import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAuthSession, replaceAuthSession, updateAuthSessionUser } from '@/api/authSession'
import { createOAuthCallbackSession } from '../oauthCallbackSession'

describe('OAuth callback session ownership', () => {
  beforeEach(() => localStorage.clear())
  it('refuses to install a late login after another account has replaced the session', async () => {
    const callback = createOAuthCallbackSession()
    replaceAuthSession({ accessToken: 'other-access', refreshToken: 'other-refresh', user: { id: 9 } })
    const setToken = vi.fn()
    await expect(callback.login({ access_token: 'late-access' }, setToken)).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(setToken).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('other-access')
  })
  it('refuses late results and token writes after the page is disposed', async () => {
    const callback = createOAuthCallbackSession()
    callback.dispose()
    await expect(callback.wait(Promise.resolve({ access_token: 'late' }))).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    await expect(callback.login({ access_token: 'late' }, vi.fn())).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(localStorage.getItem('auth_token')).toBeNull()
  })
  it('permits its own login and subject hydration without adopting a new generation', async () => {
    const callback = createOAuthCallbackSession()
    const setToken = vi.fn(async (_token, expected) => updateAuthSessionUser(expected, { id: 7 }))
    await callback.login({ access_token: 'own-access', refresh_token: 'own-refresh', expires_in: 60 }, setToken)
    expect(callback.isCurrent()).toBe(true)
    expect(captureAuthSession().subject).toBe('7')
    expect(localStorage.getItem('refresh_token')).toBe('own-refresh')
  })
  it('does not redirect or rewrite a new account after its user lookup completes late', async () => {
    const callback = createOAuthCallbackSession()
    let finish!: () => void
    const lookup = new Promise<void>(resolve => { finish = resolve })
    const completion = callback.login({ access_token: 'own-access' }, () => lookup)
    replaceAuthSession({ accessToken: 'new-access', user: { id: 9 } })
    finish()
    await expect(completion).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(localStorage.getItem('auth_token')).toBe('new-access')
  })
})
