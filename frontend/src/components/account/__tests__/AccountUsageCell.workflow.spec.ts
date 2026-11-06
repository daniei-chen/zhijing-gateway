import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import AccountUsageCell from '../AccountUsageCell.vue'
import UsageProgressBar from '../UsageProgressBar.vue'
import type { Account, AccountUsageInfo } from '@/types'

const { getUsage } = vi.hoisted(() => ({ getUsage: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { accounts: { getUsage } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key
}) }))

const Reset = defineComponent({
  props: ['account'], emits: ['redeemed', 'account-updated'],
  template: '<div><slot name="pre-actions"/><button data-test="redeem" @click="$emit(\'redeemed\')">redeem</button><button data-test="quota-reset" @click="$emit(\'account-updated\', { ...account, quota_used: 0 })">reset</button></div>'
})
const Probe = defineComponent({ emits: ['probed'], template: '<button data-test="probe" @click="$emit(\'probed\')">probe</button>' })
const wrappers: VueWrapper[] = []
let accountID = 51000
function account(overrides: Partial<Account> = {}): Account {
  return { id: ++accountID, name: 'Synthetic usage', platform: 'anthropic', type: 'oauth', credentials: {}, extra: {}, status: 'active', ...overrides } as Account
}
function cell(overrides: Partial<Account> = {}, extraProps: Record<string, unknown> = {}) {
  const wrapper = mount(AccountUsageCell, { props: { account: account(overrides), ...extraProps }, global: { stubs: {
    ClaudeResetCreditsCell: Reset, OpenAIQuotaResetCell: Reset, GrokQuotaProbeCell: Probe,
    AccountQuotaInfo: true, CNProviderQuotaCell: true, CNProviderBalanceCell: true, OllamaCloudUsageCell: true, OpenCodeGoUsageCell: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function usage(percent = 25): AccountUsageInfo {
  return { five_hour: { utilization: percent, resets_at: '2026-11-06T04:00:00Z' } } as AccountUsageInfo
}
function bars(wrapper: VueWrapper) { return wrapper.findAllComponents(UsageProgressBar) }
function activeButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find(button => button.text().includes('admin.accounts.usageWindow.activeQuery'))!
}
beforeEach(() => {
  getUsage.mockReset().mockResolvedValue(usage())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn()
  })) })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('AccountUsageCell request ownership', () => {
  it('keeps the active result when an earlier passive batch updates the public props', async () => {
    const requestBatchedUsage = vi.fn()
    getUsage.mockResolvedValueOnce(usage(72))
    const wrapper = cell({}, { requestBatchedUsage, batchedUsage: usage(11) })
    await flushPromises()
    await activeButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
    await wrapper.setProps({ batchedUsage: usage(13), batchedUsageLoading: false })
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('13%')
    // A fresh explicit refresh still accepts the parent's next batch snapshot.
    await wrapper.setProps({ manualRefreshToken: 1 })
    await wrapper.setProps({ batchedUsage: usage(48), batchedUsageLoading: false })
    expect(wrapper.text()).toContain('48%')
  })

  it('accepts a fresh parent batch after the parent acknowledges the emitted active snapshot', async () => {
    const requestBatchedUsage = vi.fn()
    getUsage.mockResolvedValueOnce(usage(72))
    const wrapper = cell({}, { requestBatchedUsage, batchedUsage: usage(11) })
    await flushPromises()
    await activeButton(wrapper).trigger('click')
    await flushPromises()
    const acknowledgedUsage = wrapper.emitted('usage-loaded')!.at(-1)![0] as AccountUsageInfo
    expect(acknowledgedUsage).toMatchObject({ five_hour: { utilization: 72 } })
    // A real parent writes the event payload back through its reactive map.
    await wrapper.setProps({ batchedUsage: acknowledgedUsage })
    await wrapper.setProps({ batchedUsageLoading: true })
    expect.soft(wrapper.find('.animate-pulse').exists()).toBe(true)
    await wrapper.setProps({ batchedUsage: usage(48), batchedUsageLoading: false })
    expect(wrapper.text()).toContain('48%')
  })

  it('loads a replacement account and rejects the previous row response and event', async () => {
    const old = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(old.promise)
    const wrapper = cell()
    const replacement = account()
    getUsage.mockResolvedValueOnce(usage(72))
    await wrapper.setProps({ account: replacement })
    await flushPromises()
    expect(getUsage).toHaveBeenLastCalledWith(replacement.id, 'passive', false)
    expect(wrapper.text()).toContain('72%')
    old.resolve(usage(13))
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('13%')
    expect(wrapper.emitted('usage-loaded')).toEqual([[usage(72)]])
  })

  it('keeps a newer manual refresh while the previous request finishes', async () => {
    const old = deferred<AccountUsageInfo>()
    const current = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = cell()
    await wrapper.setProps({ manualRefreshToken: 1 })
    old.resolve(usage(13))
    await flushPromises()
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(wrapper.emitted('usage-loaded')).toBeUndefined()
    current.resolve(usage(72))
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
  })

  it('does not replace an active query with an older passive result', async () => {
    const old = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(old.promise).mockResolvedValueOnce(usage(72))
    const wrapper = cell()
    await wrapper.get('[data-test="redeem"]').trigger('click')
    await flushPromises()
    old.resolve(usage(13))
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('13%')
    expect(wrapper.emitted('usage-loaded')).toEqual([[usage(72)]])
  })

  it('does not overwrite parent batch state when a standalone request finishes late', async () => {
    const old = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(old.promise)
    const wrapper = cell()
    const requestBatchedUsage = vi.fn()
    await wrapper.setProps({ requestBatchedUsage, batchedUsage: usage(72) })
    await flushPromises()
    old.resolve(usage(13))
    await flushPromises()
    expect(requestBatchedUsage).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('13%')
  })

  it('does not emit a late active-query result after unmount', async () => {
    const pending = deferred<AccountUsageInfo>()
    const onUsageLoaded = vi.fn()
    const wrapper = cell({}, { onUsageLoaded })
    await flushPromises()
    getUsage.mockReturnValueOnce(pending.promise)
    await activeButton(wrapper).trigger('click')
    const previousEvents = onUsageLoaded.mock.calls.length
    wrapper.unmount()
    pending.resolve(usage(91))
    await flushPromises()
    expect(onUsageLoaded).toHaveBeenCalledTimes(previousEvents)
  })
})

describe('AccountUsageCell rendered states and refresh controls', () => {
  it('renders a loading skeleton, then all Anthropic windows and reset countdowns', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-06T02:00:00Z')
    const pending = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(pending.promise)
    const wrapper = cell({ type: 'setup-token' })
    await flushPromises()
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(wrapper.find('[data-test="redeem"]').exists()).toBe(true)
    pending.resolve({ ...usage(20), seven_day: { utilization: 70, resets_at: '2026-11-08T04:00:00Z' }, seven_day_sonnet: { utilization: 90, resets_at: null }, seven_day_opus: { utilization: 5, resets_at: null }, seven_day_fable: { utilization: 30, resets_at: null } } as AccountUsageInfo)
    await flushPromises()
    expect(wrapper.find('.animate-pulse').exists()).toBe(false)
    expect(bars(wrapper).map(bar => bar.props('label'))).toEqual(['5h', '7d', '7d S', '7d F'])
    expect(wrapper.text()).toContain('2h 0m')
    expect(wrapper.text()).toContain('2d 2h')
    expect(wrapper.text()).toContain('admin.accounts.usageWindow.activeQuery')
    expect(getUsage).toHaveBeenCalledWith(wrapper.props('account').id, 'passive', false)
  })

  it('keeps the redeem action after a passive error, and a successful action recovers', async () => {
    getUsage.mockRejectedValueOnce(new Error('synthetic transport error'))
    const wrapper = cell()
    await flushPromises()
    expect(wrapper.text()).toContain('common.error')
    expect(wrapper.find('[data-test="redeem"]').exists()).toBe(true)
    await wrapper.get('[data-test="redeem"]').trigger('click')
    await flushPromises()
    expect(getUsage).toHaveBeenLastCalledWith(wrapper.props('account').id, 'active', true)
    expect(wrapper.text()).not.toContain('common.error')
    expect(wrapper.text()).toContain('25%')
  })

  it('disables the active query while pending and retains a snapshot on failure', async () => {
    const wrapper = cell()
    await flushPromises()
    const pending = deferred<AccountUsageInfo>()
    getUsage.mockReturnValueOnce(pending.promise)
    await activeButton(wrapper).trigger('click')
    expect(activeButton(wrapper).attributes('disabled')).toBeDefined()
    await activeButton(wrapper).trigger('click')
    expect(getUsage).toHaveBeenCalledTimes(2)
    pending.reject(new Error('synthetic active error'))
    await flushPromises()
    expect(activeButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('25%')
  })

  it('requests batch refresh without doing a standalone fetch', async () => {
    const requestBatchedUsage = vi.fn()
    const wrapper = cell({}, { requestBatchedUsage, batchedUsage: usage(44) })
    await flushPromises()
    expect(requestBatchedUsage).toHaveBeenCalledWith(wrapper.props('account'), undefined)
    expect(wrapper.text()).toContain('44%')
    await wrapper.setProps({ manualRefreshToken: 1, batchedUsageLoading: true })
    expect(requestBatchedUsage).toHaveBeenLastCalledWith(wrapper.props('account'), { force: true })
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    await wrapper.setProps({ batchedUsageLoading: false, batchedUsage: null, batchedUsageError: 'synthetic batch error' })
    expect(wrapper.text()).toContain('synthetic batch error')
    expect(getUsage).not.toHaveBeenCalled()
  })

  it('defers mobile automatic usage until the row intersects, then disconnects', async () => {
    let observe!: IntersectionObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', vi.fn(function(callback: IntersectionObserverCallback) { observe = callback; return { observe: vi.fn(), disconnect } }))
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    const wrapper = cell()
    await flushPromises()
    expect(getUsage).not.toHaveBeenCalled()
    observe([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    expect(getUsage).not.toHaveBeenCalled()
    observe([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    await flushPromises()
    expect(getUsage).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('25%')
    expect(disconnect).toHaveBeenCalled()
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})

describe('AccountUsageCell provider policies', () => {
  it.each([
    ['google_one', 'google_one_free', 'google one free', 'googleOne.limitsFree'],
    ['google_one', 'google_ai_pro', 'google one pro', 'googleOne.limitsPro'],
    ['google_one', 'google_ai_ultra', 'google one ultra', 'googleOne.limitsUltra'],
    ['google_one', 'AI_PREMIUM', 'google one pro', 'googleOne.limitsPro'],
    ['google_one', 'GOOGLE_ONE_UNLIMITED', 'google one ultra', 'googleOne.limitsUltra'],
    ['code_assist', 'gcp_standard', 'gcp standard', 'gcp.limitsStandard'],
    ['code_assist', 'gcp_enterprise', 'gcp enterprise', 'gcp.limitsEnterprise'],
    ['code_assist', 'legacy-enterprise', 'gcp enterprise', 'gcp.limitsEnterprise'],
    ['ai_studio', 'aistudio_paid', 'client paid', 'aiStudio.limitsPaid'],
    ['ai_studio', 'aistudio_free', 'client free', 'aiStudio.limitsFree'],
    ['ai_studio', 'legacy-payg', 'client paid', 'aiStudio.limitsPaid'],
    ['ai_studio', 'unrecognized', 'client', 'aiStudio.limitsFree']
  ])('shows Gemini %s/%s entitlement and its applicable policy', async (oauth_type, tier_id, badge, policy) => {
    getUsage.mockResolvedValueOnce({})
    const wrapper = cell({ platform: 'gemini', credentials: { oauth_type, tier_id } })
    await flushPromises()
    expect(wrapper.text()).toContain(badge)
    expect(wrapper.text()).toContain(`admin.accounts.gemini.quotaPolicy.rows.${policy}`)
    expect(wrapper.get('a').attributes('href')).toBe(oauth_type === 'ai_studio' ? 'https://ai.google.dev/pricing' : 'https://developers.google.com/gemini-code-assist/resources/quotas')
    expect(wrapper.text()).toContain('admin.accounts.gemini.rateLimit.unlimited')
  })

  it.each(['google_one', 'code_assist'])('shows only the shared daily window for %s', async (oauth_type) => {
    getUsage.mockResolvedValueOnce({ gemini_shared_daily: { utilization: 27, resets_at: null }, gemini_pro_daily: { utilization: 80, resets_at: null }, gemini_flash_daily: { utilization: 90, resets_at: null } })
    const wrapper = cell({ platform: 'gemini', credentials: { oauth_type } })
    await flushPromises()
    expect(bars(wrapper).map(bar => bar.props('label'))).toEqual(['1d'])
    expect(wrapper.text()).toContain('27%')
    expect(wrapper.text()).not.toContain('80%')
  })

  it('renders separate AI Studio daily models without substituting minute windows', async () => {
    getUsage.mockResolvedValueOnce({ gemini_pro_daily: { utilization: 33, resets_at: null }, gemini_flash_daily: { utilization: 49, resets_at: null }, gemini_pro_minute: { utilization: 99, resets_at: null } })
    const wrapper = cell({ platform: 'gemini', credentials: { oauth_type: 'ai_studio' } })
    await flushPromises()
    expect(bars(wrapper).map(bar => bar.props('label'))).toEqual(['pro', 'flash'])
    expect(wrapper.text()).toContain('33%')
    expect(wrapper.text()).toContain('49%')
    expect(wrapper.text()).not.toContain('99%')
  })

  it.each([
    ['validation', 'admin.accounts.forbiddenValidation', 'bg-yellow-100'],
    ['violation', 'admin.accounts.forbiddenViolation', 'bg-red-100'],
    ['forbidden', 'admin.accounts.forbidden', 'bg-red-100']
  ])('shows Antigravity %s without presenting stale quota as usable', async (forbidden_type, label, color) => {
    getUsage.mockResolvedValueOnce({ is_forbidden: true, forbidden_type, antigravity_quota: { 'gemini-3-flash': { utilization: 44 } } })
    const wrapper = cell({ platform: 'antigravity' })
    await flushPromises()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.find(`.${color}`).exists()).toBe(true)
    expect(bars(wrapper)).toHaveLength(0)
  })

  it.each([
    [{ needs_reauth: true }, 'admin.accounts.needsReauth'],
    [{ error: 'synthetic rate limit', error_code: 'rate_limited' }, 'admin.accounts.rateLimited'],
    [{ error: 'synthetic network failure', error_code: 'network_error' }, 'admin.accounts.usageError']
  ])('shows the relevant Antigravity recovery status %#', async (state, label) => {
    getUsage.mockResolvedValueOnce(state)
    const wrapper = cell({ platform: 'antigravity' })
    await flushPromises()
    expect(wrapper.text()).toContain(label)
    expect(bars(wrapper)).toHaveLength(0)
  })

  it.each([
    ['free-tier', 'admin.accounts.tier.free', 'bg-gray-100'],
    ['g1-pro-tier', 'admin.accounts.tier.pro', 'bg-blue-100'],
    ['g1-ultra-tier', 'admin.accounts.tier.ultra', 'bg-purple-100']
  ])('uses the paid Antigravity tier when available: %s', async (id, label, color) => {
    getUsage.mockResolvedValueOnce({ antigravity_quota: {} })
    const wrapper = cell({ platform: 'antigravity', extra: { load_code_assist: { paidTier: { id }, currentTier: { id: 'free-tier' }, ineligibleTiers: [{}] } } })
    await flushPromises()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.find(`.${color}`).exists()).toBe(true)
    expect(wrapper.text()).toContain('admin.accounts.ineligibleWarning')
  })

  it('aggregates Antigravity highest model usage and earliest reset and keeps zero windows', async () => {
    getUsage.mockResolvedValueOnce({ antigravity_quota: {
      'gemini-3-pro-low': { utilization: 10, reset_time: '2026-11-07T00:00:00Z' },
      'gemini-3-pro-high': { utilization: 70, reset_time: '2026-11-08T00:00:00Z' },
      'gemini-3-flash': { utilization: 0, reset_time: null },
      'claude-sonnet-4-6': { utilization: 80, reset_time: null }
    }, ai_credits: [{ amount: 40 }, { amount: 12.4 }, {}] })
    const wrapper = cell({ platform: 'antigravity' })
    await flushPromises()
    expect(bars(wrapper).map(bar => [bar.props('label'), bar.props('utilization')])).toEqual([
      ['admin.accounts.usageWindow.gemini3Pro', 70], ['admin.accounts.usageWindow.gemini3Flash', 0], ['admin.accounts.usageWindow.claude', 80]
    ])
    expect(bars(wrapper)[0].props('resetsAt')).toBe('2026-11-07T00:00:00Z')
    expect(wrapper.text()).toContain('admin.accounts.aiCreditsBalance: 52')
  })

  it.each([
    [15, '15s', 'no_headers', 'admin.accounts.usageWindow.grokNoHeaders'],
    [61, '2m', 'unknown', 'admin.accounts.usageWindow.grokUnknown']
  ])('shows Grok unknown quota with retry-after %s', async (grok_retry_after_seconds, time, grok_quota_snapshot_state, label) => {
    getUsage.mockResolvedValueOnce({ grok_retry_after_seconds, grok_quota_snapshot_state })
    const wrapper = cell({ platform: 'grok' })
    await flushPromises()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).toContain(`"time":"${time}"`)
    expect(bars(wrapper)).toHaveLength(0)
    await wrapper.get('[data-test="probe"]').trigger('click')
    await flushPromises()
    expect(getUsage).toHaveBeenLastCalledWith(wrapper.props('account').id, 'active', true)
  })

  it('forwards quota reset updates through the public account-updated event', async () => {
    const wrapper = cell({ platform: 'openai' })
    await flushPromises()
    await wrapper.get('[data-test="quota-reset"]').trigger('click')
    expect(wrapper.emitted('account-updated')).toEqual([[{ ...wrapper.props('account'), quota_used: 0 }]])
  })

  it.each([
    ['rolling', 'quota_daily_start', '2026-11-06T02:00:00Z', '2026-11-07T02:00:00.000Z'],
    ['fixed', 'quota_daily_reset_at', '2026-11-07T09:00:00Z', '2026-11-07T09:00:00Z']
  ])('renders the %s API-key daily reset contract', async (mode, key, value, expected) => {
    const wrapper = cell({ platform: 'anthropic', type: 'apikey', quota_daily_limit: 100, quota_daily_used: 45, extra: { quota_daily_reset_mode: mode, [key]: value } })
    expect(getUsage).not.toHaveBeenCalled()
    expect(bars(wrapper)[0].props('resetsAt')).toBe(expected)
    expect(wrapper.text()).toContain('45%')
  })
})
