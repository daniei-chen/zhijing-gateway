// All orders, credentials and responses below are synthetic; no payment provider is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { ref } from 'vue'
import AdminOrdersView from '@/views/admin/orders/AdminOrdersView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string) => key }) }))

interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const originalAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: Record<string, unknown>[]
let total: number
let detail: Record<string, unknown>
let refundReplies: Record<string, unknown>[]
let fail: string
let unexpected: string[]
const order = (patch: Record<string, unknown> = {}) => ({ id: 61, user_id: 17, user_email: 'synthetic-order@example.invalid', user_name: 'Synthetic buyer', amount: 10, pay_amount: 72.5, currency: 'CNY', fee_rate: 2.5, payment_type: 'alipay', out_trade_no: 'synthetic-order-number', status: 'COMPLETED', order_type: 'balance', created_at: '2026-11-06T00:00:00Z', expires_at: '2026-11-07T00:00:00Z', refund_amount: 0, ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll<HTMLButtonElement>('button').find(node => node.text() === label); expect(found, label).toBeDefined(); return found! }
async function click(button: { element: HTMLButtonElement }) { button.element.click(); await flushPromises() }
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const option = Array.from(document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
async function render() {
  const view = mount(AdminOrdersView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, teleport: true, transition: true } } })
  mounted.push(view); await flushPromises(); return view
}
const writes = () => wires.filter(wire => wire.method !== 'get')
const lastList = () => wires.filter(wire => wire.path === '/admin/payment/orders').at(-1)!
async function refund(view: VueWrapper, label = 'payment.admin.refund') {
  await click(button(view.get('tbody tr'), label)); return view.get('#refund-form')
}
async function submitRefund(view: VueWrapper, amount = '2.5') {
  const form = view.get('#refund-form'); await form.get('input[type="number"]').setValue(amount); await form.get('textarea').setValue('Synthetic operator refund reason')
  await click(view.get<HTMLButtonElement>('button[form="refund-form"]'))
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-orders-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [order()]; total = 1; detail = { order: order(), auditLogs: [] }; refundReplies = [{ success: true }]; fail = ''; unexpected = []
  Object.values(feedback).forEach(mock => mock.mockReset())
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }; wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new AxiosError('Synthetic order refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Synthetic refusal', headers: {}, data: { code: 400, message: 'Synthetic order refusal' } }) }
    let data: unknown
    if (wire.path === '/admin/payment/orders' && wire.method === 'get') data = { items: rows, total, page: wire.params.page, page_size: wire.params.page_size, pages: Math.ceil(total / Number(wire.params.page_size)) }
    else if (wire.path === '/admin/payment/orders/61' && wire.method === 'get') data = detail
    else if (['/admin/payment/orders/61/cancel', '/admin/payment/orders/61/retry'].includes(wire.path) && wire.method === 'post') data = { message: 'Synthetic order state accepted' }
    else if (['/admin/payment/orders/61/refund', '/admin/payment/orders/61/refund/query'].includes(wire.path) && wire.method === 'post') data = refundReplies.shift() ?? { success: true }
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic order request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Admin order state, detail and refund contracts through the real HTTP client', () => {
  it.each([
    { status: 'PENDING', action: 'payment.orders.cancel' },
    { status: 'FAILED', action: 'payment.admin.retry' },
    { status: 'REFUND_REQUESTED', action: 'payment.admin.approveRefund' },
    { status: 'REFUND_FAILED', action: 'payment.admin.retryRefund' },
    { status: 'REFUND_PENDING', action: 'payment.admin.queryRefundStatus' },
    { status: 'COMPLETED', action: 'payment.admin.refund' },
    { status: 'PARTIALLY_REFUNDED', action: 'payment.admin.refund' },
    { status: 'REFUNDED', action: null },
  ])('offers only the allowed $action state action for a $status order', async ({ status, action }) => {
    rows = [order({ status, refund_amount: status === 'REFUND_REQUESTED' ? 2.5 : 0 })]
    const view = await render(); const row = view.get('tbody tr')
    expect(row.findAll('button').map(node => node.text())).toEqual(action ? ['common.view', action] : ['common.view'])
    if (status === 'REFUND_REQUESTED') expect(row.text()).toContain('$2.50')
    expect(writes()).toEqual([])
  })

  it('submits native status, payment method, order kind and debounced keyword to the Go list query', async () => {
    const view = await render(); const selects = view.findAll('button[aria-haspopup="true"]')
    await choose(selects[0], 'payment.status.completed'); await choose(selects[1], 'payment.methods.wxpay'); await choose(selects[2], 'payment.admin.subscriptionOrder')
    vi.useFakeTimers(); const search = view.get('input[placeholder="payment.admin.searchOrders"]'); await search.setValue('synthetic'); await search.setValue('synthetic final'); await vi.advanceTimersByTimeAsync(301)
    expect(lastList().params).toMatchObject({ page: 1, page_size: 20, status: 'COMPLETED', payment_type: 'wxpay', order_type: 'subscription', keyword: 'synthetic final' }); expect(writes()).toEqual([])
  })

  it('changes order page and page size through native controls and recovers a failed list on refresh', async () => {
    total = 75; const view = await render(); await click(view.get<HTMLButtonElement>('[aria-label="pagination.next"]')); expect(lastList().params.page).toBe(2)
    await choose(view.findAll('button[aria-haspopup="true"]').at(-1)!, '50'); expect(lastList().params).toMatchObject({ page: 1, page_size: 50 })
    fail = 'get /admin/payment/orders'; await click(view.get<HTMLButtonElement>('[title="common.refresh"]')); expect(feedback.error).toHaveBeenCalledWith('Synthetic order refusal')
    await click(view.get<HTMLButtonElement>('[title="common.refresh"]')); expect(view.get('tbody tr').text()).toContain('synthetic-order-number'); expect(writes()).toEqual([])
  })

  it.each(['auditLogs', 'audit_logs'])('shows paid/refund details and the supported %s audit envelope without turning a read into a command', async auditField => {
    detail = { order: order({ paid_at: '2026-11-06T01:00:00Z', refund_amount: 2.5, refund_reason: 'Synthetic refund reason', refund_requested_at: '2026-11-06T02:00:00Z', refund_requested_by: 'synthetic-user', refund_request_reason: 'Synthetic customer request' }), [auditField]: [{ id: 1, action: 'synthetic.refund', detail: 'Synthetic audit detail', operator: 'Synthetic operator', created_at: '2026-11-06T03:00:00Z' }] }
    const view = await render(); await click(button(view.get('tbody tr'), 'common.view')); const dialog = view.get('[role="dialog"]')
    for (const text of ['Synthetic refund reason', 'Synthetic customer request', 'Synthetic audit detail', 'Synthetic operator', '$2.50', '¥72.50']) expect(dialog.text()).toContain(text)
    expect(wires.at(-1)?.path).toBe('/admin/payment/orders/61'); expect(writes()).toEqual([])
    await click(dialog.get<HTMLButtonElement>('[aria-label="Close modal"]')); expect(view.find('[role="dialog"]').exists()).toBe(false)
  })

  it('retains the visible cached order when its detail lookup fails and omits unavailable paid/refund/audit panels', async () => {
    fail = 'get /admin/payment/orders/61'; const view = await render(); await click(button(view.get('tbody tr'), 'common.view')); const dialog = view.get('[role="dialog"]')
    expect(dialog.text()).toContain('synthetic-order-number'); expect(dialog.text()).not.toContain('payment.admin.auditLogs'); expect(dialog.text()).not.toContain('payment.admin.paidAt'); expect(feedback.error).not.toHaveBeenCalled(); expect(writes()).toEqual([])
  })

  it.each([{ status: 'PENDING', action: 'payment.orders.cancel', endpoint: 'cancel', success: 'payment.admin.orderCancelled' }, { status: 'FAILED', action: 'payment.admin.retry', endpoint: 'retry', success: 'payment.admin.retrySuccess' }])('reports a failed $endpoint, then sends that command only after the operator retries it', async ({ status, action, endpoint, success }) => {
    rows = [order({ status })]; const view = await render(); fail = `post /admin/payment/orders/61/${endpoint}`
    await click(button(view.get('tbody tr'), action)); expect(feedback.error).toHaveBeenCalledWith('Synthetic order refusal')
    await click(button(view.get('tbody tr'), action)); expect(feedback.success).toHaveBeenCalledWith(success); expect(writes().map(wire => [wire.method, wire.path, wire.body])).toEqual([['post', `/admin/payment/orders/61/${endpoint}`, {}], ['post', `/admin/payment/orders/61/${endpoint}`, {}]])
  })

  it.each([{ result: { success: true }, notice: 'payment.admin.refundSuccess', closes: true }, { result: { success: false, warning: 'Synthetic provider pending' }, notice: 'payment.admin.refundPending', closes: true }, { result: { success: false, warning: 'Synthetic definitive refund refusal' }, notice: 'Synthetic definitive refund refusal', closes: false }])('handles the literal refund result $result with the appropriate visible feedback and dialog state', async ({ result, notice, closes }) => {
    refundReplies = [result]; const view = await render(); await refund(view); await submitRefund(view)
    expect(writes()).toEqual([{ method: 'post', path: '/admin/payment/orders/61/refund', params: {}, body: { amount: 2.5, reason: 'Synthetic operator refund reason', deduct_balance: true, force: false } }])
    expect(closes ? feedback.success : feedback.error).toHaveBeenCalledWith(notice); expect(view.find('#refund-form').exists()).toBe(!closes)
  })

  it('retains the confirmed refund draft after require_force and sends force only after the operator explicitly acknowledges it', async () => {
    refundReplies = [{ success: false, require_force: true, warning: 'Synthetic insufficient remaining balance' }, { success: true }]
    const view = await render(); await refund(view); await submitRefund(view); const form = view.get('#refund-form')
    expect(form.text()).toContain('Synthetic insufficient remaining balance'); expect(view.get('button[form="refund-form"]').attributes('disabled')).toBeDefined()
    await form.get('#force-refund').setValue(true); await click(view.get<HTMLButtonElement>('button[form="refund-form"]'))
    expect(writes().map(wire => wire.body)).toEqual([{ amount: 2.5, reason: 'Synthetic operator refund reason', deduct_balance: true, force: false }, { amount: 2.5, reason: 'Synthetic operator refund reason', deduct_balance: true, force: true }])
  })

  it('blocks an amount above the remaining partial-refund maximum through native validity, keeps an HTTP error editable and cancels without another command', async () => {
    rows = [order({ status: 'PARTIALLY_REFUNDED', refund_amount: 8 })]; const view = await render(); const form = await refund(view)
    await form.get('input[type="number"]').setValue('3'); await form.get('textarea').setValue('Synthetic partial refund'); await click(view.get<HTMLButtonElement>('button[form="refund-form"]')); expect(writes()).toEqual([])
    expect(form.get<HTMLInputElement>('input[type="number"]').element.validity.rangeOverflow).toBe(true)
    fail = 'post /admin/payment/orders/61/refund'; await form.get('input[type="number"]').setValue('1'); await form.get('#deduct-balance').setValue(false); await click(view.get<HTMLButtonElement>('button[form="refund-form"]'))
    expect(feedback.error).toHaveBeenCalledWith('Synthetic order refusal'); expect(form.get<HTMLTextAreaElement>('textarea').element.value).toBe('Synthetic partial refund')
    await click(button(view.get('[role="dialog"]'), 'common.cancel')); expect(writes()).toHaveLength(1)
  })

  it.each([{ result: { success: true }, notice: 'payment.admin.refundSuccess', error: false }, { result: { success: false, warning: '处理中' }, notice: 'payment.admin.refundPending', error: false }, { result: { success: false }, notice: 'common.error', error: true }])('queries an existing pending refund once and reports $notice without submitting a new refund', async ({ result, notice, error }) => {
    rows = [order({ status: 'REFUND_PENDING' })]; refundReplies = [result]; const view = await render(); await click(button(view.get('tbody tr'), 'payment.admin.queryRefundStatus'))
    expect(error ? feedback.error : feedback.success).toHaveBeenCalledWith(notice); expect(writes()).toEqual([{ method: 'post', path: '/admin/payment/orders/61/refund/query', params: {}, body: {} }]); expect(wires.at(-1)?.path).toBe('/admin/payment/orders')
  })
})
