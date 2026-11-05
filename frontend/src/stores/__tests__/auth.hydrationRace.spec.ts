import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/api', () => ({
  authAPI: { getCurrentUser: vi.fn(), refreshToken: vi.fn() },
  isTotp2FARequired: () => false, passkeyAPI: { login: vi.fn() }
}))
let dispose: (() => void) | undefined
beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('authentication hydration snapshot', () => {
  it('rejects cached user A if another tab commits B while the cached keys are being read', async () => {
    const values = new Map<string, string>()
    let replacement: Map<string, string> | null = null
    const storage: Storage = {
      get length() { return values.size },
      clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
      removeItem: key => { values.delete(key) },
      setItem: (key, value) => { values.set(key, String(value)) },
      getItem(key) {
        const value = values.get(key) ?? null
        if (key === 'token_expires_at' && replacement) {
          const next = replacement
          replacement = null
          values.clear()
          for (const [name, content] of next) values.set(name, content)
        }
        return value
      }
    }
    vi.stubGlobal('localStorage', storage)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { captureAuthSession, replaceAuthSession, AUTH_SESSION_KEY } = await import('@/api/authSession')
    const { authSessionDigest } = await import('@/api/authSessionDigest')
    replaceAuthSession({ accessToken: 'SYNTHETIC-A', refreshToken: 'SYNTHETIC-A-refresh', user: { id: 1, role: 'admin' }, expiresIn: 3600 })
    const old = captureAuthSession()
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    dispose = () => store.$dispose()
    replacement = new Map([
      ['auth_token', 'SYNTHETIC-B'], ['refresh_token', 'SYNTHETIC-B-refresh'],
      ['auth_user', JSON.stringify({ id: 2, role: 'user' })],
      ['token_expires_at', String(Date.now() + 3600000)],
      [AUTH_SESSION_KEY, JSON.stringify({ generation: old.generation + '-replacement', subject: '2', phase: 'ready', credentials: authSessionDigest(JSON.stringify(['SYNTHETIC-B', 'SYNTHETIC-B-refresh'])) })]
    ])
    store.checkAuth()
    expect(store.isAuthenticated).toBe(false)
    expect(store.isAdmin).toBe(false)
    expect(store.user).toBeNull()
    expect(storage.getItem('auth_token')).toBe('SYNTHETIC-B')
    expect(captureAuthSession().subject).toBe('2')
  })
})
