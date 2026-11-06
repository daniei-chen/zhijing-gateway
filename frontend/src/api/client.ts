/**
 * Axios HTTP Client Configuration
 * Base client with interceptors for authentication, token refresh, and error handling
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import type { ApiResponse } from '@/types'
import { getLocale } from '@/i18n'
import {
  ADMIN_UI_REQUEST_HEADER,
  USER_UI_REQUEST_HEADER,
  shouldMarkAdminUIRequest,
  shouldMarkUserUIRequest,
} from './adminUIRequest'
import { refreshAuthTokens } from './tokenRefresh'
import { getAPIBaseURL } from './url'
import { BROWSER_SESSION_HEADER, browserSessionHeaders, isBrowserSessionHandle } from './browserSession'
import {
  assertAuthSession, AuthSessionChangedError, captureAuthSession, captureRequestAuthSession,
  clearStoredAuthSession, isAuthSessionCurrent, trackAuthRequest, type AuthSessionSnapshot
} from './authSession'
export { buildApiUrl, buildGatewayUrl } from './url'

// ==================== Axios Instance Configuration ====================

export const apiClient: AxiosInstance = axios.create({
  baseURL: getAPIBaseURL(),
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// ==================== Request Interceptor ====================

interface SessionRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
  _authSession?: AuthSessionSnapshot
  _authCleanup?: () => void
  _authExternalSignal?: InternalAxiosRequestConfig['signal']
}

function responseSession(config?: InternalAxiosRequestConfig): AuthSessionSnapshot | undefined {
  const bound = (config as SessionRequestConfig | undefined)?._authSession
  if (bound) return bound
  // Compatibility for custom adapters that omit unknown config fields. A real
  // browser adapter preserves the original stamp. Never adopt a different bearer.
  const auth = config?.headers?.Authorization ?? config?.headers?.authorization
  const cookieSelector = config?.headers?.[BROWSER_SESSION_HEADER] ?? config?.headers?.[BROWSER_SESSION_HEADER.toLowerCase()]
  const current = localStorage.getItem('auth_token')
  if (auth && auth !== `Bearer ${current}`) throw new AuthSessionChangedError()
  if (isBrowserSessionHandle(cookieSelector) && cookieSelector !== current) throw new AuthSessionChangedError()
  if (typeof cookieSelector === 'string' && cookieSelector.startsWith('init.') &&
      cookieSelector !== `init.${captureAuthSession().generation}`) throw new AuthSessionChangedError()
  return config ? captureAuthSession() : undefined
}

// Get user's timezone
const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

apiClient.interceptors.request.use(
  (config: SessionRequestConfig) => {
    if (config._authSession) assertAuthSession(config._authSession)
    else { config._authSession = captureRequestAuthSession(); config._authExternalSignal = config.signal }
    const token = localStorage.getItem('auth_token')
    assertAuthSession(config._authSession)
    const controller = new AbortController()
    const originalSignal = config._authExternalSignal
    const abort = () => controller.abort()
    if (originalSignal?.aborted) abort()
    else originalSignal?.addEventListener?.('abort', abort, { once: true })
    const untrack = trackAuthRequest(config._authSession, abort)
    config._authCleanup = () => { untrack(); originalSignal?.removeEventListener?.('abort', abort) }
    config.signal = controller.signal
    // Attach token from localStorage
    if (config.headers) {
      const url = String(config.url || '')
      const target = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) ? url : String(config.baseURL || getAPIBaseURL())
      const sessionHeaders = browserSessionHeaders(token, config._authSession, target)
      if (isBrowserSessionHandle(token)) delete config.headers.Authorization
      for (const [name, value] of Object.entries(sessionHeaders)) config.headers[name] = value
    }

    // Attach locale for backend translations
    if (config.headers) {
      config.headers['Accept-Language'] = getLocale()
    }

    // Attach timezone for all GET requests (backend may use it for default date ranges)
    if (config.method === 'get') {
      if (!config.params) {
        config.params = {}
      }
      config.params.timezone = getUserTimezone()
    }

    if (config.headers) {
      const requestURL = String(config.url || '')
      if (shouldMarkAdminUIRequest(requestURL)) {
        config.headers[ADMIN_UI_REQUEST_HEADER] = '1'
      }
      if (shouldMarkUserUIRequest(requestURL)) {
        config.headers[USER_UI_REQUEST_HEADER] = '1'
      }
    }

    return config
  },
  (error) => {
    throw error
  },
  { synchronous: true }
)

// ==================== Response Interceptor ====================

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    const config = response.config as SessionRequestConfig | undefined
    config?._authCleanup?.()
    try {
      const session = responseSession(config)
      if (session) assertAuthSession(session)
    } catch {
      return Promise.reject(new AuthSessionChangedError())
    }
    // An upgraded backend advertises cookie support. Migrate a legacy browser
    // pair after /auth/me succeeds, retaining the existing cross-tab refresh lock.
    // Older backends never advertise this and retain their existing contract.
    const supportsCookie = String(response.headers?.['x-zhijing-session-supported'] || '') === '1'
    if (supportsCookie && config?._authSession?.subject && String(config.url).split('?')[0]?.endsWith('/auth/me')) {
      const token = localStorage.getItem('auth_token')
      if (token && !isBrowserSessionHandle(token) && localStorage.getItem('refresh_token')) {
        void refreshAuthTokens({ session: config._authSession }).catch(() => { /* A later authenticated profile refresh retries migration. */ })
      }
    }
    // Unwrap standard API response format { code, message, data }
    const apiResponse = response.data as ApiResponse<unknown>
    if (apiResponse && typeof apiResponse === 'object' && 'code' in apiResponse) {
      if (apiResponse.code === 0) {
        // Success - return the data portion
        response.data = apiResponse.data
      } else {
        // API error
        const resp = apiResponse as unknown as Record<string, unknown>
        return Promise.reject({
          status: response.status,
          code: apiResponse.code,
          message: apiResponse.message || 'Unknown error',
          reason: resp.reason,
          metadata: resp.metadata,
        })
      }
    }
    return response
  },
  async (error: AxiosError<ApiResponse<unknown>>) => {
    if (error.code === 'AUTH_SESSION_CHANGED') return Promise.reject(error)
    const originalRequest = error.config as SessionRequestConfig | undefined
    originalRequest?._authCleanup?.()
    if (originalRequest?._authSession && !isAuthSessionCurrent(originalRequest._authSession)) return Promise.reject(new AuthSessionChangedError())
    // Request cancellation: keep the original axios cancellation error so callers can ignore it.
    // Otherwise we'd misclassify it as a generic "network error".
    if (error.code === 'ERR_CANCELED' || axios.isCancel(error)) {
      return Promise.reject(error)
    }
    // Custom adapters can omit the private stamp while retaining the standard
    // credential headers. Check their owner before every global error effect,
    // including feature flags and compliance prompts on non-401 responses.
    let requestSession: AuthSessionSnapshot | undefined
    try {
      requestSession = responseSession(originalRequest)
      if (requestSession) assertAuthSession(requestSession)
    } catch {
      return Promise.reject(new AuthSessionChangedError())
    }

    // Handle common errors
    if (error.response) {
      const { status, data } = error.response
      const url = String(error.config?.url || '')

      // Validate `data` shape to avoid HTML error pages breaking our error handling.
      const apiData = (typeof data === 'object' && data !== null ? data : {}) as Record<string, any>

      // Ops monitoring disabled: treat as feature-flagged 404, and proactively redirect away
      // from ops pages to avoid broken UI states.
      if (status === 404 && apiData.message === 'Ops monitoring is disabled') {
        try {
          localStorage.setItem('ops_monitoring_enabled_cached', 'false')
        } catch {
          // ignore localStorage failures
        }
        try {
          window.dispatchEvent(new CustomEvent('ops-monitoring-disabled'))
        } catch {
          // ignore event failures
        }

        if (window.location.pathname.startsWith('/admin/ops')) {
          window.location.href = '/admin/settings'
        }

        return Promise.reject({
          status,
          code: 'OPS_DISABLED',
          message: apiData.message || error.message,
          url
        })
      }

      if (status === 423 && apiData.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED') {
        try {
          window.dispatchEvent(new CustomEvent('admin-compliance-required', {
            detail: apiData.metadata || {}
          }))
        } catch {
          // ignore event failures
        }

        return Promise.reject({
          status,
          code: apiData.code,
          message: apiData.message || error.message,
          metadata: apiData.metadata,
        })
      }

      // 401: Try to refresh the token if we have a refresh token
      // This handles TOKEN_EXPIRED, INVALID_TOKEN, TOKEN_REVOKED, etc.
      if (status === 401 && originalRequest && !originalRequest._retry) {
        const refreshToken = localStorage.getItem('refresh_token')
        const isAuthEndpoint =
          url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh')

        // If we have a refresh token and this is not an auth endpoint, try to refresh
        if (refreshToken && !isAuthEndpoint) {
          const refreshSessionUser = localStorage.getItem('auth_user')
          originalRequest._retry = true

          try {
            const headers = originalRequest.headers as Record<string, unknown> | undefined
            const authHeader = headers?.Authorization ?? headers?.authorization
            const cookieSelector = headers?.[BROWSER_SESSION_HEADER] ?? headers?.[BROWSER_SESSION_HEADER.toLowerCase()]
            const failedAccessToken =
              typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
                ? authHeader.slice('Bearer '.length)
                : typeof cookieSelector === 'string' && isBrowserSessionHandle(cookieSelector) ? cookieSelector : null
            const tokens = await refreshAuthTokens({ failedAccessToken, session: requestSession })
            if (requestSession) assertAuthSession(requestSession)

            // Retry the original request with the refreshed token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${tokens.access_token}`
            }
            return apiClient(originalRequest)
          } catch (refreshError) {
            // A stale request must never destroy a session that was logged out or replaced while
            // its refresh was in flight (for example, when another tab signs in as another user).
            const sessionChanged = requestSession ? !isAuthSessionCurrent(requestSession) : (
              localStorage.getItem('refresh_token') !== refreshToken ||
              localStorage.getItem('auth_user') !== refreshSessionUser)
            if (sessionChanged) {
              return Promise.reject({
                status: 401,
                code: 'AUTH_SESSION_CHANGED',
                message: 'Authentication session changed while refreshing.'
              })
            }

            if (axios.isAxiosError(refreshError)) {
              const refreshStatus = refreshError.response?.status ?? 0
              if (refreshStatus === 0 || refreshStatus === 429 || refreshStatus >= 500) {
                return Promise.reject({
                  status: refreshStatus,
                  code: 'TOKEN_REFRESH_UNAVAILABLE',
                  message: refreshError.response?.data?.message || refreshError.message
                })
              }
            }

            // Clear tokens and redirect to login
            if (!clearStoredAuthSession(requestSession)) return Promise.reject(new AuthSessionChangedError())
            sessionStorage.setItem('auth_expired', '1')

            if (!window.location.pathname.includes('/login')) {
              window.location.href = '/login'
            }

            return Promise.reject({
              status: 401,
              code: 'TOKEN_REFRESH_FAILED',
              message: 'Session expired. Please log in again.'
            })
          }
        }

        // No refresh token or is auth endpoint - clear auth and redirect
        const hasToken = !!localStorage.getItem('auth_token')
        const headers = error.config?.headers as Record<string, unknown> | undefined
        const authHeader = headers?.Authorization ?? headers?.authorization
        const sentAuth =
          typeof authHeader === 'string'
            ? authHeader.trim() !== ''
            : Array.isArray(authHeader)
              ? authHeader.length > 0
              : !!authHeader

        if (!clearStoredAuthSession(requestSession)) return Promise.reject(new AuthSessionChangedError())
        if ((hasToken || sentAuth) && !isAuthEndpoint) {
          sessionStorage.setItem('auth_expired', '1')
        }
        // Only redirect if not already on login page
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login'
        }
      }

      // Return structured error
      return Promise.reject({
        status,
        code: apiData.code,
        reason: apiData.reason,
        error: apiData.error,
        message: apiData.message || apiData.detail || error.message,
        metadata: apiData.metadata,
      })
    }

    // Network error
    return Promise.reject({
      status: 0,
      code: error.code || 'ERR_NETWORK',
      message: 'Network error. Please check your connection.'
    })
  }
)

export default apiClient
