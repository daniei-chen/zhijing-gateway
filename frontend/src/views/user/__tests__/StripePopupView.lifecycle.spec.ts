import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, shallowMount } from '@vue/test-utils'
import StripePopupView from '../StripePopupView.vue'

const mocks = vi.hoisted(() => ({
  loadStripe: vi.fn(), getOrder: vi.fn(), confirmWechatPayPayment: vi.fn(), confirmAlipayPayment: vi.fn(),
  sessionCurrent: true,
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { order_id: '42', method: 'wechat_pay' } }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api/payment', () => ({ paymentAPI: { getOrder: mocks.getOrder } }))
// The pre-fix popup imported this helper for a raw fetch. Keep that dependency
// isolated too, so the same behavioral regressions can run against the baseline.
vi.mock('@/api/client', () => ({ buildApiUrl: (path: string) => `/api/v1${path}` }))
vi.mock('@/api/authSession', () => ({
  captureAuthSession: () => ({ generation: 'synthetic', subject: '1' }),
  isAuthSessionCurrent: () => mocks.sessionCurrent,
}))
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: mocks.loadStripe }))

let openerFrame: HTMLIFrameElement
let opener: Window
const openerDescriptor = Object.getOwnPropertyDescriptor(window, 'opener')
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.sessionCurrent = true
  mocks.getOrder.mockReset().mockResolvedValue({ data: { status: 'PENDING' } })
  mocks.confirmWechatPayPayment.mockReset().mockResolvedValue({ paymentIntent: { status: 'requires_action' } })
  mocks.confirmAlipayPayment.mockReset()
  mocks.loadStripe.mockReset().mockResolvedValue({
    confirmWechatPayPayment: mocks.confirmWechatPayPayment,
    confirmAlipayPayment: mocks.confirmAlipayPayment,
  })
  openerFrame = document.createElement('iframe')
  document.body.appendChild(openerFrame)
  opener = openerFrame.contentWindow!
  vi.spyOn(opener, 'postMessage').mockImplementation(() => {})
  Object.defineProperty(window, 'opener', { value: opener, configurable: true })
})
afterEach(() => {
  openerFrame.remove()
  if (openerDescriptor) Object.defineProperty(window, 'opener', openerDescriptor)
  else delete (window as unknown as Record<string, unknown>).opener
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function initialize(source: Window = opener, payload: Record<string, unknown> = {}) {
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    source,
    data: { type: 'STRIPE_POPUP_INIT', clientSecret: 'pi_synthetic_secret', publishableKey: 'pk_synthetic', ...payload },
  }))
}
async function settle() { await flushPromises(); await flushPromises() }

describe('Stripe payment popup ownership', () => {
  it('accepts initialization only from its opener with valid string credentials', async () => {
    shallowMount(StripePopupView)
    initialize(window)
    initialize(opener, { clientSecret: { unexpected: true } })
    await settle()
    expect(mocks.loadStripe).not.toHaveBeenCalled()
    initialize()
    await settle()
    expect(mocks.loadStripe).toHaveBeenCalledTimes(1)
    expect(mocks.confirmWechatPayPayment).toHaveBeenCalledTimes(1)
  })

  it('does not initiate payment after unmount during SDK loading', async () => {
    let finishSDK!: (value: unknown) => void
    mocks.loadStripe.mockReturnValueOnce(new Promise(resolve => { finishSDK = resolve }))
    const wrapper = shallowMount(StripePopupView)
    initialize()
    await settle()
    wrapper.unmount()
    finishSDK({ confirmWechatPayPayment: mocks.confirmWechatPayPayment })
    await settle()
    expect(mocks.confirmWechatPayPayment).not.toHaveBeenCalled()
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one shared-client order request at a time and stops after session replacement', async () => {
    let finishPoll!: (value: unknown) => void
    mocks.getOrder.mockReturnValueOnce(new Promise(resolve => { finishPoll = resolve }))
    shallowMount(StripePopupView)
    initialize()
    await settle()
    await vi.advanceTimersByTimeAsync(12000)
    expect(mocks.getOrder).toHaveBeenCalledTimes(1)
    expect(mocks.getOrder).toHaveBeenCalledWith(42)
    mocks.sessionCurrent = false
    finishPoll({ data: { status: 'PAID' } })
    await settle()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.getOrder).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not schedule a delayed close for a response arriving after unmount', async () => {
    let finishPoll!: (value: unknown) => void
    mocks.getOrder.mockReturnValueOnce(new Promise(resolve => { finishPoll = resolve }))
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const wrapper = shallowMount(StripePopupView)
    initialize()
    await settle()
    await vi.advanceTimersByTimeAsync(3000)
    wrapper.unmount()
    finishPoll({ data: { status: 'PAID' } })
    await settle()
    await vi.advanceTimersByTimeAsync(3000)
    expect(close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
