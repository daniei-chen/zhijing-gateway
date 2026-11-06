import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import SubscriptionsView from '../SubscriptionsView.vue'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({ list: vi.fn(), groups: vi.fn(), users: vi.fn(), searchUsers: vi.fn(), assign: vi.fn(), bulkAssign: vi.fn(), extend: vi.fn(), revoke: vi.fn(), restore: vi.fn(), reset: vi.fn(), bulk: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  subscriptions: { list: mocks.list, assign: mocks.assign, bulkAssign: mocks.bulkAssign, extend: mocks.extend, revoke: mocks.revoke, restore: mocks.restore, resetQuota: mocks.reset, bulkAction: mocks.bulk },
  groups: { getAll: mocks.groups }, users: { list: mocks.users }, usage: { searchUsers: mocks.searchUsers },
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.error, showSuccess: mocks.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${Object.values(params).join(',')}` : key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const groups = [
  { id: 7, name: 'Synthetic paid group', platform: 'openai', subscription_type: 'subscription', status: 'active', rate_multiplier: 1, daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 100 },
  { id: 8, name: 'Synthetic inactive group', platform: 'openai', subscription_type: 'subscription', status: 'disabled', rate_multiplier: 1 },
  { id: 9, name: 'Synthetic balance group', platform: 'openai', subscription_type: 'standard', status: 'active', rate_multiplier: 1 },
]
function subscription(id: number, status = 'active') {
  return { id, user_id: id + 40, group_id: 7, status, user: { id: id + 40, email: `synthetic-${id}@example.invalid`, username: `Synthetic ${id}` },
    group: groups[0], expires_at: status === 'expired' ? '2020-01-01T00:00:00Z' : '2030-01-01T00:00:00Z',
    daily_usage_usd: 2, weekly_usage_usd: 4, monthly_usage_usd: 8, daily_window_start: null, weekly_window_start: null, monthly_window_start: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as any
}
const allRows = () => [subscription(1), subscription(2), subscription(3, 'revoked'), subscription(4, 'expired')]
const wrappers: VueWrapper[] = []
function render() {
  const wrapper = mount(SubscriptionsView, { attachTo: document.body, global: { stubs: {
    AppLayout: defineComponent({ template: '<main><slot /></main>' }),
    TablePageLayout: defineComponent({ template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' }),
    RouterLink: defineComponent({ props: ['to'], template: '<a><slot/></a>' }),
    teleport: true, transition: true, Icon: true,
  } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(scope: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = scope.findAll('button').find(candidate => candidate.text().replace(/\s/g, '') === text.replace(/\s/g, ''))
  expect(found, `DOM button ${text}`).toBeDefined()
  return found!
}
function row(wrapper: VueWrapper, id: number) {
  const found = wrapper.findAll('tbody tr').find(candidate => candidate.text().includes(`synthetic-${id}@example.invalid`))
  expect(found, `subscription row ${id}`).toBeDefined()
  return found!
}
function dialog(wrapper: VueWrapper, title: string) {
  const found = wrapper.findAll('[role="dialog"]').find(candidate => candidate.text().includes(title))
  expect(found, `dialog ${title}`).toBeDefined()
  return found!
}
async function status(wrapper: VueWrapper, value: string) {
  await wrapper.findAll('button.select-trigger')[0].trigger('click')
  const option = wrapper.findAll('[role="option"]').find(candidate => candidate.text() === value)
  expect(option).toBeDefined()
  await option!.trigger('click')
  await flushPromises()
}
async function openOperation(wrapper: VueWrapper, action: string, id: number) {
  if (action === 'restore') await status(wrapper, 'admin.subscriptions.status.revoked')
  await button(row(wrapper, id), `admin.subscriptions.${action === 'extend' ? 'adjust' : action === 'reset' ? 'resetQuota' : action}`).trigger('click')
}
function activeDialog(wrapper: VueWrapper, action: string) {
  const title = action === 'extend' ? 'adjustSubscription' : action === 'reset' ? 'resetQuotaTitle' : `${action}Subscription`
  return dialog(wrapper, `admin.subscriptions.${title}`)
}
async function confirmOperation(wrapper: VueWrapper, action: string) {
  if (action === 'extend') await wrapper.get('#extend-subscription-form').trigger('submit')
  else await button(activeDialog(wrapper, action), `admin.subscriptions.${action === 'reset' ? 'resetQuota' : action}`).trigger('click')
}
async function openAssignment(wrapper: VueWrapper, id = 41) {
  await button(wrapper, 'admin.subscriptions.assignSubscription').trigger('click')
  const form = wrapper.get('#assign-subscription-form')
  mocks.users.mockResolvedValueOnce({ items: [{ id, email: `synthetic-user-${id}@example.invalid` }] })
  const search = form.get('[data-assign-user-search] input')
  await search.trigger('focus')
  await search.setValue(`synthetic-user-${id}`)
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  await button(form, `synthetic-user-${id}@example.invalid#${id}`).trigger('click')
  await form.get('button.select-trigger').trigger('click')
  const group = wrapper.findAll('[role="option"]').find(option => option.text().includes('Synthetic paid group'))
  expect(group).toBeDefined()
  await group!.trigger('click')
  return form
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-subscription-admin', user: { id: 7 } })
  await vi.advanceTimersByTimeAsync(0)
  mocks.list.mockReset().mockImplementation((_page, _size, filters) => Promise.resolve({ items: allRows().filter(item => !filters?.status || item.status === filters.status), total: 100, pages: 5 }))
  mocks.groups.mockReset().mockResolvedValue(groups)
  mocks.users.mockReset().mockResolvedValue({ items: [] })
  mocks.searchUsers.mockReset().mockResolvedValue([])
  for (const mutation of [mocks.assign, mocks.extend, mocks.revoke, mocks.restore, mocks.reset]) mutation.mockReset().mockResolvedValue({})
  mocks.bulkAssign.mockReset().mockResolvedValue({ success_count: 1, failed_count: 0, subscriptions: [], errors: [] })
  mocks.bulk.mockReset().mockResolvedValue({ success_count: 1, failed_count: 0, results: [{ subscription_id: 1, success: true }] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('SubscriptionsView administrator DOM and payload contracts', () => {
  it('applies status, page, size and sort through real table controls', async () => {
    const wrapper = render()
    await flushPromises()
    expect(mocks.list.mock.calls[0].slice(0, 3)).toEqual([1, 20, { status: 'active', group_id: undefined, platform: undefined, user_id: undefined, sort_by: 'created_at', sort_order: 'desc' }])
    await wrapper.get('nav[aria-label="Pagination"] button[aria-label="pagination.next"]').trigger('click')
    await flushPromises()
    expect(mocks.list.mock.calls.at(-1)?.[0]).toBe(2)
    await status(wrapper, 'admin.subscriptions.status.expired')
    expect(mocks.list.mock.calls.at(-1)?.slice(0, 3)).toEqual([1, 20, expect.objectContaining({ status: 'expired' })])
    expect(row(wrapper, 4).text()).toContain('admin.subscriptions.status.expired')
    await wrapper.get('.page-size-select button.select-trigger').trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === '50')!.trigger('click')
    await flushPromises()
    expect(mocks.list.mock.calls.at(-1)?.slice(0, 2)).toEqual([1, 50])
    await button(wrapper, 'admin.subscriptions.columns.expires').trigger('click')
    await flushPromises()
    expect(mocks.list.mock.calls.at(-1)?.[2]).toMatchObject({ status: 'expired', sort_by: 'expires_at', sort_order: 'asc' })
  })

  it('assigns the explicitly chosen current user and active subscription group once', async () => {
    const wrapper = render()
    await flushPromises()
    const form = await openAssignment(wrapper)
    await form.get('input[type="number"]').setValue('60')
    await form.trigger('submit')
    await flushPromises()
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith({ user_id: 41, group_id: 7, validity_days: 60 })
    expect(wrapper.find('#assign-subscription-form').exists()).toBe(false)
    expect(mocks.success).toHaveBeenCalledWith('admin.subscriptions.subscriptionAssigned')
  })

  it.each([7, -7])('adjusts a current subscription by exactly %s days', async days => {
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, 'extend', 1)
    await wrapper.get('#extend-subscription-form input').setValue(String(days))
    await confirmOperation(wrapper, 'extend'); await flushPromises()
    expect(mocks.extend).toHaveBeenCalledExactlyOnceWith(1, { days })
    expect(mocks.success).toHaveBeenCalledWith('admin.subscriptions.subscriptionAdjusted')
  })

  it('allows a positive adjustment of an expired subscription using the backend renewal contract', async () => {
    const wrapper = render(); await flushPromises(); await status(wrapper, 'admin.subscriptions.status.expired')
    await openOperation(wrapper, 'extend', 4)
    await confirmOperation(wrapper, 'extend'); await flushPromises()
    expect(mocks.extend).toHaveBeenCalledExactlyOnceWith(4, { days: 30 })
  })

  it.each(['revoke', 'restore', 'reset'] as const)('submits the selected single %s operation', async action => {
    const id = action === 'restore' ? 3 : 1
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, action, id)
    await confirmOperation(wrapper, action); await flushPromises()
    if (action === 'reset') expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(1, { daily: true, weekly: true, monthly: true })
    else expect(mocks[action]).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it.each(['extend', 'revoke', 'restore', 'reset'] as const)('deduplicates pending %s confirmation', async action => {
    const pending = deferred<object>()
    mocks[action].mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, action, action === 'restore' ? 3 : 1)
    await confirmOperation(wrapper, action)
    await confirmOperation(wrapper, action)
    expect(mocks[action]).toHaveBeenCalledOnce()
    pending.resolve({}); await flushPromises()
  })

  it.each(['extend', 'revoke', 'reset'] as const)('does not close a new target dialog after the old %s completed', async action => {
    const pending = deferred<object>()
    mocks[action].mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, action, 1)
    await confirmOperation(wrapper, action)
    await button(activeDialog(wrapper, action), 'common.cancel').trigger('click')
    await openOperation(wrapper, action, 2)
    pending.resolve({}); await flushPromises()
    expect(activeDialog(wrapper, action).text()).toContain('synthetic-2@example.invalid')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it.each(['extend', 'revoke', 'restore', 'reset'] as const)('suppresses late %s UI results and refresh after unmount', async action => {
    const pending = deferred<object>()
    mocks[action].mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, action, action === 'restore' ? 3 : 1)
    await confirmOperation(wrapper, action)
    const listCalls = mocks.list.mock.calls.length
    wrapper.unmount()
    pending.resolve({}); await flushPromises()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledTimes(listCalls)
  })

  it('does not publish an assignment result after its page was destroyed', async () => {
    const pending = deferred<object>(); mocks.assign.mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises(); const form = await openAssignment(wrapper)
    await form.trigger('submit'); wrapper.unmount(); pending.resolve({}); await flushPromises()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('aborts the current list read when its page is destroyed', async () => {
    mocks.list.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = render(); await flushPromises()
    const signal = mocks.list.mock.calls[0][3].signal as AbortSignal
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('does not install a late old-login list result', async () => {
    const pending = deferred<any>(); mocks.list.mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises()
    replaceAuthSession({ accessToken: 'synthetic-new-admin-session', user: { id: 7 } })
    pending.resolve({ items: [subscription(1)], total: 1, pages: 1 }); await flushPromises()
    expect(wrapper.text()).not.toContain('synthetic-1@example.invalid')
  })

  it('keeps the latest assignment search result when earlier keywords resolve last', async () => {
    const a = deferred<any>(); const b = deferred<any>(); mocks.users.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const wrapper = render(); await flushPromises(); await button(wrapper, 'admin.subscriptions.assignSubscription').trigger('click')
    const search = wrapper.get('[data-assign-user-search] input'); await search.trigger('focus')
    await search.setValue('older'); await vi.advanceTimersByTimeAsync(300)
    await search.setValue('newer'); await vi.advanceTimersByTimeAsync(300)
    b.resolve({ items: [{ id: 42, email: 'newer@example.invalid' }] }); await flushPromises()
    a.resolve({ items: [{ id: 41, email: 'older@example.invalid' }] }); await flushPromises()
    const results = wrapper.get('[data-assign-user-search]')
    expect(results.text()).toContain('newer@example.invalid')
    expect(results.text()).not.toContain('older@example.invalid')
  })

  it('retains the exact single-adjustment wire identity after an ambiguous failure', async () => {
    const { apiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/admin/subscriptions')>('@/api/admin/subscriptions')
    const adapter = apiClient.defaults.adapter
    const wire: Array<{ url?: string; body: unknown; key: unknown }> = []
    apiClient.defaults.adapter = async config => {
      wire.push({ url: config.url, body: JSON.parse(config.data), key: config.headers.get('Idempotency-Key') })
      if (wire.length === 1) throw Object.assign(new Error('synthetic response lost'), { code: 'ERR_NETWORK', config })
      return { status: 200, statusText: 'OK', headers: { 'x-idempotency-replayed': 'true' }, config, data: { code: 0, data: subscription(1) } }
    }
    mocks.extend.mockImplementation(actual.extend)
    try {
      const wrapper = render(); await flushPromises(); await openOperation(wrapper, 'extend', 1)
      await confirmOperation(wrapper, 'extend'); await flushPromises()
      await confirmOperation(wrapper, 'extend'); await flushPromises()
      expect(wire).toHaveLength(2)
      expect(wire.map(request => request.body)).toEqual([{ days: 30 }, { days: 30 }])
      expect(wire.map(request => request.url)).toEqual(['/admin/subscriptions/1/extend', '/admin/subscriptions/1/extend/replay'])
      expect(wire[0].key).toEqual(expect.any(String))
      expect(wire[0].key).not.toBe('')
      expect(wire[1].key).toBe(wire[0].key)
      expect(wrapper.find('#extend-subscription-form').exists()).toBe(false)
    } finally { apiClient.defaults.adapter = adapter }
  })

  it('filters by a chosen user, group and platform and clears the user immediately when its text changes', async () => {
    const wrapper = render(); await flushPromises()
    const search = wrapper.get('[data-filter-user-search] input')
    mocks.searchUsers.mockResolvedValueOnce([{ id: 51, email: 'synthetic-filter@example.invalid' }])
    await search.trigger('focus'); await search.setValue('synthetic-filter'); await vi.advanceTimersByTimeAsync(300); await flushPromises()
    await button(wrapper, 'synthetic-filter@example.invalid#51').trigger('click'); await flushPromises()
    expect(mocks.list.mock.calls.at(-1)?.[2].user_id).toBe(51)
    await wrapper.findAll('button.select-trigger')[1].trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === 'Synthetic paid group')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button.select-trigger')[2].trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === 'OpenAI')!.trigger('click')
    await flushPromises()
    expect(mocks.list.mock.calls.at(-1)?.[2]).toMatchObject({ user_id: 51, group_id: 7, platform: 'openai' })
    await search.setValue('other user')
    expect(mocks.list.mock.calls.at(-1)?.[2].user_id).toBeUndefined()
  })

  it('offers only active subscription groups when assigning', async () => {
    const wrapper = render(); await flushPromises(); await button(wrapper, 'admin.subscriptions.assignSubscription').trigger('click')
    await wrapper.get('#assign-subscription-form button.select-trigger').trigger('click')
    const options = wrapper.findAll('[role="option"]').map(option => option.text())
    expect(options.some(option => option.includes('Synthetic paid group'))).toBe(true)
    expect(options.some(option => option.includes('Synthetic inactive group') || option.includes('Synthetic balance group'))).toBe(false)
  })

  it('retains a rejected assignment draft and retries the same selected user and corrected validity', async () => {
    mocks.assign.mockRejectedValueOnce({ status: 409, message: 'synthetic assignment conflict' })
    const wrapper = render(); await flushPromises(); const form = await openAssignment(wrapper)
    await form.trigger('submit'); await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('synthetic assignment conflict')
    expect(wrapper.find('#assign-subscription-form').exists()).toBe(true)
    await form.get('input[type="number"]').setValue('45')
    await form.trigger('submit'); await flushPromises()
    expect(mocks.assign.mock.calls[1][0]).toEqual({ user_id: 41, group_id: 7, validity_days: 45 })
    expect(wrapper.find('#assign-subscription-form').exists()).toBe(false)
  })

  it('keeps an unconfirmed adjustment open with the safe history-check message', async () => {
    mocks.extend.mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    const wrapper = render(); await flushPromises(); await openOperation(wrapper, 'extend', 1)
    await confirmOperation(wrapper, 'extend'); await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('admin.subscriptions.adjustResultUnconfirmed')
    expect(wrapper.find('#extend-subscription-form').exists()).toBe(true)
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('keeps bulk eligibility, frozen retry identity and per-target partial results through real selection controls', async () => {
    mocks.bulk.mockRejectedValueOnce({ status: 0, message: 'synthetic bulk reply lost' }).mockResolvedValueOnce({
      success_count: 1, failed_count: 1, results: [{ subscription_id: 1, success: true }, { subscription_id: 4, success: false, error: 'synthetic item denied' }],
    })
    const wrapper = render(); await flushPromises(); await status(wrapper, 'admin.subscriptions.allStatus')
    for (const id of [1, 3, 4]) await row(wrapper, id).get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-test="bulk-extend"]').trigger('click')
    const form = wrapper.get('form[id^="bulk-subscription-action-form-"]')
    expect(form.text()).toContain('synthetic-1@example.invalid')
    expect(form.text()).toContain('synthetic-4@example.invalid')
    expect(form.text()).not.toContain('synthetic-3@example.invalid')
    await form.trigger('submit'); await flushPromises()
    expect(mocks.bulk).toHaveBeenCalledOnce()
    expect(wrapper.get('form[id^="bulk-subscription-action-form-"]').text()).toContain('synthetic bulk reply lost')
    expect(wrapper.get('form[id^="bulk-subscription-action-form-"] input[type="number"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form[id^="bulk-subscription-action-form-"]').trigger('submit'); await flushPromises()
    expect(mocks.bulk.mock.calls[0][0]).toEqual({ subscription_ids: [1, 4], action: 'extend', days: 30 })
    expect(mocks.bulk.mock.calls[0][2]).toBe(false)
    expect(mocks.bulk.mock.calls[1]).toEqual([mocks.bulk.mock.calls[0][0], mocks.bulk.mock.calls[0][1], true])
    expect(wrapper.get('form[id^="bulk-subscription-action-form-"]').text()).toContain('synthetic item denied')
    expect((row(wrapper, 1).get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect((row(wrapper, 3).get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect((row(wrapper, 4).get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('does not refresh a destroyed page after a real bulk dialog completes', async () => {
    const pending = deferred<any>(); mocks.bulk.mockReturnValueOnce(pending.promise)
    const wrapper = render(); await flushPromises(); await row(wrapper, 1).get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-test="bulk-extend"]').trigger('click')
    await wrapper.get('form[id^="bulk-subscription-action-form-"]').trigger('submit')
    wrapper.unmount()
    pending.resolve({ success_count: 1, failed_count: 0, results: [{ subscription_id: 1, success: true }] }); await flushPromises()
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('removes an open bulk mutation dialog when the login is replaced', async () => {
    const wrapper = render(); await flushPromises(); await row(wrapper, 1).get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-test="bulk-extend"]').trigger('click')
    expect(wrapper.find('form[id^="bulk-subscription-action-form-"]').exists()).toBe(true)
    replaceAuthSession({ accessToken: 'synthetic-next-subscription-login', user: { id: 7 } }); await flushPromises()
    expect(wrapper.find('form[id^="bulk-subscription-action-form-"]').exists()).toBe(false)
    expect(mocks.bulk).not.toHaveBeenCalled()
  })
})
