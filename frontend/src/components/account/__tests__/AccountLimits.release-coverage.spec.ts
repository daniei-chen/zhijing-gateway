import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AccountCapacityCell from '../AccountCapacityCell.vue'
import AccountQuotaInfo from '../AccountQuotaInfo.vue'
import type { Account } from '@/types'

vi.mock('vue-i18n', async () => ({
  ...await vi.importActual('vue-i18n'),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key} ${JSON.stringify(params)}` : key })
}))

const views: VueWrapper[] = []
function account(patch: Record<string, unknown> = {}): Account {
  return {
    id: 404, name: 'Synthetic limits account', platform: 'anthropic', type: 'oauth',
    credentials: {}, extra: {}, status: 'active', concurrency: 4, priority: 1,
    rate_multiplier: 1, group_ids: [], created_at: '2026-11-06T00:00:00Z',
    updated_at: '2026-11-06T00:00:00Z', ...patch
  } as unknown as Account
}
function capacity(patch: Record<string, unknown> = {}) {
  const view = mount(AccountCapacityCell, { props: { account: account(patch) } })
  views.push(view)
  return view
}
function quota(credentials: Record<string, unknown> | undefined, patch: Record<string, unknown> = {}) {
  const view = mount(AccountQuotaInfo, { props: { account: account({ platform: 'gemini', credentials, ...patch }) } })
  views.push(view)
  return view
}
function badge(view: VueWrapper, title: string) {
  const found = view.findAll('span[title]').find(node => node.attributes('title')?.startsWith(title))
  expect(found, `visible badge ${title}`).toBeDefined()
  return found!
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-06T04:00:00Z'))
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('actual account capacity badges interpret the returned limits without changing them', () => {
  it('updates a row from idle through busy to full concurrency using successive public account DTOs', async () => {
    const view = capacity()
    const first = () => view.get('div > span')
    expect(first().text()).toBe('0/4')
    expect(first().classes()).toContain('bg-gray-100')
    await view.setProps({ account: account({ current_concurrency: 2 }) })
    expect(first().text()).toBe('2/4')
    expect(first().classes()).toContain('bg-yellow-100')
    await view.setProps({ account: account({ current_concurrency: 4 }) })
    expect(first().text()).toBe('4/4')
    expect(first().classes()).toContain('bg-red-100')
  })
  it.each(['oauth', 'setup-token'])('separates normal, warning, sticky-only and blocked %s window cost states', async type => {
    const value = { type, window_cost_limit: 100, window_cost_sticky_reserve: 10 }
    const view = capacity({ ...value, current_window_cost: 79.25 })
    let current = badge(view, 'admin.accounts.capacity.windowCost.normal')
    expect(current.text()).toBe('$79.25/$100.00')
    expect(current.classes()).toContain('bg-emerald-100')
    await view.setProps({ account: account({ ...value, current_window_cost: 80 }) })
    current = badge(view, 'admin.accounts.capacity.windowCost.normal')
    expect(current.classes()).toContain('bg-yellow-100')
    await view.setProps({ account: account({ ...value, current_window_cost: 100 }) })
    current = badge(view, 'admin.accounts.capacity.windowCost.stickyOnly')
    expect(current.text()).toBe('$100.00/$100.00')
    expect(current.classes()).toContain('bg-orange-100')
    await view.setProps({ account: account({ ...value, current_window_cost: 110 }) })
    current = badge(view, 'admin.accounts.capacity.windowCost.blocked')
    expect(current.text()).toBe('$110.00/$100.00')
    expect(current.classes()).toContain('bg-red-100')
  })
  it('uses the backend-default reserve and idle timeout while allowing missing current metrics to display zero', () => {
    const view = capacity({ window_cost_limit: 100, max_sessions: 5, base_rpm: 15 })
    expect(badge(view, 'admin.accounts.capacity.windowCost.normal').text()).toBe('$0.00/$100.00')
    expect(badge(view, 'admin.accounts.capacity.sessions.normal').text()).toBe('0/5')
    expect(badge(view, 'admin.accounts.capacity.sessions.normal').attributes('title')).toContain('"idle":5')
    expect(badge(view, 'admin.accounts.capacity.rpm.tieredNormal').text()).toBe('0/15[T]')
  })
  it('marks a session limit near capacity, then full, without confusing it with the concurrency maximum', async () => {
    const value = { max_sessions: 10, session_idle_timeout_minutes: 9, concurrency: 3 }
    const view = capacity({ ...value, active_sessions: 2 })
    expect(badge(view, 'admin.accounts.capacity.sessions.normal').classes()).toContain('bg-emerald-100')
    await view.setProps({ account: account({ ...value, active_sessions: 8 }) })
    expect(badge(view, 'admin.accounts.capacity.sessions.normal').text()).toBe('8/10')
    expect(badge(view, 'admin.accounts.capacity.sessions.normal').classes()).toContain('bg-yellow-100')
    await view.setProps({ account: account({ ...value, active_sessions: 10 }) })
    expect(badge(view, 'admin.accounts.capacity.sessions.full').text()).toBe('10/10')
    expect(badge(view, 'admin.accounts.capacity.sessions.full').attributes('title')).toContain('"idle":9')
    expect(badge(view, 'admin.accounts.capacity.sessions.full').classes()).toContain('bg-red-100')
    expect(view.get('div > span').text()).toBe('0/3')
  })
  it.each([
    ['tiered', 10, 'tieredNormal', 'bg-emerald-100', '[T]'],
    ['tiered', 16, 'tieredWarning', 'bg-yellow-100', '[T]'],
    ['tiered', 20, 'tieredStickyOnly', 'bg-orange-100', '[T]'],
    ['tiered', 24, 'tieredBlocked', 'bg-red-100', '[T]'],
    ['sticky_exempt', 10, 'stickyExemptNormal', 'bg-emerald-100', '[S]'],
    ['sticky_exempt', 16, 'stickyExemptWarning', 'bg-yellow-100', '[S]'],
    ['sticky_exempt', 24, 'stickyExemptOver', 'bg-orange-100', '[S]']
  ])('explains the %s RPM policy at %s requests per minute', (strategy, rpm, message, color, suffix) => {
    const view = capacity({ base_rpm: 20, current_rpm: rpm, rpm_strategy: strategy })
    const current = badge(view, `admin.accounts.capacity.rpm.${message}`)
    expect(current.text()).toBe(`${rpm}/20${suffix}`)
    expect(current.classes()).toContain(color)
    if (message === 'tieredStickyOnly' || message === 'tieredBlocked') expect(current.attributes('title')).toContain('"buffer":4')
  })
  it('honors an explicit zero RPM buffer and an explicitly configured positive buffer', async () => {
    const view = capacity({ base_rpm: 10, current_rpm: 10, rpm_strategy: 'tiered', rpm_sticky_buffer: 0 })
    expect(badge(view, 'admin.accounts.capacity.rpm.tieredBlocked').attributes('title')).toContain('"buffer":0')
    await view.setProps({ account: account({ base_rpm: 10, current_rpm: 10, rpm_strategy: 'tiered', rpm_sticky_buffer: 8 }) })
    expect(badge(view, 'admin.accounts.capacity.rpm.tieredStickyOnly').attributes('title')).toContain('"buffer":8')
    expect(badge(view, 'admin.accounts.capacity.rpm.tieredStickyOnly').classes()).toContain('bg-orange-100')
  })
  it.each([
    ['openai', 'oauth'], ['gemini', 'oauth'], ['anthropic', 'apikey'], ['anthropic', 'bedrock'], ['anthropic', 'service_account']
  ])('does not mislabel %s %s with Anthropic OAuth-only window/session/RPM policies', (platform, type) => {
    const view = capacity({ platform, type, window_cost_limit: 100, max_sessions: 5, base_rpm: 20 })
    expect(view.findAll('span[title]')).toHaveLength(0)
    expect(view.text()).toBe('0/4')
  })
  it.each(['apikey', 'bedrock', 'service_account'])('shows independent daily, weekly and lifetime %s quota states', type => {
    const view = capacity({ type, quota_daily_limit: 10, quota_daily_used: 8,
      quota_weekly_limit: 40, quota_weekly_used: 4, quota_limit: 100, quota_used: 100 })
    const quotas = view.findAll('span[title^="admin.accounts.capacity.quota."]')
    expect(quotas).toHaveLength(3)
    expect(quotas[0]!.text()).toBe('D$8.00/$10.00')
    expect(quotas[0]!.classes()).toContain('bg-yellow-100')
    expect(quotas[1]!.text()).toBe('W$4.00/$40.00')
    expect(quotas[1]!.classes()).toContain('bg-emerald-100')
    expect(quotas[2]!.text()).toBe('$100.00/$100.00')
    expect(quotas[2]!.attributes('title')).toBe('admin.accounts.capacity.quota.exceeded')
    expect(quotas[2]!.classes()).toContain('bg-red-100')
  })
  it('keeps upstream accounts outside the existing API-key/Bedrock/service-account quota contract', () => {
    const view = capacity({ type: 'upstream', quota_daily_limit: 10, quota_weekly_limit: 20, quota_limit: 100 })
    expect(view.findAll('span[title^="admin.accounts.capacity.quota."]')).toHaveLength(0)
    expect(view.text()).toBe('0/4')
  })
  it('hides absent or zero quota ceilings while displaying an eligible missing-used amount as zero', async () => {
    const view = capacity({ type: 'apikey', quota_daily_limit: 0, quota_weekly_limit: null, quota_limit: 10 })
    expect(view.findAll('span[title^="admin.accounts.capacity.quota."]')).toHaveLength(1)
    expect(badge(view, 'admin.accounts.capacity.quota.normal').text()).toBe('$0.00/$10.00')
    await view.setProps({ account: account({ type: 'oauth', quota_daily_limit: 10, quota_weekly_limit: 20, quota_limit: 30 }) })
    expect(view.findAll('span[title^="admin.accounts.capacity.quota."]')).toHaveLength(0)
  })
})

describe('Gemini quota identity and rate-limit countdown from public account DTOs', () => {
  it.each([
    ['code_assist', 'gcp_enterprise', 'GCP Enterprise', 'bg-purple-100'],
    ['code_assist', 'gcp_standard', 'GCP Standard', 'bg-blue-100'],
    ['code_assist', 'LEGACY_ULTRA', 'GCP Enterprise', 'bg-purple-100'],
    ['code_assist', 'legacy_enterprise', 'GCP Enterprise', 'bg-purple-100'],
    ['code_assist', 'legacy_business', 'GCP LEGACY_BUSINESS', 'bg-blue-100'],
    ['code_assist', '', 'GCP', 'bg-blue-100'],
    ['google_one', 'google_ai_ultra', 'Google AI Ultra', 'bg-purple-100'],
    ['google_one', 'google_ai_pro', 'Google AI Pro', 'bg-blue-100'],
    ['google_one', 'google_one_free', 'Google One Free', 'bg-gray-100'],
    ['google_one', 'GOOGLE_ONE_UNLIMITED', 'Google AI Ultra', 'bg-purple-100'],
    ['google_one', 'AI_PREMIUM', 'Google AI Pro', 'bg-blue-100'],
    ['google_one', 'legacy_plus', 'Google One LEGACY_PLUS', 'bg-gray-100'],
    ['google_one', '', 'Google One', 'bg-gray-100'],
    ['ai_studio', 'aistudio_paid', 'AI Studio Pay-as-you-go', 'bg-blue-100'],
    ['ai_studio', 'aistudio_free', 'AI Studio Free Tier', 'bg-gray-100'],
    ['ai_studio', '', 'AI Studio', 'bg-blue-100']
  ])('retains the human-readable %s/%s account tier and its semantic badge', (mode, tier, label, color) => {
    const view = quota({ oauth_type: mode, tier_id: tier })
    const rendered = view.get('span.badge')
    expect(rendered.text()).toBe(label)
    expect(rendered.classes()).toContain(color)
    expect(view.text()).toContain('admin.accounts.gemini.rateLimit.unlimited')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('identifies a legacy project credential as Code Assist without requiring a newly added oauth_type', () => {
    const view = quota({ project_id: 'synthetic-legacy-project', tier_id: ' GCP_STANDARD ' })
    expect(view.get('span.badge').text()).toBe('GCP Standard')
    expect(view.get('span.badge').classes()).toContain('bg-blue-100')
  })
  it('keeps an account without credential metadata inspectable as AI Studio and hides the badge for another platform', async () => {
    const view = quota(undefined)
    expect(view.get('span.badge').text()).toBe('AI Studio')
    await view.setProps({ account: account({ platform: 'openai' }) })
    expect(view.find('span.badge').exists()).toBe(false)
  })
  it.each([undefined, 'not-a-date', '2026-11-06T03:00:00Z'])('does not invent an active throttle for an unset/invalid/expired reset timestamp %s', reset => {
    const view = quota({}, { rate_limit_reset_at: reset })
    expect(view.text()).toContain('admin.accounts.gemini.rateLimit.unlimited')
    expect(view.text()).not.toContain('admin.accounts.gemini.rateLimit.limited ')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('counts down seconds, marks an urgent throttle, and stops its timer once the server reset time arrives', async () => {
    const view = quota({}, { rate_limit_reset_at: '2026-11-06T04:00:45Z' })
    expect(view.text()).toContain('"time":"45s"')
    expect(view.get('.animate-pulse').classes()).toContain('text-red-600')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(46000)
    expect(view.text()).toContain('admin.accounts.gemini.rateLimit.unlimited')
    expect(view.find('.animate-pulse').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    ['2026-11-06T04:01:30Z', '1m 30s'],
    ['2026-11-06T06:05:00Z', '2h 5m']
  ])('renders a nonurgent server throttle until %s without dropping minute/hour precision', (reset, text) => {
    const view = quota({}, { rate_limit_reset_at: reset })
    expect(view.text()).toContain(`"time":"${text}"`)
    expect(view.find('.text-amber-600').exists()).toBe(true)
    expect(view.find('.animate-pulse').exists()).toBe(false)
  })
  it('releases a pending reset timer when a row is removed from the current account list', () => {
    const view = quota({}, { rate_limit_reset_at: '2026-11-06T05:00:00Z' })
    expect(vi.getTimerCount()).toBe(1)
    views.splice(views.indexOf(view), 1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
