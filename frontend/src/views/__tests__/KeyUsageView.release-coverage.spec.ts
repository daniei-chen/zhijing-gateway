/** Public key-usage query UI with its actual fetch transport and synthetic responses. */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyUsageView from '../KeyUsageView.vue'

const fixture = vi.hoisted(() => ({ app: null as Record<string, unknown> | null, language: 'en', success: vi.fn(), error: vi.fn(), info: vi.fn(), settings: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => fixture.app }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref(fixture.language), t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }) }))
let view: VueWrapper | undefined
let payload: Record<string, unknown>
let refusal: { status: number; body: unknown; raw?: boolean } | undefined
let networkError: Error | undefined
let gate: { promise: Promise<void>; resolve: () => void } | undefined
let requests: { url: URL; authorization: string }[]
const now = new Date('2026-11-06T04:00:00Z')
const quota = (patch: Record<string, unknown> = {}) => ({ mode: 'quota_limited', isValid: true, status: 'active', quota: { limit: 100, used: 25, remaining: 75 }, ...patch })
const subscription = (patch: Record<string, unknown> = {}) => ({ mode: 'subscription', planName: 'Synthetic member plan', remaining: 18, subscription: { daily_limit_usd: 10, daily_usage_usd: 9.5, weekly_limit_usd: 100, weekly_usage_usd: 75, monthly_limit_usd: 300, monthly_usage_usd: 30, expires_at: '2026-12-01T00:00:00Z', ...patch } })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear(); document.documentElement.classList.remove('dark')
  fixture.language = 'en'; for (const mock of [fixture.success, fixture.error, fixture.info, fixture.settings]) mock.mockReset()
  fixture.app = reactive({ cachedPublicSettings: { site_name: 'Synthetic gateway', site_logo: '/synthetic.svg', doc_url: 'https://docs.example.test/guide', subscription_enabled: true }, siteName: '', siteLogo: '', docUrl: '', publicSettingsLoaded: true, fetchPublicSettings: fixture.settings, showSuccess: fixture.success, showError: fixture.error, showInfo: fixture.info })
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  payload = quota(); refusal = undefined; networkError = undefined; gate = undefined; requests = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const target = new URL(url, 'http://localhost'); expect(target.pathname).toBe('/v1/usage')
    requests.push({ url: target, authorization: (init?.headers as Record<string, string>).Authorization })
    if (gate) await gate.promise
    if (networkError) throw networkError
    if (refusal) return new Response(refusal.raw ? String(refusal.body) : JSON.stringify(refusal.body), { status: refusal.status })
    return new Response(JSON.stringify(payload), { status: 200 })
  }))
})
afterEach(async () => { view?.unmount(); view = undefined; gate?.resolve(); await flushPromises(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.classList.remove('dark'); document.body.innerHTML = '' })
async function render() { view = mount(KeyUsageView, { attachTo: document.body, global: { stubs: { RouterLink: { template: '<a><slot/></a>' }, LocaleSwitcher: true } } }); await flushPromises(); return view }
function action(text: string, last = false) { const buttons = view!.findAll('button').filter(node => node.text() === text); expect(buttons.length, text).toBeGreaterThan(0); return last ? buttons.at(-1)! : buttons[0] }
async function query() { await view!.get('input[placeholder="keyUsage.placeholder"]').setValue('  synthetic-key-207  '); await view!.get('input[placeholder="keyUsage.placeholder"]').trigger('keydown.enter'); await flushPromises() }
function row(label: string) { const item = view!.findAll('.divide-y > div').find(node => node.findAll('span').some(span => span.text() === label)); expect(item, label).toBeDefined(); return item! }
async function animate() { await vi.advanceTimersByTimeAsync(1200); await flushPromises() }

describe('public key usage release contracts', () => {
  it('requires a key, toggles key visibility and sends only the trimmed bearer to the usage endpoint', async () => {
    await render(); await action('keyUsage.query').trigger('click'); expect(fixture.info).toHaveBeenCalledWith('keyUsage.enterApiKey'); expect(requests).toHaveLength(0)
    const input = view!.get('input[placeholder="keyUsage.placeholder"]'); expect(input.attributes('type')).toBe('password'); await input.element.parentElement!.querySelector('button')!.click(); await flushPromises(); expect(input.attributes('type')).toBe('text')
    await query(); expect(requests[0].authorization).toBe('Bearer synthetic-key-207'); expect(fixture.success).toHaveBeenCalledWith('keyUsage.querySuccess'); expect(localStorage.getItem('synthetic-key-207')).toBeNull()
  })
  it('applies 7-day and 30-day date ranges through visible controls with browser timezone and explicit date strings', async () => {
    await render(); await query(); await action('keyUsage.dateRange7d').trigger('click'); await flushPromises(); let params = requests.at(-1)!.url.searchParams
    expect(params.get('start_date')).toBe('2026-10-30'); expect(params.get('end_date')).toBe('2026-11-06'); expect(params.get('timezone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    await action('keyUsage.dateRange30d').trigger('click'); await flushPromises(); params = requests.at(-1)!.url.searchParams; expect(params.get('start_date')).toBe('2026-10-07')
  })
  it('keeps a custom range local until Apply and sends its exact pair, omitting incomplete dates', async () => {
    await render(); await query(); await action('keyUsage.dateRangeCustom').trigger('click'); expect(requests).toHaveLength(1); await action('keyUsage.apply').trigger('click'); await flushPromises(); expect(requests.at(-1)!.url.searchParams.has('start_date')).toBe(false)
    const dates = view!.findAll('input[type="date"]'); await dates[0].setValue('2026-10-01'); await dates[1].setValue('2026-10-19'); await action('keyUsage.apply').trigger('click'); await flushPromises()
    expect(requests.at(-1)!.url.searchParams.get('start_date')).toBe('2026-10-01'); expect(requests.at(-1)!.url.searchParams.get('end_date')).toBe('2026-10-19')
  })
  it('changes daily detail windows without changing the date range and avoids a redundant same-window query', async () => {
    payload.daily_usage = []; await render(); await query(); await action('keyUsage.dateRange7d', true).trigger('click'); await flushPromises(); expect(requests.at(-1)!.url.searchParams.get('days')).toBe('7')
    await action('keyUsage.dateRange7d', true).trigger('click'); await flushPromises(); expect(requests).toHaveLength(2)
    await action('keyUsage.dateRange90d', true).trigger('click'); await flushPromises(); expect(requests.at(-1)!.url.searchParams.get('days')).toBe('90'); expect(view!.text()).toContain('keyUsage.noDailyUsage')
  })
  it('animates bounded quota and rate-limit rings, including unknown and unlimited windows', async () => {
    payload = quota({ quota: { limit: 100, used: 140, remaining: 0 }, rate_limits: [{ window: '5h', limit: 10, used: 9.5, reset_at: '2026-11-08T06:00:00Z' }, { window: '1d', limit: 100, used: 75, reset_at: '2026-11-06T06:15:00Z' }, { window: '7d', limit: 100, used: 30, reset_at: '2026-11-06T04:20:00Z' }, { window: 'custom', limit: 0, used: 0, reset_at: null }] })
    await render(); await query(); await animate(); expect(view!.text()).toContain('100%'); expect(view!.text()).toContain('0%'); expect(view!.text()).toContain('2d 2h'); expect(view!.text()).toContain('2h 15m'); expect(view!.text()).toContain('20m')
    expect(row('keyUsage.usedQuota (5H)').get('span.font-semibold').classes()).toContain('text-rose-500'); expect(row('keyUsage.usedQuota (D)').get('span.font-semibold').classes()).toContain('text-amber-500'); expect(row('keyUsage.usedQuota (custom)').text()).toContain('$0.00 / $0.00')
  })
  it.each([[0, 'text-rose-500'], [5, 'text-amber-500'], [75, 'text-emerald-500']] as const)('represents remaining quota %s using the matching warning color', async (remaining, color) => {
    payload = quota({ quota: { limit: 100, used: 100 - remaining, remaining } }); await render(); await query(); expect(row('keyUsage.remainingQuota').text()).toContain(`$${remaining.toFixed(2)}`); expect(row('keyUsage.remainingQuota').get('span.font-semibold').classes()).toContain(color)
  })
  it.each([[3, 'keyUsage.daysLeft:3'], [0, 'keyUsage.todayExpires'], [-1, 'November'], [null, 'November']] as const)('shows an explicit expiration with %s days remaining', async (days, label) => {
    payload = quota({ expires_at: '2026-11-09T00:00:00Z', days_until_expiry: days }); await render(); await query(); expect(row('keyUsage.expiresAt').text()).toContain(label)
  })
  it.each([['quota_exhausted', 'Quota Exhausted'], ['expired', 'Expired'], ['custom_status', 'custom_status'], ['', 'Unknown']] as const)('preserves inactive or unknown quota status %s visibly', async (status, label) => {
    payload = quota({ status, isValid: false, quota: { limit: 0, used: 0, remaining: 0 } }); await render(); await query(); await animate(); expect(view!.text()).toContain(label); expect(view!.get('.pulse-dot').classes()).toContain('bg-rose-500'); expect(view!.text()).toContain('0%')
  })
  it.each(['en', 'zh'])('renders subscription daily/weekly/monthly quotas and expiry in %s', async language => {
    fixture.language = language; payload = subscription(); await render(); await query(); await animate(); expect(view!.text()).toContain('Synthetic member plan'); expect(view!.text()).toContain('95%'); expect(view!.text()).toContain('75%'); expect(view!.text()).toContain('10%'); expect(row('keyUsage.subscriptionExpires').text()).toContain('2026'); expect(view!.findAll('.progress-ring')).toHaveLength(3)
    expect(row(`keyUsage.usedQuota (${language === 'zh' ? '日' : 'D'})`).get('span.font-semibold').classes()).toContain('text-rose-500')
  })
  it('does not invent rings for disabled subscription quotas and renders a two-ring layout when one period is unlimited', async () => {
    payload = subscription({ monthly_limit_usd: 0 }); await render(); await query(); expect(view!.findAll('.progress-ring')).toHaveLength(2); expect(view!.find('.md\\:grid-cols-2').exists()).toBe(true)
  })
  it.each([[0, 'text-rose-500'], [5, 'text-amber-500'], [20, 'text-emerald-500'], [null, 'text-gray-900']] as const)('shows wallet remaining %s without borrowing subscription limits', async (remaining, color) => {
    payload = { mode: 'wallet', balance: 25, remaining, subscription: null }; await render(); await query(); await animate(); expect(view!.text()).toContain('keyUsage.walletBalance'); expect(view!.findAll('.progress-ring')).toHaveLength(1); expect(view!.get('.progress-ring').attributes('stroke-dashoffset')).toBe('0'); expect(row('keyUsage.remainingQuota').get('span.font-semibold').classes()).toContain(color)
  })
  it('uses actual model cost when present, estimated cost when absent, and dashes for unknown numeric values', async () => {
    payload = { mode: 'wallet', balance: null, remaining: null, usage: { today: {}, total: {}, average_duration_ms: 15.6 }, model_stats: [{ model: 'synthetic-sol', requests: 1000, cost: 9, actual_cost: 1.2 }, { model: '', requests: null, cost: 2, actual_cost: null }, { model: 'unknown', actual_cost: -1 }], daily_usage: 'unsupported-shape' }
    await render(); await query(); expect(view!.findAll('.progress-ring')).toHaveLength(0); const rows = view!.findAll('tbody tr'); expect(rows).toHaveLength(3); expect(rows[0].text()).toContain('$1.20'); expect(rows[1].text()).toContain('$2.00'); expect(rows[2].text()).not.toContain('$-1'); expect(view!.text()).toContain('16 ms'); expect(view!.text()).not.toContain('keyUsage.dailyDetail')
  })
  it.each([[{ error: { message: 'Synthetic nested refusal' } }, 'Synthetic nested refusal', false], [{ message: 'Synthetic top-level refusal' }, 'Synthetic top-level refusal', false], ['not-json', 'keyUsage.queryFailed (503)', true]] as const)('shows a transport refusal and lets the same visible key retry successfully (%s)', async (body, message, raw) => {
    refusal = { status: 503, body, raw }; await render(); await query(); expect(fixture.error).toHaveBeenCalledWith(message); expect(view!.text()).not.toContain('keyUsage.detailInfo'); refusal = undefined; await action('keyUsage.query').trigger('click'); await flushPromises(); expect(fixture.success).toHaveBeenCalledWith('keyUsage.querySuccess'); expect(requests).toHaveLength(2)
  })
  it('keeps one request while the same query is pending and recovers from a network exception', async () => {
    let resolve!: () => void; gate = { promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }; await render(); await view!.get('input').setValue('synthetic-key-207'); await view!.get('input').trigger('keydown.enter'); await view!.get('input').trigger('keydown.enter'); expect(requests).toHaveLength(1); expect(action('keyUsage.querying').attributes('disabled')).toBeDefined()
    networkError = new Error('Synthetic offline'); gate.resolve(); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('Synthetic offline'); networkError = undefined; gate = undefined; await action('keyUsage.query').trigger('click'); await flushPromises(); expect(requests).toHaveLength(2)
  })
  it('toggles persisted theme and respects sanitized branding fallbacks while requesting missing public settings', async () => {
    fixture.app!.cachedPublicSettings = { site_logo: 'javascript:alert(1)', doc_url: 'javascript:alert(1)' }; fixture.app!.publicSettingsLoaded = false; localStorage.setItem('theme', 'dark'); await render(); expect(fixture.settings).toHaveBeenCalledOnce(); expect(view!.get('nav span').text()).toBe('Sub2API'); expect(view!.get('nav img').attributes('src')).toBe('/logo.svg'); expect(view!.find('a[title="home.viewDocs"]').exists()).toBe(false)
    await view!.get('button[title="home.switchToLight"]').trigger('click'); expect(localStorage.getItem('theme')).toBe('light'); await view!.get('button[title="home.switchToDark"]').trigger('click'); expect(localStorage.getItem('theme')).toBe('dark')
  })
})
