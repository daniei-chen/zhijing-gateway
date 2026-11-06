import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BulkSubscriptionActionDialog from '../BulkSubscriptionActionDialog.vue'
import type { SubscriptionBulkActionResult } from '@/api/admin/subscriptions'
import type { UserSubscription } from '@/types'
import { replaceAuthSession } from '@/api/authSession'

const { bulkAction } = vi.hoisted(() => ({ bulkAction: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { subscriptions: { bulkAction } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const result: SubscriptionBulkActionResult = { success_count: 1, failed_count: 0, results: [{ subscription_id: 41, success: true }] }
const subscriptions = (id = 41) => [{ id, user_id: 51, group_id: 61, status: 'active', user: { email: `synthetic-${id}@example.invalid` } } as UserSubscription]
const wrappers: VueWrapper[] = []
let adminID = 3000
function render(id = 41) {
  const wrapper = mount(BulkSubscriptionActionDialog, {
    props: { show: true, action: 'extend', subscriptions: subscriptions(id) }, attachTo: document.body,
    global: { stubs: { teleport: true, transition: true } }
  })
  wrappers.push(wrapper)
  return wrapper
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
function deferred() {
  let resolve!: (value: SubscriptionBulkActionResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<SubscriptionBulkActionResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function savedOperationKey() {
  const scope = Object.keys(sessionStorage).find(key => key.startsWith('sub2api:admin:subscription-bulk:'))
  expect(scope).toBeDefined()
  return sessionStorage.getItem(scope!)
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: `synthetic-bulk-session-${++adminID}`, user: { id: adminID } })
  await new Promise(resolve => setTimeout(resolve, 0))
  bulkAction.mockReset().mockResolvedValue(result)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })

describe('bulk subscription ownership and uncertain-result replay', () => {
  it('keeps unknown outcomes locked to the captured batch and reads them without another write', async () => {
    bulkAction.mockRejectedValueOnce({ status: 0, message: 'Synthetic reply lost' })
      .mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
      .mockResolvedValueOnce(result)
    const wrapper = render()
    await submit(wrapper)
    const first = bulkAction.mock.calls[0]
    expect(first[2]).toBe(false)
    expect(wrapper.get('input[type="number"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ subscriptions: subscriptions(42), action: 'revoke' })
    await submit(wrapper)
    expect(bulkAction.mock.calls[1]).toEqual([first[0], first[1], true])
    expect(wrapper.text()).toContain('admin.subscriptions.bulk.resultUnconfirmed')
    expect(wrapper.emitted('completed')).toBeUndefined()
    await submit(wrapper)
    expect(bulkAction.mock.calls[2]).toEqual([first[0], first[1], true])
    expect(wrapper.emitted('completed')).toEqual([[result]])
  })

  it('reopens a persisted uncertain operation in replay-only mode', async () => {
    bulkAction.mockRejectedValueOnce({ status: 0 })
    const first = render(); await submit(first)
    const original = bulkAction.mock.calls[0]
    first.unmount()
    const retry = render(); await submit(retry)
    expect(bulkAction.mock.calls[1]).toEqual([original[0], original[1], true])
    expect(retry.emitted('completed')).toEqual([[result]])
  })

  it('does not emit or release an unknown operation after the dialog is destroyed', async () => {
    const pending = deferred(); bulkAction.mockReturnValueOnce(pending.promise)
    const first = render(); await submit(first)
    const key = savedOperationKey()
    first.unmount(); pending.resolve(result); await flushPromises()
    expect(first.emitted('completed')).toBeUndefined()
    expect(savedOperationKey()).toBe(key)
    const retry = render(); await submit(retry)
    expect(bulkAction.mock.calls[1][1]).toBe(key)
    expect(bulkAction.mock.calls[1][2]).toBe(true)
  })

  it.each(['success', 'error'] as const)('ignores a late %s when the same dialog closes and reopens for another target', async outcome => {
    const first = deferred(); const next = deferred()
    bulkAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
    const wrapper = render(); await submit(wrapper)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, subscriptions: subscriptions(42) })
    await submit(wrapper)
    expect(bulkAction).toHaveBeenCalledTimes(2)
    expect(bulkAction.mock.calls[1][0]).toMatchObject({ subscription_ids: [42], action: 'extend' })
    if (outcome === 'success') first.resolve(result)
    else first.reject({ status: 503, message: 'Synthetic old failure' })
    await flushPromises()
    expect(wrapper.emitted('completed')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Synthetic old failure')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    next.resolve({ ...result, results: [{ subscription_id: 42, success: true }] }); await flushPromises()
    expect(wrapper.emitted('completed')).toHaveLength(1)
  })

  it.each(['success', 'error'] as const)('ignores a late %s after replacement login for the same administrator', async outcome => {
    const pending = deferred(); bulkAction.mockReturnValueOnce(pending.promise)
    const wrapper = render(); await submit(wrapper)
    const key = savedOperationKey()
    replaceAuthSession({ accessToken: 'synthetic-replacement-bulk-session', user: { id: adminID } })
    if (outcome === 'success') pending.resolve(result)
    else pending.reject({ status: 503, message: 'Synthetic old-login failure' })
    await flushPromises()
    expect(wrapper.emitted('completed')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Synthetic old-login failure')
    expect(savedOperationKey()).toBe(key)
  })

  it('does not let an old successful dialog erase a newer pending operation', async () => {
    const old = deferred()
    bulkAction.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result).mockRejectedValueOnce({ status: 0 })
    const first = render(); await submit(first)
    const oldKey = bulkAction.mock.calls[0][1]
    const confirmedReplay = render(); await submit(confirmedReplay)
    expect(bulkAction.mock.calls[1][1]).toBe(oldKey)
    const newer = render(); await submit(newer)
    const newerKey = bulkAction.mock.calls[2][1]
    expect(newerKey).not.toBe(oldKey)
    newer.unmount()
    old.resolve(result); await flushPromises()
    const resumed = render(); await submit(resumed)
    expect(bulkAction.mock.calls[3][1]).toBe(newerKey)
    expect(bulkAction.mock.calls[3][2]).toBe(true)
  })


})
