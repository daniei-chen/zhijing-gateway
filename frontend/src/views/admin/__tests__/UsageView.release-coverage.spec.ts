import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import UsageView from '@/views/admin/UsageView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), save: vi.fn(), sheet: vi.fn<(rows: unknown[][]) => Record<string, unknown>>(() => ({})), append: vi.fn(), write: vi.fn(() => new Uint8Array([1, 2, 3])), routeQuery: {} as Record<string, string | null | (string | null)[]> }))
vi.mock('@/api/admin', async () => ({ adminAPI: { usage: await vi.importActual('@/api/admin/usage'), dashboard: await vi.importActual('@/api/admin/dashboard'), users: await vi.importActual('@/api/admin/users'), groups: await vi.importActual('@/api/admin/groups'), accounts: await vi.importActual('@/api/admin/accounts') } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.error, showSuccess: mocks.success, showInfo: vi.fn(), showWarning: vi.fn() }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: mocks.routeQuery }) }))
vi.mock('file-saver', () => ({ saveAs: mocks.save }))
vi.mock('xlsx', () => ({ utils: { aoa_to_sheet: mocks.sheet, sheet_add_aoa: mocks.append, book_new: () => ({}), book_append_sheet: vi.fn() }, write: mocks.write }))

interface Wire { path: string; params: Record<string, unknown>; signal: InternalAxiosRequestConfig['signal'] }
const originalAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let total: number
let exportRows: Record<string, unknown>[]
let exportMode: 'ok' | 'error' | 'pending'
let releaseExport: (() => void) | undefined
let failSource: string
let unexpected: string[]
const externalFetch = vi.fn(() => Promise.reject(new Error('Unexpected external fetch in synthetic usage test')))
const usage = (patch: Record<string, unknown> = {}) => ({ id: 71, user_id: 17, user: { id: 17, email: 'synthetic-usage@example.invalid' }, api_key: { id: 51, name: 'Synthetic usage key' }, account: { id: 61, name: 'Synthetic account' }, group: { id: 11, name: 'Synthetic group' }, model: 'synthetic-model', request_type: 'sync', stream: false, input_tokens: 4, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0, input_cost: 0, output_cost: 0, cache_creation_cost: 0, cache_read_cost: 0, total_cost: 0, actual_cost: 0, account_stats_cost: 0, rate_multiplier: 0, account_rate_multiplier: 0, duration_ms: 10, first_token_ms: 0, created_at: '2026-11-06T00:00:00Z', request_id: 'synthetic-request', ip_address: '', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll<HTMLButtonElement>('button').find(node => node.text() === label); expect(found, label).toBeDefined(); return found! }
async function click(button: { element: HTMLButtonElement }) { button.element.click(); await flushPromises() }
function filter(view: VueWrapper, label: string) { const item = view.findAll('label').find(node => node.text() === label); expect(item, label).toBeDefined(); return new DOMWrapper(item!.element.parentElement!).get('button[aria-haspopup="true"]') }
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const option = Array.from(document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
async function render() {
  const view = mount(UsageView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, teleport: true, transition: true,
    TokenUsageTrend: true, GroupDistributionChart: true, EndpointDistributionChart: true,
    ModelDistributionChart: { props: ['modelStats', 'upstreamModelStats', 'mappingModelStats'], emits: ['update:source'], template: '<section data-test="model-distribution"><button @click="$emit(\'update:source\', \'requested\')">Requested source</button><button @click="$emit(\'update:source\', \'upstream\')">Upstream source</button><button @click="$emit(\'update:source\', \'mapping\')">Mapping source</button><output data-test="requested">{{ JSON.stringify(modelStats) }}</output><output data-test="upstream">{{ JSON.stringify(upstreamModelStats) }}</output><output data-test="mapping">{{ JSON.stringify(mappingModelStats) }}</output></section>' },
    UserTokenRanking: true, UsageCleanupDialog: true, UserBalanceHistoryModal: true, OpsErrorLogTable: true, OpsErrorDetailModal: true,
  } } })
  mounted.push(view); await flushPromises(); await vi.advanceTimersByTimeAsync(121); await flushPromises(); return view
}
const lists = () => wires.filter(wire => wire.path === '/admin/usage' && wire.params.exact_total !== true)
const exports = () => wires.filter(wire => wire.path === '/admin/usage' && wire.params.exact_total === true)
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-admin-usage-release', user: { id: 7, role: 'admin' } })
  Object.keys(mocks.routeQuery).forEach(key => delete mocks.routeQuery[key]); mocks.error.mockReset(); mocks.success.mockReset(); mocks.save.mockReset(); mocks.sheet.mockClear(); mocks.append.mockReset(); mocks.write.mockClear(); externalFetch.mockClear()
  wires = []; total = 75; exportRows = [usage()]; exportMode = 'ok'; releaseExport = undefined; failSource = ''; unexpected = []
  vi.useFakeTimers(); vi.stubGlobal('fetch', externalFetch); vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { path: String(config.url), params: { ...config.params }, signal: config.signal }; wires.push(wire)
    if (config.method !== 'get') { unexpected.push(`${config.method} ${wire.path}`); throw new Error('Unexpected usage write') }
    let data: unknown
    if (wire.path === '/admin/usage') {
      if (wire.params.exact_total === true) {
        if (exportMode === 'error') throw new AxiosError('Synthetic export failure', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 503, statusText: 'Synthetic failure', headers: {}, data: { code: 503, message: 'Synthetic export failure' } })
        if (exportMode === 'pending') await new Promise<void>(resolve => { releaseExport = resolve })
        data = { items: exportRows, total: exportRows.length, page: wire.params.page, page_size: wire.params.page_size, pages: exportRows.length ? 1 : 0 }
      } else data = { items: [usage()], total, page: wire.params.page, page_size: wire.params.page_size, pages: Math.ceil(total / Number(wire.params.page_size)) }
    } else if (wire.path === '/admin/usage/stats') data = { total_requests: 1, total_tokens: 6, total_input_tokens: 4, total_output_tokens: 2, total_cache_tokens: 0, total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_cost: 0, total_actual_cost: 0, total_account_cost: 0, average_duration_ms: 10, endpoints: [], upstream_endpoints: [], endpoint_paths: [] }
    else if (wire.path === '/admin/dashboard/models') {
      if (wire.params.model_source === failSource) { failSource = ''; throw new Error('Synthetic model statistics unavailable') }
      data = { models: [{ model: `synthetic-${String(wire.params.model_source)}`, requests: 1, total_tokens: 6, actual_cost: 0 }] }
    } else if (wire.path === '/admin/dashboard/snapshot-v2') data = { trend: [], groups: [], models: [] }
    else if (wire.path === '/admin/groups') data = { items: [{ id: 11, name: 'Synthetic filter group', platform: 'openai' }], total: 1, page: 1, page_size: 1000 }
    else if (wire.path === '/admin/users/17?include_deleted=true') data = { id: 17, email: 'synthetic-usage@example.invalid' }
    else if (wire.path === '/admin/usage/search-api-keys') data = [{ id: 51, name: 'Synthetic filter key', user_id: 17 }]
    else { unexpected.push(wire.path); throw new Error(`Unexpected synthetic usage request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; expect(unexpected).toEqual([]); expect(externalFetch).not.toHaveBeenCalled() })

describe('Admin usage native filters and actual Axios contracts beyond existing lifecycle tests', () => {
  it('accepts the first nonempty URL array value for user and dates and uses hourly granularity for a one-day range', async () => {
    Object.assign(mocks.routeQuery, { user_id: [null, '', '17'], start_date: ['', '2026-11-05'], end_date: [null, '2026-11-06'] })
    const view = await render(); expect(lists().at(-1)?.params).toMatchObject({ user_id: 17, start_date: '2026-11-05', end_date: '2026-11-06', exact_total: false })
    expect(wires.find(wire => wire.path === '/admin/dashboard/snapshot-v2')?.params.granularity).toBe('hour'); expect(view.get<HTMLInputElement>('input[placeholder="admin.usage.searchUserPlaceholder"]').element.value).toBe('synthetic-usage@example.invalid')
  })

  it.each(['invalid-user', 'Infinity'])('ignores a non-finite URL user value %s and does not look up or send that identity', async value => {
    mocks.routeQuery.user_id = value; await render(); expect(lists().at(-1)?.params.user_id).toBeUndefined(); expect(wires.some(wire => wire.path.startsWith('/admin/users/'))).toBe(false)
  })

  it.each([{ type: 'live', label: 'usage.live', stream: undefined }, { type: 'cyber', label: 'usage.cyber', stream: undefined }, { type: 'ws_v2', label: 'usage.ws', stream: true }])('sends the distinct $type request type and its compatible stream dimension from the real Select', async ({ type, label, stream }) => {
    const view = await render(); await choose(filter(view, 'usage.type'), label)
    expect(lists().at(-1)?.params).toMatchObject({ request_type: type, stream }); expect(wires.filter(wire => wire.path === '/admin/dashboard/models').at(-1)?.params).toMatchObject({ request_type: type, stream })
    await click(button(view, 'common.reset')); expect(lists().at(-1)?.params.request_type).toBeUndefined()
  })

  it('preserves billing_type=0 and a selected API key across list and model wire requests instead of dropping falsy valid values', async () => {
    const view = await render(); await choose(filter(view, 'admin.usage.billingType'), 'admin.usage.billingTypeBalance')
    const keyInput = view.get('input[placeholder="admin.usage.searchApiKeyPlaceholder"]'); await keyInput.trigger('focus'); await vi.advanceTimersByTimeAsync(301); await flushPromises()
    const key = view.findAll('button').find(node => node.text().includes('Synthetic filter key') && node.text().includes('#51'))!; expect(key).toBeDefined(); await click(key)
    expect(lists().at(-1)?.params).toMatchObject({ api_key_id: 51, billing_type: 0 }); expect(wires.filter(wire => wire.path === '/admin/dashboard/models').at(-1)?.params).toMatchObject({ api_key_id: 51, billing_type: 0 })
    await click(view.get<HTMLButtonElement>('[aria-label="Clear API key filter"]')); expect(lists().at(-1)?.params.api_key_id).toBeUndefined()
  })

  it('applies native model sorting, page and page-size changes using exact_total=false list queries', async () => {
    const view = await render(); const model = view.findAll('th').find(node => node.text() === 'usage.model')!; await model.trigger('click'); await flushPromises()
    expect(lists().at(-1)?.params).toMatchObject({ page: 1, sort_by: 'model', sort_order: 'asc', exact_total: false })
    await click(view.get<HTMLButtonElement>('[aria-label="pagination.next"]')); expect(lists().at(-1)?.params.page).toBe(2)
    const pageSize = view.get('.page-size-select button[aria-haspopup="true"]'); await choose(pageSize, '50'); expect(lists().at(-1)?.params).toMatchObject({ page: 1, page_size: 50, sort_by: 'model', sort_order: 'asc' })
  })

  it.each([{ source: 'upstream', action: 'Upstream source' }, { source: 'mapping', action: 'Mapping source' }])('loads $source model statistics through the public chart event and caches that source until explicit refresh', async ({ source, action }) => {
    const view = await render(); await click(button(view, action)); expect(view.get(`[data-test="${source}"]`).text()).toContain(`synthetic-${source}`)
    const count = wires.filter(wire => wire.path === '/admin/dashboard/models' && wire.params.model_source === source).length
    await click(button(view, 'Requested source')); await click(button(view, action)); expect(wires.filter(wire => wire.path === '/admin/dashboard/models' && wire.params.model_source === source)).toHaveLength(count)
    await click(button(view, 'common.refresh')); expect(wires.filter(wire => wire.path === '/admin/dashboard/models' && wire.params.model_source === source)).toHaveLength(count + 1)
  })

  it('shows an empty failed source without erasing the other model source and recovers it on explicit refresh', async () => {
    const view = await render(); failSource = 'upstream'; await click(button(view, 'Upstream source'))
    expect(view.get('[data-test="upstream"]').text()).toBe('[]'); expect(view.get('[data-test="requested"]').text()).toContain('synthetic-requested')
    await click(button(view, 'common.refresh')); expect(view.get('[data-test="upstream"]').text()).toContain('synthetic-upstream')
  })

  it('exports an empty exact-total result as headers only without creating imaginary data rows', async () => {
    exportRows = []; const view = await render(); await click(button(view, 'usage.exportExcel'))
    expect(exports()).toHaveLength(1); expect(exports()[0].params).toMatchObject({ page: 1, page_size: 100, exact_total: true }); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.success).toHaveBeenCalledWith('usage.exportSuccess')
  })

  it.each([{ type: 'cyber', label: 'usage.cyber' }, { type: 'live', label: 'usage.live' }, { type: 'ws_v2', label: 'usage.ws' }])('exports the explicit $type label with zero billing and zero first-token latency preserved', async ({ type, label }) => {
    exportRows = [usage({ request_type: type })]; const view = await render(); await click(button(view, 'usage.exportExcel'))
    const headers = mocks.sheet.mock.calls[0][0][0] as string[]; const exported = mocks.append.mock.calls[0][1][0] as unknown[]
    expect(exported[headers.indexOf('usage.type')]).toBe(label); expect(exported[headers.indexOf('usage.firstToken')]).toBe(0); expect(exported[headers.indexOf('usage.userBilled')]).toBe('0.000000'); expect(exported[headers.indexOf('usage.accountBilled')]).toBe('0.000000'); expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('cancels a native export progress dialog and discards a late exact-total response without another read or file', async () => {
    exportMode = 'pending'; const view = await render(); await click(button(view, 'usage.exportExcel')); expect(exports()).toHaveLength(1)
    const dialog = new DOMWrapper(document.body).get('[role="dialog"]'); await click(button(dialog, 'usage.cancelExport')); expect(exports()[0].signal?.aborted).toBe(true)
    releaseExport!(); await flushPromises(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.error).not.toHaveBeenCalled(); expect(exports()).toHaveLength(1)
  })

  it('shows an exact-total HTTP error and allows a later explicit export without claiming a partially generated file', async () => {
    exportMode = 'error'; const view = await render(); await click(button(view, 'usage.exportExcel')); expect(mocks.error).toHaveBeenCalledWith('Export Failed'); expect(mocks.save).not.toHaveBeenCalled()
    exportMode = 'ok'; await click(button(view, 'usage.exportExcel')); expect(exports()).toHaveLength(2); expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.success).toHaveBeenCalledWith('usage.exportSuccess')
  })
})
