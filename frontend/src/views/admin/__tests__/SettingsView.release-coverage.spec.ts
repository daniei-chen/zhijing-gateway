import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import SettingsView from '../SettingsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/api', async () => {
  const settingsAPI = await vi.importActual<typeof import('@/api/admin/settings')>('@/api/admin/settings')
  return { adminAPI: {
    settings: new Proxy({}, { get: (_, key) => {
      if (key === 'getSettings') return settingsAPI.getSettings
      if (key === 'updateSettings') return settingsAPI.updateSettings
      if (key === 'getAdminApiKey') return async () => ({ exists: false })
      return async () => ({ enabled: false, providers: [], rules: [] })
    } }),
    accounts: new Proxy({}, { get: () => async () => ({ enabled: false }) }),
    groups: { getAll: async () => [
      { id: 11, name: 'Release basic', platform: 'openai', subscription_type: 'subscription', status: 'active', rate_multiplier: 1 },
      { id: 22, name: 'Release premium', platform: 'anthropic', subscription_type: 'subscription', status: 'active', rate_multiplier: 1.5 },
    ] },
    users: (await vi.importActual<typeof import('@/api/admin/users')>('@/api/admin/users')).default,
    proxies: { list: async () => ({ items: [] }) }, payment: { getProviders: async () => ({ data: [] }) },
  } }
})
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, fetchPublicSettings: async () => ({}) }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: async () => ({}) }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

interface Wire {
  method: string
  path: string
  body: Record<string, unknown>
  params: Record<string, unknown>
}
const views: VueWrapper[] = []
const previousAdapter = apiClient.defaults.adapter
let settings: Record<string, unknown>
let requests: Wire[]
let rejectNext: boolean
let rejectAffiliate: boolean
let affiliateRows: Record<string, unknown>[]
let affiliateTotal: number
const writeText = vi.fn()
const writes = () => requests.filter(request => request.method === 'put' && request.path === '/admin/settings')
const lastBody = () => writes().at(-1)!.body

async function render() {
  const view = mount(SettingsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, ImageUpload: true, BackupSettings: true,
    AdminAccessKeysSettings: true, EmailTemplateEditor: true, RechargeBonusTierEditor: true,
    PaymentProviderDialog: true, TotpStepUpDialog: true, RouterLink: { template: '<a><slot/></a>' },
  } } })
  views.push(view)
  await flushPromises()
  return view
}
async function tab(view: VueWrapper, name: string) {
  await view.get(`#settings-tab-${name}`).trigger('click')
  await flushPromises()
}
function button(root: Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>, name: string) {
  const found = root.findAll('button').find(node => node.text() === name)
  expect(found, `Visible button: ${name}`).toBeDefined()
  return found!
}
async function save(view: VueWrapper) {
  const saveButton = view.get<HTMLButtonElement>('.z-admin-settings-save button[type="submit"]')
  saveButton.element.click()
  await flushPromises()
}
async function toggle(view: VueWrapper, id: string) {
  await view.get(`#${id}`).trigger('click')
  await flushPromises()
}
async function choose(view: VueWrapper, selector: string, label: string) {
  await view.get(selector).trigger('click')
  await flushPromises()
  const listbox = document.getElementById(view.get(selector).attributes('aria-controls')!)
  expect(listbox).toBeTruthy()
  const options = Array.from(listbox!.querySelectorAll<HTMLElement>('[role="option"]')).filter(node => node.textContent?.includes(label))
  expect(options, `Unique option ${label}`).toHaveLength(1)
  options[0].click()
  await flushPromises()
}

beforeEach(() => {
  requests = []
  rejectNext = false
  rejectAffiliate = false
  affiliateRows = []
  affiliateTotal = 0
  feedback.success.mockReset()
  feedback.error.mockReset()
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, clipboard: { writeText } })
  vi.stubGlobal('isSecureContext', true)
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-release-settings', user: { id: 7, role: 'admin' } })
  settings = {
    site_name: 'Release settings', backend_mode_enabled: false, table_default_page_size: 20, table_page_size_options: [10, 20, 50],
    default_subscriptions: [], registration_enabled: true, payment_enabled: false,
    oidc_connect_clock_skew_seconds: 120, oidc_connect_enabled: false,
    claude_oauth_system_prompt_blocks: '[{"type":"text","text":"Synthetic existing block","enabled":true}]',
    codex_cli_only_engine_fingerprint_signals: '[]', codex_cli_only_blacklist: '', codex_cli_only_whitelist: '',
    openai_fast_policy: { rules: [] },
  }
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request = { method: config.method ?? 'get', path: String(config.url), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}, params: { ...config.params } }
    requests.push(request)
    if (request.method === 'get' && request.path === '/admin/users/51?include_deleted=true') return { data: { code: 0, data: { id: 51, email: 'synthetic-fast@example.invalid', status: 'active' } }, status: 200, statusText: 'OK', headers: {}, config }
    if (request.path.startsWith('/admin/affiliates/users')) {
      let data: unknown
      if (request.path === '/admin/affiliates/users') data = { items: affiliateRows, total: affiliateTotal, page: request.params.page, page_size: request.params.page_size }
      else if (request.path === '/admin/affiliates/users/lookup') data = [{ id: 51, email: 'release-51@example.invalid', username: 'Release 51' }, { id: 52, email: 'release-52@example.invalid', username: 'Release 52' }]
      else if (request.method === 'delete' || request.method === 'put' || request.method === 'post') {
        if (rejectAffiliate) {
          rejectAffiliate = false
          throw new AxiosError('Synthetic affiliate rejection', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Synthetic rejection', data: { message: 'Synthetic affiliate rejection' }, headers: {}, config })
        }
        data = { user_id: Number(request.path.split('/').at(-1)), affected: 1 }
      } else throw new Error(`Unexpected affiliate endpoint ${request.method} ${request.path}`)
      return { data: { code: 0, data }, status: 200, statusText: 'OK', headers: {}, config }
    }
    if (request.path !== '/admin/settings') throw new Error(`Unexpected synthetic request: ${request.method} ${request.path}`)
    if (request.method === 'put') {
      if (rejectNext) {
        rejectNext = false
        throw new AxiosError('Synthetic rejected settings', 'ERR_BAD_RESPONSE', config, undefined, {
          status: 400, statusText: 'Synthetic rejection', data: { message: 'Synthetic rejected settings' }, headers: {}, config,
        })
      }
      settings = { ...settings, ...request.body }
    }
    return { data: { code: 0, data: settings }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = previousAdapter
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Settings affiliate controls with real administration API requests', () => {
  async function affiliateView() {
    settings.affiliate_enabled = true
    affiliateRows = [
      { user_id: 41, email: 'release-41@example.invalid', username: 'Release 41', aff_code: 'RELEASE41', aff_code_custom: true, aff_rebate_rate_percent: 7.5, aff_count: 3 },
      { user_id: 42, email: 'release-42@example.invalid', username: 'Release 42', aff_code: 'AUTO42', aff_code_custom: false, aff_rebate_rate_percent: null, aff_count: 1 },
    ]
    affiliateTotal = 45
    const view = await render()
    await tab(view, 'features')
    return view
  }
  const commands = () => requests.filter(request => request.path.startsWith('/admin/affiliates/') && request.method !== 'get')
  const readRequests = () => requests.filter(request => request.path === '/admin/affiliates/users' && request.method === 'get')
  function affiliateRow(view: VueWrapper, id: number) {
    const found = view.findAll('tbody tr').find(node => node.text().includes(`release-${id}@example.invalid`))
    expect(found).toBeDefined()
    return found!
  }

  it('paginates affiliate overrides through the literal page query and displays a global-rate user distinctly', async () => {
    const view = await affiliateView()
    expect(affiliateRow(view, 42).text()).toContain('admin.settings.features.affiliate.customUsers.useGlobal')
    expect(affiliateRow(view, 42).text()).not.toContain('admin.settings.features.affiliate.customUsers.customBadge')
    expect(button(view, 'pagination.previous').attributes('disabled')).toBeDefined()
    await button(view, 'pagination.next').trigger('click')
    await flushPromises()
    expect(readRequests().at(-1)!.params).toMatchObject({ page: 2, page_size: 20, search: '' })
    await button(view, 'pagination.previous').trigger('click')
    await flushPromises()
    expect(readRequests().at(-1)!.params.page).toBe(1)
    expect(commands()).toEqual([])
  })

  it('selects a lookup result, changes the selected user and submits a code-only override for the final user', async () => {
    const view = await affiliateView()
    await button(view, '+ admin.settings.features.affiliate.customUsers.addButton').trigger('click')
    const modal = new DOMWrapper(view.get('#settings-affiliate-modal-code').element.closest('.fixed')!)
    vi.useFakeTimers()
    await modal.get('#settings-affiliate-modal-user-query').setValue('release')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    const first = modal.findAll('button').find(node => node.text().startsWith('release-51@example.invalid'))!
    await first.trigger('click')
    expect(modal.find('#settings-affiliate-modal-user-query').exists()).toBe(false)
    await modal.get('[title="admin.settings.features.affiliate.modal.changeUser"]').trigger('click')
    expect(button(modal, 'common.save').attributes('disabled')).toBeDefined()
    await modal.get('#settings-affiliate-modal-user-query').setValue('release')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await modal.findAll('button').find(node => node.text().startsWith('release-52@example.invalid'))!.trigger('click')
    await modal.get('#settings-affiliate-modal-code').setValue(' release-only-code ')
    await button(modal, 'common.save').trigger('click')
    await flushPromises()
    expect(commands()).toEqual([{ method: 'put', path: '/admin/affiliates/users/52', body: { aff_code: 'RELEASE-ONLY-CODE' }, params: {} }])
    expect(writes()).toEqual([])
  })

  it('cancels a reset confirmation without a command, then explicitly resets only the selected affiliate user', async () => {
    const view = await affiliateView()
    await button(affiliateRow(view, 41), 'common.delete').trigger('click')
    await flushPromises()
    let dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
    expect(dialog.text()).toContain('admin.settings.features.affiliate.customUsers.resetMessage')
    await button(dialog, 'common.cancel').trigger('click')
    await flushPromises()
    expect(commands()).toEqual([])
    await button(affiliateRow(view, 42), 'common.delete').trigger('click')
    await flushPromises()
    dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
    await button(dialog, 'common.delete').trigger('click')
    await flushPromises()
    expect(commands()).toEqual([{ method: 'delete', path: '/admin/affiliates/users/42', body: {}, params: {} }])
    expect(feedback.success).toHaveBeenCalledWith('common.saved')
  })

  it('reports a rejected reset and only retries after the user reopens and confirms that action', async () => {
    const view = await affiliateView()
    rejectAffiliate = true
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await button(affiliateRow(view, 41), 'common.delete').trigger('click')
      await flushPromises()
      const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
      await button(dialog, 'common.delete').trigger('click')
      await flushPromises()
      expect(commands()).toHaveLength(attempt + 1)
      if (attempt === 0) {
        expect(feedback.error).toHaveBeenCalledWith('Synthetic affiliate rejection')
        expect(feedback.success).not.toHaveBeenCalled()
      }
    }
    expect(commands().map(request => request.path)).toEqual(['/admin/affiliates/users/41', '/admin/affiliates/users/41'])
    expect(feedback.success).toHaveBeenCalledTimes(1)
  })

  it('applies a batch rate to the remaining selected user after deselecting another row', async () => {
    const view = await affiliateView()
    await view.get('input[aria-label="common.selectAll"]').setValue(true)
    await affiliateRow(view, 41).get('input[type="checkbox"]').setValue(false)
    await button(view, 'admin.settings.features.affiliate.customUsers.batchButton').trigger('click')
    const rate = view.get('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]')
    const modal = new DOMWrapper(rate.element.closest('.fixed')!)
    await rate.setValue('100')
    await button(modal, 'common.save').trigger('click')
    await flushPromises()
    expect(commands()).toEqual([{ method: 'post', path: '/admin/affiliates/users/batch-rate', body: { user_ids: [42], aff_rebate_rate_percent: 100 }, params: {} }])
  })
})

describe('Settings release workflows at the DOM and real Axios boundary', () => {
  it('saves independent OIDC endpoints, claims and scopes without substituting the issuer for explicit URLs', async () => {
    settings.oidc_connect_enabled = true
    const view = await render()
    await tab(view, 'security')
    const fields = {
      'issuer-url': 'https://identity.invalid', 'discovery-url': 'https://metadata.invalid/oidc',
      'authorize-url': 'https://authorize.invalid/start', 'token-url': 'https://token.invalid/exchange',
      'userinfo-url': 'https://profile.invalid/me', 'jwks-url': 'https://keys.invalid/jwks',
      scopes: 'openid profile email groups', 'frontend-redirect-url': '/auth/release/callback',
      'userinfo-id-path': 'profile.subject', 'userinfo-username-path': 'profile.display_name',
    }
    for (const [field, value] of Object.entries(fields)) await view.get(`#settings-form-oidc-connect-${field}`).setValue(value)
    await save(view)
    expect(lastBody()).toMatchObject({
      oidc_connect_issuer_url: 'https://identity.invalid', oidc_connect_discovery_url: 'https://metadata.invalid/oidc',
      oidc_connect_authorize_url: 'https://authorize.invalid/start', oidc_connect_token_url: 'https://token.invalid/exchange',
      oidc_connect_userinfo_url: 'https://profile.invalid/me', oidc_connect_jwks_url: 'https://keys.invalid/jwks',
      oidc_connect_scopes: 'openid profile email groups', oidc_connect_frontend_redirect_url: '/auth/release/callback',
      oidc_connect_userinfo_id_path: 'profile.subject', oidc_connect_userinfo_username_path: 'profile.display_name',
    })
    expect(feedback.success).toHaveBeenCalled()
  })

  it.each([
    { provider: 'linuxdo', field: 'linuxdo-connect', path: 'linuxdo', name: 'admin.settings.linuxdo.quickSetCopy' },
    { provider: 'github', field: 'github-oauth', path: 'github', name: 'Generate and copy' },
    { provider: 'google', field: 'google-oauth', path: 'google', name: 'Generate and copy' },
    { provider: 'wechat', field: 'wechat-connect', path: 'wechat', name: 'admin.settings.wechatConnect.generateAndCopy' },
    { provider: 'oidc', field: 'oidc-connect', path: 'oidc', name: 'admin.settings.oidc.quickSetCopy' },
  ])('sets and copies the $provider callback from an API-root URL and persists that exact callback', async ({ provider, field, path, name }) => {
    settings.api_base_url = 'https://gateway.invalid/api/v1///'
    settings[provider === 'github' || provider === 'google' ? `${provider}_oauth_enabled` : `${provider}_connect_enabled`] = true
    const view = await render()
    await tab(view, 'security')
    const input = view.get<HTMLInputElement>(`#settings-form-${field}-redirect-url`)
    const scope = new DOMWrapper(input.element.parentElement!)
    await button(scope, name).trigger('click')
    const expected = `https://gateway.invalid/api/v1/auth/oauth/${path}/callback`
    expect(input.element.value).toBe(expected)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected)
    await save(view)
    expect(lastBody()[`${provider === 'github' || provider === 'google' ? `${provider}_oauth` : `${provider}_connect`}_redirect_url`]).toBe(expected)
  })

  it('builds a callback from a host base without adding a second API root and keeps manual front-end redirects distinct', async () => {
    settings.api_base_url = 'https://gateway.invalid/'
    settings.github_oauth_enabled = true
    const view = await render()
    await tab(view, 'security')
    const input = view.get<HTMLInputElement>('#settings-form-github-oauth-redirect-url')
    await button(new DOMWrapper(input.element.parentElement!), 'Generate and copy').trigger('click')
    await view.get('#settings-form-github-oauth-frontend-redirect-url').setValue('/custom/sign-in')
    await save(view)
    expect(lastBody()).toMatchObject({ github_oauth_redirect_url: 'https://gateway.invalid/api/v1/auth/oauth/github/callback', github_oauth_frontend_redirect_url: '/custom/sign-in' })
  })

  it('preserves DingTalk organization-only profile mappings and serializes explicit synchronization switches', async () => {
    settings.dingtalk_connect_enabled = true
    settings.dingtalk_connect_corp_id = 'synthetic-corp'
    const view = await render()
    await tab(view, 'security')
    await view.get('#settings-form-dingtalk-connect-redirect-url').setValue('https://gateway.invalid/dingtalk')
    await view.get('input[type="radio"][value="internal_only"]').setValue(true)
    for (const id of ['bypass-registration', 'sync-display-name', 'sync-corp-email', 'sync-dept']) await toggle(view, `settings-form-dingtalk-connect-${id}`)
    await view.get('#settings-form-dingtalk-connect-sync-display-name-attr-key').setValue('employee_name')
    await view.get('#settings-form-dingtalk-connect-sync-display-name-attr-name').setValue('Employee name')
    await view.get('#settings-form-dingtalk-connect-sync-corp-email-attr-key').setValue('work_email')
    await view.get('#settings-form-dingtalk-connect-sync-corp-email-attr-name').setValue('Work email')
    await view.get('#settings-form-dingtalk-connect-sync-dept-attr-key').setValue('department_path')
    await view.get('#settings-form-dingtalk-connect-sync-dept-attr-name').setValue('Department')
    await save(view)
    expect(lastBody()).toMatchObject({
      dingtalk_connect_redirect_url: 'https://gateway.invalid/dingtalk', dingtalk_connect_bypass_registration: true,
      dingtalk_connect_sync_display_name: true, dingtalk_connect_sync_display_name_attr_key: 'employee_name', dingtalk_connect_sync_display_name_attr_name: 'Employee name',
      dingtalk_connect_sync_corp_email: true, dingtalk_connect_sync_corp_email_attr_key: 'work_email', dingtalk_connect_sync_corp_email_attr_name: 'Work email',
      dingtalk_connect_sync_dept: true, dingtalk_connect_sync_dept_attr_key: 'department_path', dingtalk_connect_sync_dept_attr_name: 'Department',
    })
  })

  it('saves gateway compatibility switches and a manual Antigravity client version with literal backend field names', async () => {
    const view = await render()
    await tab(view, 'gateway')
    const switches = [
      'enable-fingerprint-unification', 'enable-metadata-passthrough', 'enable-cch-signing',
      'enable-claude-oauth-system-prompt-injection', 'enable-anthropic-cache-ttl-1h-injection',
      'rewrite-message-cache-control', 'enable-client-dateline-normalization', 'allow-ungrouped-key-scheduling',
    ]
    for (const id of switches) {
      const control = view.get(`#settings-form-${id}`)
      if (control.attributes('aria-checked') === 'true') await control.trigger('click')
      await control.trigger('click')
    }
    await view.get('#settings-form-antigravity-user-agent-version').setValue('1.2.3-release')
    await view.get('#grok-default-base-url-mode').setValue('eu-west-1')
    await save(view)
    expect(lastBody()).toMatchObject({
      enable_fingerprint_unification: true, enable_metadata_passthrough: true, enable_cch_signing: true,
      enable_claude_oauth_system_prompt_injection: true, enable_anthropic_cache_ttl_1h_injection: true,
      rewrite_message_cache_control: true, enable_client_dateline_normalization: true, allow_ungrouped_key_scheduling: true,
      antigravity_user_agent_version: '1.2.3-release', grok_default_base_url_mode: 'eu-west-1',
    })
  })

  it('hides and reopens a prompt block without losing its draft, then restores the built-in ordered blocks explicitly', async () => {
    const view = await render()
    await tab(view, 'gateway')
    await view.get('#settings-claude-prompt-text-0').setValue('Synthetic local expansion')
    await view.get('[aria-label="admin.settings.gatewayForwarding.systemBlockHide"]').trigger('click')
    expect(view.get('#settings-claude-prompt-text-0').isVisible()).toBe(false)
    await view.get('[aria-label="admin.settings.gatewayForwarding.systemBlockShow"]').trigger('click')
    expect(view.get<HTMLTextAreaElement>('#settings-claude-prompt-text-0').element.value).toBe('Synthetic local expansion')
    await button(view, 'admin.settings.gatewayForwarding.resetSystemBlocks').trigger('click')
    expect(view.findAll('textarea[id^="settings-claude-prompt-text-"]')).toHaveLength(3)
    await save(view)
    const blocks = JSON.parse(String(lastBody().claude_oauth_system_prompt_blocks)) as { text: string; cache_control?: { ttl: string } }[]
    expect(blocks).toHaveLength(3)
    expect(blocks[0].text).toBe('{billing_header}')
    expect(blocks[1].text).not.toBe('Synthetic local expansion')
    expect(blocks[2].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' })
  })

  it.each([
    { preset: 'system', label: 'admin.settings.gatewayForwarding.systemBlockPresetIdentity', cached: false },
    { preset: 'expansion', label: 'admin.settings.gatewayForwarding.systemBlockPresetExpansion', cached: true },
  ])('applies the $preset preset through the real selector and saves its cache contract', async ({ label, cached }) => {
    const view = await render()
    await tab(view, 'gateway')
    await choose(view, '#settings-claude-prompt-preset-0', label)
    expect(view.get<HTMLTextAreaElement>('#settings-claude-prompt-text-0').element.value.length).toBeGreaterThan(10)
    if (cached) await choose(view, '[aria-label="admin.settings.gatewayForwarding.systemBlockCacheControl 1: TTL"]', 'admin.settings.gatewayForwarding.cacheTTL1h')
    await save(view)
    const block = (JSON.parse(String(lastBody().claude_oauth_system_prompt_blocks)) as Record<string, unknown>[])[0]
    expect(block.type).toBe('text')
    expect(Boolean(block.cache_control)).toBe(cached)
    if (cached) expect(block.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('adds a fingerprint signal, removes a different row, and submits only the remaining normalized header signal', async () => {
    settings.codex_cli_only_engine_fingerprint_signals = '[{"type":"header_prefix","match":["x-old-"],"required":true}]'
    const view = await render()
    await tab(view, 'gateway')
    const oldMatch = view.get('[aria-label="admin.settings.gatewayForwarding.codexFpMatchPlaceholder"]')
    const editor = new DOMWrapper(oldMatch.element.parentElement!.parentElement!)
    await button(editor, 'admin.settings.gatewayForwarding.codexAddRow').trigger('click')
    await view.findAll('[aria-label="admin.settings.gatewayForwarding.codexFpMatchPlaceholder"]')[1].setValue(' x-release-client / x-release-session ')
    await button(new DOMWrapper(oldMatch.element.parentElement!), 'admin.settings.gatewayForwarding.codexRemoveRow').trigger('click')
    expect(view.findAll('[aria-label="Client fingerprint match type"]')).toHaveLength(1)
    await save(view)
    expect(JSON.parse(String(lastBody().codex_cli_only_engine_fingerprint_signals))).toEqual([{ type: 'header_exact', match: ['x-release-client', 'x-release-session'], required: false }])
  })

  it('loads mixed Codex entries defensively and permits clearing both client lists with explicit empty strings', async () => {
    settings.codex_cli_only_blacklist = '[{"originator":"old-client","ua_contains":["old-agent",12]}]'
    settings.codex_cli_only_whitelist = '[{"originator":"trusted-client","ua_contains":["trusted-agent"],"skip_engine_fingerprint":true}]'
    const view = await render()
    await tab(view, 'gateway')
    const clients = view.findAll<HTMLInputElement>('[aria-label="admin.settings.gatewayForwarding.codexOriginatorPlaceholder"]')
    expect(clients.map(node => node.element.value)).toEqual(['old-client', 'trusted-client'])
    for (const client of clients) await button(new DOMWrapper(client.element.parentElement!), 'admin.settings.gatewayForwarding.codexRemoveRow').trigger('click')
    await save(view)
    expect(lastBody()).toMatchObject({ codex_cli_only_blacklist: '', codex_cli_only_whitelist: '' })
  })

  it('normalizes pasted trusted IP headers, rejects malformed names and removes a tag without affecting the others', async () => {
    settings.forwarded_client_ip_headers = []
    const view = await render()
    await tab(view, 'security')
    const input = view.get('#forwarded-client-ip-headers')
    await input.trigger('paste', { clipboardData: { getData: () => ' X-Client-IP, x-client-ip; CF-Connecting-IP\ninvalid header' } })
    expect(feedback.error).toHaveBeenCalledWith('admin.settings.apiKeyAcl.forwardedClientIpHeaderInvalid')
    expect(view.findAll('[data-testid="forwarded-client-ip-header-tag"]').map(node => node.text())).toEqual(['X-Client-Ip', 'Cf-Connecting-Ip'])
    await input.trigger('keydown', { key: 'Backspace' })
    await save(view)
    expect(lastBody().forwarded_client_ip_headers).toEqual(['X-Client-Ip'])
  })

  it('removes a registration domain using its own tag button and sends the other domain unchanged', async () => {
    settings.registration_email_suffix_whitelist = ['allowed.invalid', 'remove.invalid']
    const view = await render()
    await tab(view, 'security')
    const tag = view.findAll('span.inline-flex').find(node => node.text() === 'remove.invalid')
    expect(tag).toBeDefined()
    await tag!.get('button').trigger('click')
    await save(view)
    expect(lastBody().registration_email_suffix_whitelist).toEqual(['@allowed.invalid'])
  })

  it('edits ordinary default credits, RPM and monthly quota without changing the selected subscription', async () => {
    const view = await render()
    await tab(view, 'users')
    await view.get('#settings-form-default-balance').setValue('12.75')
    await view.get('#settings-form-default-user-rpm-limit').setValue('47')
    await view.get('[aria-label="openai: admin.settings.platformQuota.monthly"]').setValue('30.5')
    await save(view)
    expect(lastBody()).toMatchObject({ default_balance: 12.75, default_user_rpm_limit: 47, default_subscriptions: [] })
    expect(lastBody().default_platform_quotas).toMatchObject({ openai: { monthly: 30.5 } })
  })

  it('removes an auth-source subscription while retaining a different source-specific grant and quota', async () => {
    settings.auth_source_default_email_grant_on_signup = true
    settings.auth_source_default_email_balance = 5
    settings.auth_source_default_email_concurrency = 2
    settings.auth_source_default_email_subscriptions = [{ group_id: 11, validity_days: 30 }]
    const view = await render()
    await tab(view, 'users')
    const panel = view.get('[data-testid="auth-source-email-panel"]')
    const row = panel.get('#settings-auth-source-subscription-days-email-0').element.parentElement!.parentElement!
    await button(new DOMWrapper(row), 'common.delete').trigger('click')
    await panel.get('[aria-label="admin.settings.authSourceDefaults.sources.email.title / openai: admin.settings.platformQuota.weekly"]').setValue('14.5')
    await panel.get('[aria-label="admin.settings.authSourceDefaults.sources.email.title / openai: admin.settings.platformQuota.monthly"]').setValue('51')
    await save(view)
    expect(lastBody()).toMatchObject({ auth_source_default_email_grant_on_signup: true, auth_source_default_email_balance: 5, auth_source_default_email_concurrency: 2, auth_source_default_email_subscriptions: [], auth_source_default_email_platform_quotas: { openai: { weekly: 14.5, monthly: 51 } } })
  })

  it('saves feature visibility, model plaza text and explicit cyber-session expiration in seconds', async () => {
    const view = await render()
    await tab(view, 'features')
    for (const id of ['available-channels-enabled', 'model-plaza-enabled', 'model-plaza-require-auth', 'plugin-management-enabled', 'risk-control-enabled', 'cyber-session-block-enabled']) {
      const control = view.get(`#settings-form-${id}`)
      if (control.attributes('aria-checked') === 'true') await control.trigger('click')
      await control.trigger('click')
    }
    await view.get('#settings-form-model-plaza-description').setValue('Synthetic model catalog instructions')
    await view.get('#settings-form-cyber-session-block-ttl-seconds').setValue('123')
    await save(view)
    expect(lastBody()).toMatchObject({ available_channels_enabled: true, model_plaza_enabled: true, model_plaza_require_auth: true, model_plaza_description: 'Synthetic model catalog instructions', plugin_management_enabled: true, risk_control_enabled: true, cyber_session_block_enabled: true, cyber_session_block_ttl_seconds: 123 })
  })

  it('sends affiliate percentage and time-window terms exactly and retains a rejected draft for explicit retry', async () => {
    const view = await render()
    await tab(view, 'features')
    await toggle(view, 'settings-form-affiliate-enabled')
    await toggle(view, 'settings-form-affiliate-admin-recharge-enabled')
    await view.get('#settings-form-affiliate-rebate-rate').setValue('0.12')
    await view.get('#settings-form-affiliate-rebate-freeze-hours').setValue('6')
    await view.get('#settings-form-affiliate-rebate-duration-days').setValue('45')
    await view.get('#settings-form-affiliate-rebate-per-invitee-cap').setValue('12.5')
    rejectNext = true
    await save(view)
    expect(feedback.error).toHaveBeenCalled()
    expect(view.get<HTMLInputElement>('#settings-form-affiliate-rebate-freeze-hours').element.value).toBe('6')
    await save(view)
    expect(writes()).toHaveLength(2)
    expect(lastBody()).toMatchObject({ affiliate_enabled: true, affiliate_admin_recharge_enabled: true, affiliate_rebate_rate: 0.12, affiliate_rebate_freeze_hours: 6, affiliate_rebate_duration_days: 45, affiliate_rebate_per_invitee_cap: 12.5 })
  })

  it('saves payment presentation and order limits without creating, deleting or charging through a provider', async () => {
    const view = await render()
    await tab(view, 'payment')
    await toggle(view, 'settings-form-payment-enabled')
    await view.get('#settings-form-payment-product-name-prefix').setValue('Credits: ')
    await view.get('#settings-form-payment-product-name-suffix').setValue(' units')
    await view.get('#settings-form-payment-order-timeout-minutes').setValue('23')
    await view.get('#settings-form-payment-max-pending-orders').setValue('4')
    await view.get('#settings-form-payment-help-text').setValue('Synthetic order help')
    await choose(view, '#settings-form-payment-load-balance-strategy', 'admin.settings.payment.strategyRoundRobin')
    await save(view)
    expect(lastBody()).toMatchObject({ payment_enabled: true, payment_product_name_prefix: 'Credits: ', payment_product_name_suffix: ' units', payment_order_timeout_minutes: 23, payment_max_pending_orders: 4, payment_load_balance_strategy: 'round-robin', payment_help_text: 'Synthetic order help' })
    expect(requests.every(request => request.path === '/admin/settings')).toBe(true)
  })

  it('changes an authentication-source subscription through actual selected/option slots and preserves the source quota', async () => {
    settings.auth_source_default_github_grant_on_signup = true
    settings.auth_source_default_github_subscriptions = [{ group_id: 11, validity_days: 30 }]
    const view = await render()
    await tab(view, 'users')
    await choose(view, '#settings-auth-source-subscription-group-github-0', 'Release premium')
    await view.get('#settings-auth-source-subscription-days-github-0').setValue('60')
    await view.get('[aria-label="GitHub / openai: admin.settings.platformQuota.daily"]').setValue('3.5')
    await save(view)
    expect(lastBody()).toMatchObject({ auth_source_default_github_subscriptions: [{ group_id: 22, validity_days: 60 }], auth_source_default_github_platform_quotas: { openai: { daily: 3.5 } } })
  })

  it('removes one Fast target pattern through its row button and keeps the other model and explicit fallback policy', async () => {
    settings.openai_fast_policy_settings = { rules: [{ service_tier: 'flex', action: 'filter', scope: 'all', model_whitelist: ['remove-release-*', 'keep-release-*'], fallback_action: 'pass' }] }
    const view = await render()
    await tab(view, 'gateway')
    const pattern = view.get('#settings-openai-fast-pattern-0-0')
    await new DOMWrapper(pattern.element.parentElement!).get('button').trigger('click')
    expect(view.get<HTMLInputElement>('#settings-openai-fast-pattern-0-0').element.value).toBe('keep-release-*')
    await save(view)
    expect(lastBody().openai_fast_policy_settings).toEqual({ rules: [{ service_tier: 'flex', action: 'filter', scope: 'all', model_whitelist: ['keep-release-*'], fallback_action: 'pass' }] })
  })
})

describe('Settings release configuration boundaries with literal saved DTO assertions', () => {
  it('enforces the sixteen trusted-header limit through native input, preserves existing entries, and permits a replacement after removal', async () => {
    const headers = Array.from({ length: 16 }, (_, index) => `X-Release-${index}`); settings.forwarded_client_ip_headers = headers
    const view = await render(); await tab(view, 'security'); const input = view.get<HTMLInputElement>('#forwarded-client-ip-headers')
    await input.setValue('X-Seventeenth'); await input.trigger('keydown', { key: 'Enter' }); expect(feedback.error).toHaveBeenCalledWith('admin.settings.apiKeyAcl.forwardedClientIpHeadersLimit')
    expect(view.findAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(16)
    await input.trigger('keydown', { key: 'Backspace' }); await input.setValue('x-replacement-ip'); await input.trigger('keydown', { key: 'Enter' })
    await save(view); expect(lastBody().forwarded_client_ip_headers).toEqual([...headers.slice(0, 15), 'X-Replacement-Ip'])
  })

  it('ignores empty paste and composing separators in the trusted-header editor, then commits only the finished native draft', async () => {
    settings.forwarded_client_ip_headers = []; const view = await render(); await tab(view, 'security'); const input = view.get<HTMLInputElement>('#forwarded-client-ip-headers')
    await input.trigger('paste', { clipboardData: { getData: () => '  ' } }); await input.setValue('x-composed-ip'); await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(input.element.value).toBe('x-composed-ip'); expect(view.findAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(0)
    await input.trigger('keydown', { key: 'Enter' }); await input.trigger('keydown', { key: 'Enter' }); await save(view)
    expect(lastBody().forwarded_client_ip_headers).toEqual(['X-Composed-Ip']); expect(feedback.error).not.toHaveBeenCalled()
  })

  it('normalizes an older trusted-header list with non-text, duplicate and invalid entries before showing or saving it', async () => {
    settings.forwarded_client_ip_headers = [null, 7, 'X-Real-IP', 'x-real-ip', '', 'bad header', 'CF-Connecting-IP']
    const view = await render(); await tab(view, 'security'); expect(view.findAll('[data-testid="forwarded-client-ip-header-tag"]').map(node => node.text())).toEqual(['X-Real-Ip', 'Cf-Connecting-Ip'])
    await save(view); expect(lastBody().forwarded_client_ip_headers).toEqual(['X-Real-Ip', 'Cf-Connecting-Ip'])
  })

  it('normalizes pasted registration domains, ignores duplicates and malformed entries, and removes the last tag using Backspace', async () => {
    settings.registration_email_suffix_whitelist = []; const view = await render(); await tab(view, 'security'); const input = view.get<HTMLInputElement>('input[aria-label="admin.settings.registration.emailSuffixWhitelist"]')
    await input.trigger('paste', { clipboardData: { getData: () => ' @ALPHA.invalid, *.beta.invalid\nalpha.invalid\nnot a domain' } })
    await input.trigger('keydown', { key: 'Backspace' }); await save(view); expect(lastBody().registration_email_suffix_whitelist).toEqual(['@alpha.invalid'])
  })

  it('leaves a composing registration suffix draft untouched and commits a completed domain on blur while ignoring empty paste', async () => {
    settings.registration_email_suffix_whitelist = []; const view = await render(); await tab(view, 'security'); const input = view.get<HTMLInputElement>('input[aria-label="admin.settings.registration.emailSuffixWhitelist"]')
    await input.trigger('paste', { clipboardData: { getData: () => '' } }); await input.setValue('@composed.invalid'); await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(input.element.value).toBe('composed.invalid'); await input.trigger('blur'); expect(input.element.value).toBe(''); await input.trigger('keydown', { key: 'Enter' }); await save(view)
    expect(lastBody().registration_email_suffix_whitelist).toEqual(['@composed.invalid'])
  })

  it.each(['mp', 'mobile'] as const)('makes WeChat %s the exclusive mobile-context mode while preserving the independent PC-app capability', async mode => {
    Object.assign(settings, { wechat_connect_enabled: true, wechat_connect_open_enabled: true, wechat_connect_mp_enabled: mode !== 'mp', wechat_connect_mobile_enabled: mode !== 'mobile', wechat_connect_mode: mode === 'mp' ? 'mobile' : 'mp' })
    const view = await render(); await tab(view, 'security'); const control = view.get(`[data-testid="wechat-connect-${mode}-enabled"]`); await control.trigger('click'); await flushPromises()
    expect(control.attributes('aria-checked')).toBe('true'); expect(view.get(`[data-testid="wechat-connect-${mode === 'mp' ? 'mobile' : 'mp'}-enabled"]`).attributes('aria-checked')).toBe('false')
    await save(view); expect(lastBody()).toMatchObject({ wechat_connect_open_enabled: true, wechat_connect_mp_enabled: mode === 'mp', wechat_connect_mobile_enabled: mode === 'mobile' })
  })

  it('keeps a configured nonempty Claude expansion prompt when choosing the expansion block preset', async () => {
    settings.claude_oauth_system_prompt = 'Synthetic operator expansion instruction'; const view = await render(); await tab(view, 'gateway')
    await choose(view, '#settings-claude-prompt-preset-0', 'admin.settings.gatewayForwarding.systemBlockPresetExpansion'); expect(view.get<HTMLTextAreaElement>('#settings-claude-prompt-text-0').element.value).toBe('Synthetic operator expansion instruction')
    await save(view); expect(JSON.parse(String(lastBody().claude_oauth_system_prompt_blocks))[0]).toMatchObject({ type: 'text', text: 'Synthetic operator expansion instruction', cache_control: { type: 'ephemeral', ttl: '5m' } })
  })

  it('saves positive recharge/order bounds, an independent conversion rate and the literal fee percentage without contacting a payment provider', async () => {
    settings.payment_enabled = true; const view = await render(); await tab(view, 'payment')
    for (const [key, value] of Object.entries({ 'min-amount': '2.5', 'max-amount': '125', 'daily-limit': '250', 'balance-recharge-multiplier': '1.75', 'subscription-usd-to-cny-rate': '7.25', 'recharge-fee-rate': '2.35' })) await view.get(`#settings-form-payment-${key}`).setValue(value)
    expect(view.text()).toContain('admin.settings.payment.rechargeFeePreview'); await save(view)
    expect(lastBody()).toMatchObject({ payment_min_amount: 2.5, payment_max_amount: 125, payment_daily_limit: 250, payment_balance_recharge_multiplier: 1.75, payment_subscription_usd_to_cny_rate: 7.25, payment_recharge_fee_rate: 2.35 }); expect(requests.every(request => request.path === '/admin/settings')).toBe(true)
  })

  it('keeps a named-user Fast block rule and sends only its applicable error and trimmed model/fallback fields', async () => {
    settings.openai_fast_policy_settings = { rules: [{ service_tier: 'priority', action: 'block', scope: 'oauth', user_ids: [51], error_message: 'Synthetic explicit block', model_whitelist: [' synthetic-model-* ', '   '], fallback_action: 'block', fallback_error_message: 'Synthetic fallback block' }] }
    const view = await render(); await tab(view, 'gateway'); expect(view.text()).toContain('synthetic-fast@example.invalid')
    await view.get('#settings-openai-fast-error-message-0').setValue('Synthetic updated block'); await save(view)
    expect(lastBody().openai_fast_policy_settings).toEqual({ rules: [{ service_tier: 'priority', action: 'block', scope: 'oauth', user_ids: [51], error_message: 'Synthetic updated block', model_whitelist: ['synthetic-model-*'], fallback_action: 'block', fallback_error_message: 'Synthetic fallback block' }] })
  })

  it('omits irrelevant Fast block/fallback fields when no target models remain, rather than persisting hidden errors', async () => {
    settings.openai_fast_policy_settings = { rules: [{ service_tier: 'flex', action: 'pass', scope: 'apikey', user_ids: [], error_message: 'Hidden action error', model_whitelist: [], fallback_action: 'block', fallback_error_message: 'Hidden fallback error' }] }
    const view = await render(); await tab(view, 'gateway'); expect(view.find('#settings-openai-fast-error-message-0').exists()).toBe(false); await save(view)
    expect(lastBody().openai_fast_policy_settings).toEqual({ rules: [{ service_tier: 'flex', action: 'pass', scope: 'apikey' }] })
  })

  it('loads checkbox consent and normalizes distinct document slugs and Markdown while dropping an entirely blank document', async () => {
    settings.login_agreement_enabled = true; settings.login_agreement_mode = 'checkbox'; settings.login_agreement_documents = [{ id: 'old', title: 'Synthetic title', content_md: 'Synthetic body' }, { id: 'blank', title: '', content_md: '' }]
    const view = await render(); await tab(view, 'agreement'); expect(view.text()).toContain('The checkbox appears below the login button and gates all login actions.')
    await view.get('#settings-agreement-id-0').setValue(' Synthetic / Release '); await view.get('#settings-agreement-title-0').setValue(' Synthetic release terms '); await view.get('#settings-agreement-content-md-0').setValue(' **Synthetic body** '); await save(view)
    expect(lastBody()).toMatchObject({ login_agreement_mode: 'checkbox', login_agreement_documents: [{ id: 'synthetic-release', title: 'Synthetic release terms', content_md: '**Synthetic body**' }] })
  })

  it('rejects duplicate document routes visibly, then saves a corrected native slug without dropping either document', async () => {
    settings.login_agreement_documents = [{ id: 'synthetic-a', title: 'Synthetic A', content_md: 'A' }, { id: 'synthetic-b', title: 'Synthetic B', content_md: 'B' }]
    const view = await render(); await tab(view, 'agreement'); await view.get('#settings-agreement-id-1').setValue('SYNTHETIC-A'); await save(view)
    expect(writes()).toEqual([]); expect(feedback.error).toHaveBeenCalledWith('Login agreement document routes cannot be duplicated: /legal/synthetic-a')
    await view.get('#settings-agreement-id-1').setValue('synthetic-c'); await save(view); expect(lastBody().login_agreement_documents).toEqual([{ id: 'synthetic-a', title: 'Synthetic A', content_md: 'A' }, { id: 'synthetic-c', title: 'Synthetic B', content_md: 'B' }])
  })

  it('requires a document title when body text is present and supports a corrected title with a derived route slug', async () => {
    settings.login_agreement_documents = [{ id: '', title: '', content_md: 'Synthetic untitled body' }]
    const view = await render(); await tab(view, 'agreement'); await save(view); expect(writes()).toEqual([]); expect(feedback.error).toHaveBeenCalledWith('Login agreement document title cannot be empty.')
    await view.get('#settings-agreement-title-0').setValue('Release terms'); await view.get('#settings-agreement-id-0').setValue(''); await save(view); expect(lastBody().login_agreement_documents).toEqual([{ id: 'release-terms', title: 'Release terms', content_md: 'Synthetic untitled body' }])
  })
})
