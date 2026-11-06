/**
 * Presentation settings through actual DOM/children and settingsAPI/Axios.
 * Presentation plumbing follows the existing 084 configuration fixture, but
 * requests/expected fields here independently target the Go presentation DTO.
 * Every HTTP request is intercepted by the synthetic adapter below; no email,
 * provider, business account, production settings or credentials are used.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import SettingsView from '../SettingsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), publicSettings: vi.fn(), adminSettings: vi.fn() }))
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/admin/settings')>('@/api/admin/settings')
  const { totpAPI } = await vi.importActual<typeof import('@/api/totp')>('@/api/totp')
  const real = new Set(['getSettings', 'updateSettings', 'testSmtpConnection', 'sendTestEmail', 'getWebSearchEmulationConfig', 'updateWebSearchEmulationConfig'])
  const settings = new Proxy(actual.settingsAPI, { get: (target, key) => real.has(String(key)) ? Reflect.get(target, key) : key === 'getAdminApiKey' ? async () => ({ exists: false }) : async () => ({ enabled: false, providers: [], rules: [] }) })
  return { totpAPI, adminAPI: {
    settings, accounts: new Proxy({}, { get: () => async () => ({ enabled: false }) }),
    groups: { getAll: async () => [] }, proxies: { list: async () => ({ items: [] }) }, payment: { getProviders: async () => ({ data: [] }) },
  } }
})
vi.mock('@/api/admin/affiliates', () => { const affiliatesAPI = { listUsers: async () => ({ items: [], total: 0 }) }; return { affiliatesAPI, default: affiliatesAPI } })
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, fetchPublicSettings: feedback.publicSettings }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: feedback.adminSettings }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
type Wire = { method: string; path: string; body: Record<string, unknown>; config: InternalAxiosRequestConfig }
type Reply = { status: number; message?: string; reason?: string }
let requests: Wire[]
let serverSettings: Record<string, unknown>
let rejectNext: Reply | undefined
let pendingWrite: ReturnType<typeof deferred<Reply>> | undefined
let stepUpNext: boolean
let responseOverrides: Record<string, unknown>
let searchSettings: Record<string, unknown>
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const writes = () => requests.filter(request => request.method === 'put' && request.path === '/admin/settings')
const body = () => writes().at(-1)!.body
const menu = (id: string, label: string, sort: number) => ({ id, label, icon_svg: '', url: `https://${id}.example.test/`, visibility: 'user', sort_order: sort, hide_open_button: false })
const documents = () => [{ id: 'terms', title: 'Synthetic Terms', content_md: '# Synthetic policy\n\nSafe fixture.' }]
const baseSettings = () => ({
  site_name: '105 Synthetic boundary', site_subtitle: 'Synthetic workspace', site_logo: 'https://images.example.test/logo.png',
  api_base_url: 'https://api.example.test/v1', contact_info: 'support@example.test', doc_url: 'https://docs.example.test/', home_content: '# Synthetic home',
  compact_home_enabled: false, backend_mode_enabled: false, table_default_page_size: 20, table_page_size_options: [10, 20, 50],
  custom_menu_items: [menu('alpha', 'Alpha workspace', 0), menu('beta', 'Beta workspace', 1)], custom_endpoints: [{ name: '105 Endpoint', endpoint: 'https://endpoint.example.test/v1', description: 'Synthetic endpoint' }],
  default_subscriptions: [], payment_enabled: false, registration_enabled: true, email_verify_enabled: true, password_reset_enabled: true, frontend_url: 'https://frontend.example.test/', oidc_connect_enabled: true, oidc_connect_client_id: '105-oidc-client', oidc_connect_clock_skew_seconds: 120, turnstile_enabled: true, turnstile_site_key: '105-synthetic-sitekey', turnstile_secret_key_configured: true,
  login_agreement_enabled: true, login_agreement_mode: 'modal', login_agreement_updated_at: '2026-11-06', login_agreement_documents: documents(),
  smtp_host: 'smtp.example.test', smtp_port: 587, smtp_username: 'synthetic-mail-user', smtp_password_configured: true,
  smtp_from_email: 'sender@example.test', smtp_from_name: 'Synthetic Sender', smtp_use_tls: true,
  subscription_expiry_notify_enabled: true, balance_low_notify_enabled: true, balance_low_notify_threshold: 4.5,
  balance_low_notify_recharge_url: 'https://recharge.example.test/', account_quota_notify_enabled: true,
  account_quota_notify_emails: [{ email: 'operations@example.test', disabled: false, verified: true }],
})
function response(config: InternalAxiosRequestConfig, data: unknown, reply: Reply = { status: 200 }) {
  const value = { status: reply.status, statusText: String(reply.status), data: { code: reply.status >= 400 ? 400 : 0, data, ...(reply.message ? { message: reply.message } : {}), ...(reply.reason ? { reason: reply.reason } : {}) }, headers: {}, config }
  if (reply.status >= 400) throw new AxiosError('Synthetic settings refusal', 'ERR_BAD_RESPONSE', config, undefined, value)
  return value
}
beforeEach(() => {
  Object.values(feedback).forEach(mock => mock.mockReset())
  feedback.publicSettings.mockResolvedValue({}); feedback.adminSettings.mockResolvedValue({})
  requests = []; serverSettings = baseSettings(); rejectNext = undefined; pendingWrite = undefined; stepUpNext = false; responseOverrides = {}; searchSettings = { enabled: false, providers: [] }
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: '105-synthetic-admin', user: { id: 105 } })
  apiClient.defaults.adapter = async config => {
    const request: Wire = { method: config.method ?? 'get', path: String(config.url), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}, config }
    requests.push(request)
    if (request.path === '/admin/settings') {
      if (request.method === 'get') return response(config, clone(serverSettings))
      if (request.method !== 'put') throw new Error('Unexpected settings method')
      if (stepUpNext) { stepUpNext = false; return response(config, null, { status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic verification required' }) }
      const reply = pendingWrite ? await pendingWrite.promise : rejectNext ?? { status: 200 }
      rejectNext = undefined
      if (reply.status >= 400) return response(config, null, reply)
      // This is a response fixture, not an implementation of Go validation.
      // Secrets are write-only in the actual DTO and therefore never echoed.
      const savedFields = clone(request.body)
      for (const key of ['smtp_password', 'turnstile_secret_key', 'oidc_connect_client_secret']) delete savedFields[key]
      serverSettings = { ...serverSettings, ...savedFields, ...responseOverrides }
      return response(config, clone(serverSettings))
    }
    if (request.path === '/admin/settings/web-search-emulation') {
      if (request.method === 'put') searchSettings = clone(request.body)
      return response(config, clone(searchSettings))
    }
    if (request.path === '/user/totp/step-up') return response(config, { verified: true, expires_in: 300 })
    if (request.path === '/admin/settings/test-smtp' || request.path === '/admin/settings/send-test-email') {
      const reply = rejectNext ?? { status: 200 }; rejectNext = undefined
      return response(config, { message: '103 synthetic diagnostic completed' }, reply)
    }
    throw new Error(`Unexpected synthetic endpoint ${request.method} ${request.path}`)
  }
})
afterEach(async () => {
  views.splice(0).forEach(view => view.unmount())
  pendingWrite?.resolve({ status: 200 }); await flushPromises()
  apiClient.defaults.adapter = previousAdapter
  vi.restoreAllMocks(); document.body.innerHTML = ''
})
async function render() {
  const view = mount(SettingsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, BackupSettings: true, AdminAccessKeysSettings: true,
    EmailTemplateEditor: true, RechargeBonusTierEditor: true, PaymentProviderDialog: true, PaymentProviderList: true,
    RouterLink: { template: '<a><slot/></a>' },
  } } })
  views.push(view); await flushPromises(); return view
}
async function tab(view: VueWrapper, key: string) { await view.get(`#settings-tab-${key}`).trigger('click'); await flushPromises() }
async function save(view: VueWrapper) { (view.get('button[type="submit"]').element as HTMLButtonElement).click(); await flushPromises() }
async function verify(view: VueWrapper) {
  expect(view.find('.z-stepup-panel[role="dialog"]').exists()).toBe(true)
  await view.get('.z-stepup-code-grid input').trigger('paste', { clipboardData: { getData: () => '123456' } })
  await flushPromises()
  expect(requests.filter(request => request.path === '/user/totp/step-up').map(request => request.body)).toEqual([{ code: '123456' }])
}


async function editVisible(view: VueWrapper, selector: string, value: string) {
  const input = view.get<HTMLInputElement>(selector)
  expect(input.isVisible(), `${selector} must actually be visible`).toBe(true)
  expect(input.element.matches(':disabled'), `${selector} must not inherit disabled fieldset`).toBe(false)
  expect(input.element.readOnly, `${selector} must be writable`).toBe(false)
  expect(input.element.closest('[inert]'), `${selector} must not be inert`).toBeNull()
  expect(view.find('.z-stepup-panel[role="dialog"]').exists(), 'edit only before the modal opens').toBe(false)
  await input.setValue(value)
}
async function settleWrite(reply: Reply = { status: 200 }) {
  const current = pendingWrite!; pendingWrite = undefined; current.resolve(reply); await flushPromises()
}
describe('Settings save snapshot and draft ownership', () => {
  it.each([
    ['security', '#settings-form-frontend-url', 'https://submitted.frontend.test/', 'https://later.frontend.test/'],
    ['general', '#settings-endpoint-endpoint-0', 'https://submitted.endpoint.test/v1', 'https://later.endpoint.test/v1'],
    ['security', '#settings-form-oidc-connect-client-id', '105-submitted-oidc-client', '105-later-oidc-client'],
    ['security', '#settings-form-turnstile-secret-key', '105-synthetic-submitted-secret', '105-synthetic-later-secret'],
  ])('does not replace the legitimate later %s draft in %s after the first pending PUT', async (category, selector, submitted, later) => {
    const view = await render(); await tab(view, category); await editVisible(view, selector, submitted)
    pendingWrite = deferred(); await save(view)
    expect(writes()).toHaveLength(1); expect(view.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await editVisible(view, selector, later); await settleWrite()
    expect(view.get<HTMLInputElement>(selector).element.value).toBe(later)
  })
  it('keeps the original custom-endpoint request after legitimate pending edits and a subsequent real step-up', async () => {
    const view = await render(); await editVisible(view, '#settings-endpoint-endpoint-0', 'https://confirmed.endpoint.test/v1')
    pendingWrite = deferred(); await save(view); const confirmed = clone(body().custom_endpoints)
    await editVisible(view, '#settings-endpoint-endpoint-0', 'https://unsaved.endpoint.test/v1')
    await settleWrite({ status: 403, reason: 'STEP_UP_REQUIRED', message: '105 synthetic verification required' })
    await verify(view)
    expect(writes()).toHaveLength(2); expect(writes()[1].body.custom_endpoints).toEqual(confirmed)
  })
  it('negative control: retains the 103-fixed site draft under the same legal pending interaction', async () => {
    const view = await render(); await editVisible(view, '#settings-form-site-name', '105 Submitted site'); pendingWrite = deferred(); await save(view)
    await editVisible(view, '#settings-form-site-name', '105 Later site'); await settleWrite()
    expect(view.get<HTMLInputElement>('#settings-form-site-name').element.value).toBe('105 Later site')
  })
  it('negative control: retains the 103-fixed SMTP secret instead of clearing a later secret', async () => {
    const view = await render(); await tab(view, 'email'); await view.get('#settings-form-smtp-password').trigger('keydown', { key: 'a' }); await editVisible(view, '#settings-form-smtp-password', '105-synthetic-first-smtp')
    pendingWrite = deferred(); await save(view); await view.get('#settings-form-smtp-password').trigger('keydown', { key: 'a' }); await editVisible(view, '#settings-form-smtp-password', '105-synthetic-later-smtp'); await settleWrite()
    expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('105-synthetic-later-smtp')
  })
  it('negative control: replays the 103-fixed menu snapshot after an editable pending period, not behind an open modal', async () => {
    const view = await render(); await editVisible(view, '#settings-menu-label-0', '105 Confirmed menu'); pendingWrite = deferred(); await save(view); const confirmed = clone(body().custom_menu_items)
    await editVisible(view, '#settings-menu-label-0', '105 Later menu'); await settleWrite({ status: 403, reason: 'STEP_UP_REQUIRED', message: '105 synthetic verification required' }); await verify(view)
    expect(writes()[1].body.custom_menu_items).toEqual(confirmed); expect(view.get<HTMLInputElement>('#settings-menu-label-0').element.value).toBe('105 Later menu')
  })

  it('accepts ordinary server normalization and explicit zero/null on controls that have not been edited', async () => {
    Object.assign(serverSettings, { openai_advanced_scheduler_enabled: true, openai_oauth_scheduling_rate_multiplier: null, default_balance: 0 })
    responseOverrides = { site_name: '105 Canonical server name', default_balance: 0, openai_oauth_scheduling_rate_multiplier: null }
    const view = await render(); await save(view)
    expect(view.get<HTMLInputElement>('#settings-form-site-name').element.value).toBe('105 Canonical server name')
    await tab(view, 'users'); expect(view.get<HTMLInputElement>('#settings-form-default-balance').element.value).toBe('0')
    await tab(view, 'gateway'); expect(view.get<HTMLInputElement>('#openai-oauth-scheduling-rate-multiplier').element.value).toBe('')
    expect(body()).toHaveProperty('openai_oauth_scheduling_rate_multiplier', null)
    expect(body().default_balance).toBe(0)
  })
  it.each([
    ['general', '#settings-table-page-size-options-input', '10,20,50', '10,20,75'],
    ['users', 'input[aria-label="openai: admin.settings.platformQuota.daily"]', '1.25', '6.75'],
    ['gateway', '#settings-scheduling-threshold-openai', '90', '75'],
    ['users', '#settings-auth-source-balance-email', '1.25', '6.75'],
    ['security', '#settings-form-oidc-connect-client-secret', '105-synthetic-first-oidc', '105-synthetic-later-oidc'],
    ['gateway', '#settings-openai-fast-error-message-0', '105 Submitted Fast message', '105 Later Fast message'],
  ])('does not bypass the generic draft boundary through %s derived state at %s', async (category, selector, first, later) => {
    Object.assign(serverSettings, {
      auth_source_default_email_grant_on_signup: true, auth_source_default_email_balance: 1,
      default_platform_quotas: { openai: { daily: 1, weekly: null, monthly: null } },
      openai_advanced_scheduler_enabled: true,
      openai_fast_policy_settings: { rules: [{ service_tier: 'fast', action: 'block', scope: 'all', error_message: '105 Initial Fast message' }] },
    })
    const view = await render(); await tab(view, category); await editVisible(view, selector, first); pendingWrite = deferred(); await save(view)
    await editVisible(view, selector, later); await settleWrite()
    expect(view.get<HTMLInputElement>(selector).element.value).toBe(later)
  })
  it.each([
    ['input[aria-label="admin.settings.registration.emailSuffixWhitelist"]', 'later-suffix.example.test'],
    ['#forwarded-client-ip-headers', 'x-later-client-ip'],
  ])('preserves an uncommitted pending input draft in %s', async (selector, value) => {
    const view = await render(); await tab(view, 'security'); pendingWrite = deferred(); await save(view)
    await editVisible(view, selector, value); await settleWrite()
    expect(view.get<HTMLInputElement>(selector).element.value).toBe(value)
  })
  it.each([
    ['input[aria-label="admin.settings.registration.emailSuffixWhitelist"]', 'new-suffix.example.test', 'registration_email_suffix_whitelist', '@new-suffix.example.test'],
    ['#forwarded-client-ip-headers', 'x-new-client-ip', 'forwarded_client_ip_headers', 'X-New-Client-Ip'],
  ])('preserves a legitimately added pending tag from %s for the next explicit save', async (selector, value, field, expected) => {
    const view = await render(); await tab(view, 'security'); pendingWrite = deferred(); await save(view)
    await editVisible(view, selector, value); await view.get(selector).trigger('keydown', { key: 'Enter' }); await settleWrite(); await save(view)
    expect(body()[field]).toContain(expected)
  })
  it('keeps the linked WeChat mode/capabilities draft when a previous save returns', async () => {
    Object.assign(serverSettings, { wechat_connect_enabled: true, wechat_connect_open_enabled: true, wechat_connect_mp_enabled: false, wechat_connect_mode: 'open', wechat_connect_scopes: 'snsapi_login' })
    const view = await render(); await tab(view, 'security'); pendingWrite = deferred(); await save(view)
    const mp = view.get<HTMLButtonElement>('[data-testid="wechat-connect-mp-enabled"]')
    expect(mp.isVisible()).toBe(true); expect(mp.element.matches(':disabled')).toBe(false)
    await mp.trigger('click'); expect(mp.attributes('aria-checked')).toBe('true'); await settleWrite()
    expect(mp.attributes('aria-checked')).toBe('true'); await save(view)
    expect(body()).toMatchObject({ wechat_connect_mp_enabled: true, wechat_connect_mode: 'mp' })
  })
  it('does not include later editable WebSearch configuration in a previous main settings save', async () => {
    searchSettings = { enabled: true, providers: [{ type: 'brave', api_key: '105-synthetic-first-search', api_key_configured: false, quota_limit: 1000, subscribed_at: null, expires_at: null, proxy_id: null }] }
    const view = await render(); await tab(view, 'gateway')
    const title = view.findAll('.cursor-pointer').find(node => node.text().toLowerCase().includes('brave'))
    expect(title).toBeDefined(); await title!.trigger('click')
    await editVisible(view, '#settings-search-key-0', '105-synthetic-confirmed-search'); pendingWrite = deferred(); await save(view)
    await editVisible(view, '#settings-search-key-0', '105-synthetic-later-search'); await settleWrite()
    const searchWrites = requests.filter(request => request.method === 'put' && request.path === '/admin/settings/web-search-emulation')
    expect(searchWrites).toHaveLength(1)
    expect((searchWrites[0].body.providers as Record<string, unknown>[])[0].api_key).toBe('105-synthetic-confirmed-search')
    expect(view.get<HTMLInputElement>('#settings-search-key-0').element.value).toBe('105-synthetic-later-search')
  })
})
