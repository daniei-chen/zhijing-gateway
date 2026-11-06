import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AccountUsageCell from '../AccountUsageCell.vue'
import UsageProgressBar from '../UsageProgressBar.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { Account } from '@/types'

vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key
}) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const adapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let nextID = 87000
let result: Record<string, unknown> = {}
let calls: { path: string; params: unknown }[] = []
function account(patch: Record<string, unknown> = {}): Account {
  return { id: ++nextID, name: 'Synthetic usage matrix', platform: 'gemini', type: 'oauth',
    credentials: {}, extra: {}, status: 'active', concurrency: 4, group_ids: [], proxy_id: null, priority: 1,
    error_message: null, last_used_at: null, expires_at: null, auto_pause_on_expired: true,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', schedulable: true,
    rate_limited_at: null, rate_limit_reset_at: null, overload_until: null,
    temp_unschedulable_until: null, temp_unschedulable_reason: null,
    session_window_start: null, session_window_end: null, session_window_status: null, ...patch } as Account
}
async function render(patch: Record<string, unknown> = {}, extraProps: Record<string, unknown> = {}) {
  const value = account(patch)
  const view = mount(AccountUsageCell, { attachTo: document.body, props: { account: value, ...extraProps },
    global: { stubs: {
      // Separate reset/probe workflows are covered by their own suites. Keep their
      // named action slot, while the usage client, progress bars and quota info are real.
      ClaudeResetCreditsCell: { template: '<div><slot name="pre-actions" /></div>' },
      OpenAIQuotaResetCell: { template: '<div><slot name="pre-actions" /></div>' },
      GrokQuotaProbeCell: true
    } }
  })
  views.push(view)
  await flushPromises()
  return view
}
const bars = (view: VueWrapper) => view.findAllComponents(UsageProgressBar)

beforeEach(() => {
  result = {}
  calls = []
  replaceAuthSession({ accessToken: 'synthetic-usage-release', user: { id: 87000, role: 'admin' } })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T04:00:00Z'))
  apiClient.defaults.adapter = async config => {
    calls.push({ path: String(config.url), params: config.params })
    if (config.method !== 'get' || !/^\/admin\/accounts\/\d+\/usage$/.test(String(config.url))) throw new Error(`Unexpected usage matrix endpoint ${config.url}`)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: result } }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = adapter
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('legacy Gemini credentials retain their visible channel and quota policy', () => {
  it.each([
    [{ oauth_type: 'google_one', tier_id: 'GOOGLE_ONE_BASIC' }, 'google one free', 'googleOne.limitsFree'],
    [{ oauth_type: 'google_one', tier_id: 'GOOGLE_ONE_UNKNOWN' }, 'google one free', 'googleOne.limitsFree'],
    [{ oauth_type: 'google_one', tier_id: '' }, 'google one free', 'googleOne.limitsFree'],
    [{ oauth_type: 'google_one', tier_id: 'GOOGLE_ONE_STANDARD' }, 'google one pro', 'googleOne.limitsPro'],
    [{ oauth_type: 'ai_studio', tier_id: 'LEGACY_FREE' }, 'client free', 'aiStudio.limitsFree'],
    [{ oauth_type: 'ai_studio', tier_id: 'PAY' }, 'client paid', 'aiStudio.limitsPaid'],
    [{ project_id: 'synthetic-legacy-project', tier_id: 'ULTRA' }, 'gcp enterprise', 'gcp.limitsEnterprise'],
    [{ project_id: 'synthetic-legacy-project' }, 'gcp standard', 'gcp.limitsStandard']
  ])('renders the legacy credential combination %# from a successful real usage response', async (credentials, label, policy) => {
    const view = await render({ credentials })
    expect(view.text()).toContain(label)
    expect(view.text()).toContain(`admin.accounts.gemini.quotaPolicy.rows.${policy}`)
    expect(view.text()).toContain('admin.accounts.gemini.rateLimit.unlimited')
    expect(calls).toEqual([{ path: `/admin/accounts/${view.props('account').id}/usage`, params: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }])
  })
  it('keeps a minute-only shared response from being presented as a daily consumed percentage', async () => {
    result = { gemini_shared_minute: { utilization: 99, resets_at: '2026-11-06T04:01:00Z' } }
    const view = await render({ credentials: { oauth_type: 'google_one' } })
    expect(bars(view)).toHaveLength(0)
    expect(view.text()).not.toContain('99%')
    expect(view.text()).toContain('admin.accounts.gemini.quotaPolicy.simulatedNote')
  })
  it('renders a flash-only daily response without manufacturing a missing pro window', async () => {
    result = { gemini_flash_daily: { utilization: 47, resets_at: null } }
    const view = await render({ credentials: { oauth_type: 'ai_studio' } })
    expect(bars(view).map(bar => [bar.props('label'), bar.props('utilization')])).toEqual([['flash', 47]])
    expect(view.text()).toContain('47%')
  })
})

describe('Grok billing units and partial quota snapshots', () => {
  it('derives a monthly percentage from cents while retaining weekly and monthly local statistics separately', async () => {
    result = { subscription_tier: 'SuperGrok Heavy', grok_billing: {
      period_type: 'WEEKLY', usage_percent: 36, used_cents: 1250, monthly_limit_cents: 5000,
      period_end: '2026-11-12T00:00:00Z', billing_period_end: '2026-12-01T00:00:00Z'
    }, grok_local_usage_7d: { requests: 7, tokens: 7000, cost: 0.7 }, grok_local_usage_monthly: { requests: 30, tokens: 30000, cost: 3 } }
    const view = await render({ platform: 'grok' })
    expect(bars(view).map(bar => [bar.props('label'), bar.props('utilization')])).toEqual([['7d', 36], ['30d', 25]])
    expect(bars(view)[0]!.props('windowStats')).toMatchObject({ requests: 7, tokens: 7000 })
    expect(bars(view)[1]!.props('windowStats')).toMatchObject({ requests: 30, tokens: 30000 })
    expect(bars(view)[1]!.props('resetsAt')).toBe('2026-12-01T00:00:00Z')
    expect(view.text()).toContain('admin.accounts.usageWindow.grokUsed 12.5/50.0')
  })
  it('does not duplicate a weekly-only percentage into a monthly bar without a monthly limit', async () => {
    result = { grok_billing: { plan: 'SuperGrok', period_type: 'weekly', usage_percent: 34, used_percent: 34 } }
    const view = await render({ platform: 'grok' })
    expect(bars(view).map(bar => bar.props('label'))).toEqual(['7d'])
    expect(view.text()).toContain('34%')
  })
  it('shows a valid prepaid balance without inventing used cents or an absent monthly limit', async () => {
    result = { grok_billing: { plan: 'SuperGrok', prepaid_balance: 103.6 } }
    const view = await render({ platform: 'grok' })
    expect(view.text()).toContain('admin.accounts.usageWindow.grokPrepaid $104')
    expect(view.text()).not.toContain('admin.accounts.usageWindow.grokUsed')
    expect(bars(view)).toHaveLength(0)
  })
  it('defaults missing used cents to zero for a returned positive monthly dollar limit', async () => {
    result = { grok_billing: { plan: 'SuperGrok', monthly_limit: 5 } }
    const view = await render({ platform: 'grok' })
    expect(view.text()).toContain('admin.accounts.usageWindow.grokUsed 0.00/5.00')
    expect(view.text()).not.toContain('NaN')
  })
  it('recognizes a basic entitlement without claiming a measurable free token percentage when the limit is absent', async () => {
    result = { grok_billing: { plan: 'unknown' }, grok_entitlement_status: 'Basic', grok_local_usage_24h: { tokens: 500000 } }
    const view = await render({ platform: 'grok' })
    expect(bars(view)).toHaveLength(0)
    expect(view.text()).toContain('admin.accounts.usageWindow.grokUnknown')
  })
})

describe('Antigravity partial entitlements and zero credits', () => {
  it.each([
    [undefined, null],
    [{ load_code_assist: { currentTier: { id: 'g1-pro-tier' } } }, 'admin.accounts.tier.pro'],
    [{ load_code_assist: { paidTier: { id: 5 }, currentTier: { id: 'g1-ultra-tier' } } }, 'admin.accounts.tier.ultra']
  ])('keeps an available current tier and suppresses nonpositive credit balances %#', async (extra, label) => {
    result = { ai_credits: [{ amount: 0 }, {}], antigravity_quota: { 'gemini-3-flash': { utilization: 0, reset_time: null } } }
    const view = await render({ platform: 'antigravity', extra })
    if (label) expect(view.text()).toContain(label)
    else expect(view.text()).not.toContain('admin.accounts.tier.')
    expect(bars(view).map(bar => [bar.props('label'), bar.props('utilization')])).toEqual([['admin.accounts.usageWindow.gemini3Flash', 0]])
    expect(view.text()).not.toContain('admin.accounts.aiCreditsBalance')
  })
})

describe('API-key weekly reset rows honor the literal backend reset contract', () => {
  it.each([
    [{ quota_weekly_reset_mode: 'fixed', quota_weekly_reset_at: '2026-11-09T09:00:00Z' }, '2026-11-09T09:00:00Z'],
    [{ quota_weekly_reset_mode: 'fixed' }, null],
    [{ quota_weekly_start: '2026-11-05T03:00:00Z' }, '2026-11-12T03:00:00.000Z'],
    [{}, null]
  ])('renders a weekly quota and reset time without making a provider request %#', async (extra, resetsAt) => {
    const view = await render({ platform: 'openai', type: 'apikey', quota_weekly_limit: 40, quota_weekly_used: 10, extra })
    expect(bars(view).map(bar => [bar.props('label'), bar.props('utilization'), bar.props('resetsAt')])).toEqual([['7d', 25, resetsAt]])
    expect(view.text()).toContain('25%')
    expect(calls).toEqual([])
  })
})
