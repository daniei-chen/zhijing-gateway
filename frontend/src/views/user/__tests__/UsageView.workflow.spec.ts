import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import UsageView from '../UsageView.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({ query: vi.fn(), stats: vi.fn(), models: vi.fn(), snapshot: vi.fn(), errors: vi.fn(), keys: vi.fn(), groups: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
const settings = vi.hoisted(() => ({ value: { allow_user_view_error_requests: true } as Record<string, unknown> }))
vi.mock('@/api', () => ({ usageAPI: { query: api.query, getStats: api.stats, getDashboardModels: api.models, getDashboardSnapshotV2: api.snapshot, listMyErrorRequests: api.errors }, keysAPI: { list: api.keys }, userGroupsAPI: { getAvailable: api.groups } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error, showWarning: api.warning, showInfo: api.info, get cachedPublicSettings() { return settings.value } }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

const nativeSelect = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options', 'creatable'], emits: ['update:modelValue', 'change'],
  setup(props, { emit, attrs }) { return () => {
    const change = (value: unknown) => { emit('update:modelValue', value); emit('change', value) }
    return props.creatable !== undefined && props.creatable !== false ? h('input', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => change((event.target as HTMLInputElement).value) }) : h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => { const raw = (event.target as HTMLSelectElement).value; const option = props.options.find((item: { value: unknown }) => String(item.value ?? '') === raw); change(option ? option.value : raw) } }, props.options.map((item: { value: unknown; label: string }) => h('option', { value: String(item.value ?? '') }, item.label)))
  } },
})
const dateRange = defineComponent({ props: ['startDate', 'endDate'], emits: ['update:startDate', 'update:endDate', 'change'], setup(props, { emit }) { return () => h('div', [
  h('input', { type: 'date', 'aria-label': 'Start date', value: props.startDate, onInput: (event: Event) => emit('update:startDate', (event.target as HTMLInputElement).value) }),
  h('input', { type: 'date', 'aria-label': 'End date', value: props.endDate, onInput: (event: Event) => emit('update:endDate', (event.target as HTMLInputElement).value) }),
  h('button', { type: 'button', onClick: () => emit('change', { startDate: props.startDate, endDate: props.endDate, preset: null }) }, 'apply-range'),
]) } })
const pagination = defineComponent({ props: ['page'], emits: ['update:page', 'update:pageSize'], setup(props, { emit }) { return () => h('nav', [h('button', { type: 'button', onClick: () => emit('update:page', props.page + 1) }, 'next-usage-page'), h('button', { type: 'button', onClick: () => emit('update:pageSize', 50) }, 'usage-size-50')]) } })
const usageTable = defineComponent({ props: ['data', 'loading', 'columns'], emits: ['sort', 'ipGeoBatchFailed'], template: '<section data-usage-table :aria-busy="loading"><button type="button" @click="$emit(\'sort\',\'actual_cost\',\'asc\')">sort-usage-cost</button><button type="button" @click="$emit(\'ipGeoBatchFailed\')">usage-ip-failure</button><div data-usage-columns>{{columns.map(c=>c.key).join(\',\')}}</div><p v-for="row in data" :key="row.id">{{row.request_id}}</p></section>' })
const errorTable = defineComponent({ props: ['rows', 'loading', 'page', 'visibleColumnKeys'], emits: ['sort', 'update:page', 'update:pageSize', 'ipGeoBatchFailed'], template: '<section data-error-table :aria-busy="loading"><button type="button" @click="$emit(\'sort\',\'status_code\',\'asc\')">sort-errors</button><button type="button" @click="$emit(\'update:page\',page+1)">next-error-page</button><button type="button" @click="$emit(\'update:pageSize\',50)">error-size-50</button><button type="button" @click="$emit(\'ipGeoBatchFailed\')">error-ip-failure</button><div data-error-columns>{{visibleColumnKeys.join(\',\')}}</div><p v-for="row in rows" :key="row.id">{{row.message}}</p></section>' })
const statsCard = defineComponent({ props: ['stats'], template: '<output data-stats>{{stats?.total_actual_cost}}</output>' })
const trend = defineComponent({ props: ['trendData'], template: '<div data-trend>{{trendData.map(row=>row.date).join(\',\')}}</div>' })
const modelChart = defineComponent({ props: ['modelStats'], template: '<div data-models>{{modelStats.map(row=>row.model).join(\',\')}}</div>' })
const groupChart = defineComponent({ props: ['groupStats'], template: '<div data-groups>{{groupStats.map(row=>row.group_name).join(\',\')}}</div>' })
const endpointChart = defineComponent({ props: ['endpointStats'], template: '<div data-endpoints>{{endpointStats.map(row=>row.endpoint).join(\',\')}}</div>' })

const usage = (id = 1, extra: Record<string, unknown> = {}) => ({ id, request_id: `synthetic-request-${id}`, model: 'synthetic-model', actual_cost: 0.125, total_cost: 0.25, rate_multiplier: 0.5, input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_creation_tokens: 40, first_token_ms: 120, duration_ms: 450, created_at: '2026-11-06T00:00:00Z', api_key: { name: 'Synthetic member key' }, billing_mode: 'token', request_type: 'sync', stream: false, image_count: 0, reasoning_effort: 'high', inbound_endpoint: '/v1/responses', ip_address: '192.0.2.10', ...extra })
const errorRow = (id = 1, extra: Record<string, unknown> = {}) => ({ id, model: 'synthetic-error-model', message: `Synthetic error ${id}`, category: 'upstream', status_code: 503, created_at: '2026-11-06T00:00:00Z', ...extra })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const wrappers: VueWrapper[] = []
const downloads: { name: string; url: string }[] = []
const blobs: Blob[] = []
const originalCreate = window.URL.createObjectURL
const originalRevoke = window.URL.revokeObjectURL
async function render() {
  const wrapper = mount(UsageView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, Select: nativeSelect, DateRangePicker: dateRange, Pagination: pagination, UsageTable: usageTable, UserErrorRequestsTable: errorTable, UsageStatsCards: statsCard, TokenUsageTrend: trend, ModelDistributionChart: modelChart, GroupDistributionChart: groupChart, EndpointDistributionChart: endpointChart, Icon: true } } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) { const buttons = root.findAll('button'); const result = buttons.find(item => item.text() === text) ?? buttons.find(item => item.text().startsWith(text)); expect(result, `visible ${text}`).toBeDefined(); return result! }
function field(wrapper: VueWrapper, label: string, kind = 'select') { const element = wrapper.findAll('label').find(item => item.text() === label); expect(element, label).toBeDefined(); return new DOMWrapper(element!.element.parentElement!).get(kind) }
async function range(wrapper: VueWrapper, start: string, end: string) { await wrapper.get('[aria-label="Start date"]').setValue(start); await wrapper.get('[aria-label="End date"]').setValue(end); await button(wrapper, 'apply-range').trigger('click'); await flushPromises() }
async function errors(wrapper: VueWrapper) { await button(wrapper, 'usage.tabs.errors').trigger('click'); await flushPromises(); return wrapper.get('[data-error-table]') }
function readBlob(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob) }) }

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset()); localStorage.clear(); sessionStorage.clear(); downloads.length = blobs.length = 0
  replaceAuthSession({ accessToken: 'synthetic-usage-member', user: { id: 11 } }); settings.value = { allow_user_view_error_requests: true }
  api.query.mockResolvedValue({ items: [usage()], total: 1 }); api.stats.mockResolvedValue({ total_actual_cost: 0.125, endpoints: [{ endpoint: '/v1/responses' }] })
  api.models.mockResolvedValue({ models: [{ model: 'synthetic-model' }] }); api.snapshot.mockResolvedValue({ trend: [{ date: '2026-11-06' }], groups: [{ group_name: 'Synthetic group' }] })
  api.errors.mockResolvedValue({ items: [errorRow()], total: 1 }); api.keys.mockResolvedValue({ items: [{ id: 1, name: 'Synthetic key A' }, { id: 2, name: 'Synthetic key B' }], pages: 1 }); api.groups.mockResolvedValue([{ id: 7, name: 'Synthetic group' }])
  window.URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return `blob:synthetic-${blobs.length}` }) as typeof window.URL.createObjectURL
  window.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push({ name: this.download, url: this.href }) })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); window.URL.createObjectURL = originalCreate; window.URL.revokeObjectURL = originalRevoke; document.body.innerHTML = '' })

describe('member usage workflows through visible controls', () => {
  it('loads the main table, daily chart and three distribution views without showing secrets', async () => {
    const wrapper = await render(); expect(wrapper.text()).toContain('synthetic-request-1'); expect(wrapper.get('[data-stats]').text()).toBe('0.125')
    expect(wrapper.get('[data-trend]').text()).toBe('2026-11-06'); expect(wrapper.get('[data-models]').text()).toBe('synthetic-model')
    await button(wrapper, 'Groups').trigger('click'); expect(wrapper.get('[data-groups]').isVisible()).toBe(true)
    await button(wrapper, 'Endpoints').trigger('click'); expect(wrapper.get('[data-endpoints]').text()).toContain('/v1/responses')
    expect(api.snapshot).toHaveBeenCalledWith(expect.objectContaining({ include_trend: true, include_model_stats: false, include_group_stats: true })); expect(wrapper.text()).not.toContain('synthetic-usage-member')
  })
  it('applies native key/model/group filters and resets the table to the first page', async () => {
    const wrapper = await render(); await button(wrapper, 'next-usage-page').trigger('click'); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await field(wrapper, 'usage.model').setValue('synthetic-model'); await field(wrapper, 'admin.usage.group').setValue('7'); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, api_key_id: 2, model: 'synthetic-model', group_id: 7 }), expect.any(Object))
    expect(api.stats).toHaveBeenLastCalledWith(expect.objectContaining({ api_key_id: 2, model: 'synthetic-model', group_id: 7 }))
  })
  it.each([['ws_v2', true], ['stream', true], ['sync', false], ['live', undefined]] as const)('keeps the explicit %s type together with its compatible stream filter', async (requestType, stream) => {
    const wrapper = await render(); await button(wrapper, 'More filters').trigger('click'); await field(wrapper, 'usage.type').setValue(requestType); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ request_type: requestType, stream }), expect.any(Object))
  })
  it('propagates compaction and billing filters to lists and statistics', async () => {
    const wrapper = await render(); await button(wrapper, 'More filters').trigger('click')
    await field(wrapper, 'usage.compactionFilter').setValue('true'); await field(wrapper, 'admin.usage.billingType').setValue('1'); await field(wrapper, 'admin.usage.billingMode').setValue('image'); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ native_compaction_v2: true, billing_type: 1, billing_mode: 'image' }), expect.any(Object))
    expect(api.models).toHaveBeenLastCalledWith(expect.objectContaining({ native_compaction_v2: true, billing_type: 1, billing_mode: 'image', model_source: 'requested' }))
  })
  it('sorts and changes page size using public table and pagination events', async () => {
    const wrapper = await render(); await button(wrapper, 'sort-usage-cost').trigger('click'); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sort_by: 'actual_cost', sort_order: 'asc' }), expect.any(Object))
    await button(wrapper, 'usage-size-50').trigger('click'); await flushPromises(); expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 50 }), expect.any(Object))
  })
  it('chooses daily statistics for a long range and clears filters with reset', async () => {
    const wrapper = await render(); await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await range(wrapper, '2026-10-01', '2026-10-10')
    expect(api.snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ start_date: '2026-10-01', end_date: '2026-10-10', granularity: 'day' }))
    await button(wrapper, 'common.reset').trigger('click'); await flushPromises()
    expect(api.query.mock.lastCall?.[0].api_key_id).toBeUndefined(); expect(api.query.mock.lastCall?.[0].page).toBe(1)
    expect(api.query.mock.lastCall?.[0].native_compaction_v2).toBeNull()
  })
  it('keeps usage and error column preferences separate and closes the menu outside', async () => {
    const wrapper = await render(); await wrapper.get('[data-testid="usage-column-settings"]').trigger('click'); await wrapper.get('[data-testid="usage-column-toggle-model"]').trigger('click')
    expect(wrapper.get('[data-usage-columns]').text()).not.toContain('model'); expect(JSON.parse(localStorage.getItem('user-usage-hidden-columns')!)).toContain('model')
    await errors(wrapper); await wrapper.get('[data-testid="usage-column-settings"]').trigger('click'); await wrapper.get('[data-testid="usage-column-toggle-client_ip"]').trigger('click')
    expect(JSON.parse(localStorage.getItem('user-usage-error-hidden-columns')!)).toContain('client_ip'); expect(JSON.parse(localStorage.getItem('user-usage-hidden-columns')!)).not.toContain('client_ip')
    document.body.click(); await flushPromises(); expect(wrapper.find('[data-testid="usage-column-toggle-model"]').exists()).toBe(false)
  })
  it('restores safe default columns when a saved preference is malformed', async () => {
    localStorage.setItem('user-usage-hidden-columns', '{broken'); localStorage.setItem('user-usage-error-hidden-columns', '42')
    const wrapper = await render(); expect(wrapper.get('[data-usage-columns]').text()).not.toContain('user_agent'); await errors(wrapper); expect(wrapper.get('[data-error-columns]').text()).not.toContain('user_agent')
  })
  it('loads error filters, pagination and sorting independently of the successful request table', async () => {
    const wrapper = await render(); await errors(wrapper)
    await field(wrapper, 'usage.errors.keyName').setValue('2'); await field(wrapper, 'usage.errors.model', 'input').setValue(' partial-model '); await field(wrapper, 'usage.errors.category').setValue('quota'); await field(wrapper, 'usage.errors.status').setValue('429'); await flushPromises()
    expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, api_key_id: 2, model: 'partial-model', category: 'quota', status_code: 429 }))
    await button(wrapper, 'sort-errors').trigger('click'); await button(wrapper, 'next-error-page').trigger('click'); await flushPromises()
    expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, sort_by: 'status_code', sort_order: 'asc' }))
    await button(wrapper, 'error-size-50').trigger('click'); await flushPromises(); expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 50 }))
  })
  it('hides unavailable errors and subscription filters under the existing feature flags', async () => {
    settings.value = { allow_user_view_error_requests: false, subscription_enabled: false }
    const wrapper = await render(); expect(wrapper.text()).not.toContain('usage.tabs.errors'); expect(wrapper.text()).not.toContain('admin.usage.billingType'); expect(api.errors).not.toHaveBeenCalled()
  })
  it.each(['usage', 'error'])('reports a public %s table geolocation error to the current member', async tab => {
    const wrapper = await render(); if (tab === 'error') await errors(wrapper)
    await button(wrapper, `${tab}-ip-failure`).trigger('click'); expect(api.error).toHaveBeenCalledWith('usage.ipGeo.batchFailed')
  })
  it('exports the filtered CSV and escapes formulas, commas, quotes and embedded newlines', async () => {
    api.query.mockResolvedValue({ items: [usage(1, { api_key: { name: '=SYNTHETIC()' }, model: 'quoted,"model"\nnext' })], total: 1 })
    const wrapper = await render(); await range(wrapper, '2026-11-01', '2026-11-02'); await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises()
    expect(blobs).toHaveLength(1); const csv = await readBlob(blobs[0]!)
    expect(csv).toContain('"\'=SYNTHETIC()"'); expect(csv).toContain('"quoted,""model""\nnext"'); expect(csv).toContain('0.12500000,0.25000000')
    expect(downloads[0]!.name).toBe('usage_2026-11-01_to_2026-11-02.csv'); expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1'); expect(api.success).toHaveBeenCalledWith('usage.exportSuccess')
  })
  it.each([['ws_v2', 'WS'], ['stream', 'Stream'], ['sync', 'Sync'], ['live', 'Live'], ['cyber', 'Cyber']] as const)('exports %s requests with their existing display label', async (type, label) => {
    api.query.mockResolvedValue({ items: [usage(1, { request_type: type })], total: 1 })
    const wrapper = await render(); await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises(); expect(await readBlob(blobs[0]!)).toContain(`,${label},`)
  })
  it('does not fetch export pages when the current list is empty', async () => {
    api.query.mockResolvedValue({ items: [], total: 0 }); const wrapper = await render(); const calls = api.query.mock.calls.length
    await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises(); expect(api.query).toHaveBeenCalledTimes(calls); expect(api.warning).toHaveBeenCalledWith('usage.noDataToExport'); expect(blobs).toHaveLength(0)
  })
  it('handles an empty or failed export page without creating a download', async () => {
    const wrapper = await render(); api.query.mockResolvedValueOnce({ items: [], total: 0 }); await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises()
    expect(api.warning).toHaveBeenCalledWith('usage.noDataToExport'); api.query.mockRejectedValueOnce(new Error('Synthetic export failed')); await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises()
    expect(api.error).toHaveBeenCalledWith('usage.exportFailed'); expect(blobs).toHaveLength(0)
  })
  it('does not overwrite a newer error-filter response with an older request', async () => {
    const wrapper = await render(); await errors(wrapper); const pending = deferred<{ items: ReturnType<typeof errorRow>[]; total: number }>()
    api.errors.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ items: [errorRow(3, { message: 'Newest error results' })], total: 1 })
    await field(wrapper, 'usage.errors.category').setValue('auth'); await field(wrapper, 'usage.errors.category').setValue('quota'); await flushPromises(); expect(wrapper.text()).toContain('Newest error results')
    pending.resolve({ items: [errorRow(2, { message: 'Obsolete error results' })], total: 1 }); await flushPromises(); expect(wrapper.text()).not.toContain('Obsolete error results')
  })
  it('suppresses an aborted older main-query rejection after newer filters succeed', async () => {
    const pending = deferred<object>(); const wrapper = await render(); api.query.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ items: [usage(3)], total: 1 })
    await field(wrapper, 'usage.apiKeyFilter').setValue('1'); await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await flushPromises()
    pending.reject(new Error('Synthetic old filtered query error')); await flushPromises(); expect(api.error).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('synthetic-request-3')
  })
  it('stops export pagination and download after a same-user replacement login', async () => {
    api.query.mockResolvedValue({ items: [usage()], total: 101 }); const wrapper = await render(); const pending = deferred<{ items: ReturnType<typeof usage>[]; total: number }>(); api.query.mockReturnValueOnce(pending.promise)
    await button(wrapper, 'usage.exportCsv').trigger('click'); const calls = api.query.mock.calls.length
    replaceAuthSession({ accessToken: 'synthetic-usage-new-login', user: { id: 11 } }); pending.resolve({ items: [usage()], total: 101 }); await flushPromises()
    expect(api.query).toHaveBeenCalledTimes(calls); expect(blobs).toHaveLength(0); expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('locks synchronous export clicks to one read/download operation', async () => {
    const wrapper = await render(); const pending = deferred<{ items: ReturnType<typeof usage>[]; total: number }>(); api.query.mockReturnValueOnce(pending.promise)
    const calls = api.query.mock.calls.length; const action = button(wrapper, 'usage.exportCsv').element as HTMLButtonElement; action.click(); action.click(); expect(api.query).toHaveBeenCalledTimes(calls + 1)
    pending.resolve({ items: [usage()], total: 1 }); await flushPromises()
  })
  it('revokes its object URL even when the browser refuses the download click', async () => {
    const wrapper = await render(); vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('Synthetic click blocked') })
    await button(wrapper, 'usage.exportCsv').trigger('click'); await flushPromises(); expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1'); expect(api.error).toHaveBeenCalledWith('usage.exportFailed')
  })
  it.each(['stats', 'models', 'snapshot'] as const)('does not render late %s data after a same-user replacement login', async operation => {
    const pending = deferred<Record<string, unknown>>(); const wrapper = await render(); api[operation].mockReturnValueOnce(pending.promise)
    await button(wrapper, 'common.refresh').trigger('click'); const previous = operation === 'stats' ? wrapper.get('[data-stats]').text() : operation === 'models' ? wrapper.get('[data-models]').text() : wrapper.get('[data-trend]').text()
    replaceAuthSession({ accessToken: 'synthetic-replaced-usage-session', user: { id: 11 } }); pending.resolve(operation === 'stats' ? { total_actual_cost: 999, endpoints: [] } : operation === 'models' ? { models: [{ model: 'Obsolete model' }] } : { trend: [{ date: 'Obsolete date' }], groups: [] }); await flushPromises()
    expect(api.error).not.toHaveBeenCalled(); expect(operation === 'stats' ? wrapper.get('[data-stats]').text() : operation === 'models' ? wrapper.get('[data-models]').text() : wrapper.get('[data-trend]').text()).toBe(previous)
  })
  it('does not display late error rows or toast an old failure after the login changes', async () => {
    const pending = deferred<{ items: ReturnType<typeof errorRow>[]; total: number }>(); const wrapper = await render(); api.errors.mockReturnValueOnce(pending.promise)
    await button(wrapper, 'usage.tabs.errors').trigger('click'); replaceAuthSession({ accessToken: 'synthetic-other-usage-member', user: { id: 12 } })
    pending.resolve({ items: [errorRow(9, { message: 'Old login error record' })], total: 1 }); await flushPromises(); expect(wrapper.text()).not.toContain('Old login error record'); expect(api.error).not.toHaveBeenCalled()
  })
  it('does not label previous-filter cost totals as current after the new statistics request fails', async () => {
    const wrapper = await render(); api.stats.mockRejectedValueOnce(new Error('Synthetic current statistics failure'))
    await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await flushPromises()
    expect(wrapper.find('[data-stats]').exists()).toBe(false); expect(wrapper.find('[role="alert"]').text()).toContain('usage.failedToLoad')
    api.stats.mockResolvedValueOnce({ total_actual_cost: 0.75, endpoints: [] }); await button(wrapper, 'common.refresh').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-stats]').text()).toBe('0.75'); expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('stops loading later API-key pages after the original login changes', async () => {
    const pending = deferred<{ items: { id: number; name: string }[]; pages: number }>(); api.keys.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); replaceAuthSession({ accessToken: 'synthetic-new-filter-options-login', user: { id: 11 } }); pending.resolve({ items: [{ id: 8, name: 'Old-session key option' }], pages: 2 }); await flushPromises()
    expect(api.keys).toHaveBeenCalledTimes(1); expect(wrapper.text()).not.toContain('Old-session key option')
  })
  it('keeps the latest main query loading indicator owned by the pending newer request', async () => {
    const wrapper = await render(); const first = deferred<object>(); const last = deferred<object>(); api.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    await field(wrapper, 'usage.apiKeyFilter').setValue('1'); await field(wrapper, 'usage.apiKeyFilter').setValue('2')
    first.resolve({ items: [usage(9)], total: 1 }); await flushPromises(); expect(wrapper.get('[data-usage-table]').attributes('aria-busy')).toBe('true')
    last.resolve({ items: [usage(2)], total: 1 }); await flushPromises(); expect(wrapper.get('[data-usage-table]').attributes('aria-busy')).toBe('false'); expect(wrapper.text()).toContain('synthetic-request-2')
  })
  it('does not reuse old error results after leaving that tab and changing the date range', async () => {
    const pending = deferred<{ items: ReturnType<typeof errorRow>[]; total: number }>(); const wrapper = await render(); api.errors.mockReturnValueOnce(pending.promise)
    await button(wrapper, 'usage.tabs.errors').trigger('click'); await button(wrapper, 'usage.tabs.usage').trigger('click'); await range(wrapper, '2026-10-01', '2026-10-10')
    pending.resolve({ items: [errorRow(9, { message: 'Obsolete date error' })], total: 1 }); await flushPromises()
    api.errors.mockResolvedValueOnce({ items: [errorRow(2, { message: 'New date error' })], total: 1 }); await errors(wrapper)
    expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ start_date: '2026-10-01', end_date: '2026-10-10' })); expect(wrapper.text()).toContain('New date error'); expect(wrapper.text()).not.toContain('Obsolete date error')
  })
  it.each(['resolve', 'reject'] as const)('stops a disposed CSV export after its pending page %s', async outcome => {
    api.query.mockResolvedValue({ items: [usage()], total: 101 }); const wrapper = await render(); const pending = deferred<object>(); api.query.mockReturnValueOnce(pending.promise)
    await button(wrapper, 'usage.exportCsv').trigger('click'); const calls = api.query.mock.calls.length; wrapper.unmount()
    if (outcome === 'resolve') pending.resolve({ items: [usage()], total: 101 }); else pending.reject(new Error('Synthetic disposed export failure'))
    await flushPromises(); expect(api.query).toHaveBeenCalledTimes(calls); expect(blobs).toHaveLength(0); expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('allows error-list recovery after a current request fails', async () => {
    const wrapper = await render(); api.errors.mockRejectedValueOnce(new Error('Synthetic current error list failure')); await button(wrapper, 'usage.tabs.errors').trigger('click'); await flushPromises()
    expect(api.error).toHaveBeenCalledWith('usage.errors.failedToLoad'); expect(wrapper.get('[data-testid="usage-errors-error"]').attributes('aria-busy')).toBe('false'); expect(wrapper.find('[data-error-table]').exists()).toBe(false)
    api.errors.mockResolvedValueOnce({ items: [errorRow(3, { message: 'Recovered error rows' })], total: 1 }); await button(wrapper, 'common.refresh').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Recovered error rows')
  })
  it('hides a failed key scope and retries its current dates and sort without reviving prior rows', async () => {
    const wrapper = await render(); await range(wrapper, '2026-10-01', '2026-10-03'); await button(wrapper, 'sort-usage-cost').trigger('click'); await flushPromises()
    api.query.mockRejectedValueOnce(new Error('Synthetic failed key scope')); await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await flushPromises()
    const failed = wrapper.get('[data-testid="usage-list-error"]'); expect(failed.attributes('role')).toBe('alert'); expect(failed.text()).toContain('usage.failedToLoad')
    expect(wrapper.find('[data-usage-table]').exists()).toBe(false); expect(wrapper.find('nav').exists()).toBe(false); expect(wrapper.text()).not.toContain('synthetic-request-1')
    const exportButton = button(wrapper, 'usage.exportCsv').element as HTMLButtonElement; expect(exportButton.disabled).toBe(true); const reads = api.query.mock.calls.length; exportButton.click(); await flushPromises(); expect(api.query).toHaveBeenCalledTimes(reads)
    const retry = deferred<{ items: ReturnType<typeof usage>[]; total: number }>(); api.query.mockReturnValueOnce(retry.promise)
    await button(failed, 'common.tryAgain').trigger('click'); expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, api_key_id: 2, start_date: '2026-10-01', end_date: '2026-10-03', sort_by: 'actual_cost', sort_order: 'asc' }), expect.any(Object))
    expect(wrapper.get('[data-testid="usage-list-error"]').attributes('aria-busy')).toBe('true'); expect(wrapper.find('[data-usage-table]').exists()).toBe(false)
    retry.resolve({ items: [usage(3)], total: 1 }); await flushPromises(); expect(wrapper.find('[data-testid="usage-list-error"]').exists()).toBe(false); expect(wrapper.get('[data-usage-table]').text()).toContain('synthetic-request-3'); expect(exportButton.disabled).toBe(false)
  })
  it('keeps a failed usage page distinct from an empty successful retry of that same page', async () => {
    const wrapper = await render(); api.query.mockRejectedValueOnce(new Error('Synthetic failed usage page')); await button(wrapper, 'next-usage-page').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-usage-table]').exists()).toBe(false); expect(wrapper.find('nav').exists()).toBe(false)
    api.query.mockResolvedValueOnce({ items: [], total: 0 }); await button(wrapper.get('[data-testid="usage-list-error"]'), 'common.tryAgain').trigger('click'); await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }), expect.any(Object)); expect(wrapper.find('[data-testid="usage-list-error"]').exists()).toBe(false); expect(wrapper.get('[data-usage-table]').text()).not.toContain('synthetic-request-1'); expect(wrapper.find('nav').exists()).toBe(false)
  })
  it('hides a failed error status scope until an explicit retry succeeds with the same filters', async () => {
    const wrapper = await render(); await errors(wrapper); await field(wrapper, 'usage.errors.keyName').setValue('2'); await button(wrapper, 'sort-errors').trigger('click'); await flushPromises()
    api.errors.mockRejectedValueOnce(new Error('Synthetic failed error status')); await field(wrapper, 'usage.errors.status').setValue('429'); await flushPromises()
    const failed = wrapper.get('[data-testid="usage-errors-error"]'); expect(failed.attributes('role')).toBe('alert'); expect(failed.text()).toContain('usage.errors.failedToLoad'); expect(wrapper.find('[data-error-table]').exists()).toBe(false); expect(wrapper.text()).not.toContain('Synthetic error 1')
    const retry = deferred<{ items: ReturnType<typeof errorRow>[]; total: number }>(); api.errors.mockReturnValueOnce(retry.promise); await button(failed, 'common.tryAgain').trigger('click')
    expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status_code: 429, api_key_id: 2, sort_by: 'status_code', sort_order: 'asc' })); expect(wrapper.get('[data-testid="usage-errors-error"]').attributes('aria-busy')).toBe('true'); expect(wrapper.find('[data-error-table]').exists()).toBe(false)
    retry.resolve({ items: [errorRow(3)], total: 1 }); await flushPromises(); expect(wrapper.find('[data-testid="usage-errors-error"]').exists()).toBe(false); expect(wrapper.get('[data-error-table]').text()).toContain('Synthetic error 3')
  })
  it('retries a failed error page without disguising failure as an empty list', async () => {
    const wrapper = await render(); await errors(wrapper); api.errors.mockRejectedValueOnce(new Error('Synthetic failed error page')); await button(wrapper, 'next-error-page').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-error-table]').exists()).toBe(false); expect(wrapper.get('[data-testid="usage-errors-error"]').text()).toContain('usage.errors.failedToLoad')
    api.errors.mockResolvedValueOnce({ items: [], total: 0 }); await button(wrapper.get('[data-testid="usage-errors-error"]'), 'common.tryAgain').trigger('click'); await flushPromises()
    expect(api.errors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 })); expect(wrapper.find('[data-testid="usage-errors-error"]').exists()).toBe(false); expect(wrapper.get('[data-error-table]').text()).not.toContain('Synthetic error 1')
  })
  it('finishes an already captured CSV after a newer list scope fails while blocking any new export', async () => {
    api.query.mockResolvedValue({ items: [usage()], total: 101 }); const wrapper = await render(); const firstExportPage = deferred<{ items: ReturnType<typeof usage>[]; total: number }>()
    api.query.mockImplementation((params: { page: number; page_size: number; api_key_id?: number }) => {
      if (params.page_size === 100) return params.page === 1 ? firstExportPage.promise : Promise.resolve({ items: [usage(2)], total: 101 })
      return Promise.reject(new Error('Synthetic current filter failure during export'))
    })
    await button(wrapper, 'usage.exportCsv').trigger('click'); await field(wrapper, 'usage.apiKeyFilter').setValue('2'); await flushPromises(); expect(wrapper.get('[data-testid="usage-list-error"]').attributes('role')).toBe('alert')
    firstExportPage.resolve({ items: [usage()], total: 101 }); await flushPromises()
    const exportQueries = api.query.mock.calls.map(call => call[0]).filter(params => params.page_size === 100); expect(exportQueries.map(params => params.page)).toEqual([1, 2]); expect(exportQueries.every(params => params.api_key_id == null)).toBe(true); expect(blobs).toHaveLength(1); expect(api.success).toHaveBeenCalledWith('usage.exportSuccess'); expect(wrapper.find('[data-usage-table]').exists()).toBe(false); expect((button(wrapper, 'usage.exportCsv').element as HTMLButtonElement).disabled).toBe(true)
  })
})
