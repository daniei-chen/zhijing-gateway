import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Header from '../OpsDashboardHeader.vue'
import Select from '@/components/common/Select.vue'
import type { OpsDashboardOverview, OpsMetricThresholds } from '@/api/admin/ops'

const api = vi.hoisted(() => ({ groups: vi.fn(), realtime: vi.fn() }))
let settings: { opsRealtimeMonitoringEnabled: boolean; setOpsRealtimeMonitoringEnabledLocal: (value: boolean) => void }
vi.mock('@/api', () => ({ adminAPI: { groups: { getAll: api.groups } } }))
vi.mock('@/api/admin/ops', () => ({ opsAPI: { getRealtimeTrafficSummary: api.realtime } }))
vi.mock('@/stores', () => ({ useAdminSettingsStore: () => settings }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }) }))
enableAutoUnmount(afterEach)

type Props = Pick<InstanceType<typeof Header>['$props'], 'overview' | 'platform' | 'groupId' | 'timeRange' | 'queryMode' | 'loading' | 'lastUpdated' | 'thresholds' | 'autoRefreshEnabled' | 'autoRefreshCountdown' | 'fullscreen' | 'customStartTime' | 'customEndTime'>
function overview(extra: Record<string, unknown> = {}): OpsDashboardOverview {
  return { qps: { current: 1, avg: 2 }, tps: { avg: 35 }, request_count_total: 12, request_count_sla: 12,
    token_consumed: 1000, sla: 1, error_rate: 0, upstream_error_rate: 0, health_score: 95,
    duration: { p99_ms: 900, p95_ms: 800, p90_ms: 700, p50_ms: 300, avg_ms: 400, max_ms: 1000 },
    ttft: { p99_ms: 400, p95_ms: 350, p90_ms: 300, p50_ms: 150, avg_ms: 200, max_ms: 450 },
    system_metrics: { cpu_usage_percent: 2, memory_usage_percent: 10, memory_used_mb: 128, memory_total_mb: 1024, db_ok: true, redis_ok: true, db_conn_active: 2, db_conn_idle: 1, db_max_open_conns: 10, db_conn_waiting: 0, redis_conn_total: 3, redis_conn_idle: 1, redis_pool_size: 10, goroutine_count: 100, concurrency_queue_depth: 0 },
    job_heartbeats: [], ...extra } as unknown as OpsDashboardOverview
}
async function host(props: Partial<Props> = {}) {
  const view = mount(Header, { attachTo: document.body, props: { overview: overview(), platform: '', groupId: null, timeRange: '1h', queryMode: 'auto', loading: false, lastUpdated: null, ...props }, global: { stubs: { Icon: true, HelpTooltip: true } } })
  await flushPromises(); return view
}
function systemCard(view: VueWrapper, title: string) {
  const label = view.findAll('div').find(item => item.classes().includes('uppercase') && item.text() === title)
  expect(label, title).toBeDefined()
  return new DOMWrapper(label!.element.closest('.rounded-xl')!)
}
function kpi(view: VueWrapper, title: string) {
  const card = view.findAll('.z-admin-ops-kpis > div').find(item => item.text().includes(title))
  expect(card, title).toBeDefined(); return card!
}
async function choose(view: VueWrapper, index: number, text: string) {
  await view.findAllComponents(Select)[index].get('button.select-trigger').trigger('click')
  await flushPromises()
  const option = new DOMWrapper(document.body).findAll('[role="option"]').find(item => item.text() === text)
  expect(option, text).toBeDefined(); await option!.trigger('click'); await flushPromises()
}
function button(view: VueWrapper, text: string) { const item = view.findAll('button').find(item => item.text() === text); expect(item, text).toBeDefined(); return item! }
beforeEach(() => {
  api.groups.mockReset().mockResolvedValue([{ id: 41, name: 'Synthetic OpenAI', platform: 'openai' }, { id: 8, name: 'Synthetic Claude', platform: 'anthropic' }])
  api.realtime.mockReset().mockResolvedValue({ enabled: true, summary: { qps: { current: 1.2, peak: 2.3, avg: 1.5 }, tps: { current: 40, peak: 50, avg: 45 } } })
  settings = reactive({ opsRealtimeMonitoringEnabled: true, setOpsRealtimeMonitoringEnabledLocal: (value: boolean) => { settings.opsRealtimeMonitoringEnabled = value } })
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open') })

describe('operations health semantics and public controls', () => {
  it.each([
    [95, 'text-green-500', 'admin.ops.diagnosis.healthy'],
    [75, 'text-yellow-500', 'admin.ops.diagnosis.healthLow'],
    [31, 'text-red-500', 'admin.ops.diagnosis.healthCritical'],
  ])('shows active health %s with the corresponding diagnosis', async (score, color, diagnosis) => {
    const view = await host({ overview: overview({ health_score: score }) })
    expect(view.text()).toContain(diagnosis)
    expect(view.findAll(`.${color}`).some(item => item.text() === String(score))).toBe(true)
    expect(view.text()).not.toContain('admin.ops.diagnosis.idleImpact')
  })

  it('keeps idle data distinct from a good health score and supports the empty/loading state', async () => {
    const view = await host({ overview: overview({ qps: { current: 0 }, health_score: 31 }), loading: true, autoRefreshEnabled: true, autoRefreshCountdown: 3, lastUpdated: new Date('2030-01-01T12:00:00Z') })
    expect(view.text()).toContain('admin.ops.diagnosis.idleImpact')
    expect(view.text()).toContain('admin.ops.loadingText')
    expect(view.get('button[title="common.refresh"]').attributes('disabled')).toBeDefined()
    expect(view.text()).toContain('autoRefreshRemaining')
    await view.setProps({ overview: null, loading: false })
    expect(view.find('.z-admin-ops-kpis').exists()).toBe(false)
    expect(view.text()).toContain('admin.ops.ready')
  })

  it.each([
    [98, 97, 0.08, 0.06, 'cpuCritical', 'memoryCritical', 'upstreamCritical', 'errorHigh', 'slaCritical'],
    [85, 87, 0.01, 0.03, 'cpuHigh', 'memoryHigh', 'upstreamHigh', 'errorElevated', 'slaLow'],
  ] as const)('explains resource and request risk without hiding the original TTFT', async (cpu, memory, error, upstream, cpuLabel, memoryLabel, upstreamLabel, errorLabel, slaLabel) => {
    const view = await host({ overview: overview({ system_metrics: { cpu_usage_percent: cpu, memory_usage_percent: memory, db_ok: false, redis_ok: false }, error_rate: error, upstream_error_rate: upstream, sla: error > 0.05 ? 0.8 : 0.95, ttft: { p99_ms: 30354 } }) })
    for (const label of ['dbDown', 'redisDown', cpuLabel, memoryLabel, upstreamLabel, errorLabel, slaLabel, 'ttftHigh']) expect(view.text()).toContain(`admin.ops.diagnosis.${label}`)
    expect(kpi(view, 'TTFT').text()).toContain('30354')
    expect(systemCard(view, 'admin.ops.db').text()).toContain('FAIL')
    expect(systemCard(view, 'Redis').text()).toContain('FAIL')
  })

  it.each([
    [2, 10, 3, 100, 'text-emerald-600', 'admin.ops.ok'],
    [82, 88, 8, 9000, 'text-yellow-600', 'common.warning'],
    [98, 98, 12, 16000, 'text-rose-600', 'common.critical'],
  ] as const)('renders CPU/memory/pool/worker severity for %s%% CPU', async (cpu, memory, conns, workers, color, status) => {
    const view = await host({ overview: overview({ system_metrics: { cpu_usage_percent: cpu, memory_usage_percent: memory, memory_used_mb: 128, memory_total_mb: 1024, db_ok: true, redis_ok: true, db_conn_active: conns, db_conn_idle: 0, db_max_open_conns: 10, redis_conn_total: conns, redis_conn_idle: 0, redis_pool_size: 10, goroutine_count: workers, concurrency_queue_depth: 2 } }) })
    for (const title of ['CPU', 'admin.ops.memory', 'admin.ops.db', 'Redis', 'admin.ops.goroutines']) expect(systemCard(view, title).get('.text-lg.font-black').classes()).toContain(color)
    expect(systemCard(view, 'admin.ops.db').get('.text-lg.font-black').text()).toBe(`${Math.min(100, conns * 10)}%`)
    expect(systemCard(view, 'admin.ops.goroutines').get('.text-lg.font-black').text()).toBe(status)
    expect(systemCard(view, 'admin.ops.memory').text()).toContain('128')
  })

  it.each([{}, { db_ok: true, redis_ok: true }, { db_ok: false, redis_ok: false }])('renders pool availability when the old backend has no connection counts: %j', async system => {
    const view = await host({ overview: overview({ system_metrics: system, health_score: null, request_count_sla: 0, duration: null, ttft: null, sla: null, error_rate: null, upstream_error_rate: null, qps: { current: 1 } }) })
    const expected = system.db_ok === false ? 'FAIL' : system.db_ok === true ? 'admin.ops.ok' : 'admin.ops.noData'
    expect(systemCard(view, 'admin.ops.db').get('.text-lg.font-black').text()).toBe(expected)
    expect(systemCard(view, 'Redis').get('.text-lg.font-black').text()).toBe(expected)
    expect(systemCard(view, 'CPU').get('.text-lg.font-black').text()).toBe('-')
    expect(systemCard(view, 'admin.ops.goroutines').text()).toContain('admin.ops.noData')
    expect(kpi(view, 'admin.ops.sla').get('.text-3xl').text()).toBe('-')
  })

  it.each([
    [0.989, 1000, 0.1, 0.1, 'text-red-600'],
    [0.9905, 850, 0.085, 0.085, 'text-yellow-600'],
    [1, 500, 0, 0, 'text-green-600'],
  ] as const)('uses configured metric thresholds at SLA=%s', async (sla, ttft, errorRate, upstreamRate, color) => {
    const thresholds = { sla_percent_min: 99, ttft_p99_ms_max: 1000, request_error_rate_percent_max: 10, upstream_error_rate_percent_max: 10 } as OpsMetricThresholds
    const view = await host({ thresholds, overview: overview({ sla, ttft: { p99_ms: ttft }, error_rate: errorRate, upstream_error_rate: upstreamRate }) })
    for (const label of ['admin.ops.sla', 'TTFT', 'admin.ops.requestErrors', 'admin.ops.upstreamErrors']) expect(kpi(view, label).get('.text-3xl').classes()).toContain(color)
  })

  it('opens request/error drilldowns with the right kind and sort, and exposes toolbar actions', async () => {
    const view = await host()
    await button(view, 'admin.ops.diagnostics.title').trigger('click')
    await kpi(view, 'admin.ops.requestsTitle').get('button').trigger('click')
    await kpi(view, 'admin.ops.sla').get('button').trigger('click')
    await kpi(view, 'admin.ops.latencyDuration').get('button').trigger('click')
    await kpi(view, 'TTFT').get('button').trigger('click')
    expect(view.emitted('openRequestDetails')).toEqual([
      [{ title: 'admin.ops.diagnostics.title', kind: 'all', sort: 'created_at_desc' }],
      [{ title: 'admin.ops.requestDetails.title' }], [{ title: 'admin.ops.requestDetails.title', kind: 'error' }],
      [{ title: 'admin.ops.latencyDuration', sort: 'duration_desc' }], [{ title: 'admin.ops.ttftLabel', kind: 'success', sort: 'ttft_desc' }],
    ])
    await kpi(view, 'admin.ops.requestErrors').get('button').trigger('click')
    await kpi(view, 'admin.ops.upstreamErrors').get('button').trigger('click')
    expect(view.emitted('openErrorDetails')).toEqual([['request'], ['upstream']])
    await view.get('button[title="admin.ops.alertRules.title"]').trigger('click')
    await view.get('button[title="admin.ops.settings.title"]').trigger('click')
    await view.get('button[title="admin.ops.fullscreen.enter"]').trigger('click')
    expect(view.emitted('openAlertRules')).toHaveLength(1); expect(view.emitted('openSettings')).toHaveLength(1); expect(view.emitted('enterFullscreen')).toHaveLength(1)
    const calls = api.realtime.mock.calls.length
    await view.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(view.emitted('refresh')).toHaveLength(1); expect(api.realtime).toHaveBeenCalledTimes(calls + 1)
    await view.setProps({ fullscreen: true })
    expect(view.findAllComponents(Select)).toHaveLength(0)
    expect(view.find('button[title="common.refresh"]').exists()).toBe(false)
    expect(kpi(view, 'TTFT').find('button').exists()).toBe(false)
  })

  it('selects groups/platforms and clears a group that belongs to another platform', async () => {
    const view = await host()
    await choose(view, 1, 'Synthetic OpenAI')
    expect(view.emitted('update:group')).toEqual([[41]])
    await view.setProps({ groupId: 41, platform: 'anthropic' }); await flushPromises()
    expect(view.emitted('update:group')?.at(-1)).toEqual([null])
    await choose(view, 1, 'common.all')
    expect(view.emitted('update:group')?.at(-1)).toEqual([null])
    await choose(view, 0, 'OpenAI')
    expect(view.emitted('update:platform')?.at(-1)).toEqual(['openai'])
    await view.setProps({ platform: '' }); await flushPromises()
    await choose(view, 0, 'common.all')
    expect(view.emitted('update:platform')?.at(-1)).toEqual([''])
    await choose(view, 2, 'admin.ops.timeRange.30m')
    expect(view.emitted('update:timeRange')?.at(-1)).toEqual(['30m'])
  })

  it('submits custom dates before the range change and cancels without emitting a new range', async () => {
    const view = await host()
    await choose(view, 2, 'admin.ops.timeRange.custom')
    const dialog = new DOMWrapper(document.body)
    const fields = dialog.findAll<HTMLInputElement>('input[type="datetime-local"]')
    expect(fields).toHaveLength(2)
    await fields[0].setValue('2030-01-01T10:00'); await fields[1].setValue('2030-01-01T12:00')
    await dialog.findAll('button').find(item => item.text() === 'common.confirm')!.trigger('click')
    expect(view.emitted('update:customTimeRange')).toEqual([[new Date('2030-01-01T10:00').toISOString(), new Date('2030-01-01T12:00').toISOString()]])
    expect(view.emitted('update:timeRange')).toEqual([['custom']])
    await vi.waitFor(() => expect(document.querySelector('input[type="datetime-local"]')).toBeNull())
    await choose(view, 2, 'admin.ops.timeRange.custom')
    await new DOMWrapper(document.body).findAll('button').find(item => item.text() === 'common.cancel')!.trigger('click')
    expect(view.emitted('update:timeRange')).toHaveLength(1)
    await view.setProps({ timeRange: 'custom', customStartTime: '2030-01-01T10:00:00Z', customEndTime: '2030-01-01T12:00:00Z' })
    expect(view.findAllComponents(Select)[2].text()).toContain('admin.ops.timeRange.custom (')
  })

  it('does not publish a custom range with either date missing', async () => {
    const view = await host(); await choose(view, 2, 'admin.ops.timeRange.custom')
    const dialog = new DOMWrapper(document.body)
    await dialog.findAll('input[type="datetime-local"]')[0].setValue('')
    await dialog.findAll('button').find(item => item.text() === 'common.confirm')!.trigger('click')
    expect(view.emitted('update:timeRange')).toBeUndefined()
    expect(dialog.findAll('input[type="datetime-local"]')).toHaveLength(2)
  })

  it('follows realtime windows and auto refresh only at an idle refresh boundary', async () => {
    const view = await host({ autoRefreshEnabled: true, autoRefreshCountdown: 5 })
    await button(view, '5min').trigger('click'); await flushPromises()
    expect(api.realtime).toHaveBeenLastCalledWith('5min', '', null)
    await view.setProps({ autoRefreshCountdown: 4 }); await flushPromises()
    let calls = api.realtime.mock.calls.length
    await view.setProps({ autoRefreshCountdown: 0, loading: true }); await flushPromises()
    expect(api.realtime).toHaveBeenCalledTimes(calls)
    await view.setProps({ loading: false }); await flushPromises()
    expect(api.realtime).toHaveBeenCalledTimes(calls + 1)
    await view.setProps({ timeRange: '5m' }); await flushPromises()
    expect(api.realtime).toHaveBeenLastCalledWith('1min', '', null)
    expect(view.findAll('button').some(item => item.text() === '30min')).toBe(false)
    calls = api.realtime.mock.calls.length
    settings.opsRealtimeMonitoringEnabled = false; await flushPromises()
    await view.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(api.realtime).toHaveBeenCalledTimes(calls)
    settings.opsRealtimeMonitoringEnabled = true; await flushPromises()
    expect(api.realtime).toHaveBeenCalledTimes(calls + 1)
  })

  it('displays missing realtime samples safely and records a disabled capability locally', async () => {
    api.realtime.mockResolvedValueOnce({ enabled: false, summary: null })
    const view = await host()
    expect(settings.opsRealtimeMonitoringEnabled).toBe(false)
    expect(view.text()).not.toContain('NaN')
    settings.opsRealtimeMonitoringEnabled = true
    api.realtime.mockRejectedValueOnce(new Error('Synthetic realtime refusal'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await flushPromises()
    expect(logged).toHaveBeenCalled()
    expect(view.text()).not.toContain('NaN')
  })

  it('keeps filter controls usable when group loading fails', async () => {
    api.groups.mockRejectedValueOnce(new Error('Synthetic groups unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = await host()
    await choose(view, 1, 'common.all')
    expect(view.emitted('update:group')).toEqual([[null]])
  })

  it('opens heartbeat details with success/error timestamps and warning recovery', async () => {
    const jobs = [
      { job_name: 'Synthetic healthy', last_success_at: '2030-01-01T12:00:00Z', last_error_at: '2030-01-01T10:00:00Z', updated_at: '2030-01-01T12:00:00Z', last_result: 'ok', last_duration_ms: 25 },
      { job_name: 'Synthetic failed', last_error_at: '2030-01-01T12:00:00Z', updated_at: 'not-a-date', last_error: 'Synthetic retry required', last_result: '' },
    ]
    const view = await host({ overview: overview({ job_heartbeats: jobs }) })
    const card = systemCard(view, 'admin.ops.jobs')
    expect(card.get('.text-lg.font-black').text()).toBe('common.warning')
    await card.get('button').trigger('click'); await flushPromises()
    const dialog = new DOMWrapper(document.body).get('[role="dialog"]')
    expect(dialog.text()).toContain('Synthetic retry required'); expect(dialog.text()).toContain('25ms')
    await new DOMWrapper(document.body).get('[role="dialog"] button[aria-label]').trigger('click')
    await view.setProps({ overview: overview({ job_heartbeats: [jobs[0]] }) })
    expect(card.get('.text-lg.font-black').text()).toBe('admin.ops.ok')
  })
})
