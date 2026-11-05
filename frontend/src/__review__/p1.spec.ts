import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { type InternalAxiosRequestConfig } from 'axios'

const mocks = vi.hoisted(() => ({ current: vi.fn(), login: vi.fn() }))
vi.mock('@/i18n', () => ({ getLocale: () => 'zh-CN' }))
vi.mock('@/api', () => ({
  authAPI: { getCurrentUser: mocks.current, login: mocks.login },
  isTotp2FARequired: () => false,
  passkeyAPI: { login: vi.fn() }
}))

function session(id: number, refresh = true) {
  localStorage.setItem('auth_token', `SYNTHETIC-${id}-access`)
  localStorage.setItem('auth_user', JSON.stringify({ id }))
  localStorage.setItem('token_expires_at', String(Date.now() + 3_600_000))
  if (refresh) localStorage.setItem('refresh_token', `SYNTHETIC-${id}-refresh`)
  else localStorage.removeItem('refresh_token')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/login')
})
afterEach(() => vi.restoreAllMocks())

describe('ZJ-01 secure-session acceptance (red on the reviewed baseline)', () => {
  it('must not replay A’s POST with B’s credentials after a late 401', async () => {
    session(101)
    const { apiClient } = await import('@/api/client')
    const first = deferred<never>()
    const seen: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = async config => {
      seen.push(config)
      if (seen.length === 1) return first.promise
      return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: { ok: true } } }
    }
    const refresh = vi.spyOn(axios, 'post').mockRejectedValue(new Error('Unexpected network refresh'))
    const pending = apiClient.post('/keys', { name: 'A intended key' }).then(() => 'resolved', err => err.code)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    session(202)
    first.reject({ config: seen[0], response: { status: 401, data: { code: 'TOKEN_EXPIRED' } } })
    const result = await pending
    console.log(JSON.stringify({ probe: 'ZJ-01-write', result, requests: seen.length, replay_authorization: seen[1]?.headers.Authorization, refresh_calls: refresh.mock.calls.length }))
    expect(result).toBe('AUTH_SESSION_CHANGED')
    expect(seen).toHaveLength(1)
  })

  it('must not clear B’s session when A’s no-refresh request returns 401', async () => {
    session(101, false)
    const { apiClient } = await import('@/api/client')
    const response = deferred<never>()
    let sent!: InternalAxiosRequestConfig
    apiClient.defaults.adapter = config => { sent = config; return response.promise }
    const pending = apiClient.get('/auth/me').catch(err => err)
    await vi.waitFor(() => expect(sent).toBeDefined())
    session(202, false)
    response.reject({ config: sent, response: { status: 401, data: {} } })
    await pending
    console.log(JSON.stringify({ probe: 'ZJ-01-late-401', current_access_preserved: localStorage.getItem('auth_token') === 'SYNTHETIC-202-access' }))
    expect(localStorage.getItem('auth_token')).toBe('SYNTHETIC-202-access')
  })

  it('must not overwrite B’s user with A’s late successful user response', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.token = 'SYNTHETIC-101-access'
    store.user = { id: 101 } as typeof store.user
    session(101)
    const first = deferred<{ data: { id: number } }>()
    mocks.current.mockReturnValueOnce(first.promise)
    const pending = store.refreshUser().catch(err => err)
    store.token = 'SYNTHETIC-202-access'
    store.user = { id: 202 } as typeof store.user
    session(202)
    first.resolve({ data: { id: 101 } })
    await pending
    console.log(JSON.stringify({ probe: 'ZJ-01-user-writeback', token: store.token, user_id: store.user?.id }))
    expect(store.user?.id).toBe(202)
    expect(JSON.parse(localStorage.getItem('auth_user')!).id).toBe(202)
  })
})

describe('ZJ-02 embedded authorization acceptance (red on the reviewed baseline)', () => {
  it('must not put the original login token in an external iframe URL', async () => {
    const { buildEmbeddedUrl } = await import('@/utils/embedded-url')
    const url = new URL(buildEmbeddedUrl('https://third-party.example.test/docs', 42, 'SYNTHETIC-LOGIN-ACCESS-TOKEN'))
    console.log(JSON.stringify({ probe: 'ZJ-02', login_token_in_query: url.searchParams.has('token'), origin: url.origin }))
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.toString()).not.toContain('SYNTHETIC-LOGIN-ACCESS-TOKEN')
  })
})
