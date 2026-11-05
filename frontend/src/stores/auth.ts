/**
 * Authentication Store
 * Manages user authentication state, login/logout, token refresh, and token persistence
 */

import { defineStore } from 'pinia'
import { ref, computed, readonly, onScopeDispose } from 'vue'
import { adoptDocumentAuthSession, assertAuthSession, AuthSessionChangedError, authResponseSession, captureAuthSession, clearStoredAuthSession, isAuthSessionCurrent, replaceAuthSession, subscribeAuthSession, updateAuthSessionUser, type AuthSessionSnapshot } from '@/api/authSession'
import { authAPI, isTotp2FARequired, passkeyAPI, type LoginResponse } from '@/api'
import type {
  User,
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  ActionCaptchaRequestProof
} from '@/types'

const AUTH_TOKEN_KEY = 'auth_token'
const AUTH_USER_KEY = 'auth_user'
const REFRESH_TOKEN_KEY = 'refresh_token'
const TOKEN_EXPIRES_AT_KEY = 'token_expires_at' // 存储过期时间戳而非有效期
const PENDING_AUTH_SESSION_KEY = 'pending_auth_session'
const AUTO_REFRESH_INTERVAL = 60 * 1000 // 60 seconds for user data refresh
const TOKEN_REFRESH_BUFFER = 120 * 1000 // 120 seconds before expiry to refresh token
const MIN_TOKEN_REFRESH_DELAY = 1_000
const MAX_TIMEOUT_DELAY = 2_147_483_647

type PendingAuthTokenField = 'pending_auth_token' | 'pending_oauth_token'

interface PendingAuthSessionSummary {
  token: string
  token_field: PendingAuthTokenField
  provider: string
  redirect?: string
  adoption_required?: boolean
  suggested_display_name?: string
  suggested_avatar_url?: string
}

function normalizePendingAuthTokenField(value: unknown): PendingAuthTokenField {
  return value === 'pending_oauth_token' ? 'pending_oauth_token' : 'pending_auth_token'
}

function getPersistedPendingAuthSession(): PendingAuthSessionSummary | null {
  const raw = localStorage.getItem(PENDING_AUTH_SESSION_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingAuthSessionSummary> | null
    const provider = typeof parsed?.provider === 'string' ? parsed.provider.trim() : ''
    if (!provider) {
      localStorage.removeItem(PENDING_AUTH_SESSION_KEY)
      return null
    }
    return {
      token: typeof parsed?.token === 'string' ? parsed.token : '',
      token_field: normalizePendingAuthTokenField(parsed?.token_field),
      provider,
      redirect: typeof parsed?.redirect === 'string' ? parsed.redirect : undefined,
      adoption_required: typeof parsed?.adoption_required === 'boolean' ? parsed.adoption_required : undefined,
      suggested_display_name: typeof parsed?.suggested_display_name === 'string' ? parsed.suggested_display_name : undefined,
      suggested_avatar_url: typeof parsed?.suggested_avatar_url === 'string' ? parsed.suggested_avatar_url : undefined
    }
  } catch {
    localStorage.removeItem(PENDING_AUTH_SESSION_KEY)
    return null
  }
}

function persistPendingAuthSession(session: PendingAuthSessionSummary): void {
  localStorage.setItem(PENDING_AUTH_SESSION_KEY, JSON.stringify(session))
}

function clearPendingAuthSessionStorage(): void {
  localStorage.removeItem(PENDING_AUTH_SESSION_KEY)
}

export const useAuthStore = defineStore('auth', () => {
  // ==================== State ====================

  const user = ref<User | null>(null)
  const token = ref<string | null>(null)
  const refreshTokenValue = ref<string | null>(null)
  const tokenExpiresAt = ref<number | null>(null) // 过期时间戳（毫秒）
  const runMode = ref<'standard' | 'simple'>('standard')
  const pendingAuthSession = ref<PendingAuthSessionSummary | null>(null)
  let refreshIntervalId: ReturnType<typeof setInterval> | null = null
  let tokenRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null
  let scheduledTokenExpiresAt: number | null = null
  let scheduledTokenSession: AuthSessionSnapshot | null = null

  // ==================== Computed ====================

  const isAuthenticated = computed(() => {
    return !!token.value && !!user.value
  })

  const isAdmin = computed(() => {
    return user.value?.role === 'admin'
  })

  const isSimpleMode = computed(() => runMode.value === 'simple')
  const hasPendingAuthSession = computed(() => pendingAuthSession.value !== null)

  // ==================== Actions ====================

  /**
   * Initialize auth state from localStorage
   * Call this on app startup to restore session
   * Also starts auto-refresh and immediately fetches latest user data
   */
  function checkAuth(): void {
    let expected: AuthSessionSnapshot | undefined
    try {
      // Read the cached identity and credentials between checks of the same
      // session. Another tab must not make an old user look like the new login.
      expected = captureAuthSession()
      const savedToken = localStorage.getItem(AUTH_TOKEN_KEY)
      const savedUser = localStorage.getItem(AUTH_USER_KEY)
      const savedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
      const savedExpiresAt = localStorage.getItem(TOKEN_EXPIRES_AT_KEY)
      pendingAuthSession.value = getPersistedPendingAuthSession()
      if (!savedToken || !savedUser) return
      const parsedUser = JSON.parse(savedUser) as User
      assertAuthSession(expected)
      adoptDocumentAuthSession(expected)
      token.value = savedToken
      user.value = parsedUser
      refreshTokenValue.value = savedRefreshToken
      tokenExpiresAt.value = savedExpiresAt ? parseInt(savedExpiresAt, 10) : null

      refreshUser().catch((error) => {
        console.error('Failed to refresh user on init:', error)
      })
      startAutoRefresh()
      if (savedRefreshToken && tokenExpiresAt.value !== null) {
        scheduleTokenRefreshAt(tokenExpiresAt.value, expected)
      }
    } catch (error) {
      console.error('Failed to restore saved authentication:', error)
      if (expected) clearAuth({ preservePendingAuthSession: true }, expected)
    }
  }

  /**
   * Start auto-refresh interval for user data
   * Refreshes user data every 60 seconds
   */
  function startAutoRefresh(): void {
    // Clear existing interval if any
    stopAutoRefresh()

    refreshIntervalId = setInterval(() => {
      if (token.value) {
        refreshUser().catch((error) => {
          console.error('Auto-refresh user failed:', error)
        })
      }
    }, AUTO_REFRESH_INTERVAL)
  }

  /**
   * Stop auto-refresh interval
   */
  function stopAutoRefresh(): void {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId)
      refreshIntervalId = null
    }
  }

  /**
   * Schedule proactive token refresh before expiry (based on expiry timestamp)
   * @param expiresAtMs - Token expiry timestamp in milliseconds
   */
  function scheduleTokenRefreshAt(expiresAtMs: number, expected = captureAuthSession()): void {
    assertAuthSession(expected)
    if (!Number.isFinite(expiresAtMs)) {
      stopTokenRefresh()
      return
    }

    // Profile synchronization does not change a token's expiry. Keep its existing
    // deadline instead of postponing it on every storage notification.
    if (tokenRefreshTimeoutId !== null && scheduledTokenExpiresAt === expiresAtMs &&
      scheduledTokenSession?.generation === expected.generation &&
      scheduledTokenSession.subject === expected.subject) return
    stopTokenRefresh()

    const remainingMs = Math.max(0, expiresAtMs - Date.now())
    // A fixed two-minute buffer immediately refreshes every newly issued token
    // whose lifetime is <= two minutes. Use at most half of its remaining life
    // and always yield through a timer, including for already expired tokens.
    const bufferMs = Math.min(TOKEN_REFRESH_BUFFER, remainingMs / 2)
    const refreshInMs = Math.max(MIN_TOKEN_REFRESH_DELAY, remainingMs - bufferMs)
    scheduledTokenExpiresAt = expiresAtMs
    scheduledTokenSession = expected
    tokenRefreshTimeoutId = setTimeout(() => {
      tokenRefreshTimeoutId = null
      scheduledTokenExpiresAt = null
      scheduledTokenSession = null
      if (!isAuthSessionCurrent(expected)) return
      // Browsers clamp delays above a signed 32-bit integer to ~1 ms.
      if (refreshInMs > MAX_TIMEOUT_DELAY) scheduleTokenRefreshAt(expiresAtMs, expected)
      else void performTokenRefresh(expected)
    }, Math.min(refreshInMs, MAX_TIMEOUT_DELAY))
  }

  /**
   * Schedule proactive token refresh before expiry (based on expires_in seconds)
   * @param expiresInSeconds - Token expiry time in seconds from now
   */
  function scheduleTokenRefresh(expiresInSeconds: number, expected: AuthSessionSnapshot): void {
    assertAuthSession(expected)
    const storedExpiry = Number(localStorage.getItem(TOKEN_EXPIRES_AT_KEY))
    const expiresAtMs = Number.isFinite(storedExpiry) && storedExpiry > 0
      ? storedExpiry
      : Date.now() + expiresInSeconds * 1000
    assertAuthSession(expected)
    tokenExpiresAt.value = expiresAtMs
    scheduleTokenRefreshAt(expiresAtMs, expected)
  }

  /**
   * Perform the actual token refresh
   */
  async function performTokenRefresh(expected: AuthSessionSnapshot): Promise<void> {
    if (!refreshTokenValue.value) {
      return
    }

    try {
      assertAuthSession(expected)
      const response = await authAPI.refreshToken()
      assertAuthSession(expected)

      // Update state
      token.value = response.access_token
      refreshTokenValue.value = response.refresh_token

      // The auth API already committed the expiry with the rotated credentials.
      scheduleTokenRefresh(response.expires_in, expected)
    } catch (error) {
      console.error('Token refresh failed:', error)
      // Don't clear auth here - the interceptor will handle 401 errors
    }
  }

  /**
   * Stop token refresh timeout
   */
  function stopTokenRefresh(): void {
    if (tokenRefreshTimeoutId !== null) {
      clearTimeout(tokenRefreshTimeoutId)
      tokenRefreshTimeoutId = null
    }
    scheduledTokenExpiresAt = null
    scheduledTokenSession = null
  }

  /**
   * User login
   * @param credentials - Login credentials (email and password)
   * @returns Promise resolving to the login response (may require 2FA)
   * @throws Error if login fails
   */
  async function login(credentials: LoginRequest): Promise<LoginResponse> {
    clearAuth({ preservePendingAuthSession: true })
    const expected = captureAuthSession()
    try {
      const response = await authAPI.login(credentials)

      // If 2FA is required, return the response without setting auth state
      if (isTotp2FARequired(response)) {
        assertAuthSession(expected)
        return response
      }

      // Set auth state from the response
      setAuthFromResponse(response, expected)

      return response
    } catch (error) {
      // Clear any partial state on error
      clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, expected)
      throw error
    }
  }

  /**
   * Complete login with 2FA code
   * @param tempToken - Temporary token from initial login
   * @param totpCode - 6-digit TOTP code
   * @returns Promise resolving to the authenticated user
   * @throws Error if 2FA verification fails
   */
  async function login2FA(tempToken: string, totpCode: string): Promise<User> {
    const expected = captureAuthSession()
    try {
      const response = await authAPI.login2FA({ temp_token: tempToken, totp_code: totpCode })
      setAuthFromResponse(response, expected)
      return user.value!
    } catch (error) {
      clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, expected)
      throw error
    }
  }

  async function loginWithPasskey(proof?: ActionCaptchaRequestProof): Promise<User> {
    clearAuth({ preservePendingAuthSession: true })
    const expected = captureAuthSession()
    try {
      const response = await passkeyAPI.login(proof)
      setAuthFromResponse(response, expected)
      return user.value!
    } catch (error) {
      clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, expected)
      throw error
    }
  }

  /**
   * Set auth state from an AuthResponse
   * Internal helper function
   */
  function setAuthFromResponse(response: AuthResponse, expected: AuthSessionSnapshot): void {
    const receipt = authResponseSession(response)
    assertAuthSession(receipt ?? expected)
    const active = receipt ?? replaceAuthSession({ accessToken: response.access_token, refreshToken: response.refresh_token, expiresIn: response.expires_in, user: response.user }, expected)
    // Store token and user
    token.value = response.access_token

    // Store refresh token if present
    if (response.refresh_token) {
      refreshTokenValue.value = response.refresh_token
    }

    // Extract run_mode if present
    if (response.user.run_mode) {
      runMode.value = response.user.run_mode
    }
    const { run_mode: _run_mode, ...userData } = response.user
    user.value = userData

    // Persist to localStorage
    updateAuthSessionUser(active, userData)
    clearPendingAuthSession()

    // Start auto-refresh interval for user data
    startAutoRefresh()

    // Start proactive token refresh if we have refresh token and expiry info
    if (response.refresh_token && response.expires_in) {
      scheduleTokenRefresh(response.expires_in, active)
    }
  }

  /**
   * User registration
   * @param userData - Registration data (username, email, password)
   * @returns Promise resolving to the newly registered and authenticated user
   * @throws Error if registration fails
   */
  async function register(userData: RegisterRequest): Promise<User> {
    clearAuth({ preservePendingAuthSession: true })
    const expected = captureAuthSession()
    try {
      const response = await authAPI.register(userData)

      // Use the common helper to set auth state
      setAuthFromResponse(response, expected)

      return user.value!
    } catch (error) {
      // Clear any partial state on error
      clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, expected)
      throw error
    }
  }

  /**
   * 直接设置 token（用于 OAuth/SSO 回调），并加载当前用户信息。
   * 会自动读取 localStorage 中已设置的 refresh_token 和 token_expires_in
   * @param newToken - 后端签发的 JWT access token
   */
  async function setToken(newToken: string, expected = captureAuthSession()): Promise<User> {
    assertAuthSession(expected)
    const previousToken = localStorage.getItem(AUTH_TOKEN_KEY)
    const mayAdoptCallback = !previousToken || previousToken === newToken
    const savedRefresh = mayAdoptCallback ? localStorage.getItem(REFRESH_TOKEN_KEY) : null
    const savedExpiry = mayAdoptCallback ? Number(localStorage.getItem(TOKEN_EXPIRES_AT_KEY)) : 0
    const established = previousToken === newToken ? expected : replaceAuthSession({ accessToken: newToken, refreshToken: savedRefresh, expiresIn: savedExpiry > Date.now() ? (savedExpiry - Date.now()) / 1000 : undefined }, expected)
    // Clear any previous state first (avoid mixing sessions)
    // Note: Don't clear localStorage here as OAuth callback may have set refresh_token
    stopAutoRefresh()
    stopTokenRefresh()
    token.value = null
    user.value = null

    token.value = newToken

    // Read refresh token and expires_at from localStorage if set by OAuth callback
    const savedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    const savedExpiresAt = localStorage.getItem(TOKEN_EXPIRES_AT_KEY)

    if (savedRefreshToken) {
      refreshTokenValue.value = savedRefreshToken
    }
    if (savedExpiresAt) {
      tokenExpiresAt.value = parseInt(savedExpiresAt, 10)
    }

    try {
      const userData = await refreshUser()
      if (captureAuthSession().generation !== established.generation) throw new AuthSessionChangedError()
      startAutoRefresh()

      // Start proactive token refresh if we have refresh token and expiry info
      // Note: use !== null to handle case when tokenExpiresAt.value is 0 (expired)
      if (savedRefreshToken && tokenExpiresAt.value !== null) {
        scheduleTokenRefreshAt(tokenExpiresAt.value)
      }

      clearPendingAuthSession()
      return userData
    } catch (error) {
      try {
        const current = captureAuthSession()
        if (current.generation === established.generation) clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, current)
      } catch { /* A replaced session belongs to its new owner. */ }
      throw error
    }
  }

  function setPendingAuthSession(session: PendingAuthSessionSummary | null): void {
    pendingAuthSession.value = session

    if (session) {
      persistPendingAuthSession(session)
      return
    }

    clearPendingAuthSessionStorage()
  }

  function clearPendingAuthSession(): void {
    setPendingAuthSession(null)
  }

  /**
   * User logout
   * Clears all authentication state and persisted data
   */
  async function logout(): Promise<void> {
    const expected = captureAuthSession()
    try {
      // Call API logout (revokes refresh token on server)
      await authAPI.logout()
    } catch (err) {
      // 服务端吊销失败（网络/5xx/超时）不应阻止本地登出，否则用户点了退出仍处于登录态。
      console.warn('Logout API call failed, clearing local session anyway', err)
    } finally {
      // Always clear local state (tokens, user data, refresh timers)
      clearAuth(undefined, expected)
    }
  }

  /**
   * Refresh current user data
   * Fetches latest user info from the server
   * @returns Promise resolving to the updated user
   * @throws Error if not authenticated or request fails
   */
  async function refreshUser(): Promise<User> {
    if (!token.value) {
      throw new Error('Not authenticated')
    }

    const expected = captureAuthSession()
    if (token.value !== localStorage.getItem(AUTH_TOKEN_KEY)) throw new AuthSessionChangedError()
    try {
      const response = await authAPI.getCurrentUser()
      assertAuthSession(expected)
      if (response.data.run_mode) {
        runMode.value = response.data.run_mode
      }
      const { run_mode: _run_mode, ...userData } = response.data
      updateAuthSessionUser(expected, userData)
      user.value = userData

      return userData
    } catch (error) {
      // If refresh fails with 401, clear auth state
      if ((error as { status?: number }).status === 401 && isAuthSessionCurrent(expected)) {
        clearAuth({ preservePendingAuthSession: pendingAuthSession.value !== null }, expected)
      }
      throw error
    }
  }

  /**
   * Clear all authentication state
   * Internal helper function
   */
  function clearAuth(options?: { preservePendingAuthSession?: boolean }, expected?: AuthSessionSnapshot): void {
    if (!clearStoredAuthSession(expected)) return
    // Stop auto-refresh
    stopAutoRefresh()
    // Stop token refresh
    stopTokenRefresh()

    token.value = null
    refreshTokenValue.value = null
    tokenExpiresAt.value = null
    user.value = null

    if (options?.preservePendingAuthSession) {
      pendingAuthSession.value = getPersistedPendingAuthSession()
      return
    }

    pendingAuthSession.value = null
    clearPendingAuthSessionStorage()
  }

  function syncStoredSession(): void {
    try {
      const expected = captureAuthSession()
      const savedToken = localStorage.getItem(AUTH_TOKEN_KEY)
      const savedUser = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null') as User | null
      const savedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY)
      const expiry = localStorage.getItem(TOKEN_EXPIRES_AT_KEY)
      assertAuthSession(expected)
      token.value = savedToken
      user.value = savedUser
      refreshTokenValue.value = savedRefresh
      tokenExpiresAt.value = expiry ? Number(expiry) : null
      if (savedToken && savedUser) {
        if (refreshIntervalId === null) startAutoRefresh()
        if (refreshTokenValue.value && tokenExpiresAt.value !== null) scheduleTokenRefreshAt(tokenExpiresAt.value, expected)
        else stopTokenRefresh()
      } else {
        stopAutoRefresh()
        stopTokenRefresh()
      }
    } catch { stopAutoRefresh(); stopTokenRefresh() }
  }
  const unsubscribeSession = subscribeAuthSession(syncStoredSession)
  onScopeDispose(() => { unsubscribeSession(); stopAutoRefresh(); stopTokenRefresh() })

  // ==================== Return Store API ====================

  return {
    // State
    user,
    token,
    runMode: readonly(runMode),
    pendingAuthSession: readonly(pendingAuthSession),

    // Computed
    isAuthenticated,
    isAdmin,
    isSimpleMode,
    hasPendingAuthSession,

    // Actions
    login,
    loginWithPasskey,
    login2FA,
    register,
    setToken,
    logout,
    checkAuth,
    refreshUser,
    setPendingAuthSession,
    clearPendingAuthSession
  }
})
