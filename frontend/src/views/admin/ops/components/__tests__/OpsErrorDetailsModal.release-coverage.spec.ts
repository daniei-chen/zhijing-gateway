import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Modal from '../OpsErrorDetailsModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { OpsErrorLog } from '@/api/admin/ops'

// Preserve the real dialog, table, Select portals, API functions and Axios interceptors.
// Only translation and the HTTP transport are synthetic; no operations server is contacted.
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => values && Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

enableAutoUnmount(afterEach)
const originalAdapter = apiClient.defaults.adapter
const wire: Array<{ path: string; params: Record<string, unknown> }> = []
const fixture = (patch: Partial<OpsErrorLog> = {}): OpsErrorLog => ({
  id: 81, created_at: '2030-01-02T03:04:05Z', phase: 'request', type: 'invalid_request',
  error_owner: 'client', error_source: 'client_request', severity: 'P2', status_code: 400,
  platform: 'openai', model: 'synthetic-model', resolved: false, client_request_id: '',
  request_id: 'synthetic-request-81', message: 'Synthetic request rejected', user_email: '',
  account_name: '', group_name: '', ...patch,
})
let result: { items?: OpsErrorLog[]; total?: number }
let refuse: boolean
let hold: Promise<void> | null
const body = () => new DOMWrapper(document.body)
const lastQuery = () => wire[wire.length - 1].params
const search = () => body().get<HTMLInputElement>('input[placeholder="admin.ops.errorDetails.searchPlaceholder"]')
const reset = () => body().findAll('button').find(button => button.text() === 'common.reset')!
async function settle(ms = 0) { if (ms) await vi.advanceTimersByTimeAsync(ms); await flushPromises() }
async function choose(index: number, label: string) {
  const trigger = body().findAll('.compact-select .select-trigger')[index]
  const portalId = trigger.attributes('aria-controls')
  await trigger.trigger('click')
  await settle()
  const option = body().get(`[id="${portalId}"]`).findAll('[role="option"]').find(item => item.text() === label)
  expect(option, `visible option ${label}`).toBeDefined()
  await option!.trigger('click')
  await settle()
}
async function open(props: Partial<InstanceType<typeof Modal>['$props']> = {}) {
  const view = mount(Modal, { attachTo: document.body, props: { show: false, timeRange: '1h', errorType: 'request', ...props }, global: { stubs: { transition: true } } })
  await settle()
  await view.setProps({ show: true })
  await settle()
  return view
}
function cell(id: number, header: string) {
  const index = body().findAll('th').findIndex(item => item.text() === header)
  expect(index, header).toBeGreaterThanOrEqual(0)
  return body().get(`tr[data-row-id="${id}"]`).findAll('td')[index]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-list-admin', user: { id: 7, role: 'admin' } })
  wire.length = 0; result = { items: [fixture()], total: 41 }; refuse = false; hold = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const path = new URL(apiClient.getUri(config), 'https://synthetic.invalid').pathname
    if (config.method !== 'get' || !/^\/api\/v1\/admin\/ops\/(request-errors|upstream-errors)$/.test(path)) throw new Error(`Unexpected synthetic error-list request ${config.method} ${path}`)
    wire.push({ path, params: { ...config.params } })
    const capturedResult = structuredClone(result), capturedRefusal = refuse
    if (hold) await hold
    const response = { config, status: capturedRefusal ? 503 : 200, statusText: 'Synthetic operations list', headers: {}, data: capturedRefusal ? { code: 503, message: 'Synthetic list unavailable' } : { code: 0, data: capturedResult } }
    if (capturedRefusal) throw new AxiosError('Synthetic list unavailable', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()
  document.body.innerHTML = ''; document.body.classList.remove('modal-open')
})

describe('native plural operations error-list dialog over the actual API', () => {
  it('waits for opening, requests the original list contract and renders summary-first columns', async () => {
    const view = mount(Modal, { attachTo: document.body, props: { show: false, timeRange: '1h', errorType: 'request' }, global: { stubs: { transition: true } } })
    await settle(); expect(wire).toHaveLength(0); expect(body().find('[role="dialog"]').exists()).toBe(false)
    await view.setProps({ show: true }); await settle()
    expect(wire).toHaveLength(1)
    expect(wire[0]).toEqual({ path: '/api/v1/admin/ops/request-errors', params: { page: 1, page_size: 10, view: 'errors', sort_by: 'created_at', sort_order: 'desc', time_range: '1h', timezone: expect.any(String) } })
    expect(body().get('[role="dialog"]').text()).toContain('admin.ops.errorDetails.requestErrors')
    expect(body().text()).toContain('admin.ops.errorDetails.total 41')
    expect(body().findAll('th').slice(0, 2).map(header => header.text())).toEqual(['admin.ops.errorLog.time', 'admin.ops.errorLog.message'])
    expect(body().get('tbody').text()).toContain('Synthetic request rejected')
  })

  it('routes upstream lists separately with normalized platform, group and upstream phase', async () => {
    await open({ errorType: 'upstream', platform: ' anthropic ', groupId: 16 })
    expect(wire.every(request => request.path === '/api/v1/admin/ops/upstream-errors')).toBe(true)
    expect(lastQuery()).toMatchObject({ platform: 'anthropic', group_id: 16, phase: 'upstream', time_range: '1h' })
    expect(body().get('[role="dialog"]').text()).toContain('admin.ops.errorDetails.upstreamErrors')
    expect(body().findAll('.compact-select .select-trigger')[1].text()).toBe('admin.ops.errorDetails.phase.upstream')
  })

  it('uses explicit custom timestamps without time_range and reloads changed parent context', async () => {
    const view = await open({ timeRange: 'custom', customStartTime: '2030-01-01T00:00:00Z', customEndTime: '2030-01-02T00:00:00Z' })
    expect(lastQuery()).toMatchObject({ start_time: '2030-01-01T00:00:00Z', end_time: '2030-01-02T00:00:00Z' })
    expect(lastQuery()).not.toHaveProperty('time_range')
    await view.setProps({ customEndTime: '2030-01-03T00:00:00Z', platform: 'openai', groupId: 27 }); await settle()
    expect(lastQuery()).toMatchObject({ start_time: '2030-01-01T00:00:00Z', end_time: '2030-01-03T00:00:00Z', platform: 'openai', group_id: 27, page: 1 })
  })

  it.each([[null, '2030-01-02T00:00:00Z'], ['2030-01-01T00:00:00Z', null], [null, null]])('falls back to one hour for an incomplete custom range (%s, %s)', async (customStartTime, customEndTime) => {
    await open({ timeRange: 'custom', customStartTime, customEndTime })
    expect(lastQuery().time_range).toBe('1h'); expect(lastQuery()).not.toHaveProperty('start_time'); expect(lastQuery()).not.toHaveProperty('end_time')
  })

  it('combines visible status, phase, owner and excluded-view filters in the request', async () => {
    await open()
    await choose(0, '503'); await choose(1, 'admin.ops.errorDetails.phase.routing'); await choose(2, 'admin.ops.errorDetails.owner.platform'); await choose(3, 'admin.ops.errorDetails.viewExcluded')
    expect(lastQuery()).toMatchObject({ status_codes: '503', phase: 'routing', error_owner: 'platform', view: 'excluded', page: 1 })
    expect(lastQuery()).not.toHaveProperty('status_codes_other')
    await choose(3, 'common.all'); expect(lastQuery().view).toBe('all')
  })

  it('distinguishes other HTTP statuses from a numeric filter and clears it with All', async () => {
    await open(); await choose(0, 'admin.ops.errorDetails.statusCodeOther')
    expect(lastQuery().status_codes_other).toBe('1'); expect(lastQuery()).not.toHaveProperty('status_codes')
    await choose(0, '429'); expect(lastQuery().status_codes).toBe('429'); expect(lastQuery()).not.toHaveProperty('status_codes_other')
    await choose(0, 'common.all'); expect(lastQuery()).not.toHaveProperty('status_codes'); expect(lastQuery()).not.toHaveProperty('status_codes_other')
  })

  it('debounces a replacement search, trims its wire value and omits blank search', async () => {
    await open(); wire.length = 0
    await search().setValue('old'); await settle(200); expect(wire).toHaveLength(0)
    await search().setValue('  synthetic request  '); await settle(349); expect(wire).toHaveLength(0)
    await settle(1); expect(wire).toHaveLength(1); expect(lastQuery().q).toBe('synthetic request')
    await search().setValue('   '); await settle(350); expect(lastQuery()).not.toHaveProperty('q')
  })

  it('resets all visible filters and the page, while retaining the chosen column sort', async () => {
    await open({ errorType: 'upstream' }); await choose(0, '502'); await choose(1, 'admin.ops.errorDetails.phase.network'); await choose(2, 'admin.ops.errorDetails.owner.provider'); await choose(3, 'common.all')
    await search().setValue('synthetic'); await settle(350)
    await body().get('button[aria-label="pagination.next"]').trigger('click'); await settle(); expect(lastQuery().page).toBe(2)
    await body().findAll('th button').find(button => button.text() === 'admin.ops.errorLog.model')!.trigger('click'); await settle()
    await reset().trigger('click'); await settle(350)
    expect(search().element.value).toBe('')
    expect(lastQuery()).toMatchObject({ page: 1, view: 'errors', phase: 'upstream', sort_by: 'model', sort_order: 'asc' })
    for (const key of ['q', 'status_codes', 'status_codes_other', 'error_owner']) expect(lastQuery()).not.toHaveProperty(key)
  })

  it('uses table heading clicks for server-side status sorting and returns to page one', async () => {
    await open(); await body().get('button[aria-label="pagination.next"]').trigger('click'); await settle()
    const header = () => body().findAll('th').find(item => item.text() === 'admin.ops.errorLog.status')!
    await header().get('button').trigger('click'); await settle()
    expect(lastQuery()).toMatchObject({ page: 1, sort_by: 'status_code', sort_order: 'asc' }); expect(header().attributes('aria-sort')).toBe('ascending')
    await header().get('button').trigger('click'); await settle()
    expect(lastQuery()).toMatchObject({ page: 1, sort_by: 'status_code', sort_order: 'desc' }); expect(header().attributes('aria-sort')).toBe('descending')
  })

  it('paginates and changes page size through the real pagination Select', async () => {
    await open(); await body().get('button[aria-label="pagination.next"]').trigger('click'); await settle()
    expect(lastQuery()).toMatchObject({ page: 2, page_size: 10 })
    await body().get('.page-size-select .select-trigger').trigger('click'); await settle()
    await body().findAll('[role="option"]').find(option => option.text() === '20')!.trigger('click'); await settle()
    expect(lastQuery()).toMatchObject({ page: 2, page_size: 20 })
    expect(body().get('button[aria-current="page"]').text()).toBe('2')
  })

  it('reloads parent scope at page one and sends no reads while hidden', async () => {
    const view = await open({ platform: '   ', groupId: 0 }); expect(lastQuery()).not.toHaveProperty('platform'); expect(lastQuery()).not.toHaveProperty('group_id')
    await body().get('button[aria-label="pagination.next"]').trigger('click'); await settle()
    await view.setProps({ timeRange: '24h', platform: ' gemini ', groupId: 4 }); await settle()
    expect(lastQuery()).toMatchObject({ page: 1, time_range: '24h', platform: 'gemini', group_id: 4 })
    await view.setProps({ show: false }); await settle(); const count = wire.length
    await view.setProps({ timeRange: '5m', groupId: -5 }); await settle(400)
    expect(wire).toHaveLength(count); expect(body().find('[role="dialog"]').exists()).toBe(false)
  })

  it('preserves the visible list and filters when returning from detail with resumeState', async () => {
    const view = await open(); await search().setValue('retained'); await settle(350)
    await choose(0, '422'); await body().get('button[aria-label="pagination.next"]').trigger('click'); await settle()
    await view.setProps({ show: false }); await settle(); const count = wire.length
    await view.setProps({ show: true, resumeState: true }); await settle()
    expect(wire).toHaveLength(count); expect(search().element.value).toBe('retained'); expect(body().get('button[aria-current="page"]').text()).toBe('2')
    expect(body().findAll('.compact-select .select-trigger')[0].text()).toBe('422')
    await view.setProps({ timeRange: '6h' }); await settle(); expect(lastQuery()).toMatchObject({ page: 1, q: 'retained', status_codes: '422', time_range: '6h' })
  })

  it('resets filters and the page-size selection on an ordinary close and reopen', async () => {
    const view = await open(); await search().setValue('discarded'); await settle(350); await choose(2, 'admin.ops.errorDetails.owner.client')
    await body().get('.page-size-select .select-trigger').trigger('click'); await settle(); await body().findAll('[role="option"]').find(option => option.text() === '50')!.trigger('click'); await settle()
    await view.setProps({ show: false }); await settle(); await view.setProps({ show: true }); await settle(350)
    expect(search().element.value).toBe(''); expect(lastQuery()).toMatchObject({ page: 1, page_size: 10, view: 'errors' }); expect(lastQuery()).not.toHaveProperty('q'); expect(lastQuery()).not.toHaveProperty('error_owner')
  })

  it('shows a loading skeleton until the real API response settles and tolerates omitted list fields', async () => {
    let release!: () => void
    hold = new Promise<void>(resolve => { release = resolve }); result = {}
    await open(); expect(body().get('.z-data-table').attributes('aria-busy')).toBe('true'); expect(body().findAll('tbody tr[aria-hidden="true"]').length).toBeGreaterThan(0)
    release(); await settle()
    expect(body().get('.z-data-table').attributes('aria-busy')).toBe('false'); expect(body().text()).toContain('admin.ops.errorDetails.total 0'); expect(body().text()).toContain('common.noData'); expect(body().find('[aria-label="Pagination"]').exists()).toBe(false)
  })

  it('clears old rows after a refused read and recovers through the normal Reset control', async () => {
    await open(); refuse = true; await choose(0, '500')
    expect(body().find('tr[data-row-id="81"]').exists()).toBe(false); expect(body().text()).toContain('admin.ops.errorDetails.total 0'); expect(body().text()).toContain('common.noData')
    expect(console.error).toHaveBeenCalledWith('[OpsErrorDetailsModal] Failed to fetch error logs', expect.objectContaining({ status: 503 }))
    refuse = false; result = { items: [fixture({ id: 82, message: 'Synthetic recovered list' })], total: 1 }
    await reset().trigger('click'); await settle()
    expect(body().text()).toContain('Synthetic recovered list'); expect(body().text()).toContain('admin.ops.errorDetails.total 1'); expect(lastQuery()).not.toHaveProperty('status_codes')
  })

  it('emits close from the native dialog button and Escape without inventing requests', async () => {
    const view = await open(); const count = wire.length
    await body().get('button[aria-label="Close modal"]').trigger('click'); expect(view.emitted('update:show')).toEqual([[false]])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
    expect(view.emitted('update:show')).toEqual([[false], [false]]); expect(wire).toHaveLength(count)
  })

  it('renders sparse row fallbacks and opens the selected row through its public event', async () => {
    result = { items: [fixture({ created_at: 'invalid', phase: 'internal', error_owner: 'platform', message: '', platform: '', model: '', severity: 'P3', request_id: '', client_request_id: 'synthetic-client-only' })], total: 1 }
    const view = await open()
    for (const key of ['model', 'platform', 'group', 'user', 'apiKey', 'account', 'message']) expect(cell(81, `admin.ops.errorLog.${key}`).text()).toBe('-')
    expect(cell(81, 'admin.ops.errorLog.time').get('[title]').attributes('title')).toBe('synthetic-client-only')
    await body().get('tr[data-row-id="81"]').trigger('click'); expect(view.emitted('openErrorDetail')).toEqual([[81]])
  })

  it('opens the details action once without bubbling another row-click event', async () => {
    const view = await open(); await body().get('button[title="admin.ops.errorLog.details"]').trigger('click')
    expect(view.emitted('openErrorDetail')).toEqual([[81]]); expect(wire).toHaveLength(1)
  })

  it('renders request attribution, mapped models, retained key names and HTTP status colors from wire rows', async () => {
    result = { items: [
      fixture({ id: 81, status_code: 200, phase: 'auth', error_owner: 'client', request_type: 1, requested_model: 'client-model', upstream_model: 'provider-model', user_id: 9, user_email: 'member@example.test', api_key_id: 11, api_key_name: 'Synthetic deleted key', api_key_deleted: true, account_id: 12, group_id: 13, inbound_endpoint: ' /v1/chat/completions ', upstream_endpoint: ' /v1/responses ' }),
      fixture({ id: 82, status_code: 400, phase: 'routing', error_owner: 'platform', request_type: 2, requested_model: 'same-model', upstream_model: 'same-model', group_id: 17, group_name: 'Synthetic group' }),
      fixture({ id: 83, status_code: 429, phase: 'upstream', error_owner: 'provider', request_type: 3, requested_model: '', upstream_model: 'upstream-only', account_id: 24, account_name: 'Synthetic account', api_key_id: 26 }),
      fixture({ id: 84, status_code: 503, phase: 'account_auth', error_owner: 'platform', requested_model: 'requested-only', upstream_model: '', user_id: 31, severity: 'P0' }),
    ], total: 4 }
    await open()
    for (const [id, color] of [[81, 'gray'], [82, 'amber'], [83, 'purple'], [84, 'red']] as const) expect(cell(id, 'admin.ops.errorLog.status').get('span').classes().join(' ')).toContain(`bg-${color}-100`)
    expect(cell(81, 'admin.ops.errorLog.model').text()).toContain('client-model'); expect(cell(81, 'admin.ops.errorLog.model').text()).toContain('provider-model')
    expect(cell(82, 'admin.ops.errorLog.model').text()).toBe('same-model'); expect(cell(83, 'admin.ops.errorLog.model').text()).toBe('upstream-only'); expect(cell(84, 'admin.ops.errorLog.model').text()).toBe('requested-only')
    expect(cell(81, 'admin.ops.errorLog.apiKey').text()).toContain('Synthetic deleted key'); expect(cell(81, 'admin.ops.errorLog.apiKey').text()).toContain('admin.ops.errorLog.keyDeletedBadge'); expect(cell(83, 'admin.ops.errorLog.apiKey').text()).toBe('#26')
    expect(cell(81, 'admin.ops.errorLog.user').text()).toContain('member@example.test'); expect(cell(84, 'admin.ops.errorLog.user').text()).toContain('#31'); expect(cell(81, 'admin.ops.errorLog.account').text()).toBe('#12'); expect(cell(83, 'admin.ops.errorLog.account').text()).toBe('Synthetic account')
    expect(cell(81, 'admin.ops.errorLog.endpoint').text()).toContain('/v1/chat/completions'); expect(cell(81, 'admin.ops.errorLog.endpoint').text()).toContain('/v1/responses'); expect(cell(82, 'admin.ops.errorLog.group').text()).toBe('Synthetic group')
    expect(cell(81, 'admin.ops.errorLog.type').text()).toContain('admin.ops.errorLog.typeAuth'); expect(cell(82, 'admin.ops.errorLog.type').text()).toContain('admin.ops.errorLog.typeRouting'); expect(cell(83, 'admin.ops.errorLog.type').text()).toContain('admin.ops.errorLog.typeUpstream'); expect(cell(84, 'admin.ops.errorLog.type').text()).toContain('admin.ops.errorLog.typeAccountAuth')
    expect(cell(81, 'admin.ops.errorLog.status').text()).toContain('admin.ops.errorLog.requestTypeSync'); expect(cell(82, 'admin.ops.errorLog.status').text()).toContain('admin.ops.errorLog.requestTypeStream'); expect(cell(83, 'admin.ops.errorLog.status').text()).toContain('admin.ops.errorLog.requestTypeWs')
  })
})
