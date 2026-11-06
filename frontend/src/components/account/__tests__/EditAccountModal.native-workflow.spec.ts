import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import EditAccountModal from '../EditAccountModal.vue'
import QuotaLimitCard from '../QuotaLimitCard.vue'
import QuotaDimensionRow from '../QuotaDimensionRow.vue'
import QuotaNotifyToggle from '../QuotaNotifyToggle.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({ update: vi.fn(), risk: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), settings: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { update: api.update, checkMixedChannelRisk: api.risk }, settings: { getSettings: api.settings, getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: true, providers: [] }) }, tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([]) },
} }))
vi.mock('@/api/admin/accounts', async () => ({ ...await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts'), getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: api.error, showSuccess: api.success, showWarning: api.warning, showInfo: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
const Select = defineComponent({ inheritAttrs: false, props: ['modelValue', 'options', 'disabled'], emits: ['update:modelValue', 'change'], setup(props, { attrs, emit }) { return () => h('select', { ...attrs, disabled: props.disabled, value: String(props.modelValue ?? ''), onChange: (event: Event) => { const raw = (event.target as HTMLSelectElement).value; const value = props.options.find((option: { value: unknown }) => String(option.value ?? '') === raw)?.value ?? raw; emit('update:modelValue', value); emit('change', value) } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value ?? '') }, option.label))) } })
const Models = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('textarea', { 'aria-label': 'Synthetic model whitelist', value: props.modelValue.join('\n'), onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value.split('\n')) }) } })
const wrappers: VueWrapper[] = []
function account(patch: Record<string, unknown> = {}) { return { id: 17, name: 'Synthetic edited account', platform: 'openai', type: 'apikey', credentials: { base_url: 'https://synthetic.example.test/v1', synthetic_vendor_flag: 'preserved' }, credentials_status: { has_api_key: true }, extra: { synthetic_metadata: 'preserved' }, notes: '', status: 'active', concurrency: 2, priority: 1, rate_multiplier: 1, load_factor: null, proxy_id: null, group_ids: [], expires_at: null, auto_pause_on_expired: true, ...patch } as any }
async function render(value = account()) { const wrapper = mount(EditAccountModal, { attachTo: document.body, props: { show: true, account: value, groups: [], proxies: [] }, global: { mocks: { $t: (key: string) => key }, stubs: { teleport: true, Icon: true, PlatformIcon: true, ProxyAdBanner: true, GroupSelector: true, ProxySelector: true, Select, ModelWhitelistSelector: Models } } }); wrappers.push(wrapper); await flushPromises(); return wrapper }
function field(wrapper: VueWrapper, name: string, index = 0) { const label = wrapper.findAll('label').filter(item => item.text() === name && item.attributes('for'))[index]; expect(label, `label ${name}`).toBeDefined(); const control = document.getElementById(label!.attributes('for')); expect(control).not.toBeNull(); return new DOMWrapper(control!) }
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) { const all = root.findAll('button'); const found = all.find(item => item.text() === text) ?? all.find(item => item.text().includes(text)); expect(found, `visible button ${text}`).toBeDefined(); return found! }
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
beforeEach(() => { Object.values(api).forEach(mock => mock.mockReset()); localStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-native-edit-admin', user: { id: 7 } }); api.update.mockImplementation(async (id, payload) => account({ ...payload, id })); api.risk.mockResolvedValue({ has_risk: false }); api.settings.mockResolvedValue({}); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('EditAccountModal extended normal native workflows', () => {
  it.each(['kimi', 'zhipu', 'deepseek', 'minimax', 'command_code', 'cline'])('preserves %s redacted secrets and custom adaptive endpoints when only the name changes', async platform => {
    const urls = platform === 'cline' ? { chat_completions: 'https://custom.example.test/chat' } : { chat_completions: 'https://custom.example.test/chat', anthropic: 'https://custom.example.test/claude', ...(platform === 'zhipu' ? {} : { responses: 'https://custom.example.test/responses' }) }
    const credentials = { account_mode: 'payg', api_protocol: 'adaptive', base_url: urls.chat_completions, api_base_urls: urls, synthetic_vendor_flag: 'preserved' }
    const wrapper = await render(account({ platform, credentials })); await field(wrapper, 'common.name').setValue('Renamed synthetic account'); await submit(wrapper)
    expect(api.update).toHaveBeenCalledOnce(); expect(api.update.mock.calls[0]![1]).toMatchObject({ name: 'Renamed synthetic account', credentials: { api_protocol: 'adaptive', account_mode: 'payg', api_base_urls: urls, synthetic_vendor_flag: 'preserved' } })
    expect(api.update.mock.calls[0]![1].credentials).not.toHaveProperty('api_key')
  })
  it.each(['kimi', 'zhipu', 'deepseek', 'minimax'])('moves a saved %s adaptive account to an explicitly edited native endpoint', async platform => {
    const credentials = { account_mode: 'payg', api_protocol: 'adaptive', base_url: 'https://old.example.test/v1', api_base_urls: { chat_completions: 'https://old.example.test/v1', anthropic: 'https://old.example.test/anthropic', responses: 'https://old.example.test/responses' } }
    const wrapper = await render(account({ platform, credentials })); await button(wrapper, 'admin.accounts.cnProviders.apiProtocol.anthropic').trigger('click'); await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://new.example.test/anthropic '); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].credentials).toMatchObject({ api_protocol: 'anthropic', base_url: 'https://new.example.test/anthropic' })
    expect(api.update.mock.calls[0]![1].credentials).not.toHaveProperty('api_base_urls')
  })
  it('clears optional Zhipu team identifiers while keeping the stored credential', async () => {
    const wrapper = await render(account({ platform: 'zhipu', credentials: { account_mode: 'coding', api_protocol: 'chat_completions', base_url: 'https://open.bigmodel.cn/api/coding/paas/v4', zhipu_organization: 'old-org', zhipu_project: 'old-project' } }))
    await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.organization').setValue(''); await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.project').setValue(''); await submit(wrapper)
    const credentials = api.update.mock.calls[0]![1].credentials; expect(credentials).not.toHaveProperty('zhipu_organization'); expect(credentials).not.toHaveProperty('zhipu_project'); expect(credentials).not.toHaveProperty('api_key')
  })
  it('retains a project only while its Zhipu organization remains configured', async () => {
    const wrapper = await render(account({ platform: 'zhipu', credentials: { account_mode: 'coding', api_protocol: 'chat_completions', base_url: 'https://open.bigmodel.cn/api/coding/paas/v4', zhipu_organization: 'old-org', zhipu_project: 'old-project' } }))
    await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.organization').setValue('new-org'); await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.project').setValue('new-project'); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].credentials).toMatchObject({ zhipu_organization: 'new-org', zhipu_project: 'new-project' })
  })
  it('writes scheduling, status, note and local datetime without changing redacted credentials', async () => {
    const wrapper = await render(); await field(wrapper, 'admin.accounts.notes').setValue('Synthetic edited note'); await field(wrapper, 'admin.accounts.concurrency').setValue('5'); await field(wrapper, 'admin.accounts.loadFactor').setValue('9'); await field(wrapper, 'admin.accounts.priority').setValue('13'); await field(wrapper, 'admin.accounts.billingRateMultiplier').setValue('0')
    await field(wrapper, 'admin.accounts.expiresAt').setValue('2027-04-05T06:07'); await field(wrapper, 'common.status').setValue('inactive'); await wrapper.get('button[aria-label="admin.accounts.autoPauseOnExpired"]').trigger('click'); await submit(wrapper)
    expect(api.update.mock.calls[0]![1]).toMatchObject({ notes: 'Synthetic edited note', concurrency: 5, load_factor: 9, priority: 13, rate_multiplier: 0, status: 'inactive', expires_at: Math.floor(new Date('2027-04-05T06:07').getTime()/1000), auto_pause_on_expired: false })
    expect(api.update.mock.calls[0]![1].credentials).not.toHaveProperty('api_key')
  })
  it('clears an account expiry and explicit load factor using backend zero sentinel semantics', async () => {
    const wrapper = await render(account({ expires_at: 1800000000, load_factor: 6 })); await field(wrapper, 'admin.accounts.expiresAt').setValue(''); await field(wrapper, 'admin.accounts.loadFactor').setValue(''); await submit(wrapper)
    expect(api.update.mock.calls[0]![1]).toMatchObject({ expires_at: 0, load_factor: 0 })
  })
  it.each(['force_responses', 'force_chat_completions'] as const)('saves explicit %s with compact mode while retaining unrelated extra metadata', async mode => {
    const wrapper = await render(); await field(wrapper, 'admin.accounts.openai.responsesMode').setValue(mode); await field(wrapper, 'admin.accounts.openai.compactMode').setValue('force_on'); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].extra).toMatchObject({ synthetic_metadata: 'preserved', openai_responses_mode: mode, openai_compact_mode: 'force_on' })
  })
  it('removes explicit Responses mode when the administrator disables text capability', async () => {
    const wrapper = await render(account({ credentials: { base_url: 'https://synthetic.example.test', openai_capabilities: ['chat_completions', 'embeddings'] }, extra: { openai_responses_mode: 'force_responses', synthetic_metadata: 'preserved' } }))
    await wrapper.get('[data-testid="openai-endpoint-capability-chat_completions"]').setValue(false); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].credentials.openai_capabilities).toEqual(['embeddings']); expect(api.update.mock.calls[0]![1].extra).not.toHaveProperty('openai_responses_mode')
  })
  it('switches Anthropic API-key header authentication while retaining unrelated metadata', async () => {
    const wrapper = await render(account({ platform: 'anthropic', extra: { synthetic_metadata: 'preserved' } })); await field(wrapper, 'admin.accounts.anthropic.apiKeyAuthScheme').setValue('authorization_bearer'); await wrapper.get('button[aria-label="admin.accounts.anthropic.apiKeyPassthrough"]').trigger('click'); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].extra).toMatchObject({ anthropic_apikey_auth_scheme: 'authorization_bearer', anthropic_passthrough: true, synthetic_metadata: 'preserved' })
  })
  it('removes disabled cooling rules and preserves independent credential fields', async () => {
    const wrapper = await render(account({ credentials: { base_url: 'https://synthetic.example.test', synthetic_vendor_flag: 'preserved', temp_unschedulable_enabled: true, temp_unschedulable_rules: [{ error_code: 503, duration_minutes: 3, keywords: ['synthetic'], scope: 'model', description: 'Synthetic model cooling' }] } }))
    await wrapper.get('button[aria-label="admin.accounts.tempUnschedulable.title"]').trigger('click'); await submit(wrapper)
    const credentials = api.update.mock.calls[0]![1].credentials; expect(credentials).toHaveProperty('synthetic_vendor_flag', 'preserved'); expect(credentials).not.toHaveProperty('temp_unschedulable_enabled'); expect(credentials).not.toHaveProperty('temp_unschedulable_rules')
  })
  it('preserves the exact edited CN credentials through the actual JSON update request', async () => {
    const { apiClient } = await import('@/api/client'); const actual = await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts'); const original = apiClient.defaults.adapter; const wire: unknown[] = []
    apiClient.defaults.adapter = async request => { const body = JSON.parse(request.data); wire.push({ method: request.method, url: request.url, body }); return { status: 200, statusText: 'OK', headers: {}, config: request, data: { code: 0, data: account({ ...body, id: 17 }) } } }; api.update.mockImplementation(actual.update)
    try { const wrapper = await render(account({ platform: 'deepseek', credentials: { account_mode: 'payg', api_protocol: 'adaptive', base_url: 'https://api.deepseek.com', api_base_urls: { chat_completions: 'https://api.deepseek.com', anthropic: 'https://api.deepseek.com/anthropic', responses: 'https://api.deepseek.com' } } })); await button(wrapper, 'admin.accounts.cnProviders.apiProtocol.responses').trigger('click'); await field(wrapper, 'admin.accounts.baseUrl').setValue('https://synthetic.example.test/responses'); await submit(wrapper); expect(wire).toEqual([expect.objectContaining({ method: 'put', url: '/admin/accounts/17', body: expect.objectContaining({ credentials: expect.objectContaining({ api_protocol: 'responses', base_url: 'https://synthetic.example.test/responses' }) }) })]) } finally { apiClient.defaults.adapter = original }
  })
  it.each(['openai', 'anthropic', 'gemini', 'kimi'])('updates the real %s quota card with fixed reset schedule and retains unrelated metadata', async platform => {
    const wrapper = await render(account({ platform, extra: { synthetic_metadata: 'preserved', quota_limit: 200, quota_daily_limit: 10, quota_weekly_limit: 50 } })); const quota = wrapper.findComponent(QuotaLimitCard)
    const row = (dim: string) => quota.findAllComponents(QuotaDimensionRow).find(component => component.props('dim') === dim)!
    await row('daily').get('input[type="number"]').setValue('25'); await row('weekly').get('input[type="number"]').setValue('90'); await row('total').get('input[type="number"]').setValue('300')
    await row('daily').get('select').setValue('fixed'); await row('daily').findAll('select')[1]!.setValue('8'); await row('daily').findAll('select')[2]!.setValue('Asia/Tokyo')
    await row('weekly').get('select').setValue('fixed'); await row('weekly').findAll('select')[1]!.setValue('0'); await row('weekly').findAll('select')[2]!.setValue('3'); await submit(wrapper)
    expect(api.update.mock.calls[0]![1].extra).toMatchObject({ synthetic_metadata: 'preserved', quota_limit: 300, quota_daily_limit: 25, quota_weekly_limit: 90, quota_daily_reset_mode: 'fixed', quota_daily_reset_hour: 8, quota_weekly_reset_mode: 'fixed', quota_weekly_reset_day: 0, quota_weekly_reset_hour: 3, quota_reset_timezone: 'Asia/Tokyo' })
  })
  it.each(['openai', 'anthropic'])('clears disabled %s quota limits and reset fields without erasing unrelated metadata', async platform => {
    const wrapper = await render(account({ platform, extra: { synthetic_metadata: 'preserved', quota_limit: 200, quota_daily_limit: 10, quota_weekly_limit: 50, quota_daily_reset_mode: 'fixed', quota_daily_reset_hour: 8, quota_weekly_reset_mode: 'fixed', quota_weekly_reset_day: 0, quota_weekly_reset_hour: 3, quota_reset_timezone: 'Asia/Tokyo' } }))
    const quota = wrapper.findComponent(QuotaLimitCard); await quota.get('button').trigger('click'); await submit(wrapper)
    const extra = api.update.mock.calls[0]![1].extra; expect(extra).toHaveProperty('synthetic_metadata', 'preserved')
    for (const key of ['quota_limit','quota_daily_limit','quota_weekly_limit','quota_daily_reset_mode','quota_daily_reset_hour','quota_weekly_reset_mode','quota_weekly_reset_day','quota_weekly_reset_hour','quota_reset_timezone']) expect(extra).not.toHaveProperty(key)
  })
  it('clears only disabled per-dimension notification settings while retaining limits and unrelated metadata', async () => {
    api.settings.mockResolvedValue({ account_quota_notify_enabled: true })
    const wrapper = await render(account({ extra: { synthetic_metadata: 'preserved', quota_limit: 200, quota_daily_limit: 20, quota_weekly_limit: 80, quota_notify_daily_enabled: true, quota_notify_daily_threshold: 70, quota_notify_daily_threshold_type: 'percentage', quota_notify_weekly_enabled: true, quota_notify_weekly_threshold: 12, quota_notify_weekly_threshold_type: 'fixed', quota_notify_total_enabled: true, quota_notify_total_threshold: 30, quota_notify_total_threshold_type: 'fixed' } }))
    const quota = wrapper.findComponent(QuotaLimitCard)
    for (const row of quota.findAllComponents(QuotaDimensionRow)) await row.findComponent(QuotaNotifyToggle).get('button').trigger('click')
    await submit(wrapper); const extra = api.update.mock.calls[0]![1].extra
    expect(extra).toMatchObject({ synthetic_metadata: 'preserved', quota_limit: 200, quota_daily_limit: 20, quota_weekly_limit: 80 })
    for (const dim of ['daily','weekly','total']) for (const key of ['enabled','threshold','threshold_type']) expect(extra).not.toHaveProperty(`quota_notify_${dim}_${key}`)
  })
  it('locks editing during the submitted update while preserving normal success and closing', async () => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await render(); api.update.mockReturnValueOnce(pending.promise)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(field(wrapper, 'common.name').element.matches(':disabled')).toBe(true); expect(field(wrapper, 'admin.accounts.openai.compactMode').element.matches(':disabled')).toBe(true)
    expect((button(wrapper, 'common.cancel').element as HTMLButtonElement).matches(':disabled')).toBe(false)
    pending.resolve(account()); await flushPromises()
    expect(wrapper.emitted('updated')).toHaveLength(1); expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
