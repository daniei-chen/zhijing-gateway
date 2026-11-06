import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import SettingsView from '@/views/admin/SettingsView.vue'
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
function card(view: VueWrapper, title: string) {
  const found = view.findAll('.card').find(node => node.findAll('h2,h3').some(heading => heading.text() === title))
  expect(found, `card ${title}`).toBeDefined(); return found!
}
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

// Fixture plumbing above is shared with 058. All assertions below are new,
// and payment methods execute the actual module and actual Axios interceptor.
import { AxiosError } from 'axios'
import { apiClient } from '@/api/client'
import realPayment from '@/api/admin/payment'
const wire = { requests: [] as { method: string; url: string; body: any }[], providers: [] as ProviderInstance[], put: undefined as undefined | ((config: any) => Promise<unknown>) }
let previousAdapter: typeof apiClient.defaults.adapter
beforeEach(() => {
  wire.requests = []; wire.providers = [provider(21), provider(22)]; wire.put = undefined
  api.getProviders.mockImplementation(() => realPayment.getProviders())
  api.updateProvider.mockImplementation((id: number, body: Partial<ProviderInstance>) => realPayment.updateProvider(id, body))
  previousAdapter = apiClient.defaults.adapter
  apiClient.defaults.adapter = async config => {
    const method = String(config.method).toUpperCase(); const url = String(config.url)
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    wire.requests.push({ method, url, body })
    let data: unknown
    if (method === 'GET' && url === '/admin/payment/providers') data = wire.providers
    else if (method === 'PUT' && /^\/admin\/payment\/providers\/\d+$/.test(url)) data = wire.put ? await wire.put(config) : { ...wire.providers[0], ...body }
    else throw new Error('Unexpected synthetic payment wire path: ' + method + ' ' + url)
    return { data: { code: 0, message: 'OK', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => { apiClient.defaults.adapter = previousAdapter })
async function payment(view: VueWrapper) { await openTab(view, 'payment'); await vi.waitFor(() => expect(view.text()).toContain('Synthetic provider 21')); return card(view, 'admin.settings.payment.providerManagement') }
function field(list: DOMWrapper<Element>, label: string) { const parent = list.findAll('label').find(item => item.text() === label); expect(parent, label).toBeDefined(); return parent!.get<HTMLButtonElement>('button[role="switch"]') }
function typeButton(list: DOMWrapper<Element>) { return list.findAll<HTMLButtonElement>('button').find(node => node.text() === 'payment.methods.card')! }
const puts = () => wire.requests.filter(item => item.method === 'PUT')

describe('independent real payment wire ownership', () => {
  it.each([21, 22])('keeps the entire sort batch locked after provider %i fails while its peer remains pending', async failedID => {
    const pending = deferred<unknown>()
    wire.put = config => config.url.endsWith(`/${failedID}`)
      ? Promise.reject(new AxiosError('Synthetic failed sort', 'ERR_NETWORK', config))
      : pending.promise
    const view = await render(); const list = await payment(view)
    const draggable = view.findComponent({ name: 'VueDraggable' })
    draggable.vm.$emit('update:modelValue', [provider(22), provider(21)])
    await flushPromises(); draggable.vm.$emit('end'); await flushPromises()
    expect(puts()).toHaveLength(2)
    const action = field(list, 'common.enabled').element
    action.click(); await flushPromises()
    expect(puts()).toHaveLength(2)
    expect(action.matches(':disabled')).toBe(true)
    expect(api.error).not.toHaveBeenCalled()
    pending.resolve(provider(failedID === 21 ? 22 : 21)); await flushPromises()
    expect(api.error).toHaveBeenCalledTimes(1)
    wire.put = undefined
    const unlocked = field(card(view, 'admin.settings.payment.providerManagement'), 'common.enabled').element
    expect(unlocked.matches(':disabled')).toBe(false)
    unlocked.click(); await flushPromises()
    expect(puts()).toHaveLength(3)
    expect(puts()[2]).toEqual({ method: 'PUT', url: '/admin/payment/providers/21', body: { enabled: false } })
  })
  it('keeps a disabled payment type unavailable to native keyboard/button activation', async () => {
    api.getSettings.mockResolvedValue({ ...baseSettings(), payment_enabled_types: ['alipay'] })
    const view = await render(); const list = await payment(view); const action = field(list, 'common.enabled').element
    action.focus(); action.click(); await flushPromises()
    expect(puts()).toHaveLength(0)
    expect(action.matches(':disabled')).toBe(true)
  })
  it('keeps the existing refund cascade payload on a current native switch', async () => {
    const view = await render(); const list = await payment(view)
    field(list, 'admin.settings.payment.refundEnabled').element.click(); await flushPromises()
    expect(puts()).toEqual([{ method: 'PUT', url: '/admin/payment/providers/21', body: { refund_enabled: false, allow_user_refund: false } }])
  })
  it.each(['field', 'type'] as const)('does not dispatch an old view %s command under a replacement login', async kind => {
    const view = await render(); const list = await payment(view)
    replaceAuthSession({ accessToken: 'synthetic-other-settings-login', user: { id: 7 } })
    if (kind === 'field') field(list, 'common.enabled').element.click()
    else { expect(typeButton(list)).toBeDefined(); typeButton(list).element.click() }
    await flushPromises(); expect(puts()).toHaveLength(0); expect(api.error).not.toHaveBeenCalled()
  })
  it.each(['field', 'type'] as const)('does not notify another page when a pending %s request rejects after disposal', async kind => {
    const pending = deferred<unknown>(); wire.put = config => pending.promise.catch(() => { throw new AxiosError('Synthetic old request failure', 'ERR_NETWORK', config) })
    const view = await render(); const list = await payment(view)
    if (kind === 'field') field(list, 'common.enabled').element.click(); else typeButton(list).element.click()
    await vi.waitFor(() => expect(puts()).toHaveLength(1)); view.unmount(); pending.reject(new Error('Synthetic unavailable')); await flushPromises()
    expect(api.error).not.toHaveBeenCalled(); expect(api.success).not.toHaveBeenCalled()
  })
  it.each(['field', 'type'] as const)('dispatches at most one %s mutation while its existing command is pending', async kind => {
    const pending = deferred<unknown>(); wire.put = () => pending.promise
    const view = await render(); const list = await payment(view)
    const action = kind === 'field' ? field(list, 'common.enabled').element : typeButton(list).element
    action.click(); action.click(); await vi.waitFor(() => expect(puts().length).toBeGreaterThan(0))
    expect(puts()).toHaveLength(1); pending.resolve({ ...provider(), enabled: false }); await flushPromises()
  })
  it('does not submit an old Sortable completion after the login is replaced', async () => {
    const view = await render(); await payment(view); const draggable = view.findComponent({ name: 'VueDraggable' })
    draggable.vm.$emit('update:modelValue', [provider(22), provider(21)]); await flushPromises()
    replaceAuthSession({ accessToken: 'synthetic-replaced-sort-login', user: { id: 7 } }); draggable.vm.$emit('end'); await flushPromises()
    expect(puts()).toHaveLength(0)
  })
  it('does not notify after a disposed Sortable command fails', async () => {
    const pending = deferred<unknown>(); wire.put = config => pending.promise.catch(() => { throw new AxiosError('Synthetic old sort failure', 'ERR_NETWORK', config) })
    const view = await render(); await payment(view); const draggable = view.findComponent({ name: 'VueDraggable' })
    draggable.vm.$emit('update:modelValue', [provider(22), provider(21)]); await flushPromises(); draggable.vm.$emit('end')
    await vi.waitFor(() => expect(puts()).toHaveLength(2)); view.unmount(); pending.reject(new Error('Synthetic failed order')); await flushPromises()
    expect(api.error).not.toHaveBeenCalled()
  })
})
