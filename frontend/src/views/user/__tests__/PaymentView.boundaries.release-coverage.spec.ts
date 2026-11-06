/** Native checkout controls and real Pinia payment store/API; synthetic HTTP only. */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { defineComponent, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import PaymentView from '../PaymentView.vue'
import SubscriptionPlanCard from '@/components/payment/SubscriptionPlanCard.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import { PAYMENT_RECOVERY_STORAGE_KEY } from '@/components/payment/paymentFlow'
import type { CheckoutInfoResponse, SubscriptionPlan, MethodLimit, CreateOrderResult } from '@/types/payment'
import type { UserSubscription } from '@/types'

const fixture = vi.hoisted(() => ({ app: null as { cachedPublicSettings: Record<string, unknown> } | null, active: [] as UserSubscription[], error: vi.fn(), info: vi.fn(), warning: vi.fn(), refresh: vi.fn(), fetchSubscriptions: vi.fn(), mobile: false }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 205, username: 'Synthetic member', balance: 12.25 }, refreshUser: fixture.refresh }) }))
vi.mock('@/stores/subscriptions', () => ({ useSubscriptionStore: () => ({ get activeSubscriptions() { return fixture.active }, fetchActiveSubscriptions: fixture.fetchSubscriptions }) }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ get cachedPublicSettings() { return fixture.app!.cachedPublicSettings }, showError: fixture.error, showInfo: fixture.info, showWarning: fixture.warning }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixture.app }))
vi.mock('@/utils/device', () => ({ isMobileDevice: () => fixture.mobile }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : ''), locale: ref('en') }) }))
const statusPanel = defineComponent({ props: ['orderId', 'amount', 'payAmount', 'qrCode', 'orderType'], emits: ['done', 'success', 'settled'], template: `<section data-payment-status :data-order="orderId" :data-amount="amount" :data-pay-amount="payAmount" :data-kind="orderType"><span>{{qrCode}}</span><button id="status-done" @click="$emit('done')">Done</button><button id="status-success" @click="$emit('success')">Success</button><button id="status-settled" @click="$emit('settled')">Settled</button></section>` })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const method = (patch: Partial<MethodLimit> = {}): MethodLimit => ({ currency: 'USD', daily_limit: 0, daily_used: 0, daily_remaining: 0, single_min: 0, single_max: 0, fee_rate: 0, available: true, ...patch })
const plan = (id: number, patch: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({ id, group_id: 7, group_platform: 'openai', group_name: 'Shared plan', rate_multiplier: 1.5, name: `Synthetic plan ${id}`, description: 'Synthetic subscription', price: 10 * id, original_price: 15 * id, validity_days: 30, validity_unit: 'month', features: ['Synthetic feature'], for_sale: true, sort_order: id, ...patch })
let checkout: CheckoutInfoResponse
let order: CreateOrderResult
let pending: ReturnType<typeof deferred<void>> | undefined
let refuse: boolean
let rejectionData: Record<string, unknown> | undefined
let requests: { path: string; method: string; body: Record<string, unknown> }[]
let view: VueWrapper | undefined
let router: Router
let pinia: Pinia
const oldAdapter = apiClient.defaults.adapter
const writes = () => requests.filter(request => request.method === 'post')
beforeEach(() => {
  for (const mock of [fixture.error, fixture.info, fixture.warning, fixture.refresh, fixture.fetchSubscriptions]) mock.mockReset().mockResolvedValue(undefined)
  fixture.app = reactive({ cachedPublicSettings: { subscription_enabled: true, server_utc_offset: '+08:00' } }); fixture.active = []; fixture.mobile = false
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'release-synthetic-payment', user: { id: 205 } })
  checkout = { methods: { alipay: method() }, global_min: 0, global_max: 0, plans: [plan(1), plan(2)], balance_disabled: false, balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0, recharge_fee_rate: 0, help_text: '', help_image_url: '', stripe_publishable_key: '', recharge_bonus_tiers: [], recharge_bonus_mode: 'bonus', recharge_bonus_notice: '' }
  order = { order_id: 41, amount: 20, pay_amount: 20, fee_rate: 0, qr_code: 'synthetic-payment-qr', expires_at: '2099-01-01T00:00:00Z', result_type: 'order_created', payment_type: 'alipay', out_trade_no: 'synthetic-order-41' }
  pending = undefined; refuse = false; rejectionData = undefined; requests = []; pinia = createPinia()
  apiClient.defaults.adapter = async config => {
    requests.push({ path: String(config.url), method: String(config.method), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} })
    let data: unknown
    if (config.method === 'get' && config.url === '/payment/checkout-info') data = checkout
    else if (config.method === 'post' && config.url === '/payment/orders') {
      if (pending) await pending.promise
      if (refuse) { refuse = false; throw new AxiosError('Synthetic checkout refusal', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Rejected', data: rejectionData ?? { message: 'Synthetic checkout unavailable' }, headers: {}, config }) }
      data = order
    } else throw new Error(`Unexpected synthetic payment endpoint ${config.method} ${config.url}`)
    return { data: { code: 0, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(async () => { view?.unmount(); view = undefined; pending?.resolve(); await flushPromises(); disposePinia(pinia); apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
async function render(query: Record<string, string> = {}) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/purchase', component: { template: '<main />' } }, { path: '/payment/result', component: { template: '<main />' } }, { path: '/payment/stripe', component: { template: '<main />' } }, { path: '/payment/airwallex', component: { template: '<main />' } }] })
  await router.push({ path: '/purchase', query }); await router.isReady()
  view = mount(PaymentView, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { AppLayout: { template: '<main><slot /></main>' }, PaymentStatusPanel: statusPanel } } }); await flushPromises(); return view
}
function action(text: string) { const button = view!.findAll('button').find(node => node.text() === text || node.text().startsWith(text + ' ')); expect(button, text).toBeDefined(); return button! }
async function amount(value: string) { await view!.get('input[inputmode="decimal"]').setValue(value); await flushPromises() }
async function create() { await action('payment.createOrder').trigger('click'); await flushPromises() }
async function choosePlan(name: string) { const card = view!.findAllComponents(SubscriptionPlanCard).find(node => node.text().includes(name))!; expect(card).toBeDefined(); await card.get('button').trigger('click'); await flushPromises() }

const recovery = (patch: Record<string, unknown> = {}) => ({ orderId: 59, amount: 50, qrCode: 'synthetic-recovery-qr', expiresAt: '2099-01-01T00:00:00Z', paymentType: 'alipay', payUrl: '', outTradeNo: 'synthetic-recovery-order', clientSecret: '', intentId: '', currency: 'USD', countryCode: '', paymentEnv: '', payAmount: 50, orderType: 'balance', paymentMode: 'qrcode', resumeToken: 'synthetic-recovery-token', createdAt: Date.now(), ...patch })

describe('member payment visible channel and recovery boundaries', () => {
  it('shows an explicit no-method state and an empty subscription catalog without permitting a charge', async () => {
    checkout.methods = {}; checkout.plans = []; await render(); expect(view!.text()).toContain('payment.notAvailable'); expect(writes()).toHaveLength(0); await action('payment.tabSubscribe').trigger('click'); expect(view!.text()).toContain('payment.noPlans')
  })
  it('disables an unavailable method instead of charging against its displayed option', async () => {
    checkout.methods = { alipay: method({ available: false }) }; await render(); await amount('20'); expect(action('payment.createOrder').attributes('disabled')).toBeDefined(); expect(writes()).toHaveLength(0)
  })
  it('prevents charging when no method accepts the typed amount without discarding it', async () => {
    checkout.methods = { alipay: method({ single_max: 50 }) }; await render(); await amount('80'); expect(action('payment.createOrder').attributes('disabled')).toBeDefined(); expect(view!.text()).toContain('payment.amountNoMethod'); expect(view!.get<HTMLInputElement>('input[inputmode="decimal"]').element.value).toBe('80'); await amount('40'); expect(action('payment.createOrder').attributes('disabled')).toBeUndefined()
  })
  it.each([{ reason: 'TOO_MANY_PENDING', metadata: { max: 3 }, expected: 'payment.errors.tooManyPending:3' }, { reason: 'CANCEL_RATE_LIMITED', expected: 'payment.errors.cancelRateLimited' }])('shows an actionable reservation restriction without retrying order creation (%j)', async sample => {
    const { expected, ...data } = sample; rejectionData = data; refuse = true; await render(); await amount('20'); await create(); expect(fixture.error).toHaveBeenCalledWith(expected); expect(writes()).toHaveLength(1); expect(view!.get<HTMLInputElement>('input[inputmode="decimal"]').element.value).toBe('20')
  })
  it.each([
    ['wxpay', 'WECHAT_H5_NOT_AUTHORIZED'], ['wxpay', 'WECHAT_PAYMENT_MP_NOT_CONFIGURED'], ['wxpay', 'WECHAT_JSAPI_FAILED'], ['wxpay', 'PAYMENT_GATEWAY_ERROR'], ['alipay', 'PAYMENT_GATEWAY_ERROR'],
  ] as const)('falls back once from a mobile %s / %s refusal to an explicit desktop QR request', async (paymentType, reason) => {
    fixture.mobile = true; checkout.methods = { [paymentType]: method() }; order.payment_type = paymentType; rejectionData = { reason, message: 'Synthetic mobile gateway refusal' }; refuse = true; await render(); await amount('20'); await create(); expect(writes()).toHaveLength(2); expect(writes()[0].body).toMatchObject({ amount: 20, payment_type: paymentType, is_mobile: true }); expect(writes()[1].body).toMatchObject({ amount: 20, payment_type: paymentType, is_mobile: false }); expect(fixture.warning).toHaveBeenCalledWith('payment.errors.mobilePaymentFallbackToQr'); expect(view!.get('[data-payment-status]').attributes('data-order')).toBe('41')
  })
  it.each([['wxpay', 'payment.errors.wechatUnavailable', 'payment.errors.wechatScanOnDesktopHint'], ['alipay', 'payment.errors.alipayDesktopUnavailable', 'payment.errors.alipayDesktopQrHint']] as const)('keeps a desktop %s gateway refusal explicit instead of repeating a POST', async (paymentType, message, hint) => {
    checkout.methods = { [paymentType]: method() }; rejectionData = { reason: 'PAYMENT_GATEWAY_ERROR', message: 'Synthetic gateway refusal' }; refuse = true; await render(); await amount('20'); await create(); expect(writes()).toHaveLength(1); expect(fixture.error).toHaveBeenCalledWith(`${message} ${hint}`)
  })
  it('reports an unhandled empty order result without entering a false payment screen', async () => {
    order = { order_id: 41, amount: 20, pay_amount: 20, fee_rate: 0, expires_at: '2099-01-01T00:00:00Z' }; await render(); await amount('20'); await create(); expect(view!.find('[data-payment-status]').exists()).toBe(false); expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('payment.errors.alipayDesktopUnavailable')); expect(writes()).toHaveLength(1)
  })
  it('opens a real Stripe landing URL through the intercepted popup boundary with only returned order identifiers', async () => {
    order.client_secret = 'synthetic-stripe-client-secret'; order.resume_token = 'synthetic-stripe-resume'; const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window); await render(); await amount('20'); await create(); expect(open).toHaveBeenCalledOnce(); const target = new URL(String(open.mock.calls[0][0]), 'http://localhost'); expect(target.pathname).toBe('/payment/stripe'); expect(target.searchParams.get('order_id')).toBe('41'); expect(target.searchParams.get('method')).toBe('alipay'); expect(target.searchParams.get('resume_token')).toBe('synthetic-stripe-resume'); expect(target.searchParams.has('client_secret')).toBe(false)
  })
  it('opens the returned redirect payment URL in a controlled desktop popup', async () => {
    order.pay_url = 'https://pay.example.test/synthetic-order'; order.payment_mode = 'popup'; order.qr_code = ''; const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window); await render(); await amount('20'); await create(); expect(open).toHaveBeenCalledWith('https://pay.example.test/synthetic-order', 'paymentPopup', expect.any(String)); expect(view!.find('[data-payment-status]').exists()).toBe(true)
  })
  it.each(['get_brand_wcpay_request:cancel', 'get_brand_wcpay_request:ok', 'get_brand_wcpay_request:fail'] as const)('honors the actual public JS bridge result %s without making a real payment', async err_msg => {
    checkout.methods = { wxpay: method() }; order = { ...order, payment_type: 'wxpay', result_type: 'jsapi_ready', jsapi: { appId: 'synthetic-app', nonceStr: 'synthetic-nonce', package: 'synthetic-package' }, qr_code: '' }; const invoke = vi.fn((_name: string, _payload: unknown, callback: (value: { err_msg: string }) => void) => callback({ err_msg })); vi.stubGlobal('WeixinJSBridge', { invoke }); await render(); await amount('20'); await create(); expect(invoke).toHaveBeenCalledExactlyOnceWith('getBrandWCPayRequest', order.jsapi, expect.any(Function)); if (err_msg.endsWith('cancel')) { expect(fixture.info).toHaveBeenCalledWith('payment.qr.cancelled'); expect(view!.find('[data-payment-status]').exists()).toBe(false) } else if (err_msg.endsWith(':ok')) expect(router.currentRoute.value.path).toBe('/payment/result'); else expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('payment.errors.wechatJsapiFailed')); expect(writes()).toHaveLength(1)
  })
  it('restores a subscription checkout snapshot and refreshes membership on its public done action', async () => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(recovery({ orderType: 'subscription' }))); await render({ resume_token: 'synthetic-recovery-token' }); expect(view!.get('[data-payment-status]').attributes('data-order')).toBe('59'); expect(writes()).toHaveLength(0); await view!.get('#status-done').trigger('click'); await flushPromises(); expect(fixture.fetchSubscriptions).toHaveBeenCalledWith(true); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); expect(view!.find('[data-payment-status]').exists()).toBe(false)
  })
  it.each([{ expiresAt: '2000-01-01T00:00:00Z' }, { resumeToken: 'synthetic-other-token' }])('drops a stale or mismatched recovery snapshot before showing a payable order (%j)', async patch => {
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(recovery(patch))); await render({ resume_token: 'synthetic-recovery-token' }); expect(view!.find('[data-payment-status]').exists()).toBe(false); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); expect(writes()).toHaveLength(0)
  })
  it('renders a server plan with no platform label and permits explicit cancellation of that selection', async () => {
    checkout.plans = [plan(1, { group_platform: '', rate_multiplier: undefined })]; await render(); await action('payment.tabSubscribe').trigger('click'); await choosePlan('Synthetic plan 1'); expect(view!.text()).toContain('Synthetic plan 1'); await action('common.cancel').trigger('click'); expect(writes()).toHaveLength(0)
  })
})
