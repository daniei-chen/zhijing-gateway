import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { type InternalAxiosRequestConfig } from 'axios'
import type { User } from '@/types'

vi.mock('@/i18n', () => ({ getLocale: () => 'zh-CN' }))

function user(id: number): User {
  return { id, username: `SYNTHETIC-${id}`, email: `user-${id}@example.test`, role: 'user', balance: 0, concurrency: 3, status: 'active', allowed_groups: null, created_at: '2026-01-01', updated_at: '2026-01-01' }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function ok(config: InternalAxiosRequestConfig, data: unknown) { return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } } }
const pair = (id: number) => ({ access_token: `SYNTHETIC-${id}-access`, refresh_token: `SYNTHETIC-${id}-refresh`, expires_in: 3600, token_type: 'Bearer' })
let dispose: (() => void) | undefined
beforeEach(() => { vi.resetModules(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/login') })
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks() })

async function setup() {
  // A new module graph represents a fresh document. Recreate this factory too,
  // so it cannot retain the previous document's real client across resetModules.
  vi.doMock('@/api', async () => {
    const auth = await import('@/api/auth')
    return { authAPI: auth, isTotp2FARequired: auth.isTotp2FARequired, passkeyAPI: { login: vi.fn() } }
  })
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/auth')
  const { apiClient } = await import('@/api/client')
  const store = useAuthStore()
  dispose = () => store.$dispose()
  const sessions = await import('@/api/authSession')
  apiClient.defaults.adapter = async config => ok(config, config.url === '/auth/login' ? { ...pair(101), user: user(101) } : config.url === '/auth/me' ? user(101) : {})
  await store.login({ email: 'user-101@example.test', password: 'SYNTHETIC' })
  return { store, apiClient, sessions }
}

describe('actual auth API → client → browser session → store', () => {
  it('completes password login, profile refresh and logout', async () => {
    const { store, sessions } = await setup()
    expect(store.user?.id).toBe(101)
    expect(localStorage.getItem('auth_token')).toBe(pair(101).access_token)
    const initial = sessions.captureAuthSession()
    await store.refreshUser()
    expect(sessions.captureAuthSession()).toEqual(initial)
    await store.logout()
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(sessions.isAuthSessionCurrent(initial)).toBe(false)
  })

  it.each(['get', 'post', 'put', 'delete'] as const)('never replays an old %s operation with replacement credentials', async method => {
    const { store, apiClient, sessions } = await setup()
    const first = deferred<never>()
    const calls: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = config => { calls.push(config); return first.promise }
    const refresh = vi.spyOn(axios, 'post')
    const result = apiClient.request({ method, url: '/keys', data: { name: 'A intended key' } }).catch(error => error)
    expect(calls).toHaveLength(1)
    sessions.replaceAuthSession({ accessToken: pair(202).access_token, refreshToken: pair(202).refresh_token, user: user(202), expiresIn: 3600 })
    first.reject({ config: calls[0], response: { status: 401, data: { code: 'TOKEN_EXPIRED' } } })
    await expect(result).resolves.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(calls).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
    expect(store.user?.id).toBe(202)
    expect(localStorage.getItem('auth_token')).toBe(pair(202).access_token)
    // Cached controls belonging to A cannot issue a fresh action until the view resets.
    await expect(apiClient.post('/keys', { name: 'stale view action' })).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(calls).toHaveLength(1)
  })

  it('rejects A’s late success before the real store can write it back', async () => {
    const { store, apiClient, sessions } = await setup()
    const response = deferred<ReturnType<typeof ok>>()
    let sent!: InternalAxiosRequestConfig
    apiClient.defaults.adapter = config => { sent = config; return response.promise }
    const result = store.refreshUser().catch(error => error)
    sessions.replaceAuthSession({ accessToken: pair(202).access_token, refreshToken: pair(202).refresh_token, user: user(202) })
    response.resolve(ok(sent, user(101)))
    await expect(result).resolves.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(store.user?.id).toBe(202)
    expect(JSON.parse(localStorage.getItem('auth_user')!).id).toBe(202)
  })

  it('does not reuse a later login generation even when the user id is unchanged', async () => {
    const { apiClient, sessions } = await setup()
    const first = deferred<never>()
    const calls: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = config => { calls.push(config); return first.promise }
    const result = apiClient.post('/keys', { name: 'previous login intent' }).catch(error => error)
    const initial = sessions.captureAuthSession()
    sessions.clearStoredAuthSession(initial)
    sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-A-new-login', refreshToken: 'SYNTHETIC-A-new-refresh', user: user(101) })
    expect(sessions.captureAuthSession().generation).not.toBe(initial.generation)
    first.reject({ config: calls[0], response: { status: 401, data: {} } })
    await expect(result).resolves.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(calls).toHaveLength(1)
    expect(localStorage.getItem('auth_token')).toBe('SYNTHETIC-A-new-login')
  })

  it('preserves B when A’s real logout finishes late', async () => {
    const { store, apiClient, sessions } = await setup()
    const response = deferred<ReturnType<typeof ok>>()
    let sent!: InternalAxiosRequestConfig
    apiClient.defaults.adapter = config => { sent = config; return response.promise }
    const result = store.logout()
    sessions.replaceAuthSession({ accessToken: pair(202).access_token, refreshToken: pair(202).refresh_token, user: user(202) })
    response.resolve(ok(sent, {}))
    await result
    expect(store.user?.id).toBe(202)
    expect(localStorage.getItem('auth_token')).toBe(pair(202).access_token)
  })

  it('keeps normal same-session 401 refresh, retry and store synchronization', async () => {
    const { store, apiClient, sessions } = await setup()
    const initial = sessions.captureAuthSession()
    const seen: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = async config => {
      seen.push(config)
      if (seen.length === 1) throw { config, response: { status: 401, data: { code: 'TOKEN_EXPIRED' } } }
      return ok(config, { accepted: true })
    }
    vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { code: 0, data: { ...pair(101), access_token: 'SYNTHETIC-101-rotated', refresh_token: 'SYNTHETIC-101-rotated-refresh' } } })
    await expect(apiClient.get('/keys')).resolves.toMatchObject({ data: { accepted: true } })
    expect(seen).toHaveLength(2)
    expect(seen[1].headers.Authorization).toBe('Bearer SYNTHETIC-101-rotated')
    expect(store.token).toBe('SYNTHETIC-101-rotated')
    expect(sessions.captureAuthSession()).toEqual(initial)
    expect(sessions.authDocumentIsStale()).toBe(false)
  })

  it('does not join another account’s in-flight refresh or restore its result', async () => {
    const { sessions } = await setup()
    const { refreshAuthTokens } = await import('@/api/tokenRefresh')
    const a = deferred<{ data: { code: number; data: ReturnType<typeof pair> } }>()
    const b = deferred<{ data: { code: number; data: ReturnType<typeof pair> } }>()
    const post = vi.spyOn(axios, 'post').mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const old = refreshAuthTokens().catch(error => error)
    sessions.replaceAuthSession({ accessToken: pair(202).access_token, refreshToken: pair(202).refresh_token, user: user(202) })
    const fresh = refreshAuthTokens()
    expect(post).toHaveBeenCalledTimes(2)
    b.resolve({ data: { code: 0, data: { ...pair(202), access_token: 'SYNTHETIC-B-rotated' } } })
    await expect(fresh).resolves.toMatchObject({ access_token: 'SYNTHETIC-B-rotated' })
    a.resolve({ data: { code: 0, data: pair(101) } })
    await expect(old).resolves.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(localStorage.getItem('auth_token')).toBe('SYNTHETIC-B-rotated')
    expect(JSON.parse(localStorage.getItem('auth_user')!).id).toBe(202)
  })

  it('never treats a mixed or unfinished credential write as a committed session', async () => {
    const { apiClient, sessions } = await setup()
    const adapter = vi.fn()
    apiClient.defaults.adapter = adapter
    localStorage.setItem('refresh_token', 'SYNTHETIC-foreign-refresh')
    await expect(apiClient.post('/keys', {})).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(adapter).not.toHaveBeenCalled()
    expect(() => sessions.captureAuthSession()).toThrow()
  })
})
