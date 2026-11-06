import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import UserOrdersView from '../UserOrdersView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { PaymentOrder } from '@/types/payment'

const api = vi.hoisted(() => ({ list: vi.fn(), eligibility: vi.fn(), cancel: vi.fn(), refund: vi.fn(), success: vi.fn(), error: vi.fn(), push: vi.fn() }))
vi.mock('@/api/payment', () => ({ paymentAPI: { getMyOrders: api.list, getRefundEligibleProviders: api.eligibility, cancelOrder: api.cancel, requestRefund: api.refund } }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

const select = defineComponent({
  props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'],
  setup(props, { emit }) { return () => h('select', { value: props.modelValue, 'aria-label': 'Order status', onChange: (event: Event) => { const value = (event.target as HTMLSelectElement).value; emit('update:modelValue', value); emit('change', value) } }, props.options.map((option: { value: string; label: string }) => h('option', { value: option.value }, option.label))) },
})
const dataTable = defineComponent({ props: ['data', 'columns', 'loading'], template: '<table :aria-busy="loading"><thead><tr><th v-for="column in columns" :key="column.key">{{column.label}}</th></tr></thead><tbody><tr v-for="row in data" :key="row.id" :data-order="row.id"><td v-for="column in columns" :key="column.key"><slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">{{row[column.key]}}</slot></td></tr></tbody></table>' })
const pagination = defineComponent({ props: ['page', 'pageSize'], emits: ['update:page', 'update:pageSize'], setup(props, { emit }) { return () => h('nav', [h('button', { type: 'button', onClick: () => emit('update:page', props.page + 1) }, 'next-page'), h('button', { type: 'button', onClick: () => emit('update:pageSize', 50) }, 'size-50')]) } })
const dialog = defineComponent({ props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :aria-label="title"><button type="button" @click="$emit(\'close\')">dialog-close</button><slot/><slot name="footer"/></section>' })

const order = (id: number, extra: Partial<PaymentOrder> = {}): PaymentOrder => ({ id, user_id: 11, amount: 25, pay_amount: 26, fee_rate: 4, currency: 'USD', payment_type: 'stripe', out_trade_no: `synthetic-order-${id}`, status: 'PENDING', order_type: 'balance', created_at: '2026-11-06T00:00:00Z', expires_at: '2026-11-06T01:00:00Z', refund_amount: 0, provider_instance_id: 'synthetic-eligible', ...extra })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const mounted: VueWrapper[] = []
let rows: PaymentOrder[] = []
async function render() {
  const wrapper = mount(UserOrdersView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, DataTable: dataTable, Select: select, BaseDialog: dialog, Pagination: pagination, Icon: true } } })
  mounted.push(wrapper); await flushPromises(); return wrapper
}
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) { const result = root.findAll('button').find(item => item.text() === text); expect(result, `visible ${text}`).toBeDefined(); return result! }
const row = (wrapper: VueWrapper, id: number) => wrapper.get(`[data-order="${id}"]`)
const cancelDialog = (wrapper: VueWrapper) => wrapper.get('[aria-label="payment.orders.cancel"]')
const refundDialog = (wrapper: VueWrapper) => wrapper.get('[aria-label="payment.orders.requestRefund"]')
async function openCancel(wrapper: VueWrapper, id = 1) { await button(row(wrapper, id), 'payment.orders.cancel').trigger('click'); return cancelDialog(wrapper) }
async function openRefund(wrapper: VueWrapper, id = 2) { await button(row(wrapper, id), 'payment.orders.requestRefund').trigger('click'); return refundDialog(wrapper) }

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset()); localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-orders-member', user: { id: 11 } })
  rows = [order(1), order(2, { status: 'COMPLETED' }), order(3, { status: 'COMPLETED', provider_instance_id: 'synthetic-ineligible' }), order(4)]
  api.list.mockImplementation(async () => ({ data: { items: rows.map(item => ({ ...item })), total: rows.length } }))
  api.eligibility.mockResolvedValue({ data: { provider_instance_ids: ['synthetic-eligible'] } })
  api.cancel.mockImplementation(async (id: number) => { rows = rows.map(item => item.id === id ? { ...item, status: 'CANCELLED' as const } : item); return { data: { message: 'order_cancelled' } } })
  api.refund.mockImplementation(async (id: number) => { rows = rows.map(item => item.id === id ? { ...item, status: 'REFUND_REQUESTED' as const } : item); return { data: { message: 'refund requested' } } })
})
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('member order workflows through visible controls', () => {
  it('loads owned orders, shows payment and credit amounts, and links to purchase', async () => {
    const wrapper = await render()
    expect(api.list).toHaveBeenCalledWith({ page: 1, page_size: 20, status: undefined })
    expect(row(wrapper, 1).text()).toContain('$26.00'); expect(row(wrapper, 1).text()).toContain('$25.00')
    expect(row(wrapper, 2).text()).toContain('payment.orders.requestRefund'); expect(row(wrapper, 3).text()).not.toContain('payment.orders.requestRefund')
    await button(wrapper, 'payment.result.backToRecharge').trigger('click'); expect(api.push).toHaveBeenCalledWith('/purchase')
  })
  it('does not offer a refund request for subscriptions even when the provider supports balance refunds', async () => {
    rows = [order(2, { status: 'COMPLETED', order_type: 'subscription' })]
    const wrapper = await render(); expect(row(wrapper, 2).text()).not.toContain('payment.orders.requestRefund')
  })
  it('keeps refund buttons hidden when eligibility discovery fails', async () => {
    api.eligibility.mockRejectedValueOnce(new Error('Synthetic eligibility unavailable'))
    const wrapper = await render(); expect(wrapper.text()).not.toContain('payment.orders.requestRefund'); expect(api.error).not.toHaveBeenCalled()
  })
  it('resets status and page size changes to page one while refresh preserves the current page', async () => {
    const wrapper = await render(); await button(wrapper, 'next-page').trigger('click'); await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith({ page: 2, page_size: 20, status: undefined })
    await wrapper.get('[title="common.refresh"]').trigger('click'); await flushPromises(); expect(api.list).toHaveBeenLastCalledWith({ page: 2, page_size: 20, status: undefined })
    await wrapper.get('select').setValue('FAILED'); await flushPromises(); expect(api.list).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'FAILED' })
    await button(wrapper, 'size-50').trigger('click'); await flushPromises(); expect(api.list).toHaveBeenLastCalledWith({ page: 1, page_size: 50, status: 'FAILED' })
  })
  it.each(['common.cancel', 'dialog-close'])('dismisses cancellation with %s without changing the order', async dismissal => {
    const wrapper = await render(); const panel = await openCancel(wrapper); await button(panel, dismissal).trigger('click')
    expect(wrapper.find('[aria-label="payment.orders.cancel"]').exists()).toBe(false); expect(api.cancel).not.toHaveBeenCalled()
  })
  it('cancels only the confirmed order and refreshes the list on success', async () => {
    const wrapper = await render(); const panel = await openCancel(wrapper); await button(panel, 'payment.orders.cancel').trigger('click'); await flushPromises()
    expect(api.cancel).toHaveBeenCalledTimes(1); expect(api.cancel).toHaveBeenCalledWith(1)
    expect(wrapper.find('[aria-label="payment.orders.cancel"]').exists()).toBe(false); expect(row(wrapper, 1).text()).not.toContain('payment.orders.cancel'); expect(api.success).toHaveBeenCalledWith('common.success')
  })
  it('keeps a cancellation available for a deliberate retry after an explicit rejection', async () => {
    api.cancel.mockRejectedValueOnce({ status: 400, message: 'Synthetic cancellation rejected' })
    const wrapper = await render(); let panel = await openCancel(wrapper); await button(panel, 'payment.orders.cancel').trigger('click'); await flushPromises()
    panel = cancelDialog(wrapper); expect(api.error).toHaveBeenCalled(); expect((button(panel, 'payment.orders.cancel').element as HTMLButtonElement).disabled).toBe(false)
    await button(panel, 'payment.orders.cancel').trigger('click'); await flushPromises(); expect(api.cancel).toHaveBeenCalledTimes(2)
  })
  it('requires and trims the refund reason without changing the amount or user identity', async () => {
    const wrapper = await render(); const panel = await openRefund(wrapper)
    expect((button(panel, 'payment.orders.requestRefund').element as HTMLButtonElement).disabled).toBe(true)
    await panel.get('textarea').setValue('   '); expect((button(panel, 'payment.orders.requestRefund').element as HTMLButtonElement).disabled).toBe(true)
    await panel.get('textarea').setValue('  Synthetic refund reason  '); await button(panel, 'payment.orders.requestRefund').trigger('click'); await flushPromises()
    expect(api.refund).toHaveBeenCalledTimes(1); expect(api.refund).toHaveBeenCalledWith(2, { reason: 'Synthetic refund reason' }); expect(api.list).toHaveBeenCalledTimes(2)
  })
  it('clears the previous reason when a different eligible refund dialog is opened', async () => {
    rows = [order(2, { status: 'COMPLETED' }), order(3, { status: 'COMPLETED' })]
    const wrapper = await render(); let panel = await openRefund(wrapper, 2); await panel.get('textarea').setValue('Old synthetic reason'); await button(panel, 'common.cancel').trigger('click')
    panel = await openRefund(wrapper, 3); expect(panel.text()).toContain('#3'); expect((panel.get('textarea').element as HTMLTextAreaElement).value).toBe(''); expect(api.refund).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'refund'] as const)('locks synchronous repeated %s clicks to one command', async action => {
    const pending = deferred<object>(); api[action].mockReturnValueOnce(pending.promise)
    const wrapper = await render(); const panel = action === 'cancel' ? await openCancel(wrapper) : await openRefund(wrapper)
    if (action === 'refund') await panel.get('textarea').setValue('Synthetic captured reason')
    const target = button(panel, action === 'cancel' ? 'payment.orders.cancel' : 'payment.orders.requestRefund').element as HTMLButtonElement
    target.click(); target.click(); expect(api[action]).toHaveBeenCalledTimes(1)
    pending.resolve({}); await flushPromises()
  })
  it('keeps a newly selected cancellation dialog when an earlier cancellation finishes', async () => {
    const pending = deferred<object>(); api.cancel.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); let panel = await openCancel(wrapper, 1); await button(panel, 'payment.orders.cancel').trigger('click'); await button(panel, 'common.cancel').trigger('click')
    panel = await openCancel(wrapper, 4); pending.resolve({}); await flushPromises()
    expect(wrapper.find('[aria-label="payment.orders.cancel"]').exists()).toBe(true)
    await button(cancelDialog(wrapper), 'payment.orders.cancel').trigger('click'); await flushPromises(); expect(api.cancel.mock.calls.map(call => call[0])).toEqual([1, 4])
  })
  it('keeps a newly opened refund draft when an earlier refund request finishes', async () => {
    rows = [order(2, { status: 'COMPLETED' }), order(3, { status: 'COMPLETED' })]
    const pending = deferred<object>(); api.refund.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); let panel = await openRefund(wrapper, 2); await panel.get('textarea').setValue('Submitted synthetic reason'); await button(panel, 'payment.orders.requestRefund').trigger('click'); await button(panel, 'common.cancel').trigger('click')
    panel = await openRefund(wrapper, 3); await panel.get('textarea').setValue('New unsent reason'); pending.resolve({}); await flushPromises()
    expect(wrapper.find('[aria-label="payment.orders.requestRefund"]').exists()).toBe(true)
    expect((refundDialog(wrapper).get('textarea').element as HTMLTextAreaElement).value).toBe('New unsent reason'); expect(api.refund).toHaveBeenCalledWith(2, { reason: 'Submitted synthetic reason' })
  })
  it('ignores an older list response when the selected status has changed', async () => {
    const wrapper = await render(); const old = deferred<{ data: { items: PaymentOrder[]; total: number } }>(); api.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: { items: [order(8, { out_trade_no: 'Newest-filtered-order' })], total: 1 } })
    await wrapper.get('select').setValue('PENDING'); await wrapper.get('select').setValue('FAILED'); await flushPromises()
    expect(wrapper.text()).toContain('Newest-filtered-order')
    old.resolve({ data: { items: [order(9, { out_trade_no: 'Obsolete-filtered-order' })], total: 1 } }); await flushPromises()
    expect(wrapper.text()).not.toContain('Obsolete-filtered-order'); expect(wrapper.text()).toContain('Newest-filtered-order')
  })
  it.each(['cancel', 'refund'] as const)('does not refresh or notify a replacement login after a late %s success', async action => {
    const pending = deferred<object>(); api[action].mockReturnValueOnce(pending.promise)
    const wrapper = await render(); const panel = action === 'cancel' ? await openCancel(wrapper) : await openRefund(wrapper)
    if (action === 'refund') await panel.get('textarea').setValue('Synthetic reason')
    await button(panel, action === 'cancel' ? 'payment.orders.cancel' : 'payment.orders.requestRefund').trigger('click')
    expect(api[action]).toHaveBeenCalledTimes(1); const reads = api.list.mock.calls.length
    replaceAuthSession({ accessToken: 'synthetic-other-member', user: { id: 12 } }); pending.resolve({}); await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(reads); expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'refund'] as const)('does not notify after a disposed %s failure', async action => {
    const pending = deferred<object>(); api[action].mockReturnValueOnce(pending.promise)
    const wrapper = await render(); const panel = action === 'cancel' ? await openCancel(wrapper) : await openRefund(wrapper)
    if (action === 'refund') await panel.get('textarea').setValue('Synthetic reason')
    await button(panel, action === 'cancel' ? 'payment.orders.cancel' : 'payment.orders.requestRefund').trigger('click')
    expect(api[action]).toHaveBeenCalledTimes(1); wrapper.unmount(); pending.reject(new Error('Synthetic old mutation failure')); await flushPromises()
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled()
  })
  it('does not display or toast an old list response after a same-user new login', async () => {
    const pending = deferred<{ data: { items: PaymentOrder[]; total: number } }>(); const wrapper = await render(); api.list.mockReturnValueOnce(pending.promise)
    await wrapper.get('[title="common.refresh"]').trigger('click'); replaceAuthSession({ accessToken: 'synthetic-new-session-same-user', user: { id: 11 } })
    pending.resolve({ data: { items: [order(7, { out_trade_no: 'Old-session-order' })], total: 1 } }); await flushPromises()
    expect(wrapper.text()).not.toContain('Old-session-order'); expect(api.error).not.toHaveBeenCalled()
  })
  it('drops a rejected initial load after the view is disposed', async () => {
    const pending = deferred<object>(); api.list.mockReturnValueOnce(pending.promise); const wrapper = await render()
    wrapper.unmount(); pending.reject(new Error('Synthetic old initial failure')); await flushPromises(); expect(api.error).not.toHaveBeenCalled()
  })
  it('keeps a rejected refund reason available for a deliberate current-session retry', async () => {
    api.refund.mockRejectedValueOnce({ status: 400, message: 'Synthetic refund rejected' })
    const wrapper = await render(); let panel = await openRefund(wrapper); await panel.get('textarea').setValue('Synthetic retained reason'); await button(panel, 'payment.orders.requestRefund').trigger('click'); await flushPromises()
    panel = refundDialog(wrapper); expect((panel.get('textarea').element as HTMLTextAreaElement).value).toBe('Synthetic retained reason'); expect(api.error).toHaveBeenCalled()
    await button(panel, 'payment.orders.requestRefund').trigger('click'); await flushPromises(); expect(api.refund).toHaveBeenCalledTimes(2); expect(api.refund).toHaveBeenLastCalledWith(2, { reason: 'Synthetic retained reason' })
  })
  it('does not expose a late eligibility result to a replacement login', async () => {
    const pending = deferred<{ data: { provider_instance_ids: string[] } }>(); api.eligibility.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); expect(wrapper.text()).not.toContain('payment.orders.requestRefund')
    replaceAuthSession({ accessToken: 'synthetic-new-orders-session', user: { id: 11 } }); pending.resolve({ data: { provider_instance_ids: ['synthetic-eligible'] } }); await flushPromises()
    expect(wrapper.text()).not.toContain('payment.orders.requestRefund')
  })
  it.each(['PAID', 'REFUND_REQUESTED', 'REFUNDED', 'FAILED', 'CANCELLED'] as const)('does not offer a refund command while an order is %s', async status => {
    rows = [order(2, { status })]; const wrapper = await render(); expect(row(wrapper, 2).text()).not.toContain('payment.orders.requestRefund'); expect(api.refund).not.toHaveBeenCalled()
  })
  it('does not offer a refund without a matching provider instance', async () => {
    rows = [order(2, { status: 'COMPLETED', provider_instance_id: undefined })]; const wrapper = await render(); expect(row(wrapper, 2).text()).not.toContain('payment.orders.requestRefund')
  })
  it('blocks stale visible controls from issuing another user command', async () => {
    const wrapper = await render(); const panel = await openRefund(wrapper); await panel.get('textarea').setValue('Synthetic old reason')
    replaceAuthSession({ accessToken: 'synthetic-replacement-member', user: { id: 12 } }); await button(panel, 'payment.orders.requestRefund').trigger('click')
    await wrapper.get('[title="common.refresh"]').trigger('click'); await flushPromises(); expect(api.refund).not.toHaveBeenCalled(); expect(api.list).toHaveBeenCalledTimes(1); expect(api.error).not.toHaveBeenCalled()
  })
  it('keeps the latest list loading state after an older request finishes first', async () => {
    const wrapper = await render(); const first = deferred<object>(); const last = deferred<object>(); api.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    await wrapper.get('select').setValue('PENDING'); await wrapper.get('select').setValue('COMPLETED'); first.resolve({ data: { items: [], total: 0 } }); await flushPromises()
    expect(wrapper.get('table').attributes('aria-busy')).toBe('true'); last.resolve({ data: { items: [order(2, { status: 'COMPLETED' })], total: 1 } }); await flushPromises()
    expect(wrapper.get('table').attributes('aria-busy')).toBe('false'); expect(row(wrapper, 2).text()).toContain('synthetic-order-2')
  })
  it('hides failed status results and old actions until the same current status retry succeeds', async () => {
    const wrapper = await render(); await button(wrapper, 'size-50').trigger('click'); await flushPromises(); api.list.mockRejectedValueOnce({ message: 'Synthetic current order list failure' })
    await wrapper.get('select').setValue('REFUNDED'); await flushPromises()
    const failed = wrapper.get('[data-testid="orders-list-error"]'); expect(failed.attributes('role')).toBe('alert'); expect(failed.text()).toContain('Synthetic current order list failure'); expect(wrapper.find('table').exists()).toBe(false); expect(wrapper.find('nav').exists()).toBe(false); expect(wrapper.text()).not.toContain('payment.orders.cancel'); expect(wrapper.text()).not.toContain('payment.orders.requestRefund')
    const retry = deferred<{ data: { items: PaymentOrder[]; total: number } }>(); api.list.mockReturnValueOnce(retry.promise); await button(failed, 'common.tryAgain').trigger('click')
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, page_size: 50, status: 'REFUNDED' }); expect(wrapper.get('[data-testid="orders-list-error"]').attributes('aria-busy')).toBe('true'); expect(wrapper.find('table').exists()).toBe(false)
    retry.resolve({ data: { items: [order(9, { status: 'REFUNDED' })], total: 1 } }); await flushPromises(); expect(wrapper.find('[data-testid="orders-list-error"]').exists()).toBe(false); expect(row(wrapper, 9).text()).toContain('synthetic-order-9'); expect(row(wrapper, 9).text()).not.toContain('payment.orders.cancel')
  })
  it('distinguishes a failed order page from its successful empty retry without resetting that page', async () => {
    const wrapper = await render(); api.list.mockRejectedValueOnce(new Error('Synthetic page load failure')); await button(wrapper, 'next-page').trigger('click'); await flushPromises()
    expect(wrapper.find('table').exists()).toBe(false); expect(wrapper.find('nav').exists()).toBe(false); expect(wrapper.get('[data-testid="orders-list-error"]').attributes('role')).toBe('alert')
    api.list.mockResolvedValueOnce({ data: { items: [], total: 0 } }); await button(wrapper.get('[data-testid="orders-list-error"]'), 'common.tryAgain').trigger('click'); await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith({ page: 2, page_size: 20, status: undefined }); expect(wrapper.find('[data-testid="orders-list-error"]').exists()).toBe(false); expect(wrapper.find('table').exists()).toBe(true); expect(wrapper.find('nav').exists()).toBe(false)
  })
  it('does not let an obsolete status failure hide the newer successful list', async () => {
    const wrapper = await render(); const old = deferred<object>(); api.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: { items: [order(9, { status: 'REFUNDED' })], total: 1 } })
    await wrapper.get('select').setValue('PENDING'); await wrapper.get('select').setValue('REFUNDED'); await flushPromises(); old.reject(new Error('Synthetic obsolete scope failure')); await flushPromises()
    expect(wrapper.find('[data-testid="orders-list-error"]').exists()).toBe(false); expect(row(wrapper, 9).text()).toContain('synthetic-order-9'); expect(api.error).not.toHaveBeenCalled()
  })
  it('keeps a message-less order request failure explicit instead of displaying a successful empty list', async () => {
    const wrapper = await render(); api.list.mockRejectedValueOnce(new Error('')); await wrapper.get('select').setValue('REFUNDED'); await flushPromises()
    expect(wrapper.get('[data-testid="orders-list-error"]').text()).toContain('common.error'); expect(wrapper.find('table').exists()).toBe(false); expect(wrapper.find('nav').exists()).toBe(false)
  })
})
