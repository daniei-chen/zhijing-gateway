import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SubscriptionMembershipCard from '../SubscriptionMembershipCard.vue'
import { plan } from './fixtures'

vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string, args?: Record<string, unknown>) => args ? `${key}:${JSON.stringify(args)}` : key })
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ cachedPublicSettings: {} }) }))

let wrapper: VueWrapper
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T13:00:00Z')) })
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })

function render(subscription = plan()) {
  wrapper = mount(SubscriptionMembershipCard, { props: { subscription }, global: { stubs: { Icon: true, RouterLink: { template: '<a><slot /></a>' } } } })
  return wrapper
}

describe('membership card native controls', () => {
  it('shows quota summaries before expansion and changes the action label after native toggle', async () => {
    const w = render()
    expect(w.get('summary').text()).toContain('27.16')
    expect(w.get('summary').text()).toContain('453.27')
    expect(w.get('summary').text()).toContain('memberWorkspace.viewDetails')
    ;(w.element as HTMLDetailsElement).open = true
    await w.trigger('toggle')
    expect(w.get('summary').text()).toContain('memberWorkspace.hideDetails')
  })

  it('emits the existing renew action without nesting business buttons in summary', async () => {
    const w = render()
    expect(w.get('summary').find('button, a').exists()).toBe(false)
    await w.get('button').trigger('click')
    expect(w.emitted('renew')).toHaveLength(1)
  })

  it('shows historical usage for an expired plan and keeps renewal hidden for inactive native status', () => {
    const w = render(plan({ status: 'expired' }))
    expect(w.get('summary').text()).toContain('memberWorkspace.quotaHistory')
    expect(w.get('summary').text()).toContain('12.84')
    expect(w.find('button').exists()).toBe(false)
  })

  it('keeps progress accessible and bounded after overuse', () => {
    const w = render(plan({ daily_usage_usd: 55 }))
    expect(w.findAll('[role="progressbar"]')[0].attributes('aria-valuenow')).toBe('100')
    expect(w.findAll('[role="progressbar"]')[0].attributes('aria-valuetext')).toContain('$55.00')
    expect(w.get('summary').text()).toContain('0.00')
  })

  it('keeps one-time expiry wording distinct from a resetting allowance', () => {
    const w = render(plan({ starts_at: '2026-11-04T12:00:00Z', expires_at: '2026-11-04T18:00:00Z' }))
    expect(w.get('.z-membership-quota-label').text()).toContain('userSubscriptions.quotaEndsIn')
  })
})
