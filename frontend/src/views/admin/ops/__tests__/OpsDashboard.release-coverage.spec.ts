import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Dashboard from '../OpsDashboard.vue'
import Select from '@/components/common/Select.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const fixture = vi.hoisted(() => ({ route: { query: {} as Record<string, unknown> }, store: {} as Record<string, any>, replace: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('vue-router', async actual => ({ ...await actual<typeof import('vue-router')>(), useRoute: () => fixture.route, useRouter: () => ({ replace: fixture.replace }) }))
vi.mock('@/stores', () => ({ useAdminSettingsStore: () => fixture.store, useAppStore: () => ({ showSuccess: fixture.success, showError: fixture.error }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
const base = '/api/v1/admin/ops'
type Wire = { path: string; query: Record<string, string>; signal?: AbortSignal }
const wire: Wire[] = [], unexpected: string[] = []
let advanced: Record<string, unknown>, overview: Record<string, unknown>, denied: Set<string>
let pending: { path: string; promise: Promise<unknown> } | undefined
const trend = { points: [], by_platform: [], top_groups: [] }
const stubs = {
  AppLayout: { template: '<main><slot/></main>' }, Icon: true, HelpTooltip: true,
  OpsConcurrencyCard: true, OpsSystemLogTable: true, OpsAlertEventsCard: true, OpsOpenAITokenStatsCard: true,
  OpsSwitchRateTrendChart: true, OpsLatencyChart: true, OpsErrorTrendChart: true, OpsErrorDistributionChart: true,
  OpsAlertRulesCard: { template: '<p data-test="alert-rules">Synthetic rules boundary</p>' },
  // These public child boundaries isolate the parent request/route lifecycle.
  // Their real controls and wire behavior have separate native suites.
  OpsThroughputTrendChart: { props: ['points'], emits: ['selectPlatform', 'selectGroup', 'openDetails'], template: '<section data-test="throughput"><button @click="$emit(\'selectPlatform\',\'openai\')">Select platform</button><button @click="$emit(\'selectGroup\',4)">Select group</button><button @click="$emit(\'openDetails\')">Open requests</button></section>' },
  OpsSettingsDialog: { props: ['show'], emits: ['close', 'saved'], template: '<section v-if="show" data-test="settings"><button @click="$emit(\'saved\')">Save settings</button><button @click="$emit(\'close\')">Close settings</button></section>' },
  OpsRequestDetailsModal: { props: ['modelValue', 'preset', 'platform', 'groupId', 'resumeState'], emits: ['openErrorDetail', 'update:modelValue'], template: '<section v-if="modelValue" data-test="requests"><pre>{{preset}}</pre><p>{{platform}}/{{groupId}}/{{resumeState}}</p><button @click="$emit(\'openErrorDetail\',41)">Open request error</button><button @click="$emit(\'update:modelValue\',false)">Close requests</button></section>' },
  OpsErrorDetailsModal: { props: ['show', 'errorType', 'resumeState'], emits: ['openErrorDetail', 'update:show'], template: '<section v-if="show" data-test="errors"><p>{{errorType}}/{{resumeState}}</p><button @click="$emit(\'openErrorDetail\',42)">Open list error</button><button @click="$emit(\'update:show\',false)">Close errors</button></section>' },
  OpsErrorDetailModal: { props: ['show', 'errorId', 'backToList'], emits: ['back', 'update:show'], template: '<section v-if="show" data-test="single"><p>Error {{errorId}}/{{backToList}}</p><button @click="$emit(\'back\')">Back to list</button><button @click="$emit(\'update:show\',false)">Close error</button></section>' },
}
async function host(query: Record<string, unknown> = {}) { fixture.route.query = query; const view = mount(Dashboard, { attachTo: document.body, global: { stubs } }); await flushPromises(); return view }
async function choose(view: ReturnType<typeof mount>, index: number, label: string) {
  const trigger = view.findAllComponents(Select)[index].get('button.select-trigger'); await trigger.trigger('click'); await flushPromises()
  const portal = new DOMWrapper(document.getElementById(trigger.attributes('aria-controls')!)!)
  const option = portal.findAll('[role="option"]').find(item => item.text() === label); expect(option, label).toBeDefined(); await option!.trigger('click'); await flushPromises()
}
const snapshotCalls = () => wire.filter(item => item.path.endsWith('/snapshot-v2'))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(new Date('2030-01-02T12:00:00Z'))
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-dashboard', user: { id: 7, role: 'admin' } })
  fixture.route = reactive({ query: {} }); fixture.store = reactive({ opsMonitoringEnabled: true, opsRealtimeMonitoringEnabled: true, opsQueryModeDefault: 'auto', fetch: vi.fn().mockResolvedValue(undefined), setOpsRealtimeMonitoringEnabledLocal: (value: boolean) => { fixture.store.opsRealtimeMonitoringEnabled = value } })
  fixture.replace.mockReset().mockImplementation(async (destination: string | { query: Record<string, unknown> }) => { if (typeof destination !== 'string') fixture.route.query = destination.query })
  fixture.success.mockReset(); fixture.error.mockReset(); wire.length = 0; unexpected.length = 0; denied = new Set(); pending = undefined
  advanced = { display_alert_events: false, display_openai_token_stats: false, auto_refresh_enabled: false, auto_refresh_interval_seconds: 5 }
  overview = { request_count_total: 12, request_count_sla: 12, qps: { current: 1, avg: 2 }, tps: { avg: 40 }, sla: 1, error_rate: 0, upstream_error_rate: 0, health_score: 95 }
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid'); const query = Object.fromEntries(url.searchParams); delete query.timezone
    const request = { path: url.pathname, query, signal: config.signal as AbortSignal }; wire.push(request)
    let value: unknown
    if (pending?.path === request.path) value = await pending.promise
    else if (request.path === '/api/v1/admin/groups/all') value = [{ id: 4, name: 'Synthetic group', platform: 'openai' }]
    else if (request.path.includes('realtime-traffic')) value = { enabled: true, summary: null }
    else if (request.path === `${base}/advanced-settings`) value = advanced
    else if (request.path.endsWith('/metric-thresholds')) value = null
    else if (request.path.endsWith('/snapshot-v2')) value = { overview, throughput_trend: trend, error_trend: { points: [] } }
    else if (request.path.endsWith('/overview')) value = overview
    else if (request.path.endsWith('/throughput-trend')) value = trend
    else if (request.path.endsWith('/latency-histogram')) value = { buckets: [] }
    else if (request.path.endsWith('/error-trend')) value = { points: [] }
    else if (request.path.endsWith('/error-distribution')) value = { items: [] }
    else { unexpected.push(request.path); throw new Error(`Unexpected synthetic dashboard route ${request.path}`) }
    const status = denied.has(request.path) ? 404 : 200
    const response = { config, status, statusText: 'Synthetic dashboard', headers: {}, data: status === 200 ? { code: 0, data: structuredClone(value) } : { code: 404, message: 'Synthetic endpoint unavailable' } }
    if (status >= 400) throw new AxiosError('Synthetic endpoint unavailable', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { expect(unexpected).toEqual([]); apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open') })

describe('operations dashboard parent request and route contracts', () => {
  it('loads one core snapshot, defers secondary panels and keeps the switch chart at five hours', async () => {
    const view = await host()
    expect(snapshotCalls()).toHaveLength(1); expect(snapshotCalls()[0].query).toEqual({ mode: 'auto', time_range: '1h' })
    expect(view.text()).toContain('admin.ops.ready'); expect(view.text()).toContain('12')
    expect(wire.some(item => item.path.endsWith('/latency-histogram'))).toBe(true); expect(wire.some(item => item.path.endsWith('/error-distribution'))).toBe(true)
    const switchRequest = wire.find(item => item.path.endsWith('/throughput-trend'))!
    expect(switchRequest.query).toEqual({ mode: 'auto', start_time: '2030-01-02T07:00:00.000Z', end_time: '2030-01-02T12:00:00.000Z' })
  })

  it.each([
    [{ tr: '6h', platform: 'openai', group_id: '4', mode: 'raw' }, { time_range: '6h', platform: 'openai', group_id: '4', mode: 'raw' }],
    [{ tr: ['24h'], platform: ['openai'], group_id: ['8'], mode: ['preagg'] }, { time_range: '24h', platform: 'openai', group_id: '8', mode: 'preagg' }],
    [{ tr: 'invalid', group_id: '-1', mode: 'invalid' }, { time_range: '1h', mode: 'auto' }],
    [{ tr: null, group_id: 'bad', platform: 7 }, { time_range: '1h', mode: 'auto' }],
    [{ tr: 'custom' }, { time_range: '1h', mode: 'auto' }],
  ])('restores public deep link %j with a compatible backend query', async (query, expected) => {
    await host(query); expect(snapshotCalls().at(-1)?.query).toEqual(expected)
  })

  it('falls back to split endpoints when snapshot-v2 is unavailable', async () => {
    denied.add(`${base}/dashboard/snapshot-v2`); const view = await host()
    for (const name of ['overview', 'throughput-trend', 'error-trend']) expect(wire.some(item => item.path === `${base}/dashboard/${name}`)).toBe(true)
    expect(view.text()).toContain('admin.ops.ready'); expect(view.text()).toContain('12')
  })

  it.each(['overview', 'throughput-trend', 'error-trend', 'latency-histogram', 'error-distribution'])('keeps the dashboard usable when %s fails', async endpoint => {
    denied.add(`${base}/dashboard/snapshot-v2`); denied.add(`${base}/dashboard/${endpoint}`)
    const view = await host(); expect(fixture.error).toHaveBeenCalled(); expect(view.text()).toContain('admin.ops.ready')
    denied.clear(); await view.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(snapshotCalls().length).toBeGreaterThan(1)
  })

  it('supports failed optional settings/threshold reads and a disabled-monitoring redirect', async () => {
    denied.add(`${base}/advanced-settings`); denied.add(`${base}/settings/metric-thresholds`)
    const view = await host(); expect(view.text()).toContain('admin.ops.ready'); expect(view.find('ops-alert-events-card-stub').exists()).toBe(true)
    view.unmount(); wire.length = 0; fixture.store.opsMonitoringEnabled = false
    await host(); expect(fixture.replace).toHaveBeenCalledWith('/admin/settings'); expect(wire).toHaveLength(0)
  })

  it('changes native filters, synchronizes the bookmark and retains unrelated query values', async () => {
    const view = await host({ unrelated: 'retained' })
    await choose(view, 0, 'OpenAI'); await choose(view, 1, 'Synthetic group'); await choose(view, 2, 'admin.ops.timeRange.30m')
    await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(snapshotCalls().at(-1)?.query).toEqual({ platform: 'openai', group_id: '4', time_range: '30m', mode: 'auto' })
    expect(fixture.route.query).toMatchObject({ unrelated: 'retained', platform: 'openai', group_id: '4', tr: '30m' })
    await view.get('[data-test="throughput"] button').trigger('click'); await flushPromises()
    expect(snapshotCalls().at(-1)?.query.group_id).toBeUndefined()
  })

  it('opens request/error lists, returns from single detail and carries the list-resume state', async () => {
    const view = await host()
    await view.get('[data-test="throughput"] button:last-child').trigger('click')
    expect(view.get('[data-test="requests"]').text()).toContain('created_at_desc')
    await view.get('[data-test="requests"] button').trigger('click')
    expect(view.get('[data-test="single"]').text()).toContain('Error 41/true')
    await view.get('[data-test="single"] button').trigger('click')
    expect(view.get('[data-test="requests"]').text()).toContain('true')
    await view.get('[data-test="requests"] button:last-child').trigger('click')
    const errorCard = view.findAll('.z-admin-ops-kpis > div').find(item => item.text().includes('admin.ops.upstreamErrors'))!
    await errorCard.get('button').trigger('click')
    expect(view.get('[data-test="errors"]').text()).toContain('upstream')
    await view.get('[data-test="errors"] button').trigger('click'); expect(view.get('[data-test="single"]').text()).toContain('Error 42/true')
    await view.get('[data-test="single"] button').trigger('click'); expect(view.get('[data-test="errors"]').text()).toContain('upstream/true')
    await vi.advanceTimersByTimeAsync(1); await flushPromises(); expect(view.get('[data-test="errors"]').text()).toContain('upstream/false')
  })

  it.each([{ open_error_details: '1', error_type: 'upstream' }, { open_error_details: 'true', error_type: 'unknown' }])('opens an error bookmark %j', async query => {
    const view = await host(query); expect(view.get('[data-test="errors"]').text()).toContain(query.error_type === 'upstream' ? 'upstream' : 'request')
  })

  it.each([{ open_alert_rules: 'true' }, { alert_rule_id: '7' }])('opens the requested alert rules from %j', async query => {
    await host(query); expect(new DOMWrapper(document.body).find('[data-test="alert-rules"]').exists()).toBe(true)
  })

  it('enters fullscreen through the actual toolbar and returns on Escape', async () => {
    const view = await host(); await view.get('button[title="admin.ops.fullscreen.enter"]').trigger('click'); await flushPromises()
    expect(fixture.route.query.fullscreen).toBe('1'); expect(view.find('.z-admin-ops-fullscreen').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flushPromises()
    expect(fixture.route.query.fullscreen).toBeUndefined(); expect(view.find('.z-admin-ops-fullscreen').exists()).toBe(false)
  })

  it('reloads presentation settings after the public settings dialog saves and closes', async () => {
    const view = await host(); await view.get('button[title="admin.ops.settings.title"]').trigger('click')
    advanced = { ...advanced, display_openai_token_stats: true }
    await view.get('[data-test="settings"] button').trigger('click'); await flushPromises()
    expect(view.find('ops-open-a-i-token-stats-card-stub').exists() || view.html().includes('token-stats-card-stub')).toBe(true)
    await view.get('[data-test="settings"] button:last-child').trigger('click'); await flushPromises()
    expect(wire.filter(item => item.path.endsWith('/advanced-settings')).length).toBeGreaterThanOrEqual(3)
  })

  it('runs a shared refresh countdown and cancels scheduled work on unmount', async () => {
    advanced.auto_refresh_enabled = true; advanced.auto_refresh_interval_seconds = 2
    const view = await host(); const count = snapshotCalls().length
    await vi.advanceTimersByTimeAsync(3100); await flushPromises(); expect(snapshotCalls().length).toBeGreaterThan(count)
    view.unmount(); const stopped = wire.length; await vi.advanceTimersByTimeAsync(10000); await flushPromises(); expect(wire).toHaveLength(stopped)
  })
})
