import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import * as accounts from '@/api/admin/accounts'
import type { AdminDataPayload, CreateAccountRequest, UpdateAccountRequest } from '@/types'

vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

// Expected paths/field names are from backend registerAccountRoutes,
// AccountHandler request structs and account_data.go, not an extracted TS table.
type Wire = {
  method: string; path: string; query: Record<string, string>; body: unknown
  timeout: number; auth: string; adminUI: string; etag: string
  accepts304: boolean; signal?: AbortSignal
}
type Reply = { value: unknown; status?: number; headers?: Record<string, string>; message?: string }
const prefix = '/api/v1/admin/accounts'
const originalAdapter = apiClient.defaults.adapter
let wire: Wire[]
let reply: Reply
let server: ((request: Wire) => Promise<Reply>) | undefined
const account = { id: 93, name: 'Synthetic account 093', platform: 'openai', type: 'oauth', credentials: {}, extra: { base_rpm: 90 }, schedulable: true }
const paginated = { items: [account], total: 1, page: 1, page_size: 20, pages: 1 }
const exported: AdminDataPayload = {
  type: 'sub2api-data', version: 1, exported_at: '2030-01-01T00:00:00Z',
  proxies: [{ proxy_key: 'synthetic-proxy-093', name: 'Synthetic proxy', protocol: 'http', host: 'proxy.synthetic.invalid', port: 8080, status: 'active' }],
  accounts: [{ name: 'Synthetic export account', platform: 'openai', type: 'apikey', credentials: { api_key: 'SYNTHETIC-NOT-REAL-093' }, extra: { base_rpm: 90 }, proxy_key: 'synthetic-proxy-093', concurrency: 3, priority: 10, rate_multiplier: 0, expires_at: 1_900_000_000, auto_pause_on_expired: false }],
  skipped_shadows: 1
}
const queryWithoutTimezone = () => {
  const { timezone, ...query } = wire[0].query
  expect(typeof timezone).toBe('string'); expect(timezone.length).toBeGreaterThan(0)
  return query
}
const request = () => { expect(wire).toHaveLength(1); return wire[0] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-account-contract-admin', user: { id: 93, role: 'admin' } })
  wire = []; reply = { value: account }; server = undefined
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid')
    const current: Wire = {
      method: String(config.method).toUpperCase(), path: url.pathname, query: Object.fromEntries(url.searchParams),
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      timeout: Number(config.timeout), auth: String(config.headers.Authorization || ''), adminUI: String(config.headers['X-Admin-UI-Request'] || ''),
      etag: String(config.headers['If-None-Match'] || ''), accepts304: config.validateStatus?.(304) === true, signal: config.signal as AbortSignal
    }
    wire.push(current)
    const response = server ? await server(current) : reply
    const status = response.status || 200
    const result = { config, status, statusText: 'Synthetic account contract response', headers: response.headers || {}, data: status === 304 ? '' : status >= 400 ? { code: status, message: response.message } : { code: 0, data: response.value } }
    if (status >= 400) throw new AxiosError(response.message, AxiosError.ERR_BAD_RESPONSE, config, undefined, result)
    return result
  }
})
afterEach(() => {
  expect(wire.every(request => request.path.startsWith('/api/v1/admin/accounts') || request.path.startsWith('/api/v1/admin/openai/'))).toBe(true)
  expect(wire.every(request => request.adminUI === '1')).toBe(true)
  apiClient.defaults.adapter = originalAdapter
})

describe('ordinary account HTTP contracts through actual Axios client', () => {
  it('sends ordinary list pagination defaults and unwraps the standard paginated envelope', async () => {
    reply = { value: paginated }
    await expect(accounts.list()).resolves.toEqual(paginated)
    expect(request()).toMatchObject({ method: 'GET', path: prefix, auth: 'Bearer synthetic-account-contract-admin', body: undefined })
    expect(queryWithoutTimezone()).toEqual({ page: '1', page_size: '20' })
  })

  it('serializes optional list filters, ungrouped, lite and scheduler-score flags without losing the search value', async () => {
    reply = { value: { ...paginated, page: 3, page_size: 25 } }
    const controller = new AbortController()
    await accounts.list(3, 25, { platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', search: 'synthetic + 中文', privacy_mode: 'privacy', lite: 'true', include_scheduler_score: 'true', sort_by: 'priority', sort_order: 'desc' }, { signal: controller.signal })
    expect(request().path).toBe(prefix)
    expect(queryWithoutTimezone()).toEqual({ page: '3', page_size: '25', platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', search: 'synthetic + 中文', privacy_mode: 'privacy', lite: 'true', include_scheduler_score: 'true', sort_by: 'priority', sort_order: 'desc' })
    expect(request().signal?.aborted).toBe(false)
  })

  it('returns account-list data and ETag without marking a normal 200 as unchanged', async () => {
    reply = { value: paginated, headers: { etag: '"accounts-093"' } }
    await expect(accounts.listWithEtag(1, 20, { status: 'inactive' })).resolves.toEqual({ notModified: false, etag: '"accounts-093"', data: paginated })
    expect(request()).toMatchObject({ method: 'GET', path: prefix, etag: '', accepts304: true })
  })

  it('accepts an account-list 304 and preserves its ETag while exposing no replacement rows', async () => {
    reply = { value: undefined, status: 304, headers: { etag: '"accounts-093"' } }
    await expect(accounts.listWithEtag(2, 50, { group: '41' }, { etag: '"accounts-093"' })).resolves.toEqual({ notModified: true, etag: '"accounts-093"', data: null })
    expect(request()).toMatchObject({ path: prefix, method: 'GET', etag: '"accounts-093"', accepts304: true })
    expect(queryWithoutTimezone()).toEqual({ page: '2', page_size: '50', group: '41' })
  })

  it('reads persisted billing-rate snapshots with the same Go page/filter contract', async () => {
    const rates = { items: [{ account_id: 93, rate_multiplier: 1.25 }], total: 1, page: 4, page_size: 10 }
    reply = { value: rates }
    await expect(accounts.getUpstreamBillingRatesWithEtag(4, 10, { platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', search: 'synthetic rates', privacy_mode: 'privacy', sort_by: 'name', sort_order: 'asc' })).resolves.toEqual({ notModified: false, etag: null, data: rates })
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/upstream-billing-rates`, body: undefined })
    expect(queryWithoutTimezone()).toEqual({ page: '4', page_size: '10', platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', search: 'synthetic rates', privacy_mode: 'privacy', sort_by: 'name', sort_order: 'asc' })
  })

  it('uses 304 for billing rates without turning it into a probe or returning stale response data', async () => {
    reply = { value: undefined, status: 304, headers: { etag: '"billing-093"' } }
    await expect(accounts.getUpstreamBillingRatesWithEtag(1, 20, undefined, { etag: '"billing-093"' })).resolves.toEqual({ notModified: true, etag: '"billing-093"', data: null })
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/upstream-billing-rates`, etag: '"billing-093"', accepts304: true })
  })

  it('keeps the minimal create DTO minimal without inventing omitted optional values', async () => {
    await expect(accounts.create({ name: 'Synthetic minimal', platform: 'openai', type: 'apikey', credentials: { api_key: 'SYNTHETIC-NOT-REAL' } })).resolves.toEqual(account)
    expect(request()).toMatchObject({ method: 'POST', path: prefix, body: { name: 'Synthetic minimal', platform: 'openai', type: 'apikey', credentials: { api_key: 'SYNTHETIC-NOT-REAL' } } })
  })

  it('preserves typed creation fields and explicit zero, false and null values from the Go request DTO', async () => {
    const payload: CreateAccountRequest = { name: 'Synthetic complete', notes: null, platform: 'openai', type: 'apikey', credentials: { api_key: 'SYNTHETIC-NOT-REAL', base_url: 'https://synthetic.invalid/v1' }, extra: { base_rpm: 120, quota_daily: 3.5 }, proxy_id: null, concurrency: 3, priority: 10, rate_multiplier: 0, load_factor: 80, group_ids: [41, 42], expires_at: 1_900_000_000, auto_pause_on_expired: false, upstream_billing_probe_enabled: false, confirm_mixed_channel_risk: true }
    await accounts.create(payload)
    expect(request()).toMatchObject({ method: 'POST', path: prefix, body: { name: 'Synthetic complete', notes: null, platform: 'openai', type: 'apikey', credentials: { api_key: 'SYNTHETIC-NOT-REAL', base_url: 'https://synthetic.invalid/v1' }, extra: { base_rpm: 120, quota_daily: 3.5 }, proxy_id: null, concurrency: 3, priority: 10, rate_multiplier: 0, load_factor: 80, group_ids: [41, 42], expires_at: 1_900_000_000, auto_pause_on_expired: false, upstream_billing_probe_enabled: false, confirm_mixed_channel_risk: true } })
  })

  it('keeps update pointer clears and false flags on the normal PUT instead of dropping them', async () => {
    const payload: UpdateAccountRequest = { name: 'Synthetic changed', notes: '', type: 'apikey', credentials: { base_url: 'https://changed.synthetic.invalid/v1' }, extra: { base_rpm: 100 }, proxy_id: 0, concurrency: 2, priority: 0, rate_multiplier: 0, load_factor: 0, group_ids: [], expires_at: 0, status: 'inactive', auto_pause_on_expired: false, upstream_billing_probe_enabled: false, upstream_billing_rate_sync_enabled: false, confirm_mixed_channel_risk: false }
    await accounts.update(93, payload)
    expect(request()).toMatchObject({ method: 'PUT', path: `${prefix}/93`, body: { name: 'Synthetic changed', notes: '', type: 'apikey', credentials: { base_url: 'https://changed.synthetic.invalid/v1' }, extra: { base_rpm: 100 }, proxy_id: 0, concurrency: 2, priority: 0, rate_multiplier: 0, load_factor: 0, group_ids: [], expires_at: 0, status: 'inactive', auto_pause_on_expired: false, upstream_billing_probe_enabled: false, upstream_billing_rate_sync_enabled: false, confirm_mixed_channel_risk: false } })
    expect(request().body).not.toHaveProperty('schedulable')
  })

  it.each(['oauth', 'setup-token'] as const)('applies %s credentials only through the dedicated merge endpoint', async type => {
    await expect(accounts.applyOAuthCredentials(93, { type, credentials: { access_token: 'SYNTHETIC-NOT-REAL', expires_at: 1_900_000_000 }, extra: { project_id: 'synthetic-project' } })).resolves.toEqual(account)
    expect(request()).toMatchObject({ method: 'POST', path: `${prefix}/93/apply-oauth-credentials`, body: { type, credentials: { access_token: 'SYNTHETIC-NOT-REAL', expires_at: 1_900_000_000 }, extra: { project_id: 'synthetic-project' } } })
  })

  it('wraps an older bare refresh account response once', async () => {
    await expect(accounts.refreshCredentials(93)).resolves.toEqual({ account })
    expect(request()).toMatchObject({ method: 'POST', path: `${prefix}/93/refresh`, body: undefined })
  })

  it('preserves the refresh warning envelope instead of double wrapping or losing its warning', async () => {
    const warning = { account, message: 'Synthetic project metadata will arrive later', warning: 'missing_project_id_temporary' }
    reply = { value: warning }
    await expect(accounts.refreshCredentials(93)).resolves.toEqual(warning)
    expect(request().path).toBe(`${prefix}/93/refresh`)
  })

  it.each([
    ['clear error', () => accounts.clearError(93), 'POST', '/93/clear-error'],
    ['clear rate limit', () => accounts.clearRateLimit(93), 'POST', '/93/clear-rate-limit'],
    ['recover runtime state', () => accounts.recoverState(93), 'POST', '/93/recover-state'],
    ['reset local quota', () => accounts.resetAccountQuota(93), 'POST', '/93/reset-quota'],
    ['set privacy', () => accounts.setPrivacy(93), 'POST', '/93/set-privacy'],
    ['revert proxy fallback', () => accounts.revertProxyFallback(93), 'POST', '/93/revert-proxy-fallback'],
    ['read temporary exclusion', () => accounts.getTempUnschedulableStatus(93), 'GET', '/93/temp-unschedulable'],
    ['clear temporary exclusion', () => accounts.resetTempUnschedulable(93), 'DELETE', '/93/temp-unschedulable'],
    ['delete account', () => accounts.deleteAccount(93), 'DELETE', '/93']
  ])('uses the registered %s route without inventing a body or extra follow-up', async (_name, action, method, suffix) => {
    await expect((action as () => Promise<unknown>)()).resolves.toEqual(account)
    expect(request()).toMatchObject({ method, path: `${prefix}${suffix}`, body: undefined })
  })

  it('sets a false schedulable value through its dedicated POST contract', async () => {
    await accounts.setSchedulable(93, false)
    expect(request()).toMatchObject({ method: 'POST', path: `${prefix}/93/schedulable`, body: { schedulable: false } })
  })

  it.each([undefined, 7])('sends stats days %s using the Go days query name and returns the server summary intact', async days => {
    const stats = { summary: { requests: 3, tokens: 120, cost: 1.25 }, history: [], models: [] }
    reply = { value: stats }
    await expect(accounts.getStats(93, days)).resolves.toEqual(stats)
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/93/stats` })
    expect(queryWithoutTimezone()).toEqual({ days: days === undefined ? '30' : '7' })
  })

  it('reads available models from the saved-account GET without discovery writes', async () => {
    const models = [{ id: 'synthetic-model-093', display_name: 'Synthetic model' }]
    reply = { value: models }
    await expect(accounts.getAvailableModels(93)).resolves.toEqual(models)
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/93/models`, body: undefined })
  })

  it('previews unsaved models with the credential DTO and preserves discovery warnings', async () => {
    const catalog = { models: ['synthetic-upstream'], metadata: { 'synthetic-upstream': { id: 'synthetic-upstream', context_window: 128000 } }, warnings: [{ code: 'synthetic_warning', message: 'Synthetic incomplete metadata' }], discovery_source: 'upstream' }
    reply = { value: catalog }
    await expect(accounts.syncUpstreamModelsPreview({ platform: 'openai', type: 'apikey', base_url: 'https://synthetic.invalid/v1', api_key: 'SYNTHETIC-NOT-REAL', model_mapping: { 'synthetic-alias': 'synthetic-upstream' } })).resolves.toEqual(catalog)
    expect(request()).toMatchObject({ method: 'POST', path: `${prefix}/models/sync-upstream-preview`, body: { platform: 'openai', type: 'apikey', base_url: 'https://synthetic.invalid/v1', api_key: 'SYNTHETIC-NOT-REAL', model_mapping: { 'synthetic-alias': 'synthetic-upstream' } } })
  })

  it('keeps persisted OpenAI quota refresh on the registered POST route', async () => {
    reply = { value: { fetched_at: 1_900_000_000, cache_persisted: true, credits_cache_persisted: true } }
    await expect(accounts.refreshOpenAIQuota(93)).resolves.toEqual(reply.value)
    expect(request()).toMatchObject({ method: 'POST', path: '/api/v1/admin/openai/accounts/93/quota/refresh', body: undefined })
  })

  it('keeps reset-credit consumption on the original POST with the existing 90-second timeout', async () => {
    reply = { value: { code: 'success', windows_reset: 1, cache_refreshed: true, account_state_recovered: true } }
    await expect(accounts.resetOpenAIQuota(93)).resolves.toEqual(reply.value)
    expect(request()).toMatchObject({ method: 'POST', path: '/api/v1/admin/openai/accounts/93/reset-quota', body: undefined, timeout: 90_000 })
  })

  it('exports selected IDs in the Go comma-list query and excludes unrelated filters', async () => {
    reply = { value: exported }
    await expect(accounts.exportData({ ids: [93, 94], filters: { platform: 'grok', search: 'ignored selection filter' }, includeProxies: false })).resolves.toEqual(exported)
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/data`, body: undefined })
    expect(queryWithoutTimezone()).toEqual({ ids: '93,94', include_proxies: 'false' })
  })

  it('exports filtered data with the Go query names and keeps default proxy inclusion implicit', async () => {
    reply = { value: exported }
    await accounts.exportData({ filters: { platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', privacy_mode: 'privacy', search: 'synthetic + 中文', sort_by: 'name', sort_order: 'asc' }, includeProxies: true })
    expect(request()).toMatchObject({ method: 'GET', path: `${prefix}/data` })
    expect(queryWithoutTimezone()).toEqual({ platform: 'openai', type: 'apikey', status: 'active', group: 'ungrouped', privacy_mode: 'privacy', search: 'synthetic + 中文', sort_by: 'name', sort_order: 'asc' })
  })

  it('falls back to filtered export for an empty ID selection without serializing empty IDs', async () => {
    reply = { value: exported }
    await accounts.exportData({ ids: [], filters: { group: '41' }, includeProxies: false })
    expect(queryWithoutTimezone()).toEqual({ group: '41', include_proxies: 'false' })
    expect(request().path).toBe(`${prefix}/data`)
  })

  it.each([undefined, false])('imports the exact data envelope with skip_default_group_bind=%s', async skip => {
    const result = { proxy_created: 1, proxy_reused: 0, proxy_failed: 0, account_created: 1, account_failed: 0, errors: [] }
    reply = { value: result }
    await expect(accounts.importData({ data: exported, skip_default_group_bind: skip })).resolves.toEqual(result)
    expect(request()).toMatchObject({ method: 'POST', path: `${prefix}/data`, body: skip === undefined ? { data: exported } : { data: exported, skip_default_group_bind: false } })
  })

  it('propagates an actual HTTP rejection as a structured client error without retrying another account endpoint', async () => {
    reply = { value: null, status: 400, message: 'Synthetic account policy rejection' }
    await expect(accounts.update(93, { notes: 'Synthetic correction needed' })).rejects.toMatchObject({ status: 400, message: 'Synthetic account policy rejection' })
    expect(request()).toMatchObject({ method: 'PUT', path: `${prefix}/93`, body: { notes: 'Synthetic correction needed' } })
  })

  it('rejects a late list result after the same administrator replaces the login', async () => {
    const pending = deferred<Reply>()
    server = () => pending.promise
    const result = accounts.list().catch(error => error)
    expect(wire).toHaveLength(1)
    replaceAuthSession({ accessToken: 'synthetic-account-contract-new-login', user: { id: 93, role: 'admin' } })
    pending.resolve({ value: paginated })
    await expect(result).resolves.toMatchObject({ code: expect.stringMatching(/AUTH_SESSION_CHANGED|ERR_CANCELED/) })
    expect(wire).toHaveLength(1)
  })
})
