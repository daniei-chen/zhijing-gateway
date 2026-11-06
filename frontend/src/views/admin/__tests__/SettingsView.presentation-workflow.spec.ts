/**
 * Presentation settings through actual DOM/children and settingsAPI/Axios.
 * Presentation plumbing follows the existing 084 configuration fixture, but
 * requests/expected fields here independently target the Go presentation DTO.
 * Every HTTP request is intercepted by the synthetic adapter below; no email,
 * provider, business account, production settings or credentials are used.
 */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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
  const real = new Set(['getSettings', 'updateSettings', 'testSmtpConnection', 'sendTestEmail'])
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
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const writes = () => requests.filter(request => request.method === 'put')
const body = () => writes().at(-1)!.body
const menu = (id: string, label: string, sort: number) => ({ id, label, icon_svg: '', url: `https://${id}.example.test/`, visibility: 'user', sort_order: sort, hide_open_button: false })
const documents = () => [{ id: 'terms', title: 'Synthetic Terms', content_md: '# Synthetic policy\n\nSafe fixture.' }]
const baseSettings = () => ({
  site_name: '103 Synthetic site', site_subtitle: 'Synthetic workspace', site_logo: 'https://images.example.test/logo.png',
  api_base_url: 'https://api.example.test/v1', contact_info: 'support@example.test', doc_url: 'https://docs.example.test/', home_content: '# Synthetic home',
  compact_home_enabled: false, backend_mode_enabled: false, table_default_page_size: 20, table_page_size_options: [10, 20, 50],
  custom_menu_items: [menu('alpha', 'Alpha workspace', 0), menu('beta', 'Beta workspace', 1)], custom_endpoints: [],
  default_subscriptions: [], payment_enabled: false, registration_enabled: true, email_verify_enabled: true,
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
  requests = []; serverSettings = baseSettings(); rejectNext = undefined; pendingWrite = undefined; stepUpNext = false
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: '103-synthetic-admin', user: { id: 103 } })
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
      const { smtp_password: _password, ...savedFields } = clone(request.body)
      serverSettings = { ...serverSettings, ...savedFields }
      return response(config, clone(serverSettings))
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
function button(scope: Pick<VueWrapper, 'findAll'> | DOMWrapper<Element>, text: string) {
  const result = scope.findAll('button').find(node => node.text() === text)
  expect(result, `button ${text}`).toBeDefined(); return result!
}
function card(view: VueWrapper, title: string) {
  const result = view.findAll('.card').find(node => node.findAll('h2,h3').some(heading => heading.text() === title))
  expect(result, title).toBeDefined(); return result!
}
function menuCard(view: VueWrapper, index: number) { return new DOMWrapper(view.get(`#settings-menu-label-${index}`).element.closest('.rounded-lg.border')!) }
async function typeSecret(view: VueWrapper, value: string) { const field = view.get('#settings-form-smtp-password'); await field.trigger('keydown', { key: 'a' }); await field.setValue(value) }
async function verify(view: VueWrapper) {
  expect(view.find('.z-stepup-panel[role="dialog"]').exists()).toBe(true)
  await view.get('.z-stepup-code-grid input').trigger('paste', { clipboardData: { getData: () => '123456' } })
  await flushPromises()
  expect(requests.filter(request => request.path === '/user/totp/step-up').map(request => request.body)).toEqual([{ code: '123456' }])
}

describe('Settings presentation and messaging native transport workflows', () => {
  it('edits site appearance and URLs, switches categories without losing drafts and saves their actual DTO together', async () => {
    const view = await render()
    expect(view.get<HTMLInputElement>('#settings-form-site-name').element.value).toBe('103 Synthetic site')
    await view.get('#settings-form-site-name').setValue('103 New site'); await view.get('#settings-form-site-subtitle').setValue('New subtitle')
    await view.get('#settings-form-api-base-url').setValue('https://gateway.example.test/v1'); await view.get('#settings-form-contact-info').setValue('new-support@example.test')
    await view.get('#settings-form-doc-url').setValue('https://guide.example.test/help'); await view.get('#settings-form-home-content').setValue('<section>103 synthetic home</section>')
    await view.get('#settings-form-compact-home-enabled').trigger('click'); await tab(view, 'email'); await tab(view, 'general')
    expect(view.get<HTMLInputElement>('#settings-form-site-name').element.value).toBe('103 New site')
    await save(view)
    expect(body()).toMatchObject({ site_name: '103 New site', site_subtitle: 'New subtitle', api_base_url: 'https://gateway.example.test/v1', contact_info: 'new-support@example.test', doc_url: 'https://guide.example.test/help', home_content: '<section>103 synthetic home</section>', compact_home_enabled: true })
    expect(feedback.publicSettings).toHaveBeenCalledWith(true); expect(feedback.adminSettings).toHaveBeenCalledWith(true)
  })
  it('uploads a synthetic logo through the actual file input, then removes it and submits an explicit empty logo', async () => {
    const view = await render(); const site = card(view, 'admin.settings.site.title')
    const input = site.get<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['synthetic-image'], 'logo.png', { type: 'image/png' })] })
    await input.trigger('change')
    await vi.waitFor(() => expect(site.get('img').attributes('src')).toBe('data:image/png;base64,c3ludGhldGljLWltYWdl'))
    await save(view); expect(body().site_logo).toBe('data:image/png;base64,c3ludGhldGljLWltYWdl')
    await button(site, 'admin.settings.site.remove').trigger('click'); await save(view)
    expect(body().site_logo).toBe(''); expect(site.find('img').exists()).toBe(false)
  })
  it('edits, adds, sorts and removes custom navigation through the real controls with stable DTO fields', async () => {
    const view = await render()
    await view.get('#settings-menu-label-0').setValue('103 Alpha edited'); await view.get('#settings-menu-visibility-0').setValue('admin')
    await menuCard(view, 0).get('input[type="checkbox"]').setValue(true)
    await button(view, 'admin.settings.customMenu.add').trigger('click')
    await view.get('#settings-menu-label-2').setValue('103 Manual'); await view.get('#settings-menu-url-2').setValue('md:operations-guide')
    await menuCard(view, 2).get('button[title="admin.settings.customMenu.moveUp"]').trigger('click')
    await menuCard(view, 0).get('button[title="admin.settings.customMenu.remove"]').trigger('click')
    await save(view)
    expect(body().custom_menu_items).toEqual([
      { id: '', label: '103 Manual', icon_svg: '', url: 'md:operations-guide', visibility: 'user', sort_order: 0 },
      { ...menu('beta', 'Beta workspace', 1) },
    ])
  })
  it('uploads a navigation SVG through the actual child input and preserves its literal payload', async () => {
    const view = await render(); const item = menuCard(view, 0); const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4H0z"/></svg>'
    const input = item.get<HTMLInputElement>('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [new File([svg], 'nav.svg', { type: 'image/svg+xml' })] })
    await input.trigger('change'); await vi.waitFor(() => expect(item.find('span svg path').exists()).toBe(true)); await save(view)
    expect((body().custom_menu_items as Record<string, unknown>[])[0].icon_svg).toBe(svg)
  })
  it('can explicitly clear every navigation entry instead of preserving the old server array', async () => {
    const view = await render(); await menuCard(view, 1).get('button[title="admin.settings.customMenu.remove"]').trigger('click'); await menuCard(view, 0).get('button[title="admin.settings.customMenu.remove"]').trigger('click'); await save(view)
    expect(body().custom_menu_items).toEqual([])
  })
  it('retains rejected navigation labels and retries the corrected request without losing order', async () => {
    const view = await render(); await view.get('#settings-menu-label-0').setValue('Rejected navigation draft'); rejectNext = { status: 400, message: '103 synthetic navigation refusal' }; await save(view)
    expect(view.get<HTMLInputElement>('#settings-menu-label-0').element.value).toBe('Rejected navigation draft'); expect(feedback.error).toHaveBeenCalledWith('103 synthetic navigation refusal')
    await view.get('#settings-menu-url-0').setValue('https://corrected.example.test/'); await save(view)
    expect(writes()).toHaveLength(2); expect((body().custom_menu_items as Record<string, unknown>[])[0]).toMatchObject({ id: 'alpha', label: 'Rejected navigation draft', url: 'https://corrected.example.test/', sort_order: 0 })
  })
  it('saves agreement mode, consent date and normalized Markdown documents through their real controls', async () => {
    const view = await render(); await tab(view, 'agreement'); await button(view, 'Checkbox').trigger('click')
    await view.get('#settings-form-login-agreement-updated-at').setValue('2026-11-07'); await view.get('#settings-agreement-title-0').setValue('  103 Terms  ')
    await view.get('#settings-agreement-id-0').setValue('  Terms Of Service  '); await view.get('#settings-agreement-content-md-0').setValue('  # 103 Terms\n\nSynthetic document.  ')
    await button(view, 'Add document').trigger('click'); await view.get('#settings-agreement-title-1').setValue('103 Privacy'); await view.get('#settings-agreement-id-1').setValue('privacy'); await view.get('#settings-agreement-content-md-1').setValue('# 103 Privacy')
    await save(view)
    expect(body()).toMatchObject({ login_agreement_enabled: true, login_agreement_mode: 'checkbox', login_agreement_updated_at: '2026-11-07', login_agreement_documents: [{ id: 'terms-of-service', title: '103 Terms', content_md: '# 103 Terms\n\nSynthetic document.' }, { id: 'privacy', title: '103 Privacy', content_md: '# 103 Privacy' }] })
  })
  it('keeps the last required agreement document and can remove an extra one before saving', async () => {
    const view = await render(); await tab(view, 'agreement')
    const first = new DOMWrapper(view.get('#settings-agreement-title-0').element.closest('.rounded-lg.border')!)
    expect(first.get('button').attributes('disabled')).toBeDefined()
    await button(view, 'Add document').trigger('click')
    const extra = new DOMWrapper(view.get('#settings-agreement-title-1').element.closest('.rounded-lg.border')!); await extra.get('button').trigger('click'); await save(view)
    expect(body().login_agreement_documents).toEqual(documents())
  })
  it('preserves rejected agreement drafts and can explicitly retry the same Markdown', async () => {
    const view = await render(); await tab(view, 'agreement'); await view.get('#settings-agreement-content-md-0').setValue('# Rejected policy')
    rejectNext = { status: 400, message: '103 synthetic agreement refusal' }; await save(view)
    expect(view.get<HTMLTextAreaElement>('#settings-agreement-content-md-0').element.value).toBe('# Rejected policy'); await save(view)
    expect((body().login_agreement_documents as Record<string, unknown>[])[0].content_md).toBe('# Rejected policy'); expect(writes()).toHaveLength(2)
  })
  it('saves real SMTP fields in port units while preserving a configured write-only secret when untouched', async () => {
    const view = await render(); await tab(view, 'email')
    expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('')
    expect(view.get('#settings-form-smtp-password').attributes('placeholder')).toBe('admin.settings.smtp.passwordConfiguredPlaceholder')
    await view.get('#settings-form-smtp-host').setValue('smtp.next.example.test'); await view.get('#settings-form-smtp-port').setValue('465'); await view.get('#settings-form-smtp-username').setValue('103-next-mail-user')
    await view.get('#settings-form-smtp-from-email').setValue('next-sender@example.test'); await view.get('#settings-form-smtp-from-name').setValue('103 Next Sender'); await view.get('#settings-form-smtp-use-tls').trigger('click'); await save(view)
    expect(body()).toMatchObject({ smtp_host: 'smtp.next.example.test', smtp_port: 465, smtp_username: '103-next-mail-user', smtp_from_email: 'next-sender@example.test', smtp_from_name: '103 Next Sender', smtp_use_tls: false }); expect(body()).not.toHaveProperty('smtp_password')
  })
  it('writes a manually typed SMTP secret once and omits it on an unrelated later save', async () => {
    const view = await render(); await tab(view, 'email'); await typeSecret(view, '103-synthetic-replacement-secret'); await save(view)
    expect(body().smtp_password).toBe('103-synthetic-replacement-secret'); expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('')
    await tab(view, 'general'); await view.get('#settings-form-contact-info').setValue('next@example.test'); await save(view)
    expect(body()).not.toHaveProperty('smtp_password')
  })
  it('retains a rejected SMTP secret and sender draft for the next explicit retry', async () => {
    const view = await render(); await tab(view, 'email'); await typeSecret(view, '103-synthetic-retry-secret'); await view.get('#settings-form-smtp-from-name').setValue('103 Retry Sender')
    rejectNext = { status: 400, message: '103 synthetic SMTP refusal' }; await save(view)
    expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('103-synthetic-retry-secret'); expect(view.get('button[type="submit"]').attributes('disabled')).toBeUndefined(); await save(view)
    expect(body()).toMatchObject({ smtp_password: '103-synthetic-retry-secret', smtp_from_name: '103 Retry Sender' }); expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('')
  })
  it('preserves notification dollars, disabled recipient state and explicit switches on the wire', async () => {
    const view = await render(); await tab(view, 'email'); await view.get('#settings-form-balance-low-notify-threshold').setValue('0'); await view.get('#settings-form-balance-low-notify-recharge-url').setValue('https://topup.example.test/')
    await view.get('#settings-form-subscription-expiry-notify-enabled').trigger('click')
    const quota = card(view, 'admin.settings.quotaNotify.title'); await quota.get('input[type="checkbox"]').setValue(false)
    await button(quota, '+ admin.settings.quotaNotify.addEmail').trigger('click'); await quota.findAll('input[type="email"]')[1].setValue('second@example.test'); await save(view)
    expect(body()).toMatchObject({ balance_low_notify_enabled: true, balance_low_notify_threshold: 0, balance_low_notify_recharge_url: 'https://topup.example.test/', subscription_expiry_notify_enabled: false, account_quota_notify_enabled: true, account_quota_notify_emails: [{ email: 'operations@example.test', disabled: true, verified: true }, { email: 'second@example.test', disabled: false, verified: true }] })
  })
  it('tests SMTP through a synthetic endpoint using an untouched configured password as empty', async () => {
    const view = await render(); await tab(view, 'email'); await button(view, 'admin.settings.smtp.testConnection').trigger('click'); await flushPromises()
    expect(requests.filter(request => request.path === '/admin/settings/test-smtp').map(request => request.body)).toEqual([{ smtp_host: 'smtp.example.test', smtp_port: 587, smtp_username: 'synthetic-mail-user', smtp_password: '', smtp_use_tls: true }])
    expect(feedback.success).toHaveBeenCalledWith('103 synthetic diagnostic completed')
  })
  it('retries a synthetic rejected test email with its unchanged recipient/sender and manual secret', async () => {
    const view = await render(); await tab(view, 'email'); await typeSecret(view, '103-synthetic-diagnostic-secret'); await view.get('#settings-test-email-address').setValue('fixture-recipient@example.test')
    rejectNext = { status: 400, message: '103 synthetic email refusal' }; await button(view, 'admin.settings.testEmail.sendTestEmail').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('103 synthetic email refusal'); await button(view, 'admin.settings.testEmail.sendTestEmail').trigger('click'); await flushPromises()
    const emails = requests.filter(request => request.path === '/admin/settings/send-test-email'); expect(emails).toHaveLength(2)
    expect(emails[0].body).toEqual({ email: 'fixture-recipient@example.test', smtp_host: 'smtp.example.test', smtp_port: 587, smtp_username: 'synthetic-mail-user', smtp_password: '103-synthetic-diagnostic-secret', smtp_from_email: 'sender@example.test', smtp_from_name: 'Synthetic Sender', smtp_use_tls: true }); expect(emails[1].body).toEqual(emails[0].body)
  })
  it.each([
    ['general', '#settings-form-site-name', 'site_name', 'Submitted site', 'Later site'],
    ['general', '#settings-form-contact-info', 'contact_info', 'submitted@example.test', 'later@example.test'],
    ['general', '#settings-menu-label-0', 'custom_menu_items', 'Submitted menu', 'Later menu'],
    ['agreement', '#settings-agreement-content-md-0', 'login_agreement_documents', '# Submitted policy', '# Later policy'],
    ['email', '#settings-form-smtp-host', 'smtp_host', 'submitted.smtp.test', 'later.smtp.test'],
    ['email', '#settings-form-balance-low-notify-threshold', 'balance_low_notify_threshold', '1.25', '2.75'],
  ])('retains later %s draft in %s after a previously submitted write completes', async (category, selector, field, submitted, later) => {
    const view = await render(); await tab(view, category); await view.get(selector).setValue(submitted)
    pendingWrite = deferred(); await save(view); const firstBody = clone(body()); await view.get(selector).setValue(later)
    pendingWrite.resolve({ status: 200 }); await flushPromises()
    expect(view.get<HTMLInputElement>(selector).element.value).toBe(later)
    expect(writes()[0].body).toEqual(firstBody)
    pendingWrite = undefined; await save(view)
    if (field === 'custom_menu_items') expect((body()[field] as Record<string, unknown>[])[0].label).toBe(later)
    else if (field === 'login_agreement_documents') expect((body()[field] as Record<string, unknown>[])[0].content_md).toBe(later)
    else expect(body()[field]).toBe(field === 'balance_low_notify_threshold' ? Number(later) : later)
  })
  it('does not clear a newer SMTP password draft when an older submitted password is acknowledged', async () => {
    const view = await render(); await tab(view, 'email'); await typeSecret(view, '103-synthetic-submitted-secret'); pendingWrite = deferred(); await save(view)
    await typeSecret(view, '103-synthetic-later-secret'); pendingWrite.resolve({ status: 200 }); await flushPromises()
    expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('103-synthetic-later-secret')
    pendingWrite = undefined; await save(view); expect(body().smtp_password).toBe('103-synthetic-later-secret'); expect(view.get<HTMLInputElement>('#settings-form-smtp-password').element.value).toBe('')
  })
  it.each([
    ['general', '#settings-menu-label-0', 'custom_menu_items', 'Submitted navigation', 'Later navigation'],
    ['agreement', '#settings-agreement-content-md-0', 'login_agreement_documents', '# Submitted terms', '# Later terms'],
  ])('replays only the confirmed %s array after step-up and keeps its newer unsaved input', async (category, selector, field, submitted, later) => {
    const view = await render(); await tab(view, category); await view.get(selector).setValue(submitted); stepUpNext = true; await save(view)
    const confirmed = clone(body()[field]); await view.get(selector).setValue(later); await verify(view)
    expect(writes()).toHaveLength(2); expect(writes()[1].body[field]).toEqual(confirmed)
    expect(view.get<HTMLInputElement>(selector).element.value).toBe(later)
    await save(view)
    if (field === 'custom_menu_items') expect((body()[field] as Record<string, unknown>[])[0].label).toBe(later)
    else expect((body()[field] as Record<string, unknown>[])[0].content_md).toBe(later)
  })
  it.each(['login', 'unmount'])('suppresses stale actual-transport save feedback after %s', async change => {
    const view = await render(); pendingWrite = deferred(); await view.get('#settings-form-site-name').setValue('103 Old page'); await save(view)
    if (change === 'login') replaceAuthSession({ accessToken: '103-synthetic-relogin', user: { id: 103 } })
    else { view.unmount(); views.splice(views.indexOf(view), 1) }
    pendingWrite.resolve({ status: 200 }); await flushPromises()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.publicSettings).not.toHaveBeenCalled(); expect(feedback.adminSettings).not.toHaveBeenCalled()
  })
})
