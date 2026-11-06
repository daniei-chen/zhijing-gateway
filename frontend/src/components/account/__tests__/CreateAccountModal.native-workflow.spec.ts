import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import CreateAccountModal from '../CreateAccountModal.vue'
import QuotaLimitCard from '../QuotaLimitCard.vue'
import QuotaDimensionRow from '../QuotaDimensionRow.vue'
import QuotaNotifyToggle from '../QuotaNotifyToggle.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({ create: vi.fn(), risk: vi.fn(), probe: vi.fn(), sync: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), settings: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { create: api.create, checkMixedChannelRisk: api.risk, probeUpstreamBilling: api.probe, syncUpstreamModels: api.sync },
  gemini: { getCapabilities: vi.fn().mockResolvedValue({ ai_studio_oauth_enabled: false }) },
  settings: { getSettings: api.settings, getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: true, providers: [] }) },
  tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([{ id: 'synthetic-tls', name: 'Synthetic TLS profile' }]) },
} }))
vi.mock('@/api/admin/accounts', async () => ({ ...await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts'), getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: api.error, showSuccess: api.success, showWarning: api.warning, showInfo: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const Select = defineComponent({ inheritAttrs: false, props: ['modelValue', 'options', 'disabled'], emits: ['update:modelValue', 'change'], setup(props, { attrs, emit }) { return () => h('select', { ...attrs, disabled: props.disabled, value: String(props.modelValue ?? ''), onChange: (event: Event) => { const raw = (event.target as HTMLSelectElement).value; const value = props.options.find((option: { value: unknown }) => String(option.value ?? '') === raw)?.value ?? raw; emit('update:modelValue', value); emit('change', value) } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value ?? '') }, option.label))) } })
const Models = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('textarea', { 'aria-label': 'Synthetic model whitelist', value: props.modelValue.join('\n'), onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value.split('\n')) }) } })
const wrappers: VueWrapper[] = []
function render(realSelect = false) {
  const wrapper = mount(CreateAccountModal, { attachTo: document.body, props: { show: true, groups: [], proxies: [] }, global: { mocks: { $t: (key: string) => key }, stubs: {
    teleport: !realSelect, ...(realSelect ? { BaseDialog: { props: ['show'], template: '<section v-if="show"><slot/><slot name="footer"/></section>' } } : {}), Icon: true, PlatformIcon: true, ProxyAdBanner: true, GroupSelector: true, ProxySelector: true, Select: realSelect ? false : Select, ModelWhitelistSelector: Models,
  } } })
  wrappers.push(wrapper); return wrapper
}
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) { const all = root.findAll('button'); const found = all.find(item => item.text() === text) ?? all.find(item => item.text().includes(text)); expect(found, `visible button ${text}`).toBeDefined(); return found! }
function field(wrapper: VueWrapper, name: string, index = 0) { const label = wrapper.findAll('label').filter(item => item.text() === name && item.attributes('for'))[index]; expect(label, `label ${name}`).toBeDefined(); const control = document.getElementById(label!.attributes('for')); expect(control).not.toBeNull(); return new DOMWrapper(control!) }
async function prepare(platform = 'OpenAI', realSelect = false) {
  const wrapper = render(realSelect); await button(wrapper, platform).trigger('click')
  if (['OpenAI', 'Anthropic', 'Gemini', 'Grok'].includes(platform)) await button(wrapper, platform === 'Anthropic' ? 'admin.accounts.claudeConsole' : platform === 'Gemini' ? 'admin.accounts.gemini.accountType.apiKeyTitle' : 'API Key').trigger('click')
  await field(wrapper, 'admin.accounts.accountName').setValue('Synthetic native account'); await field(wrapper, 'admin.accounts.apiKeyRequired').setValue(' synthetic-native-key '); return wrapper
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset()); localStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-native-admin', user: { id: 7 } })
  api.create.mockImplementation(async payload => ({ ...payload, id: 42 })); api.risk.mockResolvedValue({ has_risk: false }); api.probe.mockResolvedValue({}); api.sync.mockResolvedValue({ models: [], warnings: [] }); api.settings.mockResolvedValue({})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('CreateAccountModal extended normal native workflows', () => {
  const cn = [
    ['Kimi', 'kimi', 'https://api.moonshot.cn/v1', 'https://api.moonshot.cn/anthropic'],
    ['Zhipu GLM', 'zhipu', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/anthropic'],
    ['DeepSeek', 'deepseek', 'https://api.deepseek.com', 'https://api.deepseek.com/anthropic'],
    ['MiniMax', 'minimax', 'https://api.minimaxi.com/v1', 'https://api.minimaxi.com/anthropic'],
  ] as const
  it.each(cn)('creates %s adaptive credentials with every supported inbound endpoint', async (label, platform, chat, anthropic) => {
    const wrapper = await prepare(label); await submit(wrapper)
    expect(api.create).toHaveBeenCalledOnce()
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform, type: 'apikey', credentials: { account_mode: 'payg', api_protocol: 'adaptive', base_url: chat, api_key: 'synthetic-native-key', api_base_urls: { chat_completions: chat, anthropic } } })
    if (platform !== 'zhipu') expect(api.create.mock.calls[0]![0].credentials.api_base_urls.responses).toBe(chat)
    else expect(api.create.mock.calls[0]![0].credentials.api_base_urls).not.toHaveProperty('responses')
  })
  it.each(cn)('saves a custom native Anthropic endpoint for %s instead of the inactive adaptive draft', async (label, platform) => {
    const wrapper = await prepare(label); await button(wrapper, 'admin.accounts.cnProviders.apiProtocol.anthropic').trigger('click')
    await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://synthetic-native.example/anthropic '); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform, credentials: { api_protocol: 'anthropic', base_url: 'https://synthetic-native.example/anthropic' } })
    expect(api.create.mock.calls[0]![0].credentials).not.toHaveProperty('api_base_urls')
  })
  it.each([['Kimi', 'kimi'], ['MiniMax', 'minimax'], ['DeepSeek', 'deepseek']] as const)('saves an explicit native Responses endpoint for %s', async (label, platform) => {
    const wrapper = await prepare(label); await button(wrapper, 'admin.accounts.cnProviders.apiProtocol.responses').trigger('click')
    await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://synthetic-native.example/responses-base '); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform, credentials: { api_protocol: 'responses', base_url: 'https://synthetic-native.example/responses-base' } })
  })
  it.each([['Kimi', 'kimi', 'https://api.kimi.com/coding/v1'], ['Zhipu GLM', 'zhipu', 'https://open.bigmodel.cn/api/coding/paas/v4'], ['MiniMax', 'minimax', 'https://api.minimaxi.com/v1']] as const)('switches %s coding mode and keeps the chosen mode in credentials', async (label, platform, chat) => {
    const wrapper = await prepare(label); await button(wrapper, 'admin.accounts.cnProviders.accountMode.coding').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform, credentials: { account_mode: 'coding', base_url: chat, api_base_urls: { chat_completions: chat } } })
  })
  it('preserves custom adaptive endpoints across a Kimi mode change while replacing untouched defaults', async () => {
    const wrapper = await prepare('Kimi'); await wrapper.get('[data-testid="cn-adaptive-base-url-anthropic"]').setValue('https://custom.example.test/anthropic')
    await button(wrapper, 'admin.accounts.cnProviders.accountMode.coding').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].credentials.api_base_urls).toEqual({ anthropic: 'https://custom.example.test/anthropic', chat_completions: 'https://api.kimi.com/coding/v1', responses: 'https://api.kimi.com/coding/v1' })
  })
  it('captures optional Zhipu team identifiers only in coding mode', async () => {
    const wrapper = await prepare('Zhipu GLM'); await button(wrapper, 'admin.accounts.cnProviders.accountMode.coding').trigger('click')
    await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.organization').setValue(' synthetic-team '); await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.project').setValue(' synthetic-project '); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].credentials).toMatchObject({ account_mode: 'coding', zhipu_organization: 'synthetic-team', zhipu_project: 'synthetic-project' })
  })
  it('normalizes unsupported inherited coding mode when switching to DeepSeek', async () => {
    const wrapper = await prepare('Kimi'); await button(wrapper, 'admin.accounts.cnProviders.accountMode.coding').trigger('click'); await button(wrapper, 'DeepSeek').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform: 'deepseek', credentials: { account_mode: 'payg', api_protocol: 'adaptive', base_url: 'https://api.deepseek.com' } })
  })
  it.each([['Command Code', 'command_code', 'https://api.commandcode.ai/provider/v1'], ['Cline', 'cline', 'https://api.cline.bot/api/v1']] as const)('creates the registered %s provider through its generic native form', async (label, platform, base) => {
    const wrapper = await prepare(label); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform, type: 'apikey', credentials: { account_mode: 'payg', api_protocol: 'adaptive', base_url: base, api_base_urls: { chat_completions: base } } })
  })
  it('creates OpenCode Zen then changes to Go without losing a custom inbound endpoint', async () => {
    const wrapper = await prepare('OpenCode'); await wrapper.get('[data-testid="cn-adaptive-base-url-chat_completions"]').setValue('https://custom.example.test/go/v1')
    await button(wrapper, 'admin.accounts.opencodeGo.accountMode.go').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform: 'opencode_go', credentials: { account_mode: 'go', base_url: 'https://custom.example.test/go/v1' } })
  })
  it('serializes native scheduling, note, expiry and zero billing multiplier values', async () => {
    const wrapper = await prepare(); await field(wrapper, 'admin.accounts.notes').setValue('Synthetic operator note')
    await field(wrapper, 'admin.accounts.concurrency').setValue('4'); await field(wrapper, 'admin.accounts.loadFactor').setValue('7'); await field(wrapper, 'admin.accounts.priority').setValue('12'); await field(wrapper, 'admin.accounts.billingRateMultiplier').setValue('0')
    await field(wrapper, 'admin.accounts.expiresAt').setValue('2027-02-03T12:34'); await wrapper.get('button[aria-label="admin.accounts.autoPauseOnExpired"]').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ notes: 'Synthetic operator note', concurrency: 4, load_factor: 7, priority: 12, rate_multiplier: 0, expires_at: Math.floor(new Date('2027-02-03T12:34').getTime()/1000), auto_pause_on_expired: false })
  })
  it('keeps a blank load factor as inherited instead of sending zero', async () => {
    const wrapper = await prepare(); await field(wrapper, 'admin.accounts.loadFactor').setValue('0'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].load_factor == null).toBe(true)
  })
  it.each(['force_responses', 'force_chat_completions'] as const)('saves the explicit %s API mode and compact strategy', async mode => {
    const wrapper = await prepare(); await field(wrapper, 'admin.accounts.openai.responsesMode').setValue(mode); await field(wrapper, 'admin.accounts.openai.compactMode').setValue('force_off'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].extra).toMatchObject({ openai_responses_mode: mode, openai_compact_mode: 'force_off' })
  })
  it('keeps Responses mode inactive when text capability is disabled, preserving embeddings support', async () => {
    const wrapper = await prepare(); await field(wrapper, 'admin.accounts.openai.responsesMode').setValue('force_responses')
    await wrapper.get('[data-testid="openai-endpoint-capability-embeddings"]').setValue(true); await wrapper.get('[data-testid="openai-endpoint-capability-chat_completions"]').setValue(false); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].credentials.openai_capabilities).toEqual(['embeddings']); expect(api.create.mock.calls[0]![0].extra).not.toHaveProperty('openai_responses_mode')
  })
  it('writes Anthropic bearer-header auth and explicit passthrough from visible controls', async () => {
    const wrapper = await prepare('Anthropic'); await wrapper.get('button[aria-label="admin.accounts.anthropic.apiKeyPassthrough"]').trigger('click'); await field(wrapper, 'admin.accounts.anthropic.apiKeyAuthScheme').setValue('authorization_bearer'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].extra).toMatchObject({ anthropic_passthrough: true, anthropic_apikey_auth_scheme: 'authorization_bearer' })
  })
  it('adds, reorders and removes cooling rules while preserving the edited model scope', async () => {
    const wrapper = await prepare(); await wrapper.get('button[aria-label="admin.accounts.tempUnschedulable.title"]').trigger('click'); await button(wrapper, 'admin.accounts.tempUnschedulable.addRule').trigger('click')
    await field(wrapper, 'admin.accounts.tempUnschedulable.errorCode').setValue('503'); await field(wrapper, 'admin.accounts.tempUnschedulable.durationMinutes').setValue('4'); await field(wrapper, 'admin.accounts.tempUnschedulable.keywords').setValue('timeout, overload'); await field(wrapper, 'admin.accounts.tempUnschedulable.description').setValue('Synthetic upstream cooling'); await wrapper.get('[data-testid="temp-unsched-scope-model"]').trigger('click')
    await button(wrapper, 'admin.accounts.tempUnschedulable.addRule').trigger('click'); await field(wrapper, 'admin.accounts.tempUnschedulable.errorCode', 1).setValue('502'); await field(wrapper, 'admin.accounts.tempUnschedulable.durationMinutes', 1).setValue('2')
    await wrapper.findAll('button[aria-label="admin.settings.customMenu.moveUp"]')[1]!.trigger('click'); await wrapper.get('button[aria-label="common.delete 1"]').trigger('click'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0].credentials).toMatchObject({ temp_unschedulable_enabled: true, temp_unschedulable_rules: [{ error_code: 503, duration_minutes: 4, keywords: ['timeout', 'overload'], description: 'Synthetic upstream cooling', scope: 'model' }] })
  })
  it('rejects invalid cooling rules before any create then accepts a corrected native field', async () => {
    const wrapper = await prepare(); await wrapper.get('button[aria-label="admin.accounts.tempUnschedulable.title"]').trigger('click'); await button(wrapper, 'admin.accounts.tempUnschedulable.addRule').trigger('click'); await submit(wrapper)
    expect(api.create).not.toHaveBeenCalled(); expect(api.error).toHaveBeenCalled()
    await field(wrapper, 'admin.accounts.tempUnschedulable.errorCode').setValue('429'); await field(wrapper, 'admin.accounts.tempUnschedulable.durationMinutes').setValue('3'); await field(wrapper, 'admin.accounts.tempUnschedulable.keywords').setValue('synthetic-cooling'); await submit(wrapper); expect(api.create).toHaveBeenCalledOnce()
  })
  it('keeps the exact CN credentials through the real JSON request boundary', async () => {
    const { apiClient } = await import('@/api/client'); const actual = await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts'); const original = apiClient.defaults.adapter; const wire: unknown[] = []
    apiClient.defaults.adapter = async request => { const body = JSON.parse(request.data); wire.push({ method: request.method, url: request.url, body }); return { status: 200, statusText: 'OK', headers: {}, config: request, data: { code: 0, data: { ...body, id: 42 } } } }; api.create.mockImplementation(actual.create)
    try { const wrapper = await prepare('Zhipu GLM'); await button(wrapper, 'admin.accounts.cnProviders.accountMode.coding').trigger('click'); await field(wrapper, 'admin.accounts.cnProviders.zhipuTeam.organization').setValue('synthetic-org'); await submit(wrapper); expect(wire).toEqual([expect.objectContaining({ method: 'post', url: '/admin/accounts', body: expect.objectContaining({ platform: 'zhipu', credentials: expect.objectContaining({ account_mode: 'coding', zhipu_organization: 'synthetic-org', api_base_urls: { anthropic: 'https://open.bigmodel.cn/api/anthropic', chat_completions: 'https://open.bigmodel.cn/api/coding/paas/v4' } }) }) })]) } finally { apiClient.defaults.adapter = original }
  })
  it.each(['OpenAI', 'Anthropic', 'Gemini', 'Kimi'])('submits the quota limits and reset schedule edited in the real %s quota card', async platform => {
    const wrapper = await prepare(platform); const quota = wrapper.findComponent(QuotaLimitCard); expect(quota.exists()).toBe(true); await quota.get('button').trigger('click')
    const row = (dim: string) => quota.findAllComponents(QuotaDimensionRow).find(component => component.props('dim') === dim)!
    await row('daily').get('input[type="number"]').setValue('20'); await row('weekly').get('input[type="number"]').setValue('80'); await row('total').get('input[type="number"]').setValue('250')
    await row('daily').get('select').setValue('fixed'); await row('daily').findAll('select')[1]!.setValue('6'); await row('daily').findAll('select')[2]!.setValue('Asia/Tokyo')
    await row('weekly').get('select').setValue('fixed'); await row('weekly').findAll('select')[1]!.setValue('0'); await row('weekly').findAll('select')[2]!.setValue('2')
    await submit(wrapper)
    expect(api.create.mock.calls[0]![0].extra).toMatchObject({ quota_limit: 250, quota_daily_limit: 20, quota_weekly_limit: 80, quota_daily_reset_mode: 'fixed', quota_daily_reset_hour: 6, quota_weekly_reset_mode: 'fixed', quota_weekly_reset_day: 0, quota_weekly_reset_hour: 2, quota_reset_timezone: 'Asia/Tokyo' })
  })
  it('submits all three quota notification settings from real nested controls without sending a notification', async () => {
    api.settings.mockResolvedValue({ account_quota_notify_enabled: true })
    const wrapper = await prepare(); await flushPromises(); const quota = wrapper.findComponent(QuotaLimitCard); await quota.get('button').trigger('click')
    for (const [dim, limit, threshold, type] of [['daily', '20', '70', 'percentage'], ['weekly', '80', '12', 'fixed'], ['total', '250', '40', 'fixed']] as const) {
      const row = quota.findAllComponents(QuotaDimensionRow).find(component => component.props('dim') === dim)!
      await row.get('input[type="number"]').setValue(limit); const notify = row.findComponent(QuotaNotifyToggle); expect(notify.exists()).toBe(true)
      await notify.get('button').trigger('click'); await notify.get('input').setValue(threshold); await notify.get('select').setValue(type)
    }
    await submit(wrapper)
    expect(api.create.mock.calls[0]![0].extra).toMatchObject({ quota_notify_daily_enabled: true, quota_notify_daily_threshold: 70, quota_notify_daily_threshold_type: 'percentage', quota_notify_weekly_enabled: true, quota_notify_weekly_threshold: 12, quota_notify_weekly_threshold_type: 'fixed', quota_notify_total_enabled: true, quota_notify_total_threshold: 40, quota_notify_total_threshold_type: 'fixed' })
  })
  it('keeps the existing Bedrock shared-create quota and credential contract', async () => {
    const wrapper = render(); await button(wrapper, 'admin.accounts.bedrockLabel').trigger('click'); await field(wrapper, 'admin.accounts.accountName').setValue('Synthetic quota Bedrock'); await field(wrapper, 'admin.accounts.bedrockAccessKeyId').setValue('SYNTHETIC_ACCESS'); await field(wrapper, 'admin.accounts.bedrockSecretAccessKey').setValue('synthetic-secret')
    const quota = wrapper.findComponent(QuotaLimitCard); await quota.get('button').trigger('click'); const total = quota.findAllComponents(QuotaDimensionRow).find(row => row.props('dim') === 'total')!; await total.get('input[type="number"]').setValue('123'); await submit(wrapper)
    expect(api.create.mock.calls[0]![0]).toMatchObject({ platform: 'anthropic', type: 'bedrock', credentials: { auth_mode: 'sigv4', aws_access_key_id: 'SYNTHETIC_ACCESS', aws_secret_access_key: 'synthetic-secret' }, extra: { quota_limit: 123 } })
    expect(api.create.mock.calls[0]![0].credentials).not.toHaveProperty('api_key'); expect(api.probe).not.toHaveBeenCalled()
  })
  it('locks editing during the submitted create while preserving normal success and closing', async () => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await prepare(); api.create.mockReturnValueOnce(pending.promise)
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(api.create).toHaveBeenCalledOnce()
    expect(field(wrapper, 'admin.accounts.accountName').element.matches(':disabled')).toBe(true)
    expect(field(wrapper, 'admin.accounts.openai.compactMode').element.matches(':disabled')).toBe(true)
    const platformButton = button(wrapper, 'Kimi').element as HTMLButtonElement; expect(platformButton.matches(':disabled')).toBe(true); platformButton.click(); await flushPromises()
    expect(wrapper.find('[data-testid="cn-adaptive-base-url-anthropic"]').exists()).toBe(false)
    expect((button(wrapper, 'common.cancel').element as HTMLButtonElement).disabled).toBe(false)
    pending.resolve({ id: 42, platform: 'openai', type: 'apikey' }); await flushPromises()
    expect(wrapper.emitted('created')).toHaveLength(1); expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('closes an already open real Select portal while creating and restores native editing after failure', async () => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await prepare('OpenAI', true)
    const compact = field(wrapper, 'admin.accounts.openai.compactMode'); await compact.trigger('click'); await flushPromises(); expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    api.create.mockReturnValueOnce(pending.promise); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.create).toHaveBeenCalledOnce(); expect(compact.element.matches(':disabled')).toBe(true); expect(compact.attributes('aria-expanded')).toBe('false')
    const leavingOption = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent?.includes('compactModeForceOff'))
    leavingOption?.click(); await flushPromises()
    expect(compact.text()).toBe('admin.accounts.openai.compactModeAuto')
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull())
    pending.reject({ status: 400, message: 'Synthetic create validation failure' }); await flushPromises()
    expect(field(wrapper, 'admin.accounts.accountName').element.matches(':disabled')).toBe(false); expect(compact.element.matches(':disabled')).toBe(false)
    await compact.trigger('click'); await flushPromises(); expect(document.querySelector('[role="listbox"]')).not.toBeNull()
  })
  it('allows cancellation while a create is in flight without closing the next reopened draft', async () => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await prepare(); api.create.mockReturnValueOnce(pending.promise)
    await wrapper.get('form').trigger('submit'); await flushPromises(); const cancel = button(wrapper, 'common.cancel').element as HTMLButtonElement; expect(cancel.matches(':disabled')).toBe(false); cancel.click(); await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1); await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }); await flushPromises()
    const currentCloseCount = wrapper.emitted('close')!.length; pending.resolve({ id: 42 }); await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(currentCloseCount); expect(wrapper.emitted('created')).toBeUndefined()
  })
})
