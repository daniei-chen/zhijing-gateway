import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { InternalAxiosRequestConfig } from 'axios'
import AuditLogView from '../AuditLogView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: { audit: await vi.importActual('@/api/admin/audit') } }))
vi.mock('@/api', async () => ({ totpAPI: await vi.importActual('@/api/totp') }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))
interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const adapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let logs: Record<string, unknown>[]
let detail: Record<string, unknown>
let total: number
let enabled: boolean
let fail: string
let unexpected: string[]
const entry = (patch: Record<string, unknown> = {}) => ({ id: 41, created_at: '2026-11-06T00:00:00Z', actor_user_id: 7, actor_email: 'synthetic-admin@example.invalid', actor_role: 'admin', auth_method: 'jwt', credential_masked: '***synthetic', action: 'groups.update', method: 'PUT', path: '/api/v1/admin/groups/11', request_id: 'synthetic-audit-request', client_ip: '192.0.2.15', user_agent: 'Synthetic browser', request_body: '{"name":"Synthetic group"}', status_code: 200, latency_ms: 12, extra: { target_id: 11 }, ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll('button').find(node => node.text() === label); expect(found, label).toBeDefined(); return found! }
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const options = document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')
  const option = Array.from(options).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
async function render() {
  const view = mount(AuditLogView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' }, teleport: true, transition: true } } })
  mounted.push(view); await flushPromises(); return view
}
const lastList = () => wires.filter(wire => wire.path === '/admin/audit-logs').at(-1)!
const writes = () => wires.filter(wire => wire.method !== 'get')
async function openTotp(view: VueWrapper) {
  await button(view, 'admin.audit.clearAll').trigger('click'); await flushPromises()
  await button(view.get('[role="dialog"]'), 'admin.audit.clearAll').trigger('click'); await flushPromises()
  return view.get('[role="dialog"]')
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-audit-release', user: { id: 7, role: 'admin' } })
  wires = []; logs = [entry()]; detail = entry(); total = 1; enabled = true; fail = ''; unexpected = []
  feedback.error.mockReset(); feedback.success.mockReset()
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }
    wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new Error('Synthetic audit service failure') }
    let data: unknown
    if (wire.path === '/admin/audit-logs' && wire.method === 'get') data = { items: logs, total, page: wire.params.page, page_size: wire.params.page_size, pages: Math.ceil(total / Number(wire.params.page_size)) }
    else if (wire.path === '/admin/audit-logs/41' && wire.method === 'get') data = detail
    else if (wire.path === '/user/totp/status' && wire.method === 'get') data = { enabled, feature_enabled: true }
    else if (wire.path === '/admin/audit-logs/clear' && wire.method === 'post') data = { deleted: 3 }
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic audit request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = adapter; vi.restoreAllMocks(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Audit log browsing and explicit authenticated clearing at the transport boundary', () => {
  it.each([
    { status: 200, auth: 'jwt', label: 'JWT', tone: 'green', result: 'resultSuccess' },
    { status: 404, auth: 'admin_api_key', label: 'Admin API Key', tone: 'amber', result: 'resultFailure' },
    { status: 503, auth: 'mcp_oauth', label: 'MCP OAuth', tone: 'red', result: 'resultFailure' },
  ])('renders a $status audit result and $auth credential label consistently in the row and detail', async ({ status, auth, label, tone, result }) => {
    logs = [entry({ status_code: status, auth_method: auth })]; detail = logs[0]
    const view = await render(); const row = view.get('tbody tr')
    expect(row.text()).toContain(label); expect(row.get(`.bg-${tone}-100`).text()).toBe(String(status)); expect(row.find(`.bg-${tone}-500`).exists()).toBe(true)
    await button(row, 'admin.audit.columns.detail').trigger('click'); await flushPromises()
    const dialog = view.get('[role="dialog"]'); expect(dialog.text()).toContain(`admin.audit.filters.${result}`)
    expect(dialog.text()).toContain('***synthetic'); expect(dialog.text()).toContain('synthetic-audit-request')
    expect(dialog.findAll('pre').map(node => node.text())).toEqual(['{\n  "name": "Synthetic group"\n}', '{\n  "target_id": 11\n}'])
    expect(writes()).toEqual([])
  })

  it('preserves an unknown credential label and raw non-JSON request body while showing empty metadata fallbacks', async () => {
    detail = entry({ created_at: 'Legacy timestamp', actor_email: '', actor_role: '', auth_method: 'future_auth', credential_masked: '', request_id: '', client_ip: '', user_agent: '', request_body: 'Synthetic non-JSON body', extra: {} }); logs = [detail]
    const view = await render(); expect(view.get('tbody tr').text()).toContain('Legacy timestamp')
    await button(view, 'admin.audit.columns.detail').trigger('click'); await flushPromises()
    const dialog = view.get('[role="dialog"]'); expect(dialog.text()).toContain('future_auth'); expect(dialog.text()).toContain('—')
    expect(dialog.findAll('pre').map(node => node.text())).toEqual(['Synthetic non-JSON body'])
    expect(dialog.text()).not.toContain('synthetic-audit-request')
  })

  it('omits absent request and extra panels, and displays an anonymous actor without inventing a credential', async () => {
    detail = entry({ actor_email: '', auth_method: '', request_body: '', extra: null }); logs = [detail]
    const view = await render(); expect(view.get('tbody tr').text()).toContain('—')
    await button(view, 'admin.audit.columns.detail').trigger('click'); await flushPromises()
    expect(view.get('[role="dialog"]').findAll('pre')).toEqual([])
  })

  it('submits trimmed text and literal method/auth/result filters, then resets all optional query values', async () => {
    const view = await render(); const fields = view.findAll('input[type="text"]')
    for (const [index, text] of ['  operation needle  ', ' admin@example.invalid ', ' accounts.update ', ' 192.0.2.20 '].entries()) await fields[index].setValue(text)
    const selects = view.findAll('button[aria-haspopup="true"]')
    await choose(selects[0], 'PATCH'); await choose(selects[1], 'MCP OAuth'); await choose(selects[2], 'admin.audit.filters.resultFailure')
    await fields[0].trigger('keyup', { key: 'Enter' }); await flushPromises()
    expect(lastList().params).toMatchObject({ page: 1, page_size: 20, q: 'operation needle', actor_email: 'admin@example.invalid', action: 'accounts.update', client_ip: '192.0.2.20', method: 'PATCH', auth_method: 'mcp_oauth', success: 'false' })
    await button(view, 'common.reset').trigger('click'); await flushPromises()
    expect(JSON.parse(JSON.stringify(lastList().params))).toEqual({ page: 1, page_size: 20, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    expect(fields.map(node => (node.element as HTMLInputElement).value)).toEqual(['', '', '', ''])
  })

  it.each([['30m', 30], ['1h', 60], ['6h', 360], ['24h', 1440], ['7d', 10080], ['30d', 43200]] as const)('uses the %s time window as an ISO start boundary without adding an end boundary', async (range, minutes) => {
    const now = Date.parse('2026-11-06T12:00:00Z'); vi.spyOn(Date, 'now').mockReturnValue(now)
    const view = await render(); await choose(view.findAll('button[aria-haspopup="true"]')[3], `admin.ops.timeRange.${range}`)
    expect(lastList().params.start_time).toBe(new Date(now - minutes * 60000).toISOString()); expect(lastList().params.end_time).toBeUndefined()
    expect(writes()).toEqual([])
  })

  it('keeps the active range on custom cancel, requires both endpoints, and uses the confirmed native local times', async () => {
    const view = await render(); const trigger = view.findAll('button[aria-haspopup="true"]')[3]
    await choose(trigger, 'admin.ops.timeRange.1h'); const prior = lastList(); const before = wires.length
    await choose(trigger, 'admin.ops.timeRange.custom'); let dialog = view.get('[role="dialog"]')
    await button(dialog, 'common.cancel').trigger('click'); expect(wires).toHaveLength(before); expect(lastList()).toBe(prior)
    await choose(trigger, 'admin.ops.timeRange.custom'); dialog = view.get('[role="dialog"]')
    const fields = dialog.findAll('input[type="datetime-local"]'); await fields[0].setValue(''); expect(button(dialog, 'common.confirm').attributes('disabled')).toBeDefined()
    await fields[0].setValue('2030-01-02T03:04'); await fields[1].setValue('2030-01-03T05:06')
    await button(dialog, 'common.confirm').trigger('click'); await flushPromises()
    expect(lastList().params).toMatchObject({ start_time: new Date('2030-01-02T03:04').toISOString(), end_time: new Date('2030-01-03T05:06').toISOString() })
    expect(trigger.text()).toContain('01-02 03:04 ~ 01-03 05:06')
  })

  it('changes native pagination and page size, resetting page to one on a new search', async () => {
    total = 77; const view = await render()
    await view.get('[aria-label="pagination.next"]').trigger('click'); await flushPromises(); expect(lastList().params.page).toBe(2)
    await choose(view.findAll('button[aria-haspopup="true"]').at(-1)!, '50'); expect(lastList().params).toMatchObject({ page: 1, page_size: 50 })
    await view.get('[aria-label="pagination.next"]').trigger('click'); await flushPromises(); await button(view, 'common.search').trigger('click'); await flushPromises(); expect(lastList().params.page).toBe(1)
  })

  it('shows an empty table and a recoverable list/detail failure without posting a clear command', async () => {
    logs = []; total = 0; const view = await render(); expect(view.text()).toContain('admin.audit.empty'); expect(view.find('[aria-label="pagination.next"]').exists()).toBe(false)
    fail = 'get /admin/audit-logs'; await button(view, 'common.search').trigger('click'); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith('Network error. Please check your connection.')
    logs = [entry()]; total = 1; await button(view, 'common.search').trigger('click'); await flushPromises()
    fail = 'get /admin/audit-logs/41'; await button(view, 'admin.audit.columns.detail').trigger('click'); await flushPromises(); expect(view.find('[role="dialog"]').exists()).toBe(false)
    await button(view, 'admin.audit.columns.detail').trigger('click'); await flushPromises(); expect(view.find('[role="dialog"]').exists()).toBe(true); expect(writes()).toEqual([])
  })

  it.each(['disabled', 'lookup-error'])('does not open a destructive prompt when TOTP status is %s', async state => {
    enabled = state !== 'disabled'; if (state === 'lookup-error') fail = 'get /user/totp/status'
    const view = await render(); await button(view, 'admin.audit.clearAll').trigger('click'); await flushPromises()
    expect(view.find('[role="dialog"]').exists()).toBe(false); expect(writes()).toEqual([])
    expect(feedback.error).toHaveBeenCalledWith(state === 'disabled' ? 'stepUp.notEnabled' : 'Network error. Please check your connection.')
  })

  it('requires confirmation and six digits, clears only on explicit TOTP submit, and refreshes the table after success', async () => {
    const view = await render(); await button(view, 'admin.audit.clearAll').trigger('click'); await flushPromises()
    await button(view.get('[role="dialog"]'), 'common.cancel').trigger('click'); expect(writes()).toEqual([])
    const dialog = await openTotp(view); const field = dialog.get('input[autocomplete="one-time-code"]')
    await field.setValue('123'); expect(button(dialog, 'admin.audit.clearAll').attributes('disabled')).toBeDefined()
    await field.trigger('keyup', { key: 'Enter' }); await flushPromises(); expect(writes()).toEqual([])
    await field.setValue('123456'); await button(dialog, 'admin.audit.clearAll').trigger('click'); await flushPromises()
    expect(writes()).toEqual([{ method: 'post', path: '/admin/audit-logs/clear', params: {}, body: { totp_code: '123456' } }])
    expect(feedback.success).toHaveBeenCalledWith('admin.audit.clearConfirm.success:{"count":3}'); expect(view.find('[role="dialog"]').exists()).toBe(false)
    expect(wires.at(-1)?.path).toBe('/admin/audit-logs')
  })

  it('erases the rejected TOTP code for an explicit corrected retry and permits cancellation before a write', async () => {
    const view = await render(); let dialog = await openTotp(view)
    await button(dialog, 'common.cancel').trigger('click'); expect(writes()).toEqual([])
    dialog = await openTotp(view); const field = dialog.get<HTMLInputElement>('input[autocomplete="one-time-code"]')
    await field.setValue('111111'); fail = 'post /admin/audit-logs/clear'; await button(dialog, 'admin.audit.clearAll').trigger('click'); await flushPromises()
    expect(field.element.value).toBe(''); expect(feedback.error).toHaveBeenCalledWith('Network error. Please check your connection.')
    await field.setValue('222222'); await field.trigger('keyup', { key: 'Enter' }); await flushPromises()
    expect(writes().map(wire => wire.body)).toEqual([{ totp_code: '111111' }, { totp_code: '222222' }])
  })
})
