import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import SettingsView from '../SettingsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/admin/settings')>('@/api/admin/settings')
  const settings = new Proxy({}, { get: (_, key) => key === 'getSettings' ? actual.getSettings : key === 'updateSettings' ? actual.updateSettings : key === 'getAdminApiKey' ? async () => ({ exists: false }) : async () => ({ enabled: false, providers: [], rules: [] }) })
  return { adminAPI: { settings, accounts: new Proxy({}, { get: () => async () => ({ enabled: false }) }), groups: { getAll: async () => [
    { id: 11, name: '084 Basic', description: 'Basic subscription', platform: 'openai', subscription_type: 'subscription', status: 'active', rate_multiplier: 1 },
    { id: 22, name: '084 Premium', description: 'Advanced subscription', platform: 'anthropic', subscription_type: 'subscription', status: 'active', rate_multiplier: 1.5 },
    { id: 33, name: '084 Balance', platform: 'openai', subscription_type: 'standard', status: 'active' },
  ] }, proxies: { list: async () => ({ items: [] }) }, payment: { getProviders: async () => ({ data: [] }) } } }
})
vi.mock('@/api/admin/affiliates', () => { const affiliatesAPI = { listUsers: async () => ({ items: [], total: 0 }) }; return { affiliatesAPI, default: affiliatesAPI } })
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, fetchPublicSettings: async () => ({}) }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: async () => ({}) }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

type SettingsWire = { method: string; path: string; body: Record<string, unknown>; config: InternalAxiosRequestConfig }
let requests: SettingsWire[]
let settings: Record<string, unknown>
let rejectNext: boolean
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
const writes = () => requests.filter(request => request.method === 'put')
const body = () => writes().at(-1)!.body
async function render() {
  const view = mount(SettingsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, ImageUpload: true, BackupSettings: true,
    AdminAccessKeysSettings: true, EmailTemplateEditor: true, RechargeBonusTierEditor: true,
    PaymentProviderDialog: true, TotpStepUpDialog: true, RouterLink: { template: '<a><slot/></a>' },
  } } })
  views.push(view); await flushPromises(); return view
}
async function tab(view: VueWrapper, key: string) { await view.get(`#settings-tab-${key}`).trigger('click'); await flushPromises() }
async function save(view: VueWrapper) { (view.get('button[type="submit"]').element as HTMLButtonElement).click(); await flushPromises() }
function button(view: VueWrapper, text: string) { const node = view.findAll('button').find(node => node.text() === text); expect(node, text).toBeDefined(); return node! }
async function toggle(view: VueWrapper, id: string) { await view.get(`#${id}`).trigger('click'); await flushPromises() }

beforeEach(() => {
  feedback.success.mockReset(); feedback.error.mockReset(); requests = []; rejectNext = false
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: '084-synthetic-admin', user: { id: 84 } })
  settings = {
    site_name: '084 Settings', backend_mode_enabled: false, table_default_page_size: 20, table_page_size_options: [10, 20, 50],
    default_subscriptions: [], payment_enabled: false, registration_enabled: true,
    oidc_connect_enabled: true, oidc_connect_provider_name: '084 Identity', oidc_connect_client_id: '084-client',
    oidc_connect_client_secret_configured: true, oidc_connect_issuer_url: 'https://084-id.invalid',
    oidc_connect_redirect_url: 'https://084-app.invalid/api/v1/auth/oidc/callback', oidc_connect_frontend_redirect_url: '/auth/oidc/callback',
    oidc_connect_scopes: 'openid profile email', oidc_connect_clock_skew_seconds: 120,
    oidc_connect_token_auth_method: 'client_secret_post', oidc_connect_use_pkce: true, oidc_connect_validate_id_token: true,
    oidc_connect_require_email_verified: false, oidc_connect_allowed_signing_algs: 'RS256',
    codex_cli_only_engine_fingerprint_signals: '[{"type":"header_prefix","match":["x-codex-"],"required":true}]',
    openai_codex_version_auto_sync_enabled: true, claude_code_version_auto_sync_enabled: true,
  }
  apiClient.defaults.adapter = async config => {
    const request: SettingsWire = { method: config.method ?? 'get', path: String(config.url), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}, config }
    requests.push(request)
    if (request.path !== '/admin/settings') throw new Error(`Unexpected 084 synthetic endpoint ${request.path}`)
    if (request.method === 'put') {
      const skew = request.body.oidc_connect_clock_skew_seconds
      if (rejectNext || typeof skew !== 'number' || !Number.isInteger(skew) || skew < 0 || skew > 600) {
        rejectNext = false
        throw new AxiosError('084 synthetic settings rejection', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Synthetic rejection', data: { message: '084 synthetic settings rejection' }, headers: {}, config })
      }
      settings = { ...settings, ...request.body }
      delete settings.oidc_connect_client_secret
    }
    return { data: { code: 0, data: settings }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => { views.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = previousAdapter; vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('Settings ordinary configuration through actual controls and settings transport', () => {
  it('loads and saves advanced OIDC settings with actual switches, token auth selection and one-time secret replacement', async () => {
    const view = await render(); await tab(view, 'security')
    expect(view.get<HTMLInputElement>('#settings-form-oidc-connect-client-id').element.value).toBe('084-client')
    expect(view.get('#settings-form-oidc-connect-use-pkce').attributes('role')).toBe('switch')
    await view.get('#settings-form-oidc-connect-client-id').setValue('084-next-client'); await view.get('#settings-form-oidc-connect-client-secret').setValue('084-synthetic-client-secret')
    await view.get('#settings-form-oidc-connect-token-auth-method').setValue('client_secret_basic'); await view.get('#settings-form-oidc-connect-clock-skew-seconds').setValue('90')
    await view.get('#settings-form-oidc-connect-allowed-signing-algs').setValue('RS256,ES256'); await view.get('#settings-form-oidc-connect-userinfo-email-path').setValue('profile.email')
    await toggle(view, 'settings-form-oidc-connect-use-pkce'); await toggle(view, 'settings-form-oidc-connect-validate-id-token'); await toggle(view, 'settings-form-oidc-connect-require-email-verified')
    await save(view); expect(body()).toMatchObject({ oidc_connect_enabled: true, oidc_connect_client_id: '084-next-client', oidc_connect_client_secret: '084-synthetic-client-secret', oidc_connect_token_auth_method: 'client_secret_basic', oidc_connect_clock_skew_seconds: 90, oidc_connect_allowed_signing_algs: 'RS256,ES256', oidc_connect_use_pkce: false, oidc_connect_validate_id_token: false, oidc_connect_require_email_verified: true, oidc_connect_userinfo_email_path: 'profile.email' })
    expect(view.get<HTMLInputElement>('#settings-form-oidc-connect-client-secret').element.value).toBe(''); await tab(view, 'general'); await view.get('#settings-form-site-subtitle').setValue('084 unrelated save'); await save(view); expect(body()).not.toHaveProperty('oidc_connect_client_secret'); expect(body().oidc_connect_use_pkce).toBe(false)
  })
  it.each(['', '-1', '601', '1.5'])('rejects an OIDC clock skew of %s locally and saves the corrected whole-seconds value', async value => {
    const view = await render(); await tab(view, 'security'); await view.get('#settings-form-oidc-connect-clock-skew-seconds').setValue(value); await save(view)
    expect(writes()).toHaveLength(0); expect(feedback.error).toHaveBeenCalledWith(expect.stringContaining('OIDC clock skew')); expect(view.get<HTMLInputElement>('#settings-form-oidc-connect-clock-skew-seconds').element.value).toBe(value)
    await view.get('#settings-form-oidc-connect-clock-skew-seconds').setValue('75'); await save(view); expect(writes()).toHaveLength(1); expect(body().oidc_connect_clock_skew_seconds).toBe(75)
  })
  it.each([0, 600])('preserves an accepted OIDC clock-skew boundary of %i in the wire contract', async value => {
    const view = await render(); await tab(view, 'security'); await view.get('#settings-form-oidc-connect-clock-skew-seconds').setValue(String(value)); await save(view)
    expect(writes()).toHaveLength(1); expect(body().oidc_connect_clock_skew_seconds).toBe(value); expect(feedback.error).not.toHaveBeenCalled()
  })
  it('retains an edited OIDC secret after rejection and submits it on the next explicit save', async () => {
    const view = await render(); await tab(view, 'security'); await view.get('#settings-form-oidc-connect-client-secret').setValue('084-retry-secret'); await view.get('#settings-form-oidc-connect-provider-name').setValue('084 Retry Identity'); rejectNext = true; await save(view)
    expect(writes()).toHaveLength(1); expect(view.get<HTMLInputElement>('#settings-form-oidc-connect-client-secret').element.value).toBe('084-retry-secret'); expect(feedback.error).toHaveBeenCalled()
    await save(view); expect(writes()).toHaveLength(2); expect(body()).toMatchObject({ oidc_connect_client_secret: '084-retry-secret', oidc_connect_provider_name: '084 Retry Identity' }); expect(view.get<HTMLInputElement>('#settings-form-oidc-connect-client-secret').element.value).toBe('')
  })
  it('uses actual subscription option slots and keyboard selection to assign an eligible default plan', async () => {
    const view = await render(); await tab(view, 'users'); await button(view, 'admin.settings.defaults.addDefaultSubscription').trigger('click')
    const select = view.get<HTMLButtonElement>('#settings-default-subscription-group-0'); const label = view.get<HTMLLabelElement>('label[for="settings-default-subscription-group-0"]'); expect(label.element.control).toBe(select.element)
    select.element.focus(); await select.trigger('keydown', { key: 'ArrowDown' }); await flushPromises()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')); expect(options.some(option => option.textContent?.includes('084 Premium'))).toBe(true); expect(options.some(option => option.textContent?.includes('084 Balance'))).toBe(false)
    const listboxId = select.attributes('aria-controls'); expect(listboxId).toBeTruthy(); const listbox = new DOMWrapper(document.getElementById(listboxId!)!); await listbox.trigger('keydown', { key: 'ArrowDown' }); await listbox.trigger('keydown', { key: 'Enter' }); await flushPromises(); expect(select.text()).toContain('084 Premium')
    await view.get('#settings-default-subscription-days-0').setValue('45'); await save(view); expect(body().default_subscriptions).toEqual([{ group_id: 22, validity_days: 45 }])
  })
  it('saves explicit client version bounds and manual user-agent overrides through actual editable controls', async () => {
    const view = await render(); await tab(view, 'gateway')
    await view.get('#settings-form-min-claude-code-version').setValue('2.0.1'); await view.get('#settings-form-max-claude-code-version').setValue('2.9.0'); await view.get('#settings-form-min-codex-version').setValue('0.50.0'); await view.get('#settings-form-max-codex-version').setValue('0.99.0')
    await view.get('#settings-form-openai-codex-user-agent').setValue('  084-client/1.0  '); await view.get('#settings-form-openai-codex-client-version').setValue('  0.75.0  '); await view.get('#settings-form-claude-code-client-version').setValue('  2.5.0  ')
    await toggle(view, 'settings-form-openai-codex-version-auto-sync-enabled'); await toggle(view, 'settings-form-claude-code-version-auto-sync-enabled'); await toggle(view, 'settings-form-codex-cli-only-allow-app-server-clients'); await save(view)
    expect(body()).toMatchObject({ min_claude_code_version: '2.0.1', max_claude_code_version: '2.9.0', min_codex_version: '0.50.0', max_codex_version: '0.99.0', openai_codex_user_agent: '084-client/1.0', openai_codex_client_version: '0.75.0', claude_code_client_version: '2.5.0', openai_codex_version_auto_sync_enabled: false, claude_code_version_auto_sync_enabled: false, codex_cli_only_allow_app_server_clients: true })
  })
  it('edits a body-path client signal and exposes the missing-required-signal warning without inventing another requirement', async () => {
    const view = await render(); await tab(view, 'gateway'); await view.get('[aria-label="Client fingerprint match type"]').setValue('body_path')
    await view.get('[aria-label="admin.settings.gatewayForwarding.codexFpMatchPlaceholder"]').setValue(' client_metadata.installation / client_metadata.window ')
    const required = view.findAll('label').find(node => node.text() === 'admin.settings.gatewayForwarding.codexFpRequired')!; expect(required).toBeDefined(); await required.get('input[type="checkbox"]').setValue(false)
    expect(view.text()).toContain('admin.settings.gatewayForwarding.codexFingerprintNoRequiredWarn'); await save(view)
    expect(body().codex_cli_only_engine_fingerprint_signals).toBe('[{"type":"body_path","match":["client_metadata.installation","client_metadata.window"],"required":false}]')
  })
})
