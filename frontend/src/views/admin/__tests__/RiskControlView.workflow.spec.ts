import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import RiskControlView from '../RiskControlView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { ContentModerationConfig, ContentModerationAPIKeyStatus } from '@/api/admin/riskControl'

const api = vi.hoisted(() => ({ config: vi.fn(), status: vi.fn(), logs: vi.fn(), update: vi.fn(), groups: vi.fn(), proxies: vi.fn(), test: vi.fn(), unban: vi.fn(), deleteHash: vi.fn(), clearHashes: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  riskControl: { getConfig: api.config, getStatus: api.status, listLogs: api.logs, updateConfig: api.update, testAPIKeys: api.test, unbanUser: api.unban, deleteFlaggedHash: api.deleteHash, clearFlaggedHashes: api.clearHashes },
  groups: { getAll: api.groups }, proxies: { getAll: api.proxies },
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }) }))

const nativeSelect = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'],
  setup(props, { emit, attrs }) { return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => {
    const raw = (event.target as HTMLSelectElement).value
    const value = props.options.find((item: { value: unknown }) => String(item.value ?? '') === raw)?.value ?? raw
    emit('update:modelValue', value); emit('change', value)
  } }, props.options.map((item: { value: unknown; label: string }) => h('option', { value: String(item.value ?? '') }, item.label))) },
})
const toggle = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('input', { type: 'checkbox', checked: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }) } })
const models = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('textarea', { 'aria-label': 'Synthetic model selector', value: props.modelValue.join('\n'), onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value.split('\n')) }) } })
const pagination = defineComponent({ props: ['page'], emits: ['update:page', 'update:pageSize'], setup(props, { emit }) { return () => h('nav', [h('button', { type: 'button', onClick: () => emit('update:page', props.page + 1) }, 'next-page'), h('button', { type: 'button', onClick: () => emit('update:pageSize', 50) }, 'size-50')]) } })

function config(extra: Partial<ContentModerationConfig> = {}): ContentModerationConfig {
  return { engine: 'openai', enabled: true, mode: 'observe', base_url: 'https://moderation.example.test', model: 'omni-moderation-latest', proxy_id: null,
    api_key_configured: false, api_key_masked: '', api_key_count: 0, api_key_masks: [], api_key_statuses: [], timeout_ms: 3000, sample_rate: 100,
    all_groups: true, group_ids: [], record_non_hits: false, worker_count: 4, queue_size: 32768, block_status: 403, block_message: 'Synthetic block message',
    email_on_hit: true, auto_ban_enabled: true, ban_threshold: 10, violation_window_hours: 720, retry_count: 2, hit_retention_days: 180, non_hit_retention_days: 3,
    pre_hash_check_enabled: false, blocked_keywords: [], keyword_blocking_mode: 'keyword_and_api', thresholds: { harassment: 0.98, sexual: 0.65 },
    model_filter: { type: 'all', models: [] }, cyber_policy_exclude_from_ban_count: false, ...extra }
}
const status = (extra: Record<string, unknown> = {}) => ({ engine: 'openai', enabled: true, risk_control_enabled: true, mode: 'observe', worker_count: 4, active_workers: 2, idle_workers: 2, queue_size: 32768, queue_length: 1, queue_usage_percent: 50, enqueued: 8, processed: 7, dropped: 0, errors: 1, flagged_hash_count: 2, api_key_statuses: [], ...extra })
const keyStatus = (index: number, state: ContentModerationAPIKeyStatus['status'] = 'ok'): ContentModerationAPIKeyStatus => ({ index, key_hash: `synthetic-hash-${index}`, masked: `***${index}`, status: state, configured: true, failure_count: state === 'ok' ? 0 : 1, success_count: 1, last_error: state === 'ok' ? '' : 'Synthetic key failure', last_latency_ms: 120, last_http_status: state === 'ok' ? 200 : 429, last_tested: true })
const log = (id = 1, extra: Record<string, unknown> = {}) => ({ id, created_at: '2026-11-06T00:00:00Z', user_id: 11, user_email: 'synthetic@example.test', user_status: 'disabled', auto_banned: true, group_id: 1, group_name: 'Synthetic Gemini', api_key_name: 'Synthetic key', endpoint: '/v1/responses', provider: 'openai', model: 'synthetic-model', flagged: true, action: 'blocked', highest_category: 'sexual', highest_score: 0.9, latency_ms: 125, queue_delay_ms: 5, input_excerpt: 'Synthetic excerpt', violation_count: 3, ban_threshold: 3, ...extra })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const mounted: VueWrapper[] = []
async function render() {
  const wrapper = mount(RiskControlView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot /></main>' }, Icon: true, Select: nativeSelect, Toggle: toggle, Pagination: pagination, ModelWhitelistSelector: models,
    ProxySelector: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select aria-label="Synthetic proxy" :value="modelValue ?? 0" @change="$emit(\'update:modelValue\', Number($event.target.value))"><option :value="0">Direct</option><option :value="7">Synthetic proxy</option></select>' },
    BaseDialog: { props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :aria-label="title"><button type="button" @click="$emit(\'close\')">dialog-close</button><slot /><slot name="footer" /></section>' },
  } } })
  mounted.push(wrapper); await flushPromises(); return wrapper
}
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) { const buttons = root.findAll('button'); const result = buttons.find(item => item.text().split(':')[0] === text) ?? buttons.find(item => item.text().startsWith(text)); expect(result, text).toBeDefined(); return result! }
const dialog = (wrapper: VueWrapper) => wrapper.get('[aria-label="admin.riskControl.settingsTitle"]')
async function open(wrapper: VueWrapper, tab = 'basic') { await button(wrapper, 'admin.riskControl.openSettings').trigger('click'); if (tab !== 'basic') await button(dialog(wrapper), `admin.riskControl.tabs.${tab}`).trigger('click'); await flushPromises(); return dialog(wrapper) }
async function save(wrapper: VueWrapper) { await button(dialog(wrapper), 'admin.riskControl.saveConfig').trigger('click'); await flushPromises() }

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset())
  localStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-risk-admin', user: { id: 7 } })
  api.config.mockResolvedValue(config()); api.status.mockResolvedValue(status())
  api.logs.mockResolvedValue({ items: [log()], total: 1, page: 1, page_size: 20, pages: 1 })
  api.groups.mockResolvedValue([{ id: 1, name: 'Synthetic Gemini' }, { id: 2, name: 'Synthetic OpenAI' }]); api.proxies.mockResolvedValue([])
  api.update.mockImplementation(async (payload: object) => config(payload))
  api.unban.mockResolvedValue({ status: 'active' }); api.deleteHash.mockResolvedValue({ deleted: true }); api.clearHashes.mockResolvedValue({ deleted: 2 })
  api.test.mockResolvedValue({ items: [keyStatus(1)], image_count: 0 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('risk-control administrator workflows through visible controls', () => {
  it('shows audit input details and closes them without changing configuration', async () => {
    api.logs.mockResolvedValue({ items: [log(1, { matched_keyword: 'synthetic-match', engine_meta: { engine: 'openai', model: 'synthetic-audit', rules_version: 'v1', skipped_images: 1 } })], total: 1, page: 1, page_size: 20, pages: 1 })
    const wrapper = await render(); await wrapper.get('button[title="Synthetic excerpt"]').trigger('click')
    const detail = wrapper.get('[aria-label="admin.riskControl.inputDetailTitle"]')
    expect(detail.text()).toContain('synthetic-match'); expect(detail.text()).toContain('synthetic-audit')
    expect(detail.get('pre').text()).toBe('Synthetic excerpt')
    await button(detail, 'common.close').trigger('click')
    expect(wrapper.find('[aria-label="admin.riskControl.inputDetailTitle"]').exists()).toBe(false); expect(api.update).not.toHaveBeenCalled()
  })
  it('unbans the selected user once and updates all matching displayed rows', async () => {
    const pending = deferred<{ status: string }>(); api.unban.mockReturnValue(pending.promise)
    api.logs.mockResolvedValue({ items: [log(1), log(2), log(3, { user_id: 12 })], total: 3, page: 1, page_size: 20, pages: 1 })
    const wrapper = await render(); const actions = wrapper.findAll('button').filter(item => item.text() === 'admin.riskControl.unbanUser')
    expect(actions).toHaveLength(3); await actions[0]!.trigger('click'); await actions[1]!.trigger('click')
    expect(api.unban).toHaveBeenCalledTimes(1); expect(api.unban).toHaveBeenCalledWith(11)
    pending.resolve({ status: 'active' }); await flushPromises()
    expect(wrapper.findAll('button').filter(item => item.text() === 'admin.riskControl.unbanUser')).toHaveLength(1)
  })
  it('keeps an unban retry available after a server failure', async () => {
    api.unban.mockRejectedValueOnce(new Error('Synthetic rejection'))
    const wrapper = await render(); await button(wrapper, 'admin.riskControl.unbanUser').trigger('click'); await flushPromises()
    expect(api.error).toHaveBeenCalled(); await button(wrapper, 'admin.riskControl.unbanUser').trigger('click'); await flushPromises()
    expect(api.unban).toHaveBeenCalledTimes(2); expect(api.success).toHaveBeenCalledWith('admin.riskControl.unbanSuccess')
  })
  it('sends the visible log filters and resets page when changing page size', async () => {
    const wrapper = await render(); await button(wrapper, 'next-page').trigger('click'); await flushPromises()
    expect(api.logs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }))
    await wrapper.get('input[type="search"]').setValue(' synthetic-user '); await wrapper.get('input[type="search"]').trigger('keyup.enter'); await flushPromises()
    expect(api.logs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'synthetic-user' }))
    const filters = wrapper.findAll('select'); await filters[0]!.setValue('hit'); await filters[1]!.setValue('2'); await filters[2]!.setValue('/v1/responses'); await flushPromises()
    expect(api.logs).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'hit', group_id: 2, endpoint: '/v1/responses' }))
    await wrapper.get('input[type="datetime-local"]').setValue('2026-11-05T12:00'); await flushPromises()
    expect(api.logs.mock.lastCall?.[0].from).toBe(new Date('2026-11-05T12:00').toISOString())
    await button(wrapper, 'size-50').trigger('click'); await flushPromises()
    expect(api.logs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 50 }))
  })
  it('preserves a selected group and explicit model include list in the saved payload', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'scope')
    await button(panel, 'admin.riskControl.selectedGroups').trigger('click')
    await button(panel, 'Synthetic OpenAI').trigger('click')
    await button(panel, 'admin.riskControl.modelFilterInclude').trigger('click')
    await panel.get('textarea[aria-label="Synthetic model selector"]').setValue('gpt-test\ngpt-test\n gemini-test ')
    await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ all_groups: false, group_ids: [2], model_filter: { type: 'include', models: ['gpt-test', 'gemini-test'] } }))
  })
  it('rejects an empty include list before writing settings', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'scope'); await button(panel, 'admin.riskControl.modelFilterInclude').trigger('click'); await save(wrapper)
    expect(api.update).not.toHaveBeenCalled(); expect(api.error).toHaveBeenCalledWith('admin.riskControl.modelFilterModelsRequired')
  })
  it('requires replacement keys, then sends a de-duplicated explicit replacement', async () => {
    const wrapper = await render(); const panel = await open(wrapper)
    await button(panel, 'admin.riskControl.apiKeysModeReplace').trigger('click'); await save(wrapper)
    expect(api.update).not.toHaveBeenCalled(); expect(api.error).toHaveBeenCalledWith('admin.riskControl.apiKeysReplaceNoInput')
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-first\nsynthetic-first\nsynthetic-second'); await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ api_keys: ['synthetic-first', 'synthetic-second'], api_keys_mode: 'replace', clear_api_key: false, proxy_id: 0 }))
  })
  it.each([true, false])('cancels or completes explicit flagged-hash clearing (%s)', async confirmed => {
    vi.mocked(window.confirm).mockReturnValue(confirmed)
    const wrapper = await render(); const panel = await open(wrapper, 'runtime')
    await button(panel, 'admin.riskControl.clearFlaggedHashes').trigger('click'); await flushPromises()
    expect(api.clearHashes).toHaveBeenCalledTimes(confirmed ? 1 : 0)
    if (confirmed) expect(api.success).toHaveBeenCalledWith('admin.riskControl.flaggedHashesCleared:2')
    expect(api.update).not.toHaveBeenCalled()
  })
  it('validates a flagged hash before deleting it and allows recovery after a failed delete', async () => {
    api.deleteHash.mockRejectedValueOnce(new Error('Synthetic unavailable'))
    const wrapper = await render(); const panel = await open(wrapper, 'runtime')
    const field = panel.get('input[type="text"]'); await field.setValue('invalid')
    const action = button(panel, 'admin.riskControl.deleteFlaggedHash'); expect((action.element as HTMLButtonElement).disabled).toBe(true)
    const hash = 'a'.repeat(64); await field.setValue(hash); await action.trigger('click'); await flushPromises()
    expect((field.element as HTMLInputElement).value).toBe(hash)
    await action.trigger('click'); await flushPromises()
    expect(api.deleteHash).toHaveBeenLastCalledWith(hash); expect((field.element as HTMLInputElement).value).toBe('')
  })
  it('sends input-key audit parameters without saving them', async () => {
    api.test.mockResolvedValue({ items: [keyStatus(0)], image_count: 0, audit_result: { flagged: true, highest_category: 'sexual', highest_score: 0.9, composite_score: 0.9, category_scores: { sexual: 0.9, harassment: 0.1 }, thresholds: { sexual: 0.65, harassment: 0.98 } } })
    const wrapper = await render(); const panel = await open(wrapper)
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-audit-key')
    await panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').setValue('Synthetic audit input')
    await panel.get('select[aria-label="Synthetic proxy"]').setValue('7')
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises()
    expect(api.test).toHaveBeenCalledWith(expect.objectContaining({ api_keys: ['synthetic-audit-key'], prompt: 'Synthetic audit input', proxy_id: 7, engine: 'openai' }))
    expect(panel.text()).toContain('sexual'); expect(api.success).toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled()
    await button(panel, 'admin.riskControl.clearAuditTest').trigger('click')
    expect((panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').element as HTMLTextAreaElement).value).toBe('')
  })
  it.each(['error', 'frozen'] as const)('reports an audit key with %s without claiming success', async state => {
    api.test.mockResolvedValue({ items: [keyStatus(0, state)], image_count: 0 })
    const wrapper = await render(); const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-test-key')
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises()
    expect(api.error).toHaveBeenCalledWith('admin.riskControl.apiKeyTestFailed'); expect(api.success).not.toHaveBeenCalled()
  })
  it('keeps status refresh errors visible to the current administrator and recovers on retry', async () => {
    const wrapper = await render(); api.status.mockRejectedValueOnce(new Error('Synthetic status failure'))
    await button(wrapper, 'admin.riskControl.refreshStatus').trigger('click'); await flushPromises(); expect(api.error).toHaveBeenCalled()
    api.status.mockResolvedValue(status({ mode: 'pre_block', pre_block_api_key_available_count: 1 }))
    await button(wrapper, 'admin.riskControl.refreshStatus').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-test="pre-block-runtime-cards"]').exists()).toBe(true)
  })
  it('ignores a superseded log request when filters change before the older response arrives', async () => {
    const pending = deferred<object>(); const wrapper = await render(); api.logs.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ items: [log(3, { input_excerpt: 'Newest filtered result' })], total: 1, page: 1, page_size: 20, pages: 1 })
    await wrapper.get('input[type="search"]').setValue('first'); await wrapper.get('input[type="search"]').trigger('keyup.enter')
    await wrapper.get('input[type="search"]').setValue('second'); await wrapper.get('input[type="search"]').trigger('keyup.enter'); await flushPromises()
    expect(wrapper.text()).toContain('Newest filtered result')
    pending.resolve({ items: [log(2, { input_excerpt: 'Obsolete filtered result' })], total: 1, page: 1, page_size: 20, pages: 1 }); await flushPromises()
    expect(wrapper.text()).not.toContain('Obsolete filtered result'); expect(wrapper.text()).toContain('Newest filtered result')
  })
  it.each(['resolve', 'reject'] as const)('does not refresh or notify another login after a late save %s', async outcome => {
    const pending = deferred<ContentModerationConfig>(); const wrapper = await render(); await open(wrapper); api.update.mockReturnValue(pending.promise)
    await button(dialog(wrapper), 'admin.riskControl.saveConfig').trigger('click')
    const statusCalls = api.status.mock.calls.length; const logCalls = api.logs.mock.calls.length
    replaceAuthSession({ accessToken: 'synthetic-replacement-admin', user: { id: 8 } })
    if (outcome === 'resolve') pending.resolve(config()); else pending.reject(new Error('Synthetic old save failure'))
    await flushPromises()
    expect(api.status).toHaveBeenCalledTimes(statusCalls); expect(api.logs).toHaveBeenCalledTimes(logCalls)
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('does not use a disposed view to start follow-up reads after saving', async () => {
    const pending = deferred<ContentModerationConfig>(); const wrapper = await render(); await open(wrapper); api.update.mockReturnValue(pending.promise)
    await button(dialog(wrapper), 'admin.riskControl.saveConfig').trigger('click'); const statusCalls = api.status.mock.calls.length
    wrapper.unmount(); pending.resolve(config()); await flushPromises()
    expect(api.status).toHaveBeenCalledTimes(statusCalls); expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('preserves edits entered while an older settings save is pending', async () => {
    const pending = deferred<ContentModerationConfig>(); const wrapper = await render(); const panel = await open(wrapper)
    await panel.get('[data-test="audit-base-url"]').setValue('https://submitted.example.test'); api.update.mockReturnValue(pending.promise)
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await panel.get('[data-test="audit-base-url"]').setValue('https://unsaved.example.test')
    pending.resolve(config({ base_url: 'https://submitted.example.test' })); await flushPromises()
    expect(wrapper.find('[aria-label="admin.riskControl.settingsTitle"]').exists()).toBe(true)
    expect((dialog(wrapper).get('[data-test="audit-base-url"]').element as HTMLInputElement).value).toBe('https://unsaved.example.test')
  })
  it('drops late audit-image decoding after the administrator clears the test input', async () => {
    const readers: { result: string; onload?: () => void; onerror?: () => void; readAsDataURL: () => void }[] = []
    vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,c3ludGhldGlj'; onload?: () => void; onerror?: () => void; readAsDataURL() { readers.push(this) } abort() {} })
    const wrapper = await render(); const panel = await open(wrapper)
    await panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').setValue('Synthetic draft')
    const input = panel.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { value: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })], configurable: true })
    await input.trigger('change'); expect(readers).toHaveLength(1)
    await button(panel, 'admin.riskControl.clearAuditTest').trigger('click'); readers[0]!.onload?.(); await flushPromises()
    expect(panel.findAll('img')).toHaveLength(0); expect(api.test).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it.each(['status', 'logs', 'unban', 'deleteHash', 'clearHashes', 'test'] as const)('keeps a late %s operation inside its original login', async action => {
    const pending = deferred<Record<string, unknown>>()
    const wrapper = await render()
    const originalCalls = api[action].mock.calls.length
    api[action].mockReturnValueOnce(pending.promise)
    switch (action) {
      case 'status': await button(wrapper, 'admin.riskControl.refreshStatus').trigger('click'); break
      case 'logs': await button(wrapper, 'admin.riskControl.refresh').trigger('click'); break
      case 'unban': await button(wrapper, 'admin.riskControl.unbanUser').trigger('click'); break
      case 'deleteHash': { const panel = await open(wrapper, 'runtime'); await panel.get('input[type="text"]').setValue('a'.repeat(64)); await button(panel, 'admin.riskControl.deleteFlaggedHash').trigger('click'); break }
      case 'clearHashes': { const panel = await open(wrapper, 'runtime'); await button(panel, 'admin.riskControl.clearFlaggedHashes').trigger('click'); break }
      case 'test': { const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-captured-key'); await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); break }
    }
    expect(api[action]).toHaveBeenCalledTimes(originalCalls + 1)
    const before = { status: api.status.mock.calls.length, logs: api.logs.mock.calls.length }
    replaceAuthSession({ accessToken: 'synthetic-other-login', user: { id: 8 } })
    pending.resolve(action === 'status' ? status({ mode: 'pre_block' }) : action === 'logs' ? { items: [log(9, { input_excerpt: 'Other-login late log' })], total: 1, page: 1, page_size: 20, pages: 1 } : action === 'test' ? { items: [keyStatus(1)], image_count: 0 } : { status: 'active', deleted: 1 })
    await flushPromises()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
    expect(api.status).toHaveBeenCalledTimes(before.status); expect(api.logs).toHaveBeenCalledTimes(before.logs)
    expect(wrapper.text()).not.toContain('Other-login late log')
  })
  it.each(['status', 'logs', 'unban', 'deleteHash', 'clearHashes', 'test'] as const)('suppresses a rejected %s operation after route disposal', async action => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await render(); const originalCalls = api[action].mock.calls.length; api[action].mockReturnValueOnce(pending.promise)
    switch (action) {
      case 'status': await button(wrapper, 'admin.riskControl.refreshStatus').trigger('click'); break
      case 'logs': await button(wrapper, 'admin.riskControl.refresh').trigger('click'); break
      case 'unban': await button(wrapper, 'admin.riskControl.unbanUser').trigger('click'); break
      case 'deleteHash': { const panel = await open(wrapper, 'runtime'); await panel.get('input[type="text"]').setValue('a'.repeat(64)); await button(panel, 'admin.riskControl.deleteFlaggedHash').trigger('click'); break }
      case 'clearHashes': { const panel = await open(wrapper, 'runtime'); await button(panel, 'admin.riskControl.clearFlaggedHashes').trigger('click'); break }
      case 'test': { const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-captured-key'); await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); break }
    }
    expect(api[action]).toHaveBeenCalledTimes(originalCalls + 1); wrapper.unmount(); pending.reject(new Error('Synthetic disposed operation failure')); await flushPromises()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('does not start log reads from an initial page load that completes after a login change', async () => {
    const pending = deferred<ContentModerationConfig>(); api.config.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); expect(api.logs).not.toHaveBeenCalled()
    replaceAuthSession({ accessToken: 'synthetic-new-initial-login', user: { id: 8 } }); pending.resolve(config()); await flushPromises()
    expect(api.logs).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('shows an initial loading error without allowing a late disposed error to notify another page', async () => {
    api.config.mockRejectedValueOnce(new Error('Synthetic configuration unavailable'))
    const wrapper = await render(); expect(api.error).toHaveBeenCalledWith('Synthetic configuration unavailable'); expect(wrapper.text()).toContain('admin.riskControl.openSettings')
  })
  it('allows the current page to load if optional proxy discovery fails', async () => {
    api.proxies.mockRejectedValueOnce(new Error('Synthetic optional proxy unavailable'))
    const wrapper = await render(); await open(wrapper)
    expect(api.logs).toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
    expect((dialog(wrapper).get('[data-test="audit-base-url"]').element as HTMLInputElement).value).toBe('https://moderation.example.test')
  })
  it('locks synchronous repeated save clicks to one request and keeps recovery after a rejection', async () => {
    const pending = deferred<ContentModerationConfig>(); const wrapper = await render(); const panel = await open(wrapper); api.update.mockReturnValueOnce(pending.promise)
    const action = button(panel, 'admin.riskControl.saveConfig').element as HTMLButtonElement; action.click(); action.click()
    expect(api.update).toHaveBeenCalledTimes(1); pending.reject(new Error('Synthetic save failure')); await flushPromises()
    expect((button(dialog(wrapper), 'admin.riskControl.saveConfig').element as HTMLButtonElement).disabled).toBe(false)
    await save(wrapper); expect(api.update).toHaveBeenCalledTimes(2)
  })
  it('locks synchronous audit clicks and keeps the edited prompt when the old result arrives', async () => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await render(); const panel = await open(wrapper)
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-key'); const field = panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]'); await field.setValue('Submitted synthetic audit')
    api.test.mockReturnValueOnce(pending.promise); const action = button(panel, 'admin.riskControl.testInputApiKeys').element as HTMLButtonElement; action.click(); action.click()
    expect(api.test).toHaveBeenCalledTimes(1); await field.setValue('New unsent audit draft')
    pending.resolve({ items: [keyStatus(1)], image_count: 0, audit_result: { flagged: true, highest_category: 'Old result category', category_scores: {}, thresholds: {} } }); await flushPromises()
    expect(panel.text()).not.toContain('Old result category'); expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
    expect((field.element as HTMLTextAreaElement).value).toBe('New unsent audit draft')
    expect((button(panel, 'admin.riskControl.testInputApiKeys').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps a newly entered hash when an earlier delete finishes', async () => {
    const pending = deferred<{ deleted: boolean }>(); const wrapper = await render(); const panel = await open(wrapper, 'runtime'); const field = panel.get('input[type="text"]')
    await field.setValue('a'.repeat(64)); api.deleteHash.mockReturnValueOnce(pending.promise); await button(panel, 'admin.riskControl.deleteFlaggedHash').trigger('click')
    await field.setValue('b'.repeat(64)); pending.resolve({ deleted: true }); await flushPromises()
    expect((field.element as HTMLInputElement).value).toBe('b'.repeat(64)); expect(api.deleteHash).toHaveBeenCalledWith('a'.repeat(64))
  })
  it('preserves a reopened settings dialog when a previous save finishes', async () => {
    const pending = deferred<ContentModerationConfig>(); const wrapper = await render(); const panel = await open(wrapper); api.update.mockReturnValueOnce(pending.promise)
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await button(panel, 'common.cancel').trigger('click')
    const reopened = await open(wrapper); await reopened.get('[data-test="audit-base-url"]').setValue('https://reopened.example.test')
    pending.resolve(config()); await flushPromises()
    expect((dialog(wrapper).get('[data-test="audit-base-url"]').element as HTMLInputElement).value).toBe('https://reopened.example.test')
  })
  it.each(['keyword_only', 'keyword_and_api', 'api_only'] as const)('saves explicit %s policy and normalized keyword lines', async mode => {
    const labels = { keyword_only: 'admin.riskControl.keywordModeKeywordOnly', keyword_and_api: 'admin.riskControl.keywordModeKeywordAndApi', api_only: 'admin.riskControl.keywordModeApiOnly' }
    const wrapper = await render(); const panel = await open(wrapper, 'keywords'); await panel.get('textarea').setValue(' synthetic-word \nsynthetic-word\nsecond-word')
    await button(panel, labels[mode]).trigger('click'); await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ keyword_blocking_mode: mode, blocked_keywords: ['synthetic-word', 'second-word'] }))
  })
  it.each([[45, 0.45], [200, 1], [-5, 0]] as const)('saves the visible risk threshold %s within its supported range', async (input, expected) => {
    const wrapper = await render(); const panel = await open(wrapper, 'riskThresholds'); await panel.get('[data-test="risk-threshold-sexual"]').setValue(String(input)); await save(wrapper)
    expect(api.update.mock.calls[0]![0].thresholds.sexual).toBe(expected)
    expect(api.update.mock.calls[0]![0].engine_configs.openai.thresholds.sexual).toBe(expected)
  })
  it('expands stored key rows, supports undo, and submits only the selected key deletion', async () => {
    const keys = Array.from({ length: 6 }, (_, i) => keyStatus(i, (['ok', 'unknown', 'error', 'frozen'] as const)[i % 4]))
    api.config.mockResolvedValue(config({ api_key_count: 6, api_key_configured: true, api_key_statuses: keys })); api.status.mockResolvedValue(status({ api_key_statuses: keys }))
    const wrapper = await render(); const panel = await open(wrapper)
    expect(panel.findAll('button[title="admin.riskControl.deleteApiKey"]').length).toBeLessThan(6)
    await button(panel, 'admin.riskControl.expandApiKeyRows').trigger('click'); expect(panel.findAll('button[title="admin.riskControl.deleteApiKey"]')).toHaveLength(6)
    await panel.findAll('button[title="admin.riskControl.deleteApiKey"]')[0]!.trigger('click'); await panel.get('button[title="admin.riskControl.undoDeleteApiKey"]').trigger('click')
    await panel.findAll('button[title="admin.riskControl.deleteApiKey"]')[1]!.trigger('click'); await save(wrapper)
    expect(api.update.mock.calls[0]![0].delete_api_key_hashes).toEqual(['synthetic-hash-1'])
    expect(api.update.mock.calls[0]![0].engine_configs.openai.delete_api_key_hashes).toEqual(['synthetic-hash-1'])
  })
  it('uses the stored-key audit path without adding plaintext keys to the request', async () => {
    const keys = [keyStatus(1)]; api.config.mockResolvedValue(config({ api_key_count: 1, api_key_configured: true, api_key_statuses: keys })); api.status.mockResolvedValue(status({ api_key_statuses: keys }))
    const wrapper = await render(); const panel = await open(wrapper); await button(panel, 'admin.riskControl.testStoredApiKeys').trigger('click'); await flushPromises()
    expect(api.test).toHaveBeenCalledWith(expect.objectContaining({ api_keys: [], engine: 'openai' })); expect(api.success).toHaveBeenCalledWith('admin.riskControl.apiKeyTestDone:1'); expect(api.update).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'engine', 'unmount'] as const)('cancels a pending image read on %s without stale images or errors', async action => {
    const abort = vi.fn(); const readers: { result: string; onload?: () => void; onerror?: () => void; readAsDataURL: () => void }[] = []
    vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,c3ludGhldGlj'; onload?: () => void; onerror?: () => void; readAsDataURL() { readers.push(this) } abort() { abort() } })
    const wrapper = await render(); const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-file-key')
    const input = panel.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { value: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })], configurable: true }); await input.trigger('change')
    expect((button(panel, 'admin.riskControl.testInputApiKeys').element as HTMLButtonElement).disabled).toBe(true)
    if (action === 'cancel') await button(panel, 'common.cancel').trigger('click')
    if (action === 'engine') await panel.get('[data-test="audit-engine-select"]').setValue('typesafe')
    if (action === 'unmount') wrapper.unmount()
    expect(abort).toHaveBeenCalledTimes(1); readers[0]!.onerror?.(); readers[0]!.onload?.(); await flushPromises()
    expect(api.error).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled()
    if (action === 'engine') { expect(panel.findAll('img')).toHaveLength(0); expect((button(panel, 'admin.riskControl.testInputApiKeys').element as HTMLButtonElement).disabled).toBe(true) }
  })
  it.each(['upload', 'drop', 'paste'] as const)('uses a fully decoded %s image in the audit request and supports removing it', async action => {
    const wrapper = await render(); const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-file-key')
    const file = new File(['synthetic image bytes'], 'synthetic.png', { type: 'image/png' })
    if (action === 'upload') { const input = panel.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { value: [file], configurable: true }); await input.trigger('change') }
    if (action === 'drop') { const zone = panel.findAll('div').find(item => item.classes().includes('border-dashed')); expect(zone).toBeDefined(); await zone!.trigger('drop', { dataTransfer: { files: [file] } }) }
    if (action === 'paste') await panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').trigger('paste', { clipboardData: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } })
    await vi.waitFor(() => expect(panel.findAll('img')).toHaveLength(1))
    expect((panel.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(false)
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises()
    expect(api.test.mock.calls[0]![0].images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)])
    await panel.get('button[aria-label="common.delete"]').trigger('click'); expect(panel.findAll('img')).toHaveLength(0)
  })
  it.each(['non-image', 'oversized', 'too-many'] as const)('handles %s audit files without silently submitting invalid input', async kind => {
    const wrapper = await render(); const panel = await open(wrapper); const input = panel.get('input[type="file"]')
    const files = kind === 'non-image' ? [new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' })] : kind === 'oversized' ? [new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] : [new File(['first'], 'first.png', { type: 'image/png' }), new File(['second'], 'second.png', { type: 'image/png' })]
    Object.defineProperty(input.element, 'files', { value: files, configurable: true }); await input.trigger('change')
    if (kind === 'too-many') await vi.waitFor(() => expect(api.error).toHaveBeenCalledWith('admin.riskControl.auditTestImageLimit:1'))
    else if (kind === 'oversized') expect(api.error).toHaveBeenCalledWith('admin.riskControl.auditTestImageTooLarge')
    else expect(api.error).not.toHaveBeenCalled()
    expect(panel.findAll('img')).toHaveLength(kind === 'too-many' ? 1 : 0); expect(api.test).not.toHaveBeenCalled()
  })
  it('restores image input and audit controls after a decoding error', async () => {
    vi.stubGlobal('FileReader', class { onerror?: () => void; error = new Error('Synthetic image decode failure'); readAsDataURL() { this.onerror?.() } abort() {} })
    const wrapper = await render(); const panel = await open(wrapper); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-input-key')
    const input = panel.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { value: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })], configurable: true }); await input.trigger('change'); await flushPromises()
    expect(api.error).toHaveBeenCalledWith('admin.riskControl.auditTestImageReadFailed'); expect((input.element as HTMLInputElement).disabled).toBe(false)
    expect((button(panel, 'admin.riskControl.testInputApiKeys').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('saves the visible worker and queue configuration with an explicit recording preference', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'runtime'); const fields = panel.findAll('input[type="number"]')
    await fields[0]!.setValue('6'); await fields[1]!.setValue('1500'); await panel.findAll('input[type="checkbox"]')[0]!.setValue(true); await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ worker_count: 6, queue_size: 1500, record_non_hits: true }))
  })
  it('saves response controls without changing unrelated key configuration', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'response'); const fields = panel.findAll('input[type="number"]')
    await fields[0]!.setValue('451'); await panel.get('input[type="text"]').setValue('Synthetic explicit block message'); await fields[1]!.setValue('12'); await fields[2]!.setValue('24')
    const toggles = panel.findAll('input[type="checkbox"]'); await toggles[0]!.setValue(false); await toggles[1]!.setValue(false); await toggles[2]!.setValue(true); await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ block_status: 451, block_message: 'Synthetic explicit block message', ban_threshold: 12, violation_window_hours: 24, email_on_hit: false, auto_ban_enabled: false, cyber_policy_exclude_from_ban_count: true, clear_api_key: false }))
  })
  it('limits non-hit retention to the supported maximum while preserving selected hit retention', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'retention'); const fields = panel.findAll('input[type="number"]')
    await fields[0]!.setValue('90'); await fields[1]!.setValue('20'); await save(wrapper)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ hit_retention_days: 90, non_hit_retention_days: 3 }))
  })
  it('resets risk thresholds through the visible reset control', async () => {
    const wrapper = await render(); const panel = await open(wrapper, 'riskThresholds'); const field = panel.get('[data-test="risk-threshold-sexual"]')
    await field.setValue('12'); await button(panel, 'admin.riskControl.riskThresholdReset').trigger('click'); await save(wrapper)
    expect(api.update.mock.calls[0]![0].thresholds.sexual).toBe(0.65)
  })
  it.each([
    { action: 'cyber_policy', flagged: true, label: 'admin.riskControl.action.cyberPolicy', tone: 'bg-red-100' },
    { action: 'keyword_block', flagged: true, label: 'admin.riskControl.action.keywordBlock', tone: 'bg-red-100' },
    { action: 'block', flagged: true, label: 'admin.riskControl.action.block', tone: 'bg-red-100' },
    { action: 'error', flagged: false, label: 'admin.riskControl.action.error', tone: 'bg-amber-100' },
    { action: 'pass', flagged: false, label: 'admin.riskControl.result.pass', tone: 'bg-green-100' },
  ])('renders a distinguishable $action audit result with missing timings safely', async scenario => {
    api.logs.mockResolvedValue({ items: [log(1, { action: scenario.action, flagged: scenario.flagged, latency_ms: null, highest_score: Number.NaN, input_excerpt: '', error: scenario.action === 'error' ? 'Synthetic log error' : '', auto_banned: false, user_status: 'active' })], total: 1, page: 1, page_size: 20, pages: 1 })
    const wrapper = await render(); const row = wrapper.get('tbody tr'); const badge = row.findAll('span').find(item => item.text() === scenario.label)
    expect(badge).toBeDefined(); expect(badge!.classes()).toContain(scenario.tone); expect(row.text()).not.toContain('NaN')
    expect(row.findAll('button').some(item => item.text() === 'admin.riskControl.unbanUser')).toBe(false)
  })
})
