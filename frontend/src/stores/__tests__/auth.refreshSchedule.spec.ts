import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { login, refreshToken, getCurrentUser } = vi.hoisted(() => ({
  login: vi.fn(), refreshToken: vi.fn(), getCurrentUser: vi.fn()
}))
vi.mock('@/api', () => ({
  authAPI: { login, refreshToken, getCurrentUser },
  isTotp2FARequired: () => false,
  passkeyAPI: { login: vi.fn() }
}))

const user = {
  id: 701, username: 'SYNTHETIC', email: 'refresh@example.test', role: 'user',
  balance: 0, concurrency: 3, status: 'active', allowed_groups: null,
  created_at: '2026-01-01', updated_at: '2026-01-01'
}
const pair = (expires: number) => ({
  access_token: 'SYNTHETIC-access', refresh_token: 'SYNTHETIC-refresh',
  expires_in: expires, token_type: 'Bearer'
})
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
  localStorage.clear()
  vi.resetAllMocks()
  refreshToken.mockImplementation(() => new Promise(() => {}))
  getCurrentUser.mockResolvedValue({ data: user })
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function signIn(expires: number) {
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/auth')
  const store = useAuthStore()
  dispose = () => store.$dispose()
  login.mockResolvedValue({ ...pair(expires), user })
  await store.login({ email: user.email, password: 'SYNTHETIC-password' })
  return store
}

describe('proactive token refresh scheduling', () => {
  it('does not immediately refresh a newly issued short-lived token', async () => {
    await signIn(60)
    expect(refreshToken).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(refreshToken).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('schedules one future refresh after a short-lived token rotates', async () => {
    let resolveRefresh!: (value: ReturnType<typeof pair>) => void
    refreshToken.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve }))
    await signIn(60)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshToken).toHaveBeenCalledTimes(1)
    const { captureAuthSession, commitAuthTokenRotation } = await import('@/api/authSession')
    const rotated = { ...pair(60), access_token: 'SYNTHETIC-rotated' }
    commitAuthTokenRotation(captureAuthSession(), rotated)
    resolveRefresh(rotated)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(refreshToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshToken).toHaveBeenCalledTimes(2)
  })

  it('does not postpone a scheduled refresh when the profile is synchronized', async () => {
    const store = await signIn(200)
    await vi.advanceTimersByTimeAsync(60_000)
    await store.refreshUser()
    await vi.advanceTimersByTimeAsync(40_000)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not overflow the browser timeout for a long-lived token', async () => {
    await signIn(30 * 24 * 60 * 60)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refreshToken).not.toHaveBeenCalled()
  })

  it('stops refreshing after the store is disposed', async () => {
    await signIn(60)
    dispose?.()
    dispose = undefined
    await vi.advanceTimersByTimeAsync(120_000)
    expect(refreshToken).not.toHaveBeenCalled()
  })
})
