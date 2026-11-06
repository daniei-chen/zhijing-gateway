/** Native checkout controls and real Pinia payment store/API; synthetic HTTP only. */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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

const fixture = vi.hoisted(() => ({ app: null as { cachedPublicSettings: Record<string, unknown> } | null, active: [] as UserSubscription[], error: vi.fn(), info: vi.fn(), warning: vi.fn(), refresh: vi.fn(), fetchSubscriptions: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 205, username: 'Synthetic member', balance: 12.25 }, refreshUser: fixture.refresh }) }))
vi.mock('@/stores/subscriptions', () => ({ useSubscriptionStore: () => ({ get activeSubscriptions() { return fixture.active }, fetchActiveSubscriptions: fixture.fetchSubscriptions }) }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ get cachedPublicSettings() { return fixture.app!.cachedPublicSettings }, showError: fixture.error, showInfo: fixture.info, showWarning: fixture.warning }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixture.app }))
vi.mock('@/utils/device', () => ({ isMobileDevice: () => false }))
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
let requests: { path: string; method: string; body: Record<string, unknown> }[]
let view: VueWrapper | undefined
let router: Router
let pinia: Pinia
const oldAdapter = apiClient.defaults.adapter
const writes = () => requests.filter(request => request.method === 'post')
beforeEach(() => {
  for (const mock of [fixture.error, fixture.info, fixture.warning, fixture.refresh, fixture.fetchSubscriptions]) mock.mockReset().mockResolvedValue(undefined)
  fixture.app = reactive({ cachedPublicSettings: { subscription_enabled: true, server_utc_offset: '+08:00' } }); fixture.active = []
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'release-synthetic-payment', user: { id: 205 } })
  checkout = { methods: { alipay: method() }, global_min: 0, global_max: 0, plans: [plan(1), plan(2)], balance_disabled: false, balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0, recharge_fee_rate: 0, help_text: '', help_image_url: '', stripe_publishable_key: '', recharge_bonus_tiers: [], recharge_bonus_mode: 'bonus', recharge_bonus_notice: '' }
  order = { order_id: 41, amount: 20, pay_amount: 20, fee_rate: 0, qr_code: 'synthetic-payment-qr', expires_at: '2099-01-01T00:00:00Z', result_type: 'order_created', payment_type: 'alipay', out_trade_no: 'synthetic-order-41' }
  pending = undefined; refuse = false; requests = []; pinia = createPinia()
  apiClient.defaults.adapter = async config => {
    requests.push({ path: String(config.url), method: String(config.method), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} })
    let data: unknown
    if (config.method === 'get' && config.url === '/payment/checkout-info') data = checkout
    else if (config.method === 'post' && config.url === '/payment/orders') {
      if (pending) await pending.promise
      if (refuse) { refuse = false; throw new AxiosError('Synthetic checkout refusal', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Rejected', data: { message: 'Synthetic checkout unavailable' }, headers: {}, config }) }
      data = order
    } else throw new Error(`Unexpected synthetic payment endpoint ${config.method} ${config.url}`)
    return { data: { code: 0, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(async () => { view?.unmount(); view = undefined; pending?.resolve(); await flushPromises(); disposePinia(pinia); apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); document.body.innerHTML = '' })
async function render(query: Record<string, string> = {}) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/purchase', component: { template: '<main />' } }, { path: '/payment/result', component: { template: '<main />' } }, { path: '/payment/stripe', component: { template: '<main />' } }, { path: '/payment/airwallex', component: { template: '<main />' } }] })
  await router.push({ path: '/purchase', query }); await router.isReady()
  view = mount(PaymentView, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { AppLayout: { template: '<main><slot /></main>' }, PaymentStatusPanel: statusPanel } } }); await flushPromises(); return view
}
function action(text: string) { const button = view!.findAll('button').find(node => node.text() === text || node.text().startsWith(text + ' ')); expect(button, text).toBeDefined(); return button! }
async function amount(value: string) { await view!.get('input[inputmode="decimal"]').setValue(value); await flushPromises() }
async function create() { await action('payment.createOrder').trigger('click'); await flushPromises() }
async function choosePlan(name: string) { const card = view!.findAllComponents(SubscriptionPlanCard).find(node => node.text().includes(name))!; expect(card).toBeDefined(); await card.get('button').trigger('click'); await flushPromises() }

describe('member checkout release workflows', () => {
  it('submits a typed recharge through the actual payment store/API and shows only its returned order', async () => {
    await render(); await amount('18.25'); order.amount = 18.25; order.pay_amount = 18.25; await create()
    expect(writes()).toHaveLength(1); expect(writes()[0].body).toMatchObject({ amount: 18.25, payment_type: 'alipay', order_type: 'balance' })
    expect(view!.get('[data-payment-status]').attributes()).toMatchObject({ 'data-order': '41', 'data-amount': '18.25' }); expect(view!.text()).toContain('synthetic-payment-qr')
  })
  it('keeps a rejected recharge amount and permits a corrected explicit retry', async () => {
    await render(); await amount('20'); refuse = true; await create()
    expect(writes()).toHaveLength(1); expect(view!.get<HTMLInputElement>('input[inputmode="decimal"]').element.value).toBe('20'); expect(fixture.error).toHaveBeenCalled()
    await amount('25'); await create(); expect(writes()[1].body.amount).toBe(25); expect(view!.find('[data-payment-status]').exists()).toBe(true)
  })
  it('admits one order from two synchronous native clicks while HTTP is pending', async () => {
    pending = deferred(); await render(); await amount('20'); const button = action('payment.createOrder').element as HTMLButtonElement; button.click(); button.click(); await flushPromises()
    expect(writes()).toHaveLength(1); expect(button.disabled).toBe(true); pending.resolve(); await flushPromises(); expect(view!.find('[data-payment-status]').exists()).toBe(true)
  })
  it('prevents a below-minimum recharge and shows its validation while leaving the input editable', async () => {
    checkout.methods.alipay = method({ single_min: 10, single_max: 50 }); await render(); await amount('5')
    expect(action('payment.createOrder').attributes('disabled')).toBeDefined(); expect(view!.text()).toContain('10'); expect(writes()).toHaveLength(0)
    await amount('10'); expect(action('payment.createOrder').attributes('disabled')).toBeUndefined()
  })
  it('automatically chooses a method that can actually accept the selected amount', async () => {
    checkout.methods = { alipay: method({ single_max: 50 }), custom_card: method({ display_name: 'Synthetic card', single_min: 50, single_max: 200, fee_rate: 2 }) }
    await render(); await amount('100'); await create(); expect(writes()[0].body.payment_type).toBe('custom_card'); expect(view!.find('[data-payment-status]').exists()).toBe(true)
  })
  it('renders bonus/multiplier economics from checkout data before sending the unscaled pay amount', async () => {
    checkout.balance_recharge_multiplier = 2; checkout.recharge_bonus_tiers = [{ min_amount: 20, bonus_percent: 10 }]; checkout.recharge_bonus_notice = '**Synthetic bonus**'; await render(); await amount('20')
    expect(view!.get('[data-testid="recharge-bonus-notice"] strong').text()).toBe('Synthetic bonus'); expect(view!.get('[data-testid="recharge-credited-row"]').text()).toContain('44.00'); await create(); expect(writes()[0].body.amount).toBe(20)
  })
  it('shows discount economics separately from fees using the configured method currency', async () => {
    checkout.recharge_bonus_mode = 'discount'; checkout.recharge_bonus_tiers = [{ min_amount: 20, bonus_percent: 10 }]; checkout.methods.alipay = method({ currency: 'CNY', fee_rate: 2 }); await render(); await amount('20')
    expect(view!.find('[data-testid="recharge-discount-row"]').exists()).toBe(true); expect(view!.text()).toContain('payment.actualPay'); await create(); expect(writes()[0].body.amount).toBe(20)
  })
  it('selects a real plan card, presents its peak/quota facts and sends its plan identity on confirmation', async () => {
    checkout.plans = [plan(1, { peak_rate_enabled: true, peak_start: '18:00', peak_end: '22:00', peak_rate_multiplier: 2, daily_limit_usd: 20, weekly_limit_usd: 100, monthly_limit_usd: 300 })]
    await render(); await action('payment.tabSubscribe').trigger('click'); await choosePlan('Synthetic plan 1')
    expect(view!.text()).toContain('18:00-22:00 ×2 (UTC+08:00)'); expect(view!.text()).toContain('$300'); await create()
    expect(writes()[0].body).toMatchObject({ amount: 10, order_type: 'subscription', plan_id: 1 }); expect(view!.get('[data-payment-status]').attributes('data-kind')).toBe('subscription')
  })
  it('closes a multiple-plan renewal chooser without creating an order', async () => {
    await render({ tab: 'subscription', group: '7' }); const modal = new DOMWrapper(document.body).get('.fixed.inset-0.z-50')
    expect(modal.text()).toContain('Synthetic plan 1'); await modal.get('button').trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(new DOMWrapper(document.body).find('.fixed.inset-0.z-50').exists()).toBe(false)); expect(writes()).toHaveLength(0)
  })
  it('chooses a renewal from the public modal and confirms exactly that subscription', async () => {
    await render({ tab: 'subscription', group: '7' }); const modal = new DOMWrapper(document.body).get('.fixed.inset-0.z-50')
    const card = modal.findAll('.group.relative').find(node => node.text().includes('Synthetic plan 2'))!; expect(card).toBeDefined(); await card.get('button').trigger('click'); await flushPromises(); await create()
    expect(writes()[0].body.plan_id).toBe(2); expect(writes()[0].body.amount).toBe(20)
  })
  it('selects the sole matching renewal directly and can cancel back to all plans', async () => {
    checkout.plans = [plan(1)]; await render({ tab: 'subscription', group: '7' }); expect(view!.text()).toContain('Synthetic subscription'); await action('common.cancel').trigger('click')
    expect(view!.find('input[inputmode="decimal"]').exists()).toBe(false); expect(writes()).toHaveLength(0); expect(view!.text()).toContain('Synthetic plan 1')
  })
  it('renders active subscriptions including expiry, missing-group fallback and peak pricing', async () => {
    fixture.active = [{ id: 1, group_id: 7, expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), group: { name: 'Synthetic active', platform: 'openai', rate_multiplier: 1.5, peak_rate_enabled: true, peak_start: '18:00', peak_end: '22:00', peak_rate_multiplier: 2 } }, { id: 2, group_id: 8, expires_at: null }] as UserSubscription[]
    await render({ tab: 'subscription' }); expect(view!.text()).toContain('Synthetic active'); expect(view!.text()).toContain('userSubscriptions.daysRemaining:3'); expect(view!.text()).toContain('userSubscriptions.noExpiration'); expect(view!.text()).toContain('payment.groupFallback:8')
  })
  it('clears recovery state on settled, then restores the form on the public done event', async () => {
    await render(); await amount('20'); await create(); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).not.toBeNull(); await view!.get('#status-settled').trigger('click')
    expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull(); expect(view!.find('[data-payment-status]').exists()).toBe(true); await view!.get('#status-done').trigger('click'); expect(view!.find('input[inputmode="decimal"]').exists()).toBe(true)
  })
  it('refreshes membership and account state on successful subscription payment and routes to its result', async () => {
    checkout.plans = [plan(1)]; await render({ tab: 'subscription', group: '7' }); await create(); await view!.get('#status-success').trigger('click'); await flushPromises()
    expect(fixture.refresh).toHaveBeenCalledOnce(); expect(fixture.fetchSubscriptions).toHaveBeenCalledWith(true); expect(router.currentRoute.value.path).toBe('/payment/result'); expect(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull()
  })
  it('opens and closes the configured help image without creating checkout', async () => {
    checkout.help_image_url = 'https://images.example.test/synthetic-help.png'; await render(); await view!.get('img.h-40').trigger('click'); await flushPromises()
    expect(new DOMWrapper(document.body).findAll('img[src="https://images.example.test/synthetic-help.png"]')).toHaveLength(2)
    const overlay = new DOMWrapper(document.body).findAll('.fixed.inset-0').at(-1)!; await overlay.trigger('click'); await flushPromises(); expect(writes()).toHaveLength(0)
  })
})
