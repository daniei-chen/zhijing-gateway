/** Actual payment store/API and auth balance refresh, with synthetic Axios only. */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import PaymentResultView from '../PaymentResultView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import { useAuthStore } from '@/stores/auth'
import { PAYMENT_RECOVERY_STORAGE_KEY } from '@/components/payment/paymentFlow'
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string) => key }) }))
let view: VueWrapper | undefined
let pinia: Pinia
let router: Router
let sequence: Record<string, unknown>[]
let requestGate: { path: string; promise: Promise<void>; resolve: () => void } | undefined
let failures: Set<string>
let requests: { path: string; body: Record<string, unknown> }[]
const oldAdapter = apiClient.defaults.adapter
const resolvePath = '/payment/public/orders/resolve'; const verifyPath = '/payment/orders/verify'; const publicPath = '/payment/public/orders/verify'; const orderPath = '/payment/orders/62'
const full = (patch: Record<string, unknown> = {}) => ({ id: 62, user_id: 212, amount: 100, pay_amount: 110, fee_rate: 10, bonus_amount: 5, payment_type: 'alipay_direct', out_trade_no: 'synthetic-order-62', currency: 'USD', status: 'COMPLETED', order_type: 'balance', created_at: '2026-11-06T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', refund_amount: 0, ...patch })
const snapshot = (patch: Record<string, unknown> = {}) => ({ orderId: 62, amount: 100, qrCode: 'synthetic-qr', expiresAt: '2099-01-01T00:00:00Z', paymentType: 'alipay', payUrl: '', outTradeNo: 'synthetic-order-62', clientSecret: '', intentId: '', currency: 'USD', countryCode: '', paymentEnv: '', payAmount: 110, orderType: 'balance', paymentMode: 'qrcode', resumeToken: 'synthetic-resume-62', createdAt: Date.now(), ...patch })
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-result-member-212', user: { id: 212 } }); pinia = createPinia(); sequence = [full()]; failures = new Set(); requests = []; requestGate = undefined
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); const body = config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}; requests.push({ path, body })
    if (requestGate?.path === path) await requestGate.promise
    if (failures.has(path)) throw new AxiosError('Synthetic order unavailable', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic order lookup refused' } })
    let value: unknown
    if (path === '/auth/me') value = { id: 212, email: 'member@example.test', role: 'user', status: 'active', balance: 120, concurrency: 1 }
    else if ([resolvePath, verifyPath, publicPath].includes(path) || /^\/payment\/orders\/\d+$/.test(path)) value = sequence.length > 1 ? sequence.shift() : sequence[0]
    else throw new Error(`Unexpected synthetic result endpoint ${path}`)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: value } }
  }
})
afterEach(async () => { view?.unmount(); view = undefined; requestGate?.resolve(); await flushPromises(); disposePinia(pinia); apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function render(query: LocationQueryRaw = {}) { useAuthStore(pinia).checkAuth(); await flushPromises(); requests = []; router = createRouter({ history: createMemoryHistory(), routes: ['/payment/result','/purchase','/orders'].map(path => ({ path, component: { template: '<main/>' } })) }); await router.push({ path: '/payment/result', query }); await router.isReady(); view = mount(PaymentResultView, { attachTo: document.body, global: { plugins: [pinia, router] } }); await flushPromises(); return view }
const calls = (path: string) => requests.filter(request => request.path === path)
function line(label: string) { const node = view!.findAll('.space-y-3 > div').find(node => node.findAll('span').some(span => span.text() === label)); expect(node, label).toBeDefined(); return node! }
function action(text: string) { const node = view!.findAll('button').find(node => node.text() === text); expect(node, text).toBeDefined(); return node! }

describe('payment result release workflows', () => {
  it('renders authoritative base, fee, bonus and credited amount from a completed balance order and refreshes balance once', async () => {
    await render({ order_id: '62' }); expect(line('payment.orders.baseAmount').text()).toContain('100.00'); expect(view!.text()).toContain('10%'); expect(line('payment.orders.payAmount').text()).toContain('110.00'); expect(line('payment.orders.bonusAmount').text()).toContain('+$5.00'); expect(line('payment.orders.creditedAmount').text()).toContain('$100.00'); expect(line('payment.orders.paymentMethod').text()).toContain('payment.methods.alipay'); expect(calls('/auth/me')).toHaveLength(1); await vi.advanceTimersByTimeAsync(5000); expect(calls(orderPath)).toHaveLength(1)
  })
  it('keeps subscription currency and fee-free amount distinct and never refreshes wallet balance for subscription fulfillment', async () => {
    sequence = [full({ amount: 120, pay_amount: 100, fee_rate: 0, bonus_amount: 0, order_type: 'subscription', currency: 'CNY', payment_type: 'wxpay' })]; await render({ order_id: '62' }); expect(line('payment.orders.baseAmount').text()).toContain('100.00'); expect(line('payment.orders.creditedAmount').text()).toContain('120.00'); expect(view!.text()).not.toContain('payment.orders.bonusAmount'); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('uses only the first repeated signed resume token and renders its minimal public DTO without inventing monetary fields', async () => {
    sequence = [{ out_trade_no: 'synthetic-public-62', status: 'PAID', paid: true, created_at: '2026-11-06T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }]; await render({ resume_token: ['synthetic-resume-62', 'ignored-token'] }); expect(calls(resolvePath)[0].body).toEqual({ resume_token: 'synthetic-resume-62' }); expect(view!.text()).toContain('synthetic-public-62'); expect(view!.text()).not.toContain('payment.orders.baseAmount'); expect(view!.text()).not.toContain('payment.orders.payAmount'); expect(calls('/auth/me')).toHaveLength(0)
  })
  it.each([{ orderId: 999 }, { outTradeNo: 'synthetic-other-order' }, { expiresAt: '2000-01-01T00:00:00Z' }])('does not let a mismatched or expired global snapshot redirect the explicit order identity (%j)', async patch => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot(patch))); await render({ order_id: '62', out_trade_no: 'synthetic-order-62' }); expect(calls(orderPath)).toHaveLength(1); expect(calls('/payment/orders/999')).toHaveLength(0); expect(calls(resolvePath)).toHaveLength(0); expect(view!.text()).toContain('#62')
  })
  it('ignores an unbound global recovery snapshot and removes no authoritative amount from it', async () => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot())); await render(); expect(requests).toHaveLength(0); expect(view!.text()).toContain('payment.result.failed'); expect(view!.text()).not.toContain('synthetic-order-62')
  })
  it('uses matching legacy order identity to restore a snapshot and retains terminal server authority over the cached state', async () => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot())); sequence = [full({ status: 'CANCELLED' })]; await render({ out_trade_no: 'synthetic-order-62', trade_status: 'TRADE_SUCCESS' }); expect(calls(orderPath)).toHaveLength(1); expect(view!.text()).toContain('payment.result.failed'); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('falls back from a refused signed resolve through order ID and authenticated/public verification', async () => {
    failures = new Set([resolvePath, orderPath, verifyPath]); await render({ resume_token: 'synthetic-resume-62', order_id: '62', out_trade_no: 'synthetic-order-62' }); expect(calls(resolvePath)).toHaveLength(1); expect(calls(orderPath)).toHaveLength(1); expect(calls(verifyPath)[0].body).toEqual({ out_trade_no: 'synthetic-order-62' }); expect(calls(publicPath)[0].body).toEqual({ out_trade_no: 'synthetic-order-62' }); expect(view!.text()).toContain('payment.result.success')
  })
  it('never treats unsigned legacy return metadata as a confirmed successful payment when both verifiers refuse it', async () => {
    failures = new Set([verifyPath, publicPath]); await render({ out_trade_no: 'synthetic-legacy-62', trade_status: 'TRADE_SUCCESS', money: 'not-a-number', type: 'wechat' }); expect(view!.text()).toContain('synthetic-legacy-62'); expect(view!.text()).toContain('0.00'); expect(view!.text()).toContain('payment.methods.wxpay'); expect(view!.text()).toContain('payment.result.failed'); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('keeps a failed bare signed resume local and does not query unrelated order identifiers', async () => {
    failures.add(resolvePath); await render({ resume_token: 'synthetic-invalid-resume' }); expect(requests).toHaveLength(1); expect(view!.text()).toContain('payment.result.failed'); expect(calls(orderPath)).toHaveLength(0)
  })
  it('continues a pending status through a transient lookup refusal and stops after completed fulfillment', async () => {
    sequence = [full({ status: 'PENDING' })]; await render({ order_id: '62' }); failures.add(orderPath); await vi.advanceTimersByTimeAsync(2000); await flushPromises(); expect(view!.text()).toContain('payment.result.processing'); failures.delete(orderPath); sequence = [full({ status: 'PAID' }), full({ status: 'COMPLETED' })]; await vi.advanceTimersByTimeAsync(4000); await flushPromises(); expect(view!.text()).toContain('payment.result.success'); expect(calls('/auth/me')).toHaveLength(1); const count = calls(orderPath).length; await vi.advanceTimersByTimeAsync(4000); expect(calls(orderPath)).toHaveLength(count)
  })
  it('caps automatic pending checks at fifteen attempts while keeping the status explicitly processing', async () => {
    sequence = [full({ status: 'PROCESSING' })]; await render({ order_id: '62' }); await vi.advanceTimersByTimeAsync(32000); await flushPromises(); expect(calls(orderPath)).toHaveLength(16); expect(view!.text()).toContain('payment.result.processing'); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('clears a pending timer on unmount instead of issuing another synthetic order query', async () => {
    sequence = [full({ status: 'PENDING' })]; await render({ order_id: '62' }); view!.unmount(); view = undefined; await vi.advanceTimersByTimeAsync(6000); expect(calls(orderPath)).toHaveLength(1)
  })
  it('keeps a completed order visible even if its separate profile refresh refuses and exposes working return actions', async () => {
    failures.add('/auth/me'); await render({ order_id: '62' }); expect(view!.text()).toContain('payment.result.success'); await action('payment.result.viewOrders').trigger('click'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/orders'); await action('payment.result.backToRecharge').trigger('click'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/purchase')
  })
  it('does not reschedule a status query whose in-flight response arrives after unmount', async () => {
    sequence = [full({ status: 'PENDING' })]; await render({ order_id: '62' }); let resolve!: () => void; requestGate = { path: orderPath, promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }; await vi.advanceTimersByTimeAsync(2000); expect(calls(orderPath)).toHaveLength(2); view!.unmount(); view = undefined; requestGate.resolve(); await flushPromises(); requestGate = undefined; await vi.advanceTimersByTimeAsync(4000); expect(calls(orderPath)).toHaveLength(2)
  })

  it.each(['PAID', 'RECHARGING'])('keeps the existing %s cache-clearing contract while polling until COMPLETED and refreshing balance once', async status => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot())); sequence = [full({ status }), full({ status: 'COMPLETED' })]; await render({ order_id: '62' }); expect(view!.text()).toContain('payment.result.success'); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); expect(calls('/auth/me')).toHaveLength(0); await vi.advanceTimersByTimeAsync(2000); await flushPromises(); expect(calls(orderPath)).toHaveLength(2); expect(calls('/auth/me')).toHaveLength(1); await vi.advanceTimersByTimeAsync(4000); expect(calls(orderPath)).toHaveLength(2); expect(calls('/auth/me')).toHaveLength(1)
  })
  it.each(['FAILED', 'EXPIRED', 'CANCELLED'])('stops terminal %s order queries and clears recovery state without claiming wallet fulfillment', async status => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot())); sequence = [full({ status })]; await render({ order_id: '62' }); expect(view!.text()).toContain('payment.result.failed'); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); await vi.advanceTimersByTimeAsync(6000); expect(calls(orderPath)).toHaveLength(1); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('does not clear recovery state or refresh balance from a completed status response after unmount', async () => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot())); sequence = [full({ status: 'PENDING' })]; await render({ order_id: '62' }); let resolve!: () => void; requestGate = { path: orderPath, promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }; await vi.advanceTimersByTimeAsync(2000); view!.unmount(); view = undefined; sequence = [full({ status: 'COMPLETED' })]; requestGate.resolve(); await flushPromises(); expect(calls('/auth/me')).toHaveLength(0); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).not.toBeNull(); requestGate = undefined; await vi.advanceTimersByTimeAsync(4000); expect(calls(orderPath)).toHaveLength(2)
  })

})
