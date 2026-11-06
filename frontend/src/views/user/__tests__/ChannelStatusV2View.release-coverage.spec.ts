/** Rendered monitor workflows with real V2 HTTP transport; all responses synthetic. */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import ChannelStatusV2View from '../ChannelStatusV2View.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { MonitorCoverage, MonitorMetric, MonitorHealth, MonitorSnapshot, MonitorMatrixRow, MonitorModelRow, MonitorErrorRow, MonitorUserRow } from '@/api/channelMonitorV2'

const fixture = vi.hoisted(() => ({ auth: null as { isAdmin: boolean } | null, hideThroughput: false, hideRanking: false, translatedErrors: false, error: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => fixture.auth }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: fixture.error }) }))
vi.mock('@/utils/featureFlags', () => ({ isChannelMonitorThroughputHidden: () => fixture.hideThroughput, isChannelMonitorUserRankingHidden: () => fixture.hideRanking }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : ''), te: () => fixture.translatedErrors, locale: ref('en') }) }))
// ChartJS canvas is replaced only at its public renderer boundary. The real
// MonitorTrendChart still computes its datasets/options and the real pulse matrix renders.
vi.mock('vue-chartjs', () => ({ Line: defineComponent({ props: ['data', 'options'], setup: props => () => h('div', { 'data-chart': 'line', 'data-series': JSON.stringify(props.data) }) }) }))

const metric = (patch: Partial<MonitorMetric> = {}): MonitorMetric => ({ success_requests: 90, error_requests: 10, request_count: 100, token_count: 60000, rpm: 120, tpm: 3600, error_rate: 0.1, cache_rate: 0.8, cache_rate_numerator: 80, cache_rate_denominator: 100, ttft: { sample_count: 90, p50_ms: 500, p90_ms: 900, p95_ms: 1200, avg_ms: 700 }, duration: { sample_count: 90, p50_ms: 2000, p90_ms: 3000, p95_ms: 3500, avg_ms: 2300 }, ...patch })
const health = (patch: Partial<MonitorHealth> = {}): MonitorHealth => ({ overall: 'healthy', error_rate: 'warning', ttft: 'healthy', cache: 'healthy', score: 90, error_rate_score: 70, ttft_score: 95, cache_score: 90, minimum_sample: 5, ...patch })
const coverage = (): MonitorCoverage => ({ requested_start: '2026-11-06T00:00:00Z', requested_end: '2026-11-06T00:20:00Z', coverage_start: '2026-11-06T00:00:00Z', data_through: '2026-11-06T00:20:00Z', computed_at: '2026-11-06T00:20:10Z', aggregation_lag_seconds: 10, coverage_complete: true, bucket_seconds: 300 })
const bucket = (minute: string, patch: Partial<MonitorMetric> = {}) => ({ bucket_start: `2026-11-06T00:${minute}:00Z`, metrics: metric(patch), health: health() })
const snapshot = (): MonitorSnapshot => ({ config: { version: 2, enabled: true, refresh_interval_seconds: 60, platforms: [], group_ids: [], health_thresholds: { minimum_sample: 5, warning_error_rate: .1, critical_error_rate: .5, target_ttft_ms: 1000, warning_ttft_ms: 2000, critical_ttft_ms: 4000, warning_cache_rate: .5, critical_cache_rate: .2, error_weight: .4, ttft_weight: .4, cache_weight: .2 } }, coverage: coverage(), metrics: metric(), health: health(), trend: [bucket('00'), bucket('05'), bucket('10'), bucket('15')] })
let data: MonitorSnapshot
let models: MonitorModelRow[]
let matrixRows: MonitorMatrixRow[]
let errors: MonitorErrorRow[]
let users: MonitorUserRow[]
let requests: { path: string; params: Record<string, unknown> }[]
let fail: string
let router: Router
let view: VueWrapper | undefined
const oldAdapter = apiClient.defaults.adapter
function reply(config: InternalAxiosRequestConfig, value: unknown) { return { status: 200, statusText: 'OK', data: { code: 0, data: value }, headers: {}, config } }
const dims = { platforms: [{ value: 'openai', label: 'OpenAI', request_count: 100 }, { value: 'gemini', label: 'Gemini', request_count: 20 }], groups: [{ id: 7, name: 'Shared OpenAI', platform: 'openai', request_count: 100 }, { id: 8, name: '', platform: 'gemini', request_count: 20 }, { id: 9, name: 'Unscoped', request_count: 1 }], models: [{ value: 'sol', label: 'Sol', platform: 'openai', request_count: 90 }, { value: 'flash', label: 'gemini Flash', platform: 'gemini', request_count: 20 }, { value: 'other', label: 'Unscoped', request_count: 1 }] }
beforeEach(() => {
  fixture.auth = reactive({ isAdmin: false }); fixture.hideThroughput = false; fixture.hideRanking = false; fixture.translatedErrors = false; fixture.error.mockReset()
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'release-synthetic-channel', user: { id: 204 } })
  data = snapshot(); models = [{ platform: 'openai', model: 'sol', metrics: metric(), health: health() }, { platform: 'gemini', model: '__other__', metrics: metric({ tpm: 0, rpm: 0 }), health: health({ score: null, overall: 'warning' }) }]
  matrixRows = [{ platform: 'openai', group_id: 7, group_name: 'Shared OpenAI', model: 'sol', metrics: metric(), health: health(), buckets: [bucket('00'), bucket('10')] }, { platform: 'gemini', metrics: metric(), health: health(), buckets: [] }]
  errors = [{ category: 'rate_or_capacity', count: 8, rate: .08, ignored: false, details: [{ platform: 'openai', model: 'sol', status_code: 429, upstream_status_code: 503, count: 8, message: 'Synthetic capacity failure' }] }, { category: 'legacy_error', count: 1, rate: 0, ignored: true, details: [{ count: 1, error_type: 'synthetic_type' }, { count: 1 }] }]
  users = [{ user_id: 204, rank: 1, display_label: 'Synthetic member', is_self: true, can_drilldown: false, metrics: metric() }, { rank: 4, display_label: 'Anonymous member', is_self: false, can_drilldown: false, metrics: metric({ error_rate: 0, cache_rate: 0, tpm: 0, rpm: 0 }) }]
  requests = []; fail = ''
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); requests.push({ path, params: JSON.parse(JSON.stringify(config.params ?? {})) })
    if (!/^\/(?:admin\/)?channel-monitor-v2\//.test(path)) throw new Error(`Unexpected synthetic endpoint ${path}`)
    if (path.endsWith('/' + fail) && fail) throw new AxiosError('Synthetic monitor refusal', 'ERR_BAD_RESPONSE', config, undefined, { status: 503, statusText: 'Unavailable', data: { message: 'Synthetic monitor unavailable' }, headers: {}, config })
    if (path.endsWith('/dimensions')) return reply(config, dims)
    if (path.endsWith('/snapshot')) return reply(config, data)
    if (path.endsWith('/matrix')) return reply(config, { coverage: data.coverage, group_by: config.params.group_by, items: matrixRows })
    if (path.endsWith('/models')) return reply(config, { coverage: data.coverage, items: models })
    if (path.endsWith('/errors')) return reply(config, { coverage: data.coverage, items: errors })
    if (path.endsWith('/users')) return reply(config, { coverage: data.coverage, items: users })
    throw new Error(`Unexpected synthetic path ${path}`)
  }
})
afterEach(() => { view?.unmount(); view = undefined; apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })
async function render(query: Record<string, string> = {}) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/channels', component: { template: '<main />' } }] })
  await router.push({ path: '/channels', query }); await router.isReady()
  view = mount(ChannelStatusV2View, { attachTo: document.body, global: { plugins: [router], stubs: { AppLayout: { template: '<main><slot /></main>' } } } }); await flushPromises(); return view
}
function button(text: string) { const node = view!.findAll('button').find(node => node.text() === text); expect(node, text).toBeDefined(); return node! }
const last = (suffix: string) => requests.filter(request => request.path.endsWith('/' + suffix)).at(-1)!
async function selectDimension(label: string, text: string) {
  await view!.get(`button[aria-label="channelMonitorV2.filters.${label}"]`).trigger('click'); await flushPromises()
  const portal = new DOMWrapper(document.body).findAll('[role="listbox"]').at(-1)!
  const option = portal.findAll('[role="option"]').find(node => node.text().includes(text)); expect(option, text).toBeDefined(); await option!.trigger('click'); document.body.click(); await flushPromises()
}
async function tab(name: string) { await button(`channelMonitorV2.tabs.${name}`).trigger('click'); await flushPromises() }

describe('channel monitor rendered release workflows', () => {
  it('renders public snapshots with numeric success, TTFT, cache, throughput and real matrix gaps', async () => {
    await render(); expect(view!.text()).toContain('90.0%'); expect(view!.text()).toContain('500ms'); expect(view!.text()).toContain('80.0%')
    expect(view!.findAll('tbody tr')).toHaveLength(2); expect(view!.text()).toContain('channelMonitorV2.otherModels')
    expect(view!.findAll('.matrix-row').length).toBeGreaterThan(1); expect(view!.text()).toContain('Shared OpenAI')
    expect(requests.every(request => request.path.startsWith('/channel-monitor-v2/'))).toBe(true)
    expect(last('dimensions').params).not.toHaveProperty('platform')
  })
  it('cascades real filter menus, preserves the platform catalog and clears all dimensions', async () => {
    await render(); await selectDimension('platform', 'OpenAI'); expect(last('snapshot').params.platform).toEqual(['openai'])
    await selectDimension('group', 'Shared OpenAI'); await selectDimension('model', 'Sol')
    expect(last('matrix').params).toMatchObject({ platform: ['openai'], group_id: [7], model: ['sol'] })
    expect(router.currentRoute.value.query).toMatchObject({ platform: 'openai', group: '7', model: 'sol' })
    await button('channelMonitorV2.clearFilters').trigger('click'); await flushPromises()
    expect(last('snapshot').params).not.toHaveProperty('platform'); expect(last('snapshot').params).not.toHaveProperty('group_id'); expect(router.currentRoute.value.query.model).toBeUndefined()
  })
  it('drills a visible model row and changes range through public controls without filtering the dimensions request', async () => {
    await render(); await view!.get('tbody tr').trigger('click'); await flushPromises()
    expect(last('models').params).toMatchObject({ platform: ['openai'], model: ['sol'] })
    await button('channelMonitorV2.ranges.24h').trigger('click'); await flushPromises()
    expect(last('dimensions').params).toMatchObject({ range: '24h' }); expect(last('dimensions').params).not.toHaveProperty('model'); expect(router.currentRoute.value.query.range).toBe('24h')
  })
  it('loads ranking with self attribution and a real rank badge after selecting the users tab', async () => {
    await render(); await tab('users'); expect(view!.text()).toContain('Synthetic member'); expect(view!.text()).toContain('Anonymous member'); expect(view!.text()).toContain('channelMonitorV2.currentUser')
    expect(last('users').path).toBe('/channel-monitor-v2/users'); expect(view!.findAll('tbody tr')).toHaveLength(2)
  })
  it('keeps member error details private while allowing a category to open and close', async () => {
    await render(); await tab('errors'); const category = view!.findAll('button').find(node => node.text().includes('Capacity') || node.text().includes('限流')) ?? view!.get('.space-y-3 > div button')
    await category.trigger('click'); expect(view!.text()).toContain('channelMonitorV2.errorDetail.empty'); expect(view!.text()).not.toContain('Synthetic capacity failure'); await category.trigger('click'); expect(view!.text()).not.toContain('channelMonitorV2.errorDetail.empty')
  })
  it('renders admin translated and fallback error details, statuses and missing message fallbacks', async () => {
    fixture.auth!.isAdmin = true; fixture.translatedErrors = true; await render({ tab: 'errors' })
    const category = view!.findAll('button').find(node => node.text().includes('channelMonitorV2.errorCategories.rate_or_capacity'))!; expect(category.text()).toContain('8.0%'); await category.trigger('click')
    expect(view!.text()).toContain('Synthetic capacity failure'); expect(view!.text()).toContain('channelMonitorV2.errorDetail.http:429'); expect(view!.text()).toContain('channelMonitorV2.errorDetail.upstream:503')
    const other = view!.findAll('button').find(node => node.text().includes('channelMonitorV2.errorCategories.legacy_error'))!; await other.trigger('click')
    expect(view!.text()).toContain('synthetic_type'); expect(view!.text()).toContain('channelMonitorV2.errorDetail.noMessage'); expect(requests.every(request => request.path.startsWith('/admin/channel-monitor-v2/'))).toBe(true)
  })
  it('honors public privacy switches and refuses a bookmarked users tab when ranking is hidden', async () => {
    fixture.hideThroughput = true; fixture.hideRanking = true; await render({ tab: 'users' })
    expect(view!.text()).not.toContain('channelMonitorV2.metrics.tps'); expect(view!.text()).not.toContain('channelMonitorV2.metrics.rpm'); expect(view!.text()).not.toContain('channelMonitorV2.tabs.users'); expect(last('models')).toBeDefined(); expect(requests.some(request => request.path.endsWith('/users'))).toBe(false)
  })
  it('keeps administrator throughput and ranking visible despite public privacy switches', async () => {
    fixture.auth!.isAdmin = true; fixture.hideThroughput = true; fixture.hideRanking = true; await render({ tab: 'users' })
    expect(view!.text()).toContain('channelMonitorV2.metrics.tps'); expect(view!.text()).toContain('Synthetic member')
  })
  it.each([-8, 46.7, 120])('shows clamped bootstrap progress %s with empty tables and polling status', async percent => {
    vi.useFakeTimers(); data.coverage.bootstrap = { active: true, progress_percent: percent }; data.coverage.coverage_complete = false; models = []
    await render(); expect(view!.get('[role="progressbar"]').attributes('aria-valuenow')).toBe(String(Math.max(0, Math.min(100, Math.round(percent)))))
    expect(view!.text()).toContain('channelMonitorV2.bootstrap.title'); const before = requests.length; await vi.advanceTimersByTimeAsync(10000); await flushPromises(); expect(requests.length).toBeGreaterThan(before)
  })
  it('shows partial coverage without a bootstrap banner and an explicit empty-state description', async () => {
    data.coverage.coverage_complete = false; models = []; matrixRows = []; await render()
    expect(view!.text()).toContain('channelMonitorV2.partialCoverage'); expect(view!.text()).toContain('channelMonitorV2.empty.description'); expect(view!.find('[role="progressbar"]').exists()).toBe(false)
  })
  it('loads a URL line-chart preference and preserves chart/health preferences in navigation', async () => {
    await render({ trend_view: 'line', range: '7d', health_mode: 'cache', group_by: 'platform' })
    expect(view!.find('[data-chart="line"]').exists()).toBe(true); expect(view!.get('[data-chart="line"]').attributes('data-series')).toContain('500')
    await button('channelMonitorV2.trendView.pulse').trigger('click'); await flushPromises(); await button('channelMonitorV2.healthMode.ttft').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ range: '7d', health_mode: 'ttft', group_by: 'platform' }); expect(router.currentRoute.value.query.trend_view).toBeUndefined()
  })
  it('recovers from a current snapshot failure through the visible refresh button', async () => {
    fail = 'snapshot'; await render(); expect(fixture.error).toHaveBeenCalledWith('Synthetic monitor unavailable'); fail = ''
    await view!.get('button[title="common.refresh"]').trigger('click'); await flushPromises(); expect(view!.text()).toContain('sol'); expect(view!.findAll('tbody tr')).toHaveLength(2)
  })
  it('reports a current detail failure and allows a different tab to load normally', async () => {
    await render(); fail = 'errors'; await tab('errors'); expect(fixture.error).toHaveBeenCalledWith('Synthetic monitor unavailable'); fail = ''; await tab('users'); expect(view!.text()).toContain('Synthetic member')
  })

  it('selects multiple platforms, toggles one off and clears the filter from its real portal', async () => {
    await render(); await selectDimension('platform', 'OpenAI'); await selectDimension('platform', 'Gemini')
    expect(last('models').params.platform).toEqual(['openai', 'gemini'])
    await selectDimension('platform', 'OpenAI'); expect(last('models').params.platform).toEqual(['gemini'])
    await view!.get('button[aria-label="channelMonitorV2.filters.platform"]').trigger('click'); await flushPromises()
    const menu = new DOMWrapper(document.body).findAll('[role="listbox"]').at(-1)!; await menu.get('button').trigger('click'); document.body.click(); await flushPromises()
    expect(last('models').params).not.toHaveProperty('platform')
  })
  it('prunes selected group/model dimensions after switching to another platform without shrinking its catalog', async () => {
    await render({ platform: 'openai', group: '7', model: 'sol' }); await selectDimension('platform', 'Gemini'); await selectDimension('platform', 'OpenAI')
    expect(last('snapshot').params.platform).toEqual(['gemini']); expect(last('snapshot').params).not.toHaveProperty('model'); expect(last('snapshot').params).not.toHaveProperty('group_id')
    await view!.get('button[aria-label="channelMonitorV2.filters.platform"]').trigger('click'); await flushPromises(); const portal = new DOMWrapper(document.body).findAll('[role="listbox"]').at(-1)!; expect(portal.text()).toContain('OpenAI'); expect(portal.text()).toContain('Gemini')
  })
  it('changes matrix grouping and displays bare platform rows only in an appropriate grouping', async () => {
    await render(); expect(view!.findAll('.dimension-cell')).toHaveLength(1)
    await view!.get('.monitor-toolbar-select button').trigger('click'); await flushPromises()
    const option = new DOMWrapper(document.body).findAll('[role="option"]').find(node => node.text() === 'channelMonitorV2.groupBy.platform')!; expect(option).toBeDefined(); await option.trigger('click'); await flushPromises()
    expect(last('matrix').params.group_by).toBe('platform'); expect(view!.findAll('.dimension-cell')).toHaveLength(2)
  })
  it('keeps meaningful zero/no-sample metrics and legacy health states readable instead of inventing latency', async () => {
    data.metrics = metric({ error_rate: 0, cache_rate: 0, tpm: 0, rpm: 0, ttft: { sample_count: 0, p50_ms: null, p90_ms: null, p95_ms: null, avg_ms: null } }); data.health = health({ overall: 'unknown', ttft: 'unknown', cache: undefined })
    models = [{ platform: 'openai', model: 'Legacy row', metrics: data.metrics, health: 'critical' as unknown as MonitorHealth }]
    await render(); expect(view!.text()).toContain('100.0%'); expect(view!.text()).toContain('0.00%'); const ttft = view!.findAll('.stat-card').find(card => card.text().includes('channelMonitorV2.metrics.ttftP50'))!; expect(ttft.get('.stat-value').text()).toBe('-'); expect(view!.find('tbody .health-critical').exists()).toBe(true)
  })
  it('shows no-data filter menus when the range dimensions are empty', async () => {
    const saved = apiClient.defaults.adapter
    apiClient.defaults.adapter = async config => config.url?.endsWith('/dimensions') ? reply(config, { platforms: [], groups: [], models: [] }) : (saved as (config: InternalAxiosRequestConfig) => Promise<unknown>)(config) as never
    await render(); await view!.get('button[aria-label="channelMonitorV2.filters.model"]').trigger('click'); await flushPromises()
    expect(new DOMWrapper(document.body).findAll('[role="listbox"]').at(-1)!.text()).toContain('channelMonitorV2.filters.empty')
  })
  it('uses valid defaults for an unsupported bookmarked view and refreshes at the configured normal interval', async () => {
    vi.useFakeTimers(); await render({ range: 'unsupported', group_by: 'unknown', health_mode: 'invalid', trend_view: 'invalid', tab: 'unknown' })
    expect(last('snapshot').params.range).toBe('90m'); expect(last('matrix').params.group_by).toBe('platform_group')
    const before = requests.length; await vi.advanceTimersByTimeAsync(59000); expect(requests).toHaveLength(before); await vi.advanceTimersByTimeAsync(1000); await flushPromises(); expect(requests.length).toBeGreaterThan(before)
  })
  it('shows the current bucket tooltip, moves it and resets a deliberate matrix zoom', async () => {
    await render(); const cell = view!.get('.pulse-cell')
    await cell.trigger('mouseenter', { clientX: 40, clientY: 60 }); expect(new DOMWrapper(document.body).find('.matrix-floating-tooltip').exists()).toBe(true); expect(new DOMWrapper(document.body).get('.matrix-floating-tooltip').text()).toContain('channelMonitorV2.metrics.successRateValue:90.0%')
    await cell.trigger('mousemove', { clientX: 50, clientY: 70 }); await cell.trigger('mouseleave'); expect(new DOMWrapper(document.body).find('.matrix-floating-tooltip').exists()).toBe(false)
    const scroll = view!.get('.matrix-scroll'); scroll.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 30, bubbles: true, cancelable: true })); await flushPromises()
    expect(button('channelMonitorV2.matrix.resetZoom').attributes('disabled')).toBeUndefined(); await button('channelMonitorV2.matrix.resetZoom').trigger('click'); expect(button('channelMonitorV2.matrix.resetZoom').attributes('disabled')).toBeDefined()
  })
})
