import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SubscriptionsView from '../SubscriptionsView.vue'
import { plan } from '@/components/user/subscriptions/__tests__/fixtures'

const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), error: vi.fn() }))
vi.mock('@/api/subscriptions', () => ({ default: { getMySubscriptions: mocks.get } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string) => key })
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.error }) }))

function render() {
  return mount(SubscriptionsView, { global: { stubs: {
    AppLayout: { template: '<main><slot /></main>' }, Icon: true,
    WorkspaceLoadError: { emits: ['retry'], template: '<button class="retry" @click="$emit(\'retry\')">retry</button>' },
    SubscriptionMembershipCard: { props: ['subscription'], emits: ['renew'], template: '<button class="renew" @click="$emit(\'renew\')">{{ subscription.group_id }}</button>' }
  } } })
}

beforeEach(() => vi.clearAllMocks())

describe('subscription loading and native navigation', () => {
  it('keeps failed loading distinct from no subscriptions and retries the same existing endpoint', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.get.mockRejectedValueOnce(new Error('local failure')).mockResolvedValueOnce([])
    const w = render()
    await flushPromises()
    expect(w.find('.retry').exists()).toBe(true)
    expect(w.text()).not.toContain('userSubscriptions.noActiveSubscriptions')
    await w.get('.retry').trigger('click')
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('userSubscriptions.noActiveSubscriptions')
    w.unmount()
    consoleError.mockRestore()
  })

  it('keeps renewal scoped to the selected group and the native subscription purchase tab', async () => {
    mocks.get.mockResolvedValue([plan(), plan({ id: 13, group_id: 22 })])
    const w = render()
    await flushPromises()
    await w.findAll('.renew')[1].trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/purchase', query: { tab: 'subscription', group: '22' } })
    w.unmount()
  })
})
