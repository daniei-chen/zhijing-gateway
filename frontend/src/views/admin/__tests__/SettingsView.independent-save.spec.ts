/**
 * Independent DOM/Axios acceptance originally prepared during the v0.0.3 review.
 * v0.0.4 repairs setup only: the API/store exports, explicit provider expansion,
 * SMTP enablement and the established @domain wire format. No live requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError } from 'axios'
import SettingsView from '@/views/admin/SettingsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), publicRefresh: vi.fn(), adminRefresh: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, fetchPublicSettings: feedback.publicRefresh }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, fetchPublicSettings: feedback.publicRefresh }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: feedback.adminRefresh }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
vi.mock('@/api', async () => ({ totpAPI: (await import('@/api/totp')).default, adminAPI: (await import('@/api/admin')).adminAPI }))
vi.mock('@/api/admin', async () => {
  const settings = await import('@/api/admin/settings')
  return { adminAPI: {
    // Main/auxiliary settings writes and reads below use the actual exported API.
    // Independent operational cards and child pages are setup plumbing only.
    settings: { ...settings,
      getAdminApiKey: async () => ({ exists: false, masked_key: '' }),
      getOverloadCooldownSettings: async () => ({}), getPanelRateLimitSettings: async () => ({}),
      getRateLimit429CooldownSettings: async () => ({}), getStreamTimeoutSettings: async () => ({}),
      getRectifierSettings: async () => ({}), getBetaPolicySettings: async () => ({ rules: [] }),
    },
    accounts: { getUpstreamBillingProbeSettings: async () => ({}), getOllamaCloudUsageSettings: async () => ({}), getOpenCodeGoUsageSettings: async () => ({}) },
    groups: { getAll: async () => [{ id: 41, name: 'Independent subscription 108', status: 'active', subscription_type: 'subscription', platform: 'openai', rate_multiplier: 1, description: '' }] },
    proxies: { list: async () => ({ items: [] }) }, payment: { getProviders: async () => ({ data: [] }) },
  } }
})

// Written from the Go settings DTO/handler contracts and public controls.
// No author spec/setup, private serializer or component-private method is used.
function systemSettings() {
  return {
    site_name: 'Independent settings 108', site_logo: '', site_subtitle: '', api_base_url: 'https://api.synthetic.invalid',
    registration_enabled: true, email_verify_enabled: false, registration_email_suffix_whitelist: ['alpha.synthetic.invalid'],
    table_default_page_size: 20, table_page_size_options: [10, 20, 50],
    custom_endpoints: [{ name: 'Confirmed endpoint A', endpoint: 'https://gateway.synthetic.invalid/v1', description: 'Synthetic endpoint' }],
    default_balance: 0, default_concurrency: 3, default_user_rpm_limit: 0,
    default_subscriptions: [{ group_id: 41, validity_days: 30 }],
    default_platform_quotas: { openai: { daily: 0, weekly: null, monthly: 40 } },
    auth_source_default_email_grant_on_signup: true, auth_source_default_email_grant_on_first_bind: false,
    auth_source_default_email_balance: 0, auth_source_default_email_concurrency: 5,
    auth_source_default_email_subscriptions: [{ group_id: 41, validity_days: 30 }],
    auth_source_default_email_platform_quotas: { openai: { daily: 0, weekly: null, monthly: 40 } },
    openai_oauth_scheduling_rate_multiplier: null,
    github_oauth_enabled: true, github_oauth_client_id: 'synthetic-github-client-108', github_oauth_client_secret_configured: true,
    github_oauth_redirect_url: 'https://ui.synthetic.invalid/github/callback', github_oauth_frontend_redirect_url: '',
    wechat_connect_enabled: true, wechat_connect_mode: 'open', wechat_connect_scopes: 'snsapi_login',
    wechat_connect_open_enabled: true, wechat_connect_mp_enabled: false, wechat_connect_mobile_enabled: false,
    wechat_connect_app_id: 'synthetic-open-108', wechat_connect_app_secret_configured: true,
    wechat_connect_open_app_id: 'synthetic-open-108', wechat_connect_open_app_secret_configured: true,
    wechat_connect_mp_app_id: 'synthetic-mp-108', wechat_connect_mp_app_secret_configured: true,
    wechat_connect_mobile_app_id: 'synthetic-mobile-108', wechat_connect_mobile_app_secret_configured: true,
    smtp_host: 'smtp.synthetic.invalid', smtp_port: 587, smtp_username: 'synthetic-mail-user', smtp_from_email: 'sender@synthetic.invalid',
    smtp_from_name: 'Synthetic sender', smtp_use_tls: true, smtp_password_configured: true,
    openai_fast_policy_settings: { rules: [{ service_tier: 'priority', action: 'block', scope: 'all', error_message: 'Confirmed fast A' }] },
  }
}
function searchSettings() {
  return { enabled: true, providers: [{ type: 'brave', api_key: '', api_key_configured: true, quota_limit: 25, subscribed_at: 1700000000, proxy_id: null, expires_at: null, quota_used: 4 }] }
}
type Request = { method: string; path: string; raw: string | undefined; body: Record<string, any> | undefined }
type Reply = { value: unknown; status?: number; reason?: string; message?: string }
const requests: Request[] = [], unexpected: string[] = [], views: VueWrapper[] = []
const oldAdapter = apiClient.defaults.adapter
let respond: ((request: Request) => Reply | Promise<Reply>) | undefined
function defaultReply(request: Request): Reply {
  if (request.path === '/admin/settings') return { value: systemSettings() }
  if (request.path === '/admin/settings/web-search-emulation') return { value: searchSettings() }
  if (request.path === '/user/totp/step-up' && request.method === 'POST') return { value: { verified: true, expires_in: 300 } }
  throw new Error('Unexpected independent settings request')
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
const mainWrites = () => requests.filter(request => request.method === 'PUT' && request.path === '/admin/settings')
const searchWrites = () => requests.filter(request => request.method === 'PUT' && request.path === '/admin/settings/web-search-emulation')
const body = () => new DOMWrapper(document.body)
async function tab(view: VueWrapper, key: string) { view.get<HTMLButtonElement>(`#settings-tab-${key}`).element.click(); await flushPromises() }
async function save(view: VueWrapper) { view.get<HTMLButtonElement>('.z-admin-settings-save > button[type="submit"]').element.click(); await flushPromises() }
async function verifyOtp() {
  const cells = body().get('[role="dialog"][aria-label="stepUp.title"]').findAll<HTMLInputElement>('input[maxlength="1"]')
  for (const [index, digit] of [...'654321'].entries()) await cells[index].setValue(digit)
  await flushPromises()
}
async function render() {
  const view = mount(SettingsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, Icon: true, RouterLink: { template: '<a><slot/></a>' },
    PaymentProviderList: true, PaymentProviderDialog: true, BackupSettings: true, EmailTemplateEditor: true,
    AdminAccessKeysSettings: true, RechargeBonusTierEditor: true, OpenAIFastPolicyUserSelector: true,
  } } })
  views.push(view); await flushPromises()
  expect(view.find('.z-admin-settings-save > button[type="submit"]').exists()).toBe(true)
  return view
}
function visibleInput(view: VueWrapper, selector: string) {
  const input = view.findAll<HTMLInputElement>(selector).find(item => item.isVisible())
  expect(input, selector).toBeDefined(); return input!
}
async function expandSearch(view: VueWrapper) {
  await tab(view, 'gateway')
  const heading = view.findAll('h2').find(item => item.text() === 'admin.settings.webSearchEmulation.title')!
  const card = new DOMWrapper(heading.element.closest<HTMLElement>('.card')!)
  const providerHeader = card.get<HTMLElement>('div.cursor-pointer')
  providerHeader.element.click(); await flushPromises()
  return card
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-settings-independent-108', user: { id: 7, role: 'admin' } })
  requests.length = 0; unexpected.length = 0; respond = undefined
  Object.values(feedback).forEach(mock => mock.mockReset())
  feedback.publicRefresh.mockResolvedValue(undefined); feedback.adminRefresh.mockResolvedValue(undefined)
  apiClient.defaults.adapter = async config => {
    const request: Request = { method: String(config.method).toUpperCase(), path: String(config.url), raw: typeof config.data === 'string' ? config.data : undefined, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    const allowed = (['GET', 'PUT'].includes(request.method) && ['/admin/settings', '/admin/settings/web-search-emulation'].includes(request.path)) || (request.method === 'POST' && request.path === '/user/totp/step-up')
    if (!allowed) { unexpected.push(`${request.method} ${request.path}`); throw new Error(`Strict independent transport rejected ${request.method} ${request.path}`) }
    requests.push(request)
    const result = respond ? await respond(request) : defaultReply(request)
    const status = result.status ?? 200
    const response = { config, status, statusText: 'Synthetic independent settings response', headers: {}, data: status < 400 ? { code: 0, data: structuredClone(result.value) } : { code: status, reason: result.reason, message: result.message } }
    if (status >= 400) throw new AxiosError(result.message, AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = oldAdapter
  expect(unexpected).toEqual([])
  vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open')
})

describe('independent settings save acceptance at the real DOM and Axios boundary', () => {
  it('keeps the complete first and OTP replay body identical when a nested custom endpoint changes during verification', async () => {
    let attempts = 0
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' && ++attempts === 1 ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic verification required' } : defaultReply(request)
    const view = await render()
    await save(view)
    expect(mainWrites()[0].body?.custom_endpoints).toEqual([{ name: 'Confirmed endpoint A', endpoint: 'https://gateway.synthetic.invalid/v1', description: 'Synthetic endpoint' }])
    await view.get('#settings-endpoint-name-0').setValue('Unsubmitted endpoint B')
    await verifyOtp()
    expect(mainWrites()).toHaveLength(2)
    expect(mainWrites()[1].body).toEqual(mainWrites()[0].body)
    expect(mainWrites()[1].raw).toBe(mainWrites()[0].raw)
    expect(view.get<HTMLInputElement>('#settings-endpoint-name-0').element.value).toBe('Unsubmitted endpoint B')
  })

  it('retains a new ordinary concurrency and GitHub secret draft after acknowledging older values, then sends them only on the next explicit save', async () => {
    const pending = deferred<Reply>(); let writes = 0
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' && ++writes === 1 ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'users'); await view.get('#settings-form-default-concurrency').setValue(6)
    await save(view)
    expect(mainWrites()[0].body).toMatchObject({ default_concurrency: 6 })
    expect(mainWrites()[0].body).not.toHaveProperty('github_oauth_client_secret')
    await view.get('#settings-form-default-concurrency').setValue(13)
    await tab(view, 'security'); await view.get('#settings-form-github-oauth-client-secret').setValue('SYNTHETIC-UNSUBMITTED-SECRET-B-108')
    pending.resolve({ value: { ...systemSettings(), default_concurrency: 6 } }); await flushPromises()
    expect(view.get<HTMLInputElement>('#settings-form-github-oauth-client-secret').element.value).toBe('SYNTHETIC-UNSUBMITTED-SECRET-B-108')
    await tab(view, 'users'); expect(view.get<HTMLInputElement>('#settings-form-default-concurrency').element.value).toBe('13')
    await save(view)
    expect(mainWrites()[1].body).toMatchObject({ default_concurrency: 13, github_oauth_client_secret: 'SYNTHETIC-UNSUBMITTED-SECRET-B-108' })
  })

  it('retains committed new email-domain tags and a separate unfinished tag input after an older acknowledgement', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'security'); await save(view)
    const domains = view.get<HTMLInputElement>('input[aria-label="admin.settings.registration.emailSuffixWhitelist"]')
    await domains.setValue('bravo.synthetic.invalid'); await domains.trigger('keydown', { key: 'Enter' })
    await domains.setValue('unfinished-domain')
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(view.text()).toContain('bravo.synthetic.invalid')
    expect(domains.element.value).toBe('unfinished-domain')
    expect(mainWrites()[0].body?.registration_email_suffix_whitelist).toEqual(['@alpha.synthetic.invalid'])
  })

  it('retains a table-size text draft maintained outside the serialized form object', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await save(view)
    await view.get('#settings-table-page-size-options-input').setValue('10, 20, 75')
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(view.get<HTMLInputElement>('#settings-table-page-size-options-input').element.value).toBe('10, 20, 75')
    expect(mainWrites()[0].body?.table_page_size_options).toEqual([10, 20, 50])
  })

  it('keeps a newly selected WeChat capability instead of applying the old derived-mode reset', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'security'); await save(view)
    view.get<HTMLButtonElement>('[data-testid="wechat-connect-mp-enabled"]').element.click(); await flushPromises()
    expect(view.get('[data-testid="wechat-connect-mp-enabled"]').attributes('aria-checked')).toBe('true')
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(view.get('[data-testid="wechat-connect-mp-enabled"]').attributes('aria-checked')).toBe('true')
    expect(mainWrites()[0].body).toMatchObject({ wechat_connect_mode: 'open', wechat_connect_open_enabled: true, wechat_connect_mp_enabled: false })
  })

  it('keeps a newly edited quota cell while the confirmed wire retains explicit zero and null windows', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'users'); await save(view)
    const daily = visibleInput(view, 'input[aria-label="openai: admin.settings.platformQuota.daily"]')
    await daily.setValue(9.5)
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(daily.element.value).toBe('9.5')
    expect(mainWrites()[0].body?.default_platform_quotas.openai).toEqual({ daily: 0, weekly: null, monthly: 40 })
  })

  it('retains an email-source grant draft outside form when the previous source defaults return', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'users'); await save(view)
    await view.get('#settings-auth-source-concurrency-email').setValue(17)
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(view.get<HTMLInputElement>('#settings-auth-source-concurrency-email').element.value).toBe('17')
    expect(mainWrites()[0].body).toMatchObject({ auth_source_default_email_concurrency: 5, auth_source_default_email_balance: 0, auth_source_default_email_grant_on_first_bind: false })
  })

  it('retains an edited Fast rule message while the in-flight request remains the original literal rule', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await tab(view, 'gateway'); await save(view)
    await view.get('#settings-openai-fast-error-message-0').setValue('Unsubmitted fast B')
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(view.get<HTMLInputElement>('#settings-openai-fast-error-message-0').element.value).toBe('Unsubmitted fast B')
    expect(mainWrites()[0].body?.openai_fast_policy_settings).toEqual({ rules: [{ service_tier: 'priority', action: 'block', scope: 'all', error_message: 'Confirmed fast A' }] })
  })

  it('submits the WebSearch snapshot from the original main intent while preserving a newer key draft', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await expandSearch(view)
    await view.get('#settings-search-key-0').setValue('SYNTHETIC-SEARCH-A-108')
    await save(view)
    await view.get('#settings-search-key-0').setValue('SYNTHETIC-SEARCH-B-108')
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(searchWrites()).toHaveLength(1)
    expect(searchWrites()[0].body).toMatchObject({ enabled: true, providers: [{ type: 'brave', api_key: 'SYNTHETIC-SEARCH-A-108', quota_limit: 25, subscribed_at: 1700000000, proxy_id: null, expires_at: null }] })
    expect(view.get<HTMLInputElement>('#settings-search-key-0').element.value).toBe('SYNTHETIC-SEARCH-B-108')
  })

  it('accepts untouched server SMTP trimming, retains zero/null settings and clears only the secret actually acknowledged', async () => {
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? { value: { ...systemSettings(), email_verify_enabled: true, smtp_host: 'smtp.normalized.synthetic.invalid', smtp_port: 465 } } : defaultReply(request)
    const view = await render(); await tab(view, 'security')
    await view.get('#settings-form-github-oauth-client-secret').setValue('SYNTHETIC-ACKNOWLEDGED-SECRET-A-108')
    view.get<HTMLButtonElement>('#settings-form-email-verify-enabled').element.click(); await flushPromises()
    await tab(view, 'email'); await view.get('#settings-form-smtp-host').setValue('  smtp.normalized.synthetic.invalid  ')
    await view.get('#settings-form-smtp-port').setValue(465)
    await save(view)
    expect(mainWrites()[0].body).toMatchObject({ smtp_host: '  smtp.normalized.synthetic.invalid  ', smtp_port: 465, default_balance: 0, openai_oauth_scheduling_rate_multiplier: null, github_oauth_client_secret: 'SYNTHETIC-ACKNOWLEDGED-SECRET-A-108' })
    expect(view.get<HTMLInputElement>('#settings-form-smtp-host').element.value).toBe('smtp.normalized.synthetic.invalid')
    await tab(view, 'security'); expect(view.get<HTMLInputElement>('#settings-form-github-oauth-client-secret').element.value).toBe('')
    await save(view)
    expect(mainWrites()[1].body).not.toHaveProperty('github_oauth_client_secret')
  })

  it('does not submit the secondary configuration or publish success after native OTP cancellation', async () => {
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic verification required' } : defaultReply(request)
    const view = await render(); await save(view)
    const cancel = body().get('[role="dialog"][aria-label="stepUp.title"]').findAll<HTMLButtonElement>('button').find(item => item.text() === 'common.cancel')!
    cancel.element.click(); await flushPromises()
    expect(mainWrites()).toHaveLength(1); expect(searchWrites()).toHaveLength(0)
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
    expect(feedback.publicRefresh).not.toHaveBeenCalled(); expect(feedback.adminRefresh).not.toHaveBeenCalled()
  })

  it('ignores an old main acknowledgement after same-ID re-login without sending the secondary write', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' ? pending.promise : defaultReply(request)
    const view = await render(); await save(view)
    replaceAuthSession({ accessToken: 'synthetic-settings-independent-new-login-108', user: { id: 7, role: 'admin' } })
    pending.resolve({ value: systemSettings() }); await flushPromises()
    expect(searchWrites()).toHaveLength(0)
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
    expect(feedback.publicRefresh).not.toHaveBeenCalled(); expect(feedback.adminRefresh).not.toHaveBeenCalled()
  })

  it('retains input on a definitive main rejection and sends the corrected form only after another native save', async () => {
    let rejecting = true
    respond = request => request.method === 'PUT' && request.path === '/admin/settings' && rejecting ? { value: null, status: 400, message: 'Synthetic main settings rejected' } : defaultReply(request)
    const view = await render(); await tab(view, 'users'); await view.get('#settings-form-default-concurrency').setValue(9)
    await save(view)
    expect(feedback.error).toHaveBeenCalledWith('Synthetic main settings rejected'); expect(searchWrites()).toHaveLength(0)
    expect(view.get<HTMLInputElement>('#settings-form-default-concurrency').element.value).toBe('9')
    rejecting = false; await view.get('#settings-form-default-concurrency').setValue(11); await save(view)
    expect(mainWrites().map(request => request.body?.default_concurrency)).toEqual([9, 11])
    expect(searchWrites()).toHaveLength(1)
  })

  it('keeps secondary failure visible without a success toast or an automatic replay, then permits an explicit new save', async () => {
    let rejecting = true
    respond = request => request.method === 'PUT' && request.path === '/admin/settings/web-search-emulation' && rejecting ? { value: null, status: 503, message: 'Synthetic search settings unavailable' } : defaultReply(request)
    const view = await render(); await save(view)
    expect(mainWrites()).toHaveLength(1); expect(searchWrites()).toHaveLength(1)
    expect(feedback.error).toHaveBeenCalledWith('Synthetic search settings unavailable')
    expect(feedback.success).not.toHaveBeenCalledWith('admin.settings.settingsSaved')
    rejecting = false; await save(view)
    expect(mainWrites()).toHaveLength(2); expect(searchWrites()).toHaveLength(2)
    expect(feedback.success).toHaveBeenCalledWith('admin.settings.settingsSaved')
  })
})
