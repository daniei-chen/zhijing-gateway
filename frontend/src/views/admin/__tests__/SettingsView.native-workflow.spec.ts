import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import SettingsView from '../SettingsView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { ProviderInstance } from '@/types/payment'

const api = vi.hoisted(() => ({
  getSettings: vi.fn(), updateSettings: vi.fn(), getWebSearchEmulationConfig: vi.fn(), updateWebSearchEmulationConfig: vi.fn(),
  getAdminApiKey: vi.fn(), regenerateAdminApiKey: vi.fn(), deleteAdminApiKey: vi.fn(),
  getOverloadCooldownSettings: vi.fn(), getRateLimit429CooldownSettings: vi.fn(), getPanelRateLimitSettings: vi.fn(),
  getStreamTimeoutSettings: vi.fn(), getRectifierSettings: vi.fn(), getBetaPolicySettings: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn(), getOllamaCloudUsageSettings: vi.fn(), getOpenCodeGoUsageSettings: vi.fn(),
  groups: vi.fn(), proxies: vi.fn(), getProviders: vi.fn(), createProvider: vi.fn(), updateProvider: vi.fn(), deleteProvider: vi.fn(),
  resetWebSearchUsage: vi.fn(), testWebSearchEmulation: vi.fn(),
  listAffiliateUsers: vi.fn(), lookupAffiliateUsers: vi.fn(), updateAffiliateUser: vi.fn(), clearAffiliateUser: vi.fn(), batchAffiliateRate: vi.fn(),
  success: vi.fn(), error: vi.fn(), publicSettings: vi.fn(), adminSettings: vi.fn(), clipboard: vi.fn(),
}))

vi.mock('@/api', () => ({ adminAPI: {
  settings: {
    getSettings: api.getSettings, updateSettings: api.updateSettings,
    getWebSearchEmulationConfig: api.getWebSearchEmulationConfig, updateWebSearchEmulationConfig: api.updateWebSearchEmulationConfig,
    getAdminApiKey: api.getAdminApiKey, regenerateAdminApiKey: api.regenerateAdminApiKey, deleteAdminApiKey: api.deleteAdminApiKey,
    getOverloadCooldownSettings: api.getOverloadCooldownSettings, getRateLimit429CooldownSettings: api.getRateLimit429CooldownSettings,
    getPanelRateLimitSettings: api.getPanelRateLimitSettings, getStreamTimeoutSettings: api.getStreamTimeoutSettings,
    getRectifierSettings: api.getRectifierSettings, getBetaPolicySettings: api.getBetaPolicySettings,
    resetWebSearchUsage: api.resetWebSearchUsage, testWebSearchEmulation: api.testWebSearchEmulation,
  },
  accounts: {
    getUpstreamBillingProbeSettings: api.getUpstreamBillingProbeSettings, getOllamaCloudUsageSettings: api.getOllamaCloudUsageSettings,
    getOpenCodeGoUsageSettings: api.getOpenCodeGoUsageSettings,
  },
  groups: { getAll: api.groups }, proxies: { list: api.proxies },
  payment: { getProviders: api.getProviders, createProvider: api.createProvider, updateProvider: api.updateProvider, deleteProvider: api.deleteProvider },
} }))
vi.mock('@/api/admin/affiliates', () => {
  const affiliates = {
    listUsers: api.listAffiliateUsers, lookupUsers: api.lookupAffiliateUsers, updateUserSettings: api.updateAffiliateUser,
    clearUserSettings: api.clearAffiliateUser, batchSetRate: api.batchAffiliateRate,
  }
  return { default: affiliates, affiliatesAPI: affiliates }
})
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error, fetchPublicSettings: api.publicSettings }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: api.adminSettings }) }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } }, getLocale: () => 'en' }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

const nativeSelect = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit }) {
    return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => {
      const raw = (event.target as HTMLSelectElement).value
      const option = props.options.find((item: { value: unknown }) => String(item.value ?? '') === raw)
      const value = option?.value ?? raw
      emit('update:modelValue', value); emit('change', value, option)
    } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value ?? '') }, option.label)))
  },
})
const nativeToggle = defineComponent({
  inheritAttrs: false, props: { modelValue: Boolean, disabled: Boolean }, emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', { ...attrs, type: 'checkbox', checked: props.modelValue, disabled: props.disabled,
      onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked),
    })
  },
})
const icon = defineComponent({ props: ['name'], setup: props => () => h('span', { 'data-icon': props.name, 'aria-hidden': true }) })
const views: VueWrapper[] = []
const baseSettings = () => ({
  site_name: 'Synthetic native settings', backend_mode_enabled: false, table_default_page_size: 20, table_page_size_options: [10, 20, 50, 100],
  registration_enabled: true, default_balance: 0, default_concurrency: 1, default_subscriptions: [],
  payment_enabled: true, payment_enabled_types: ['stripe', 'alipay'],
  claude_oauth_system_prompt_blocks: JSON.stringify([{ enabled: true, type: 'text', text: 'Loaded synthetic block', cache_control: { type: 'ephemeral', ttl: '1h' } }]),
  codex_cli_only_engine_fingerprint_signals: JSON.stringify([{ type: 'header_exact', match: ['x-synthetic=old'], required: true }]),
  codex_cli_only_blacklist: '', codex_cli_only_whitelist: '', openai_fast_policy_settings: { rules: [] },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function render() {
  const view = mount(SettingsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, Icon: icon, Select: nativeSelect, Toggle: nativeToggle,
    GroupBadge: true, GroupOptionItem: true, ProxySelector: true, ImageUpload: true, BackupSettings: true,
    AdminAccessKeysSettings: true, EmailTemplateEditor: true, RouterLink: { template: '<a><slot/></a>' },
    OpenAIFastPolicyUserSelector: true,
    BaseDialog: { props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :aria-label="title"><button type="button" @click="$emit(\'close\')">close-dialog</button><slot/><slot name="footer"/></section>' },
    teleport: true,
  } } })
  views.push(view); await flushPromises(); return view
}
async function openTab(view: VueWrapper, key: string) { await view.get(`#settings-tab-${key}`).trigger('click'); await flushPromises() }
function button(scope: Pick<VueWrapper, 'findAll'> | DOMWrapper<Element>, text: string) {
  const found = scope.findAll('button').find(node => node.text() === text)
  expect(found, `button ${text}`).toBeDefined(); return found!
}
function card(view: VueWrapper, title: string) {
  const found = view.findAll('.card').find(node => node.findAll('h2,h3').some(heading => heading.text() === title))
  expect(found, `card ${title}`).toBeDefined(); return found!
}
async function save(view: VueWrapper) { await view.get('form').trigger('submit'); await flushPromises() }
const payload = () => api.updateSettings.mock.calls.at(-1)![0]
const provider = (id = 21, overrides: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id, provider_key: 'stripe', name: `Synthetic provider ${id}`, supported_types: ['card'], enabled: true,
  refund_enabled: true, allow_user_refund: true, payment_mode: '', config: { publishableKey: 'synthetic-public', currency: 'CNY' }, limits: '', sort_order: id,
  ...overrides,
} as ProviderInstance)

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset())
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-native-settings-admin', user: { id: 7 } })
  api.getSettings.mockImplementation(async () => baseSettings())
  api.updateSettings.mockImplementation(async request => ({ ...baseSettings(), ...JSON.parse(JSON.stringify(request)) }))
  api.getWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] })
  api.updateWebSearchEmulationConfig.mockImplementation(async request => request)
  api.getAdminApiKey.mockResolvedValue({ exists: false, masked_key: '' })
  api.getOverloadCooldownSettings.mockResolvedValue({ enabled: true, cooldown_minutes: 10 })
  api.getRateLimit429CooldownSettings.mockResolvedValue({ enabled: true, cooldown_seconds: 5 })
  api.getPanelRateLimitSettings.mockResolvedValue({ enabled: true, user_rpm: 240, heavy_rpm: 60, public_ip_rpm: 300, exempt_admin: true })
  api.getStreamTimeoutSettings.mockResolvedValue({ enabled: false, action: 'temp_unsched', temp_unsched_minutes: 5, threshold_count: 3, threshold_window_minutes: 10 })
  api.getRectifierSettings.mockResolvedValue({ enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true })
  api.getBetaPolicySettings.mockResolvedValue({ rules: [] })
  api.getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: false, interval_minutes: 30 })
  api.getOllamaCloudUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 60, debounce_minutes: 1 })
  api.getOpenCodeGoUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 15, debounce_minutes: 1 })
  api.groups.mockResolvedValue([{ id: 11, name: 'Synthetic subscription', subscription_type: 'subscription', platform: 'openai', status: 'active' }])
  api.proxies.mockResolvedValue({ items: [] }); api.getProviders.mockResolvedValue({ data: [] })
  api.listAffiliateUsers.mockResolvedValue({ items: [], total: 0 }); api.lookupAffiliateUsers.mockResolvedValue([])
  api.publicSettings.mockResolvedValue({}); api.adminSettings.mockResolvedValue({})
  api.regenerateAdminApiKey.mockResolvedValue({ key: 'synthetic-admin-key-000000000001' }); api.deleteAdminApiKey.mockResolvedValue(undefined)
  api.clipboard.mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: 0, clipboard: { writeText: api.clipboard } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('confirm', vi.fn(() => true))
})
afterEach(() => { views.splice(0).forEach(view => view.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('native settings policy workflows', () => {
  it('loads a Claude block, edits its text/cache, adds a billing block and preserves order across tabs before saving', async () => {
    const view = await render(); await openTab(view, 'gateway')
    expect((view.get('#settings-claude-prompt-text-0').element as HTMLTextAreaElement).value).toBe('Loaded synthetic block')
    await view.get('#settings-claude-prompt-text-0').setValue('Synthetic edited block')
    await view.get('#settings-claude-prompt-cache-control-enabled-0').setValue(false)
    await button(view, 'admin.settings.gatewayForwarding.addSystemBlock').trigger('click')
    await view.get('#settings-claude-prompt-preset-1').setValue('billing')
    await openTab(view, 'general'); await openTab(view, 'gateway')
    expect((view.get('#settings-claude-prompt-text-0').element as HTMLTextAreaElement).value).toBe('Synthetic edited block')
    await save(view)
    expect(JSON.parse(payload().claude_oauth_system_prompt_blocks)).toEqual([
      { enabled: true, type: 'text', text: 'Synthetic edited block' },
      { enabled: true, type: 'text', text: '{billing_header}' },
    ])
    expect(api.success).toHaveBeenCalled()
  })

  it('moves and disables actual Claude blocks, then removes every row without restoring the default injection', async () => {
    const view = await render(); await openTab(view, 'gateway')
    await button(view, 'admin.settings.gatewayForwarding.addSystemBlock').trigger('click')
    await view.get('#settings-claude-prompt-text-1').setValue('Second synthetic block')
    const second = view.get('#settings-claude-prompt-text-1').element.closest('.rounded-lg')!
    await new DOMWrapper(second).get('[data-icon="arrowUp"]').element.parentElement!.click()
    await flushPromises()
    expect((view.get('#settings-claude-prompt-text-0').element as HTMLTextAreaElement).value).toBe('Second synthetic block')
    await view.get('input[aria-label="admin.settings.gatewayForwarding.systemBlockText 1: common.enabled"]').setValue(false)
    await save(view)
    expect(JSON.parse(payload().claude_oauth_system_prompt_blocks).map((block: { enabled: boolean; text: string }) => [block.enabled, block.text])).toEqual([[false, 'Second synthetic block'], [true, 'Loaded synthetic block']])
    for (let index = 0; index < 2; index++) {
      const block = view.get('#settings-claude-prompt-text-0').element.closest('.rounded-lg')!
      ;(new DOMWrapper(block).get('[data-icon="trash"]').element.parentElement as HTMLButtonElement).click(); await flushPromises()
    }
    await save(view)
    expect(JSON.parse(payload().claude_oauth_system_prompt_blocks)).toEqual([{ enabled: false, type: 'text', text: '' }])
  })

  it('edits real Codex fingerprint and black/white list rows into the structured backend JSON contract', async () => {
    const view = await render(); await openTab(view, 'gateway')
    const fingerprint = view.get('select[aria-label="Client fingerprint match type"]').element.parentElement!
    await new DOMWrapper(fingerprint).get('select').setValue('body_path')
    await new DOMWrapper(fingerprint).get('input[type="text"]').setValue(' metadata.synthetic ')
    await new DOMWrapper(fingerprint).get('input[type="checkbox"]').setValue(false)
    expect(view.text()).toContain('admin.settings.gatewayForwarding.codexFingerprintNoRequiredWarn')
    const blacklist = view.findAll('label').find(label => label.text() === 'admin.settings.gatewayForwarding.codexBlacklist')!.element.parentElement!
    await button(new DOMWrapper(blacklist), 'admin.settings.gatewayForwarding.codexAddRow').trigger('click')
    await new DOMWrapper(blacklist).findAll('input')[0].setValue(' synthetic-client ')
    await new DOMWrapper(blacklist).findAll('input')[1].setValue(' blocked-one, blocked-two, ')
    const whitelist = view.findAll('label').find(label => label.text() === 'admin.settings.gatewayForwarding.codexWhitelist')!.element.parentElement!
    await button(new DOMWrapper(whitelist), 'admin.settings.gatewayForwarding.codexAddRow').trigger('click')
    await new DOMWrapper(whitelist).findAll('input')[0].setValue('trusted-synthetic')
    await new DOMWrapper(whitelist).get('input[type="checkbox"]').setValue(true)
    await save(view)
    expect(JSON.parse(payload().codex_cli_only_engine_fingerprint_signals)).toEqual([{ type: 'body_path', match: ['metadata.synthetic'], required: false }])
    expect(JSON.parse(payload().codex_cli_only_blacklist)).toEqual([{ originator: 'synthetic-client', ua_contains: ['blocked-one', 'blocked-two'] }])
    expect(JSON.parse(payload().codex_cli_only_whitelist)).toEqual([{ originator: 'trusted-synthetic', ua_contains: [], skip_engine_fingerprint: true }])
  })

  it('adds a Fast rule with an explicit tier, account scope, target model and separate fallback error contract', async () => {
    const view = await render(); await openTab(view, 'gateway')
    const policy = card(view, 'admin.settings.openaiFastPolicy.title')
    await button(policy, 'admin.settings.openaiFastPolicy.addRule').trigger('click')
    await policy.get('#settings-openai-fast-service-tier-0').setValue('ultrafast')
    await policy.get('#settings-openai-fast-action-0').setValue('block')
    await policy.get('#settings-openai-fast-scope-0').setValue('apikey')
    await policy.get('#settings-openai-fast-error-message-0').setValue('Synthetic target rejection')
    await button(policy, 'admin.settings.openaiFastPolicy.addModelPattern').trigger('click')
    await policy.get('#settings-openai-fast-pattern-0-0').setValue(' synthetic-model-* ')
    await policy.get('select[aria-label="admin.settings.openaiFastPolicy.fallbackAction"]').setValue('block')
    await policy.get('input[placeholder="admin.settings.openaiFastPolicy.fallbackErrorMessagePlaceholder"]').setValue('Synthetic fallback rejection')
    await save(view)
    expect(JSON.parse(JSON.stringify(payload().openai_fast_policy_settings))).toEqual({ rules: [{
      service_tier: 'ultrafast', action: 'block', scope: 'apikey', error_message: 'Synthetic target rejection',
      model_whitelist: ['synthetic-model-*'], fallback_action: 'block', fallback_error_message: 'Synthetic fallback rejection',
    }] })
  })

  it('removes stale block and fallback fields when a Fast rule is changed to pass for every model, then deletes the rule', async () => {
    api.getSettings.mockResolvedValue({ ...baseSettings(), openai_fast_policy_settings: { rules: [{
      service_tier: 'flex', action: 'block', scope: 'oauth', error_message: 'Old rejection',
      model_whitelist: ['synthetic-old'], fallback_action: 'block', fallback_error_message: 'Old fallback',
    }] } })
    const view = await render(); await openTab(view, 'gateway')
    await view.get('#settings-openai-fast-action-0').setValue('pass')
    await view.get('#settings-openai-fast-pattern-0-0').setValue('  ')
    await save(view)
    expect(JSON.parse(JSON.stringify(payload().openai_fast_policy_settings))).toEqual({ rules: [{ service_tier: 'flex', action: 'pass', scope: 'oauth' }] })
    await view.get('button[title="admin.settings.openaiFastPolicy.removeRule"]').trigger('click')
    await save(view)
    expect(payload().openai_fast_policy_settings).toEqual({ rules: [] })
  })

  it('preserves a typed Fast draft after an API failure and sends it only when the administrator retries', async () => {
    const view = await render(); await openTab(view, 'gateway')
    await button(card(view, 'admin.settings.openaiFastPolicy.title'), 'admin.settings.openaiFastPolicy.addRule').trigger('click')
    await view.get('#settings-openai-fast-service-tier-0').setValue('missing')
    api.updateSettings.mockRejectedValueOnce(new Error('Synthetic save failure'))
    await save(view)
    expect(api.error).toHaveBeenCalledTimes(1)
    expect((view.get('#settings-openai-fast-service-tier-0').element as HTMLSelectElement).value).toBe('missing')
    await view.get('#settings-openai-fast-scope-0').setValue('bedrock')
    await save(view)
    expect(api.updateSettings).toHaveBeenCalledTimes(2)
    expect(payload().openai_fast_policy_settings.rules[0]).toMatchObject({ service_tier: 'missing', scope: 'bedrock', action: 'filter' })
  })

  it('omits Fast policy on an unrelated save when an older backend did not load that setting', async () => {
    api.getSettings.mockResolvedValue({ ...baseSettings(), openai_fast_policy_settings: undefined })
    const view = await render()
    await view.get('#settings-form-site-name').setValue('Synthetic compatible title')
    await save(view)
    expect(payload().site_name).toBe('Synthetic compatible title')
    expect(payload()).not.toHaveProperty('openai_fast_policy_settings')
  })

  it.each(['email', 'github', 'google', 'dingtalk'] as const)('edits %s signup/bind defaults and a real subscription row without losing a hidden draft', async source => {
    api.getSettings.mockResolvedValue({ ...baseSettings(), [`auth_source_default_${source}_grant_on_signup`]: false })
    const view = await render(); await openTab(view, 'users')
    const toggle = view.get(`[data-testid="auth-source-${source}-enabled"]`)
    expect(view.find(`[data-testid="auth-source-${source}-panel"]`).exists()).toBe(false)
    await toggle.setValue(true)
    await view.get(`#settings-auth-source-balance-${source}`).setValue('12.75')
    await view.get(`#settings-auth-source-concurrency-${source}`).setValue('3')
    await view.get(`#settings-auth-source-grant-on-first-bind-${source}`).setValue(true)
    const panel = view.get(`[data-testid="auth-source-${source}-panel"]`)
    await button(panel, 'admin.settings.defaults.addDefaultSubscription').trigger('click')
    await panel.get(`#settings-auth-source-subscription-days-${source}-0`).setValue('45')
    await toggle.setValue(false); await toggle.setValue(true)
    expect((view.get(`#settings-auth-source-balance-${source}`).element as HTMLInputElement).value).toBe('12.75')
    await view.get('#settings-form-force-email-on-third-party-signup').setValue(true)
    await openTab(view, 'general'); await save(view)
    expect(payload()).toMatchObject({
      [`auth_source_default_${source}_balance`]: 12.75,
      [`auth_source_default_${source}_concurrency`]: 3,
      [`auth_source_default_${source}_grant_on_signup`]: true,
      [`auth_source_default_${source}_grant_on_first_bind`]: true,
      [`auth_source_default_${source}_subscriptions`]: [{ group_id: 11, validity_days: 45 }],
      force_email_on_third_party_signup: true,
    })
  })
})

describe('native legacy administrator key ownership', () => {
  async function renderKey() {
    api.getAdminApiKey.mockResolvedValue({ exists: true, masked_key: 'synthetic-old...0001' })
    const view = await render(); await openTab(view, 'security')
    ;(view.get('details').element as HTMLDetailsElement).open = true
    return view
  }

  it('respects native cancellation, regenerates once, shows only the new synthetic key and deletes explicitly', async () => {
    const view = await renderKey()
    vi.mocked(confirm).mockReturnValueOnce(false)
    await button(view, 'admin.settings.adminApiKey.regenerate').trigger('click'); await flushPromises()
    expect(api.regenerateAdminApiKey).not.toHaveBeenCalled()
    await button(view, 'admin.settings.adminApiKey.regenerate').trigger('click'); await flushPromises()
    expect(api.regenerateAdminApiKey).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain('synthetic-admin-key-000000000001')
    await button(view, 'admin.settings.adminApiKey.delete').trigger('click'); await flushPromises()
    expect(api.deleteAdminApiKey).toHaveBeenCalledTimes(1)
    expect(view.text()).not.toContain('synthetic-admin-key-000000000001')
    expect(api.success).toHaveBeenLastCalledWith('admin.settings.adminApiKey.keyDeleted')
  })

  it.each(['unmount', 'login'] as const)('discards late regenerated key material and feedback after %s', async change => {
    const pending = deferred<{ key: string }>(); api.regenerateAdminApiKey.mockReturnValue(pending.promise)
    const view = await renderKey()
    await button(view, 'admin.settings.adminApiKey.regenerate').trigger('click'); await flushPromises()
    if (change === 'unmount') { view.unmount(); views.splice(views.indexOf(view), 1) }
    else replaceAuthSession({ accessToken: 'synthetic-replacement-admin', user: { id: 7 } })
    pending.resolve({ key: 'synthetic-late-admin-secret' }); await flushPromises()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
    if (change === 'login') expect(view.text()).not.toContain('synthetic-late-admin-secret')
  })

  it('locks queued native regeneration clicks before Vue can render the disabled state', async () => {
    const pending = deferred<{ key: string }>(); api.regenerateAdminApiKey.mockReturnValue(pending.promise)
    const view = await renderKey()
    const regenerate = button(view, 'admin.settings.adminApiKey.regenerate').element as HTMLButtonElement
    regenerate.click(); regenerate.click(); await flushPromises()
    expect(api.regenerateAdminApiKey).toHaveBeenCalledTimes(1)
    pending.resolve({ key: 'synthetic-once-only-key' }); await flushPromises()
  })

  it('does not install a late legacy-key status from the previous login', async () => {
    const status = deferred<{ exists: boolean; masked_key: string }>()
    api.getAdminApiKey.mockReturnValue(status.promise)
    const view = await render(); await openTab(view, 'security')
    replaceAuthSession({ accessToken: 'synthetic-next-key-status-login', user: { id: 7 } })
    status.resolve({ exists: true, masked_key: 'synthetic-obsolete-mask' }); await flushPromises()
    expect(view.text()).not.toContain('synthetic-obsolete-mask')
    expect(view.find('button').exists()).toBe(true)
  })

  it('does not queue deletion while a native regeneration click already owns the key operation', async () => {
    const pending = deferred<{ key: string }>(); api.regenerateAdminApiKey.mockReturnValue(pending.promise)
    const view = await renderKey()
    const regenerate = button(view, 'admin.settings.adminApiKey.regenerate').element as HTMLButtonElement
    const remove = button(view, 'admin.settings.adminApiKey.delete').element as HTMLButtonElement
    regenerate.click(); remove.click(); await flushPromises()
    expect(api.regenerateAdminApiKey).toHaveBeenCalledTimes(1)
    expect(api.deleteAdminApiKey).not.toHaveBeenCalled()
    pending.resolve({ key: 'synthetic-regenerated-and-retained' }); await flushPromises()
    expect(view.text()).toContain('synthetic-regenerated-and-retained')
  })

  it('does not report an old copied key after a newer key replaces it in the same login', async () => {
    const copy = deferred<void>()
    const view = await renderKey()
    await button(view, 'admin.settings.adminApiKey.regenerate').trigger('click'); await flushPromises()
    api.clipboard.mockReturnValue(copy.promise)
    await button(view, 'admin.settings.adminApiKey.copyKey').trigger('click'); await flushPromises()
    expect(api.clipboard).toHaveBeenCalledWith('synthetic-admin-key-000000000001')
    api.regenerateAdminApiKey.mockResolvedValue({ key: 'synthetic-replacement-key-0002' })
    await button(view, 'admin.settings.adminApiKey.regenerate').trigger('click'); await flushPromises()
    api.success.mockClear(); api.error.mockClear()
    copy.resolve(); await flushPromises()
    expect(view.text()).toContain('synthetic-replacement-key-0002')
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
})

describe('native payment provider parent and child workflows', () => {
  async function openPayment(view: VueWrapper) {
    await openTab(view, 'payment')
    await vi.waitFor(() => expect(view.findAll('.card').some(panel => panel.findAll('h2,h3').some(heading => heading.text() === 'admin.settings.payment.providerManagement'))).toBe(true))
    await vi.waitFor(() => expect(view.text()).toContain('admin.settings.payment.providerManagement'))
    return card(view, 'admin.settings.payment.providerManagement')
  }
  function dialog(view: VueWrapper, mode: 'create' | 'edit' = 'create') {
    return view.get(`[role="dialog"][aria-label="admin.settings.payment.${mode}Provider"]`)
  }
  async function waitDialog(view: VueWrapper, mode: 'create' | 'edit' = 'create') {
    await vi.waitFor(() => expect(view.find(`[role="dialog"][aria-label="admin.settings.payment.${mode}Provider"]`).exists()).toBe(true))
    return dialog(view, mode)
  }
  async function newStripe(view: VueWrapper) {
    const list = await openPayment(view)
    await button(list, 'admin.settings.payment.createProvider').trigger('click'); await flushPromises()
    const form = await waitDialog(view)
    await form.get('select').setValue('stripe')
    await form.get('input[type="text"]').setValue('Synthetic native Stripe')
    for (const [name, value] of [['secretKey', 'synthetic-secret'], ['publishableKey', 'synthetic-public'], ['webhookSecret', 'synthetic-webhook']]) {
      const label = form.findAll('label').find(node => node.text().includes(`field_${name}`))!
      expect(label, name).toBeDefined()
      const control = label.element.parentElement!.querySelector('input,textarea')!
      await new DOMWrapper(control).setValue(value)
    }
    return form
  }

  it('creates a provider through the actual child form and submits the parent unsaved settings only after it succeeds', async () => {
    api.createProvider.mockImplementation(async request => { api.getProviders.mockResolvedValue({ data: [provider(24, request)] }); return provider(24, request) })
    const view = await render(); await view.get('#settings-form-site-name').setValue('Synthetic pending title')
    const form = await newStripe(view)
    await form.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(1)
    expect(api.createProvider.mock.calls[0][0]).toMatchObject({
      provider_key: 'stripe', name: 'Synthetic native Stripe', enabled: true, payment_mode: '',
      config: { secretKey: 'synthetic-secret', publishableKey: 'synthetic-public', webhookSecret: 'synthetic-webhook', currency: 'CNY' },
    })
    expect(view.find('[role="dialog"][aria-label="admin.settings.payment.createProvider"]').exists()).toBe(false)
    expect(card(view, 'admin.settings.payment.providerManagement').text()).toContain('Synthetic native Stripe')
    expect(api.updateSettings).toHaveBeenCalledTimes(1)
    expect(payload().site_name).toBe('Synthetic pending title')
  })

  it('cancels a provider edit without writing and retries a rejected edit against the original provider ID', async () => {
    api.getProviders.mockResolvedValue({ data: [provider()] })
    const view = await render(); let list = await openPayment(view)
    await button(list, 'common.edit').trigger('click'); await flushPromises()
    await (await waitDialog(view, 'edit')).get('input[type="text"]').setValue('Cancelled native name')
    await button(dialog(view, 'edit'), 'common.cancel').trigger('click'); await flushPromises()
    expect(api.updateProvider).not.toHaveBeenCalled()
    await button(list, 'common.edit').trigger('click'); await flushPromises()
    const edit = await waitDialog(view, 'edit')
    expect((edit.get('input[type="text"]').element as HTMLInputElement).value).toBe('Synthetic provider 21')
    await edit.get('input[type="text"]').setValue('Retried native name')
    api.updateProvider.mockRejectedValueOnce({ status: 400, message: 'Synthetic invalid merchant configuration' })
    await edit.get('form').trigger('submit'); await flushPromises()
    expect(view.find('[role="dialog"][aria-label="admin.settings.payment.editProvider"]').exists()).toBe(true)
    expect(api.error).toHaveBeenCalledTimes(1)
    api.updateProvider.mockImplementation(async (id, request) => { api.getProviders.mockResolvedValue({ data: [provider(id, request)] }); return provider(id, request) })
    await edit.get('form').trigger('submit'); await flushPromises()
    expect(api.updateProvider.mock.calls.map(call => call[0])).toEqual([21, 21])
    expect(api.updateProvider.mock.calls[1][1].name).toBe('Retried native name')
    expect(api.createProvider).not.toHaveBeenCalled()
    list = card(view, 'admin.settings.payment.providerManagement')
    expect(list.text()).toContain('Retried native name')
  })

  it('does not auto-save settings or publish feedback when an old provider creation resolves after unmount', async () => {
    const pending = deferred<ProviderInstance>(); api.createProvider.mockReturnValue(pending.promise)
    const view = await render(); const form = await newStripe(view)
    await form.get('form').trigger('submit'); await flushPromises()
    const readsBefore = api.getProviders.mock.calls.length
    view.unmount(); views.splice(views.indexOf(view), 1)
    pending.resolve(provider(24)); await flushPromises()
    expect(api.getProviders).toHaveBeenCalledTimes(readsBefore)
    expect(api.updateSettings).not.toHaveBeenCalled()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })

  it('keeps a newly reopened provider dialog intact when an older save completes', async () => {
    const pending = deferred<ProviderInstance>(); api.createProvider.mockReturnValue(pending.promise)
    const view = await render(); const original = await newStripe(view)
    await original.get('form').trigger('submit'); await flushPromises()
    await button(original, 'common.cancel').trigger('click'); await flushPromises()
    const list = card(view, 'admin.settings.payment.providerManagement')
    await button(list, 'admin.settings.payment.createProvider').trigger('click'); await flushPromises()
    await dialog(view).get('input[type="text"]').setValue('New unsaved provider draft')
    pending.resolve(provider(24)); await flushPromises()
    expect(view.find('[role="dialog"][aria-label="admin.settings.payment.createProvider"]').exists()).toBe(true)
    expect((dialog(view).get('input[type="text"]').element as HTMLInputElement).value).toBe('New unsaved provider draft')
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('does not silently repeat an uncertain provider creation when the administrator declines another new command', async () => {
    const persisted: ProviderInstance[] = []
    api.createProvider.mockImplementation(async request => {
      const row = provider(30 + persisted.length, request); persisted.push(row)
      api.getProviders.mockResolvedValue({ data: [...persisted] })
      if (persisted.length === 1) throw new TypeError('Synthetic response lost after persistence')
      return row
    })
    const view = await render(); const form = await newStripe(view)
    await form.get('form').trigger('submit'); await flushPromises()
    expect(persisted).toHaveLength(1)
    expect(api.updateSettings).not.toHaveBeenCalled()
    vi.mocked(confirm).mockReturnValue(false)
    await form.get('form').trigger('submit'); await flushPromises()
    expect(persisted).toHaveLength(1)
    expect(api.createProvider).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(view.find('[role="dialog"][aria-label="admin.settings.payment.createProvider"]').exists()).toBe(true)
  })

  it('keeps unknown creation evidence across close/reopen and across an explicitly confirmed successful new create', async () => {
    api.createProvider.mockRejectedValueOnce(new TypeError('Synthetic lost original response')).mockResolvedValue(provider(31))
    const view = await render(); const form = await newStripe(view)
    await form.get('form').trigger('submit'); await flushPromises()
    expect(api.getProviders).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain('A provider creation result is unconfirmed.')
    vi.mocked(confirm).mockReturnValueOnce(true)
    await form.get('input[type="text"]').setValue('Explicitly separate new instance')
    await form.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(2)
    expect(api.createProvider.mock.calls[1][0].name).toBe('Explicitly separate new instance')
    expect(view.text()).toContain('A provider creation result is unconfirmed.')
    const next = await newStripe(view)
    vi.mocked(confirm).mockReturnValueOnce(false)
    await next.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('rechecks login ownership after a new-command confirmation following an unknown creation', async () => {
    api.createProvider.mockRejectedValueOnce(new TypeError('Synthetic lost original response'))
    const view = await render(); const form = await newStripe(view)
    await form.get('form').trigger('submit'); await flushPromises()
    vi.mocked(confirm).mockImplementationOnce(() => { replaceAuthSession({ accessToken: 'synthetic-confirm-new-admin-session', user: { id: 7 } }); return true })
    const reads = api.getProviders.mock.calls.length
    await form.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(1)
    expect(api.getProviders).toHaveBeenCalledTimes(reads)
  })

  it('cancels and confirms provider deletion through the real confirmation dialog', async () => {
    api.getProviders.mockResolvedValue({ data: [provider()] })
    const view = await render(); const list = await openPayment(view)
    await button(list, 'common.delete').trigger('click'); await flushPromises()
    let confirmDialog = view.get('[role="dialog"][aria-label="admin.settings.payment.deleteProvider"]')
    await button(confirmDialog, 'common.cancel').trigger('click'); await flushPromises()
    expect(api.deleteProvider).not.toHaveBeenCalled()
    await button(list, 'common.delete').trigger('click'); await flushPromises()
    confirmDialog = view.get('[role="dialog"][aria-label="admin.settings.payment.deleteProvider"]')
    api.deleteProvider.mockImplementation(async () => { api.getProviders.mockResolvedValue({ data: [] }) })
    await button(confirmDialog, 'common.delete').trigger('click'); await flushPromises()
    expect(api.deleteProvider).toHaveBeenCalledExactlyOnceWith(21)
    expect(card(view, 'admin.settings.payment.providerManagement').text()).not.toContain('Synthetic provider 21')
  })

  it('translates the real draggable public model/end events into ID-specific sort-order updates', async () => {
    const first = provider(21), second = provider(22)
    api.getProviders.mockResolvedValue({ data: [first, second] })
    api.updateProvider.mockResolvedValue(undefined)
    const view = await render(); await openPayment(view)
    const draggable = view.findComponent({ name: 'VueDraggable' })
    expect(draggable.exists()).toBe(true)
    // Sortable's public model and completion events are its layout-independent
    // integration contract. No SettingsView or list setup methods are accessed.
    draggable.vm.$emit('update:modelValue', [second, first]); await flushPromises()
    api.getProviders.mockResolvedValue({ data: [second, first] })
    draggable.vm.$emit('end'); await flushPromises()
    expect(api.updateProvider.mock.calls).toEqual([[22, { sort_order: 0 }], [21, { sort_order: 1 }]])
    const list = card(view, 'admin.settings.payment.providerManagement').text()
    expect(list.indexOf('Synthetic provider 22')).toBeLessThan(list.indexOf('Synthetic provider 21'))
  })

  it('keeps provider B confirmation open when a cancelled provider A delete finishes', async () => {
    api.getProviders.mockResolvedValue({ data: [provider(21), provider(22)] })
    const pending = deferred<void>(); api.deleteProvider.mockReturnValue(pending.promise)
    const view = await render(); const list = await openPayment(view)
    await list.findAll('button').filter(node => node.text() === 'common.delete')[0].trigger('click'); await flushPromises()
    let confirmDialog = view.get('[role="dialog"][aria-label="admin.settings.payment.deleteProvider"]')
    await button(confirmDialog, 'common.delete').trigger('click'); await flushPromises()
    await button(confirmDialog, 'common.cancel').trigger('click'); await flushPromises()
    await list.findAll('button').filter(node => node.text() === 'common.delete')[1].trigger('click'); await flushPromises()
    const reads = api.getProviders.mock.calls.length
    pending.resolve(); await flushPromises()
    expect(view.find('[role="dialog"][aria-label="admin.settings.payment.deleteProvider"]').exists()).toBe(true)
    expect(api.getProviders).toHaveBeenCalledTimes(reads)
    expect(api.success).not.toHaveBeenCalled()
    api.deleteProvider.mockResolvedValue(undefined)
    confirmDialog = view.get('[role="dialog"][aria-label="admin.settings.payment.deleteProvider"]')
    await button(confirmDialog, 'common.delete').trigger('click'); await flushPromises()
    expect(api.deleteProvider.mock.calls).toEqual([[21], [22]])
  })

  it('retains an older pending command that becomes unknown after a newer create has already succeeded', async () => {
    const old = deferred<ProviderInstance>()
    api.createProvider.mockReturnValueOnce(old.promise).mockResolvedValueOnce(provider(32))
    const view = await render(); const first = await newStripe(view)
    await first.get('form').trigger('submit'); await flushPromises()
    await button(first, 'common.cancel').trigger('click'); await flushPromises()
    const second = await newStripe(view)
    vi.mocked(confirm).mockReturnValueOnce(true)
    await second.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(2)
    api.success.mockClear(); api.error.mockClear()
    const reads = api.getProviders.mock.calls.length
    old.reject(new TypeError('Synthetic late unknown original command')); await flushPromises()
    expect(view.text()).toContain('A provider creation result is unconfirmed.')
    expect(api.getProviders).toHaveBeenCalledTimes(reads)
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
    const third = await newStripe(view)
    vi.mocked(confirm).mockReturnValueOnce(false)
    await third.get('form').trigger('submit'); await flushPromises()
    expect(api.createProvider).toHaveBeenCalledTimes(2)
  })
})

describe('native Web Search usage and diagnostics ownership', () => {
  async function searchCard() {
    api.getWebSearchEmulationConfig.mockResolvedValue({ enabled: true, providers: [{
      type: 'brave', api_key: 'synthetic-search-key', api_key_configured: true, quota_limit: 100, quota_used: 92,
      subscribed_at: null, expires_at: null, proxy_id: null,
    }] })
    const view = await render(); await openTab(view, 'gateway')
    const search = card(view, 'admin.settings.webSearchEmulation.title')
    await search.get('.cursor-pointer').trigger('click')
    return { view, search }
  }
  function diagnostics(view: VueWrapper) {
    return new DOMWrapper(view.get('input[aria-label="Search test query"]').element.closest('.fixed')!)
  }

  it('confirms usage reset, keeps cancellation read-only and resets the selected backend provider type', async () => {
    const { search } = await searchCard()
    vi.mocked(confirm).mockReturnValueOnce(false)
    await button(search, 'admin.settings.webSearchEmulation.resetUsage').trigger('click'); await flushPromises()
    expect(api.resetWebSearchUsage).not.toHaveBeenCalled()
    api.resetWebSearchUsage.mockResolvedValue(undefined)
    await button(search, 'admin.settings.webSearchEmulation.resetUsage').trigger('click'); await flushPromises()
    expect(api.resetWebSearchUsage).toHaveBeenCalledExactlyOnceWith({ provider_type: 'brave' })
    expect(search.text().replace(/\s+/g, '')).toContain('0/100')
    expect(api.success).toHaveBeenCalledWith('admin.settings.webSearchEmulation.resetUsageSuccess')
  })

  it('does not reset the usage display of a provider changed while the original reset is pending', async () => {
    const reset = deferred<void>(); api.resetWebSearchUsage.mockReturnValue(reset.promise)
    const { search } = await searchCard()
    await button(search, 'admin.settings.webSearchEmulation.resetUsage').trigger('click'); await flushPromises()
    await search.get('select').setValue('tavily')
    reset.resolve(); await flushPromises()
    expect(api.resetWebSearchUsage).toHaveBeenCalledExactlyOnceWith({ provider_type: 'brave' })
    expect(search.text().replace(/\s+/g, '')).toContain('92/100')
    expect(api.success).not.toHaveBeenCalled()
  })

  it('keeps a new diagnostics result when an earlier dialog query arrives after close/reopen', async () => {
    const old = deferred<{ provider: string; results: { title: string; url: string; description: string }[] }>()
    api.testWebSearchEmulation.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ provider: 'brave', results: [{ title: 'Current query result', url: 'https://synthetic.invalid/current', description: 'Current synthetic result' }] })
    const { view, search } = await searchCard()
    await button(search, 'admin.settings.webSearchEmulation.test').trigger('click')
    await diagnostics(view).get('input').setValue('old query')
    await diagnostics(view).get('input').trigger('keyup.enter'); await flushPromises()
    await button(diagnostics(view), 'common.close').trigger('click')
    await button(search, 'admin.settings.webSearchEmulation.test').trigger('click')
    await diagnostics(view).get('input').setValue('new query')
    await diagnostics(view).get('input').trigger('keyup.enter'); await flushPromises()
    expect(diagnostics(view).text()).toContain('Current query result')
    old.resolve({ provider: 'brave', results: [{ title: 'Obsolete query result', url: 'https://synthetic.invalid/old', description: 'Old synthetic result' }] }); await flushPromises()
    expect(api.testWebSearchEmulation.mock.calls.map(call => call[0])).toEqual(['old query', 'new query'])
    expect(diagnostics(view).text()).toContain('Current query result')
    expect(diagnostics(view).text()).not.toContain('Obsolete query result')
  })

  it('drops obsolete diagnostics errors after the settings page unmounts', async () => {
    const pending = deferred<unknown>(); api.testWebSearchEmulation.mockReturnValue(pending.promise)
    const { view, search } = await searchCard()
    await button(search, 'admin.settings.webSearchEmulation.test').trigger('click')
    await diagnostics(view).get('input').setValue('pending query')
    await diagnostics(view).get('input').trigger('keyup.enter'); await flushPromises()
    view.unmount(); views.splice(views.indexOf(view), 1)
    pending.reject(new Error('Synthetic obsolete diagnostics error')); await flushPromises()
    expect(api.error).not.toHaveBeenCalled(); expect(api.success).not.toHaveBeenCalled()
  })
})

describe('native affiliate administrator workflows', () => {
  const member = (id: number) => ({ user_id: id, email: `synthetic-${id}@example.invalid`, username: `Member ${id}`, aff_code: `SYNTHETIC${id}`, aff_code_custom: true, aff_rebate_rate_percent: 7.5, aff_count: 1 })
  async function affiliateView() {
    api.getSettings.mockResolvedValue({ ...baseSettings(), affiliate_enabled: true })
    api.listAffiliateUsers.mockResolvedValue({ items: [member(41), member(42)], total: 2 })
    const view = await render(); await openTab(view, 'features')
    return view
  }
  function affiliateModal(view: VueWrapper) {
    return new DOMWrapper(view.get('#settings-affiliate-modal-code').element.closest('.fixed')!)
  }
  async function editMember(view: VueWrapper, id: number) {
    const row = view.findAll('tbody tr').find(node => node.text().includes(`synthetic-${id}@example.invalid`))!
    expect(row).toBeDefined(); await button(row, 'common.edit').trigger('click'); await flushPromises()
    return affiliateModal(view)
  }

  it('normalizes a synthetic custom code and explicit zero rebate, retains rejected edits and retries the original user', async () => {
    const view = await affiliateView(); const modal = await editMember(view, 41)
    await modal.get('#settings-affiliate-modal-code').setValue(' synthetic-new-code ')
    await modal.get('#settings-affiliate-modal-rate').setValue('0')
    api.updateAffiliateUser.mockRejectedValueOnce({ status: 400, message: 'Synthetic invalid code' }).mockResolvedValueOnce(undefined)
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(affiliateModal(view).exists()).toBe(true)
    expect(api.error).toHaveBeenCalledTimes(1)
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.updateAffiliateUser.mock.calls).toEqual([[41, { aff_code: 'SYNTHETIC-NEW-CODE', aff_rebate_rate_percent: 0 }], [41, { aff_code: 'SYNTHETIC-NEW-CODE', aff_rebate_rate_percent: 0 }]])
    expect(view.find('#settings-affiliate-modal-code').exists()).toBe(false)
  })

  it('rejects an out-of-range exclusive rate and submits an explicit clear when the administrator empties it', async () => {
    const view = await affiliateView(); const modal = await editMember(view, 41)
    await modal.get('#settings-affiliate-modal-rate').setValue('101')
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.updateAffiliateUser).not.toHaveBeenCalled()
    expect(api.error).toHaveBeenCalledWith('admin.settings.features.affiliate.modal.errorBadRate')
    await modal.get('#settings-affiliate-modal-code').setValue('')
    await modal.get('#settings-affiliate-modal-rate').setValue('')
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.updateAffiliateUser).toHaveBeenCalledExactlyOnceWith(41, { clear_rebate_rate: true })
  })

  it('selects actual table rows and clears only those users through the bulk rate contract', async () => {
    const view = await affiliateView()
    await view.get('input[aria-label="common.selectAll"]').setValue(true)
    await button(view, 'admin.settings.features.affiliate.customUsers.batchButton').trigger('click')
    const rate = view.get('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]')
    const modal = new DOMWrapper(rate.element.closest('.fixed')!)
    await rate.setValue('')
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.batchAffiliateRate).toHaveBeenCalledExactlyOnceWith({ user_ids: [41, 42], clear: true })
    expect(view.find('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]').exists()).toBe(false)
  })

  it('does not replace current user-search results with an older debounced lookup', async () => {
    const view = await affiliateView()
    await button(view, '+ admin.settings.features.affiliate.customUsers.addButton').trigger('click')
    const old = deferred<unknown[]>()
    api.lookupAffiliateUsers.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ id: 52, email: 'new-query@example.invalid', username: 'New query' }])
    vi.useFakeTimers()
    await view.get('#settings-affiliate-modal-user-query').setValue('old query'); await vi.advanceTimersByTimeAsync(300)
    await view.get('#settings-affiliate-modal-user-query').setValue('new query'); await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(affiliateModal(view).text()).toContain('new-query@example.invalid')
    old.resolve([{ id: 51, email: 'obsolete-query@example.invalid', username: 'Old query' }]); await flushPromises()
    expect(affiliateModal(view).text()).toContain('new-query@example.invalid')
    expect(affiliateModal(view).text()).not.toContain('obsolete-query@example.invalid')
    expect(api.lookupAffiliateUsers.mock.calls).toEqual([['old query'], ['new query']])
  })

  it('keeps a newly opened user B draft when the captured update for user A finishes', async () => {
    const view = await affiliateView(); const first = await editMember(view, 41)
    const pending = deferred<void>(); api.updateAffiliateUser.mockReturnValue(pending.promise)
    await first.get('#settings-affiliate-modal-rate').setValue('11')
    await button(first, 'common.save').trigger('click'); await flushPromises()
    await button(first, 'common.cancel').trigger('click'); await flushPromises()
    const current = await editMember(view, 42)
    await current.get('#settings-affiliate-modal-code').setValue('CURRENT-B-DRAFT')
    const loads = api.listAffiliateUsers.mock.calls.length
    pending.resolve(); await flushPromises()
    expect(api.updateAffiliateUser).toHaveBeenCalledExactlyOnceWith(41, { aff_code: 'SYNTHETIC41', aff_rebate_rate_percent: 11 })
    expect(view.find('#settings-affiliate-modal-code').exists()).toBe(true)
    expect((view.get('#settings-affiliate-modal-code').element as HTMLInputElement).value).toBe('CURRENT-B-DRAFT')
    expect(api.listAffiliateUsers).toHaveBeenCalledTimes(loads)
    expect(api.success).not.toHaveBeenCalled()
  })

  it('does not submit an old-page affiliate edit after the same administrator has logged in again', async () => {
    const view = await affiliateView(); const modal = await editMember(view, 41)
    await modal.get('#settings-affiliate-modal-rate').setValue('9')
    replaceAuthSession({ accessToken: 'synthetic-next-affiliate-admin-session', user: { id: 7 } })
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.updateAffiliateUser).not.toHaveBeenCalled()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })

  it('keeps a new bulk target/draft when a cancelled earlier bulk update finishes', async () => {
    const view = await affiliateView()
    await view.get('input[aria-label="common.selectAll"]').setValue(true)
    await button(view, 'admin.settings.features.affiliate.customUsers.batchButton').trigger('click')
    let rate = view.get('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]')
    let modal = new DOMWrapper(rate.element.closest('.fixed')!)
    await rate.setValue('10')
    const pending = deferred<void>(); api.batchAffiliateRate.mockReturnValue(pending.promise)
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    await button(modal, 'common.cancel').trigger('click')
    await view.get('input[aria-label="common.selectAll"]').setValue(false)
    const secondRow = view.findAll('tbody tr').find(row => row.text().includes('synthetic-42@example.invalid'))!
    await secondRow.get('input[type="checkbox"]').setValue(true)
    await button(view, 'admin.settings.features.affiliate.customUsers.batchButton').trigger('click')
    rate = view.get('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]')
    modal = new DOMWrapper(rate.element.closest('.fixed')!)
    await rate.setValue('20')
    pending.resolve(); await flushPromises()
    expect(api.batchAffiliateRate).toHaveBeenCalledExactlyOnceWith({ user_ids: [41, 42], aff_rebate_rate_percent: 10 })
    expect(view.find('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]').exists()).toBe(true)
    expect((view.get('input[aria-label="admin.settings.features.affiliate.modal.rateLabel"]').element as HTMLInputElement).value).toBe('20')
    api.batchAffiliateRate.mockResolvedValue(undefined)
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.batchAffiliateRate).toHaveBeenLastCalledWith({ user_ids: [42], aff_rebate_rate_percent: 20 })
  })

  it('retains an edited affiliate draft while the earlier captured values save and unlocks one explicit retry', async () => {
    const view = await affiliateView(); const modal = await editMember(view, 41)
    const pending = deferred<void>(); api.updateAffiliateUser.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined)
    await modal.get('#settings-affiliate-modal-rate').setValue('10')
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    await modal.get('#settings-affiliate-modal-rate').setValue('20')
    pending.resolve(); await flushPromises()
    expect(api.updateAffiliateUser).toHaveBeenCalledExactlyOnceWith(41, { aff_code: 'SYNTHETIC41', aff_rebate_rate_percent: 10 })
    expect((view.get('#settings-affiliate-modal-rate').element as HTMLInputElement).value).toBe('20')
    expect(api.success).not.toHaveBeenCalled()
    expect((button(modal, 'common.save').element as HTMLButtonElement).disabled).toBe(false)
    await button(modal, 'common.save').trigger('click'); await flushPromises()
    expect(api.updateAffiliateUser).toHaveBeenLastCalledWith(41, { aff_code: 'SYNTHETIC41', aff_rebate_rate_percent: 20 })
  })

  it('keeps the current affiliate filter results when the unfiltered initial list arrives last', async () => {
    api.getSettings.mockResolvedValue({ ...baseSettings(), affiliate_enabled: true })
    const old = deferred<{ items: ReturnType<typeof member>[]; total: number }>()
    api.listAffiliateUsers.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [member(52)], total: 1 })
    const view = await render(); await openTab(view, 'features')
    vi.useFakeTimers()
    await view.get('input[aria-label="admin.settings.features.affiliate.customUsers.searchPlaceholder"]').setValue('synthetic-52')
    await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(view.text()).toContain('synthetic-52@example.invalid')
    old.resolve({ items: [member(41)], total: 1 }); await flushPromises()
    expect(view.text()).toContain('synthetic-52@example.invalid')
    expect(view.text()).not.toContain('synthetic-41@example.invalid')
    expect(api.listAffiliateUsers.mock.calls.map(call => call[0])).toEqual([
      { page: 1, page_size: 20, search: '' }, { page: 1, page_size: 20, search: 'synthetic-52' },
    ])
  })
})
