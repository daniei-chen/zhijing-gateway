import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import PaymentQRDialog from '../PaymentQRDialog.vue'
import PaymentStatusPanel from '../PaymentStatusPanel.vue'

const mocks = vi.hoisted(() => ({ poll: vi.fn(), verify: vi.fn(), cancel: vi.fn(), showError: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/payment', () => ({ usePaymentStore: () => ({ pollOrderStatus: mocks.poll }) }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: mocks.showError }) }))
vi.mock('@/api/payment', () => ({ paymentAPI: { verifyOrder: mocks.verify, cancelOrder: mocks.cancel } }))
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
function order(id = 42, status = 'PENDING') {
  return { id, status, out_trade_no: `synthetic_${id}`, amount: 10, pay_amount: 10, currency: 'CNY' }
}

async function open(kind: 'dialog' | 'panel') {
  const props = { orderId: 42, qrCode: '', expiresAt: new Date(Date.now() + 120_000).toISOString(), paymentType: 'wxpay' }
  const global = { stubs: {
    Icon: true,
    BaseDialog: { props: ['show'], emits: ['close'], template: '<div v-if="show"><slot /><slot name="footer" /></div>' },
  } }
  if (kind === 'panel') return mount(PaymentStatusPanel, { props, global })
  const wrapper = mount(PaymentQRDialog, { props: { ...props, show: false }, global })
  await wrapper.setProps({ show: true })
  return wrapper
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  localStorage.clear()
  mocks.poll.mockReset().mockResolvedValue(null)
  mocks.verify.mockReset().mockResolvedValue({ data: order() })
  mocks.cancel.mockReset().mockResolvedValue(undefined)
  mocks.showError.mockReset()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear() })

describe.each(['dialog', 'panel'] as const)('payment polling lifecycle: %s', kind => {
  it('never overlaps slow polls, including the provider verification stage', async () => {
    const status = deferred<ReturnType<typeof order>>()
    const verification = deferred<{ data: ReturnType<typeof order> }>()
    mocks.poll.mockReturnValueOnce(status.promise)
    mocks.verify.mockReturnValueOnce(verification.promise)
    const wrapper = await open(kind)
    await vi.advanceTimersByTimeAsync(12000)
    expect(mocks.poll).toHaveBeenCalledTimes(1)
    status.resolve(order())
    await flushPromises()
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(12000)
    expect(mocks.poll).toHaveBeenCalledTimes(1)
    verification.resolve({ data: order(42, 'PAID') })
    await flushPromises()
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not initiate provider verification after unmount', async () => {
    const status = deferred<ReturnType<typeof order>>()
    mocks.poll.mockReturnValueOnce(status.promise)
    const wrapper = await open(kind)
    await vi.advanceTimersByTimeAsync(3000)
    wrapper.unmount()
    status.resolve(order())
    await flushPromises()
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps an old order response from settling or clearing the new order request', async () => {
    const first = deferred<ReturnType<typeof order>>()
    const second = deferred<ReturnType<typeof order>>()
    mocks.poll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = await open(kind)
    await vi.advanceTimersByTimeAsync(3000)
    await wrapper.setProps({ orderId: 77 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.poll).toHaveBeenCalledTimes(2)
    expect(mocks.poll).toHaveBeenLastCalledWith(77)
    first.resolve(order(42, 'PAID'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.poll).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('success')).toBeUndefined()
    second.resolve(order(77, 'PAID'))
    await flushPromises()
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(wrapper.text()).toContain('#77')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a cancel response from an order that has been replaced', async () => {
    const cancel = deferred<void>()
    mocks.cancel.mockReturnValueOnce(cancel.promise)
    const wrapper = await open(kind)
    const cancelButton = wrapper.findAll('button').find(button => button.text() === 'payment.qr.cancelOrder')!
    await cancelButton.trigger('click')
    expect(mocks.cancel).toHaveBeenCalledWith(42)
    await wrapper.setProps({ orderId: 77 })
    cancel.resolve()
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('settled')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.poll).toHaveBeenCalledWith(77)
  })

  it('does not start polling an already expired order', async () => {
    const wrapper = await open(kind)
    await wrapper.setProps({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.poll).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('payment.qr.expired')
    expect(vi.getTimerCount()).toBe(0)
  })
})
