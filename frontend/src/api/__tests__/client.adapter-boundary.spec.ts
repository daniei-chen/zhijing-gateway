import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({ getLocale: () => 'en' }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.resetModules()
})

afterEach(() => { vi.restoreAllMocks() })

it.each([
  { status: 404, data: { message: 'Ops monitoring is disabled' }, event: 'ops-monitoring-disabled' },
  { status: 423, data: { code: 'ADMIN_COMPLIANCE_ACK_REQUIRED', metadata: { source: 'old account' } }, event: 'admin-compliance-required' }
])('ignores a late adapter error from a replaced cookie session before $status side effects', async ({ status, data, event }) => {
  const idA = '12345678-1234-4234-8234-123456789abc'
  const idB = '22345678-1234-4234-8234-123456789abc'
  const access = (id: string) => `zjs.${id}.${'a'.repeat(32)}`
  const refresh = (id: string) => `zjr.${id}.${'a'.repeat(32)}`
  const otherTabSessions = await import('@/api/authSession')
  otherTabSessions.replaceAuthSession({ accessToken: access(idB), refreshToken: refresh(idB), user: { id: 8 } })
  const storageKeys = [otherTabSessions.AUTH_SESSION_KEY, 'auth_token', 'refresh_token', 'auth_user']
  const otherTabStorage = storageKeys.map(key => [key, localStorage.getItem(key)!] as const)
  vi.resetModules()
  const sessions = await import('@/api/authSession')
  sessions.replaceAuthSession({ accessToken: access(idA), refreshToken: refresh(idA), user: { id: 7 } })
  const { apiClient } = await import('@/api/client')
  let finish!: () => void
  apiClient.defaults.adapter = config => new Promise((_resolve, reject) => {
    // Keep standard headers while reconstructing config, as supported adapters do.
    const returnedConfig = { url: config.url, headers: config.headers }
    finish = () => reject({ config: returnedConfig, response: { status, data } })
  })
  const onObsoleteEvent = vi.fn()
  window.addEventListener(event, onObsoleteEvent)
  try {
    const request = apiClient.get('/admin/ops/overview')
    // Another tab's committed storage is visible before its queued storage
    // event runs here; cancellation has not yet notified this in-flight adapter.
    for (const [key, value] of otherTabStorage) localStorage.setItem(key, value)
    finish()
    await expect.soft(request).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect.soft(onObsoleteEvent).not.toHaveBeenCalled()
    expect.soft(localStorage.getItem('ops_monitoring_enabled_cached')).toBeNull()
    expect(localStorage.getItem('auth_token')).toBe(access(idB))
  } finally {
    window.removeEventListener(event, onObsoleteEvent)
  }
})
