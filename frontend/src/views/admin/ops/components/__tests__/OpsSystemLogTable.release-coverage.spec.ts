import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Table from '../OpsSystemLogTable.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { OpsRuntimeLogConfig, OpsSystemLog } from '@/api/admin/ops'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
let desktop = ref(true)
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => desktop }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
const base = '/api/v1/admin/ops'
type Wire = { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | undefined }
const wire: Wire[] = []
let rows: OpsSystemLog[], config: OpsRuntimeLogConfig, failure: ((request: Wire) => boolean) | undefined
function row(extra: Partial<OpsSystemLog> = {}): OpsSystemLog { return { id: 1, created_at: '2030-01-01T12:00:00Z', host: 'synthetic-node', level: 'warn', component: 'synthetic-gateway', message: 'Synthetic log content', ...extra } }
async function host(props = {}) { const view = mount(Table, { props, attachTo: document.body }); await flushPromises(); return view }
function field(view: ReturnType<typeof mount>, text: string, index = 0) { const label = view.findAll('label').filter(item => item.text().startsWith(text))[index]; expect(label, text).toBeDefined(); return new DOMWrapper(label!.element) }
function button(view: ReturnType<typeof mount>, text: string) { const item = view.findAll('button').find(item => item.text() === text); expect(item, text).toBeDefined(); return item! }
async function choose(root: DOMWrapper<Element>, text: string) {
  const trigger = root.get('button.select-trigger'); await trigger.trigger('click'); await flushPromises()
  const portal = document.getElementById(trigger.attributes('aria-controls')!); expect(portal).not.toBeNull()
  const option = new DOMWrapper(portal!).findAll('[role="option"]').find(item => item.text() === text)
  expect(option, text).toBeDefined(); await option!.trigger('click'); await flushPromises()
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-system-logs', user: { id: 7, role: 'admin' } })
  desktop = ref(true); rows = [row()]; failure = undefined; wire.length = 0
  config = { level: 'info', persist_access_logs: false, enable_sampling: false, sampling_initial: 100, sampling_thereafter: 100, caller: true, stacktrace_level: 'error', retention_days: 30, request_retention_days: 90 }
  feedback.success.mockReset(); feedback.error.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async requestConfig => {
    const url = new URL(apiClient.getUri(requestConfig), 'https://synthetic.invalid'); const query = Object.fromEntries(url.searchParams); delete query.timezone
    const request: Wire = { method: String(requestConfig.method).toUpperCase(), path: url.pathname, query, body: typeof requestConfig.data === 'string' ? JSON.parse(requestConfig.data) : requestConfig.data }
    wire.push(request)
    let value: unknown
    if (request.path === `${base}/system-logs`) value = { items: rows, total: 65, page: Number(query.page), page_size: Number(query.page_size) }
    else if (request.path === `${base}/system-logs/health`) value = { queue_depth: 2, queue_capacity: 100, dropped_count: 1, write_failed_count: 1, written_count: 65, avg_write_delay_ms: 5, last_error: 'Synthetic sink error' }
    else if (request.path === `${base}/system-logs/cleanup`) value = { deleted: 0 }
    else if (request.path === `${base}/runtime/logging/reset`) value = config
    else if (request.path === `${base}/runtime/logging`) { if (request.method === 'PUT') config = request.body as unknown as OpsRuntimeLogConfig; value = config }
    else throw new Error(`Unexpected synthetic system log route ${request.path}`)
    const denied = failure?.(request)
    const response = { config: requestConfig, status: denied ? 422 : 200, statusText: 'Synthetic logging response', headers: {}, data: denied ? { code: 422, reason: request.path.endsWith('/cleanup') ? 'OPS_SYSTEM_LOG_CLEANUP_FILTER_REQUIRED' : 'SYNTHETIC_REFUSAL', message: 'Synthetic logging refusal' } : { code: 0, data: value } }
    if (denied) throw new AxiosError('Synthetic logging refusal', AxiosError.ERR_BAD_RESPONSE, requestConfig, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('system log display and runtime controls using actual Axios', () => {
  it.each([true, false])('renders sparse and complete log DTOs on desktop=%s', async isDesktop => {
    desktop.value = isDesktop
    rows = [row({ level: 'error', request_id: 'request-synthetic', client_request_id: 'client-synthetic', user_id: 0, api_key_id: 8, account_id: 41, platform: 'openai', model: 'synthetic-model', extra: { status_code: 500, latency_ms: 0, method: ' POST ', path: '/synthetic', client_ip: '192.0.2.1', protocol: 'HTTP/2', errors: 'synthetic-errors', err: 'synthetic-error' } }),
      row({ id: 2, level: 'fatal', created_at: 'invalid-time', message: '', host: '', extra: { error: 'fallback-error', protocol: false, status_code: {}, path: null } }),
      row({ id: 3, level: 'warning', created_at: '', extra: undefined }), row({ id: 4, level: 'debug' }), row({ id: 5, level: 'info' })]
    const view = await host()
    for (const text of ['status=500', 'latency_ms=0', 'method=POST', 'req=request-synthetic', 'client_req=client-synthetic', 'user=0', 'key=8', 'acc=41', 'platform=openai', 'model=synthetic-model', 'errors=synthetic-errors', 'error=synthetic-error', 'error=fallback-error', 'proto=false', 'invalid-time', 'Synthetic sink error']) expect(view.text()).toContain(text)
    expect(view.find('.bg-red-100').exists()).toBe(true); expect(view.find('.bg-amber-100').exists()).toBe(true); expect(view.find('.bg-slate-100').exists()).toBe(true); expect(view.find('.bg-blue-100').exists()).toBe(true)
    expect(view.find('table').exists()).toBe(isDesktop)
  })

  it('submits all visible filter fields as a single literal query and resets to the parent platform', async () => {
    const view = await host({ platformFilter: 'openai' })
    const values: Array<[string, string]> = [['host', ' synthetic-host '], ['component', ' synthetic-component '], ['keyId', '8'], ['platform', 'anthropic'], ['model', ' synthetic-model '], ['keyword', ' synthetic + ']]
    for (const [name, value] of values) await field(view, `admin.ops.systemLogs.${name}`).get('input').setValue(value)
    for (const [text, value] of [['request_id', ' request-synthetic '], ['client_request_id', ' client-synthetic '], ['user_id', '7'], ['account_id', '41']]) {
      const input = view.findAll('label').find(label => label.text().includes(text))!
      expect(input, text).toBeDefined(); await input.get('input').setValue(value)
    }
    await choose(field(view, 'admin.ops.systemLogs.timeRange'), '30d')
    await choose(field(view, 'admin.ops.systemLogs.level', 1), 'error')
    await field(view, 'admin.ops.systemLogs.startTime').get('input').setValue('2030-01-01T10:00')
    await field(view, 'admin.ops.systemLogs.endTime').get('input').setValue('2030-01-01T12:00')
    await button(view, 'admin.ops.systemLogs.search').trigger('click'); await flushPromises()
    expect(wire.at(-1)?.query).toMatchObject({ page: '1', page_size: '20', time_range: '30d', host: 'synthetic-host', component: 'synthetic-component', request_id: 'request-synthetic', client_request_id: 'client-synthetic', user_id: '7', api_key_id: '8', account_id: '41', platform: 'anthropic', model: 'synthetic-model', q: 'synthetic +', level: 'error', start_time: new Date('2030-01-01T10:00').toISOString(), end_time: new Date('2030-01-01T12:00').toISOString() })
    await button(view, 'common.reset').trigger('click'); await flushPromises()
    expect(wire.at(-1)?.query).toEqual({ page: '1', page_size: '20', time_range: '1h', platform: 'openai' })
  })

  it('does not send nonpositive or invalid ID filters and updates when the parent requests refresh', async () => {
    const view = await host()
    for (const [text, value] of [['user_id', 'no-id'], ['account_id', '-1']]) await view.findAll('label').find(label => label.text().includes(text))!.get('input').setValue(value)
    await field(view, 'admin.ops.systemLogs.keyId').get('input').setValue('0')
    await button(view, 'admin.ops.systemLogs.search').trigger('click'); await flushPromises()
    expect(wire.at(-1)?.query).toEqual({ page: '1', page_size: '20', time_range: '1h' })
    await view.setProps({ platformFilter: 'openai', refreshToken: 1 }); await flushPromises()
    expect(wire.filter(item => item.path.endsWith('/system-logs')).at(-1)?.query.platform).toBe('openai')
    expect(wire.filter(item => item.path.endsWith('/health')).length).toBeGreaterThan(1)
  })

  it('saves native runtime controls with explicit false and zero request-retention values', async () => {
    const view = await host()
    await choose(field(view, 'admin.ops.systemLogs.level'), 'debug')
    await choose(field(view, 'admin.ops.systemLogs.stacktraceThreshold'), 'none')
    await field(view, 'admin.ops.systemLogs.samplingInitial').get('input').setValue(7)
    await field(view, 'admin.ops.systemLogs.samplingThereafter').get('input').setValue(11)
    for (const key of ['caller', 'sampling', 'persistAccessLogs']) {
      const control = view.findAll('label').find(item => item.text() === `admin.ops.systemLogs.${key}` && item.find('input[type="checkbox"]').exists())!
      expect(control, key).toBeDefined(); await control.get('input[type="checkbox"]').setValue(key !== 'caller')
    }
    await choose(field(view, 'admin.ops.systemLogs.requestRetentionDays'), 'admin.ops.systemLogs.retentionForever')
    await button(view, 'admin.ops.systemLogs.saveAndApply').trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'PUT')?.body).toEqual({ level: 'debug', stacktrace_level: 'none', sampling_initial: 7, sampling_thereafter: 11, caller: false, enable_sampling: true, persist_access_logs: true, retention_days: 30, request_retention_days: 0 })
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.systemLogs.runtimeConfigActive')
  })

  it('requires native confirmation before runtime reset and log cleanup', async () => {
    const view = await host()
    vi.mocked(window.confirm).mockReturnValue(false)
    await button(view, 'admin.ops.systemLogs.resetDefaults').trigger('click')
    await button(view, 'admin.ops.systemLogs.cleanCurrentFilters').trigger('click')
    expect(wire.filter(item => item.method === 'POST')).toHaveLength(0)
    vi.mocked(window.confirm).mockReturnValue(true)
    await button(view, 'admin.ops.systemLogs.resetDefaults').trigger('click'); await flushPromises()
    expect(wire.some(item => item.path.endsWith('/runtime/logging/reset'))).toBe(true)
    await field(view, 'admin.ops.systemLogs.host').get('input').setValue(' synthetic-host ')
    await button(view, 'admin.ops.systemLogs.cleanCurrentFilters').trigger('click'); await flushPromises()
    expect(wire.find(item => item.path.endsWith('/cleanup'))?.body).toEqual({ host: 'synthetic-host' })
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.systemLogs.cleanupSuccess')
  })

  it('changes the real page and page-size controls without losing the platform filter', async () => {
    const view = await host({ platformFilter: 'openai' })
    await view.findAll('button').find(item => item.text() === '2')!.trigger('click'); await flushPromises()
    expect(wire.filter(item => item.path === `${base}/system-logs`).at(-1)?.query).toEqual({ page: '2', page_size: '20', time_range: '1h', platform: 'openai' })
    await choose(new DOMWrapper(view.get('.page-size-select').element), '50')
    expect(wire.filter(item => item.path === `${base}/system-logs`).at(-1)?.query).toEqual({ page: '1', page_size: '50', time_range: '1h', platform: 'openai' })
    await button(view, 'admin.ops.systemLogs.refreshHealth').trigger('click'); await flushPromises()
    expect(wire.at(-1)?.path).toBe(`${base}/system-logs/health`)
  })

  it.each([
    ['retentionDays', '0'], ['retentionDays', '-1'], ['retentionDays', '1.5'], ['retentionDays', '3651'],
    ['requestRetentionDays', '-1'], ['requestRetentionDays', '1.5'], ['requestRetentionDays', '3651'],
  ])('rejects invalid %s=%s through the native custom retention input', async (name, value) => {
    const view = await host(); const control = field(view, `admin.ops.systemLogs.${name}`)
    await choose(control, 'admin.ops.systemLogs.retentionDaysCustom')
    await control.get('input[type="number"]').setValue(value)
    await button(view, 'admin.ops.systemLogs.saveAndApply').trigger('click'); await flushPromises()
    expect(wire.filter(item => item.method === 'PUT')).toHaveLength(0)
    expect(feedback.error).toHaveBeenCalledWith('admin.ops.systemLogs.retentionDaysInvalid')
  })

  it('supports the maximum valid custom retention and supplies the missing legacy request default', async () => {
    const { request_retention_days: _oldRequestRetention, ...legacy } = config
    config = legacy as OpsRuntimeLogConfig
    const view = await host(); const control = field(view, 'admin.ops.systemLogs.retentionDays')
    await choose(control, 'admin.ops.systemLogs.retentionDaysCustom'); await control.get('input[type="number"]').setValue('3650')
    await button(view, 'admin.ops.systemLogs.saveAndApply').trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'PUT')?.body).toMatchObject({ retention_days: 3650, request_retention_days: 90 })
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.systemLogs.runtimeConfigActive')
  })

  it.each(['list', 'health', 'runtime', 'save', 'reset', 'cleanup'] as const)('handles a %s refusal without claiming a successful update', async kind => {
    failure = request => kind === 'list' ? request.path === `${base}/system-logs` : kind === 'health' ? request.path.endsWith('/health') : kind === 'runtime' ? request.path.endsWith('/runtime/logging') && request.method === 'GET' : kind === 'save' ? request.method === 'PUT' : kind === 'reset' ? request.path.endsWith('/reset') : request.path.endsWith('/cleanup')
    const view = await host()
    if (kind === 'save' || kind === 'reset' || kind === 'cleanup') await button(view, kind === 'save' ? 'admin.ops.systemLogs.saveAndApply' : kind === 'reset' ? 'admin.ops.systemLogs.resetDefaults' : 'admin.ops.systemLogs.cleanCurrentFilters').trigger('click')
    await flushPromises(); expect(feedback.success).not.toHaveBeenCalled()
    if (kind === 'health') expect(view.text()).toContain('Synthetic log content')
    else expect(feedback.error).toHaveBeenCalled()
    if (kind === 'runtime') expect(button(view, 'admin.ops.systemLogs.saveAndApply').attributes('disabled')).toBeDefined()
  })
})
