/**
 * Ordinary Ops HTTP contracts derived from Go routes/admin.go and ops handlers/DTOs.
 * All requests use a synthetic Axios adapter; no server setting, alert, cleanup,
 * provider, WebSocket or real log operation is performed by these tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import { opsAPI, type AlertRule } from '@/api/admin/ops'

vi.mock('@/i18n', () => ({ getLocale: () => 'en' }))

type Wire = { method: string; path: string; params: Record<string, unknown>; body: unknown; config: InternalAxiosRequestConfig }
const originalAdapter = apiClient.defaults.adapter
let wire: Wire[] = []
let responseData: unknown
let behavior: ((request: Wire) => Promise<unknown>) | undefined
const start = '2026-11-01T12:34:56.123456789+09:00'
const end = '2026-11-01T04:34:56Z'
const dashboardQuery = { time_range: '6h', start_time: start, end_time: end, platform: 'openai', group_id: 83, mode: 'raw' } as const
const page = { items: [{ id: 83, message: 'Synthetic diagnostic only' }], total: 1, pages: 1, page: 3, page_size: 25 }
const overview = {
  start_time: start, end_time: end, platform: 'openai', group_id: 83, health_score: 48,
  system_metrics: { id: 1, created_at: end, window_minutes: 1, memory_used_mb: 48 },
  job_heartbeats: [{ job_name: 'synthetic-job', last_run_at: end, last_success_at: end, last_error_at: null, last_error: null, last_duration_ms: 128, last_result: 'Synthetic only', updated_at: end }],
  success_count: 7, error_count_total: 3, business_limited_count: 1, error_count_sla: 2, request_count_total: 10, request_count_sla: 9,
  token_consumed: 1234, sla: 77.78, error_rate: 22.22, upstream_error_rate: 11.11,
  upstream_error_count_excl_429_529: 1, upstream_429_count: 1, upstream_529_count: 0,
  qps: { current: 0.25, peak: 0.5, avg: 0.3 }, tps: { current: 100.5, peak: 150, avg: 125 }, output_tps: null,
  duration: { p50_ms: 300, p90_ms: 600, p95_ms: 800, p99_ms: 1200, avg_ms: 456, max_ms: 1500 },
  ttft: { p50_ms: 10, p90_ms: 20, p95_ms: 50, p99_ms: 1234, avg_ms: 23, max_ms: 1500 },
}
const throughput = { bucket: '1m', points: [{ bucket_start: end, request_count: 2, token_consumed: 1234, switch_count: 1, qps: 0.25, tps: 100.5 }] }
const errorTrend = { bucket: '1m', points: [{ bucket_start: end, error_count_total: 3, business_limited_count: 1, error_count_sla: 2, upstream_error_count_excl_429_529: 1, upstream_429_count: 1, upstream_529_count: 0 }] }
function expectWire(method: string, path: string, params: Record<string, unknown> = {}, body?: unknown) {
  expect(wire).toHaveLength(1)
  expect(wire[0]).toMatchObject({ method, path, body })
  const actual = { ...wire[0].params }
  if (method === 'get') { expect(actual.timezone).toEqual(expect.any(String)); delete actual.timezone }
  expect(actual).toEqual(params)
}
function failure(request: Wire, status = 400, reason = 'SYNTHETIC_INVALID_QUERY') {
  return new AxiosError('Synthetic ops failure', 'ERR_BAD_RESPONSE', request.config, undefined, { status, statusText: 'Synthetic', config: request.config, headers: {}, data: { code: status, reason, message: 'Synthetic ops failure' } })
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-ops-contract-admin', user: { id: 83, role: 'admin' } })
  wire = []; responseData = {}; behavior = undefined
  apiClient.defaults.adapter = async config => {
    const request: Wire = { method: config.method ?? 'get', path: String(config.url), params: { ...(config.params ?? {}) }, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, config }
    wire.push(request)
    const data = behavior ? await behavior(request) : responseData
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks() })

describe('083 Go-defined ordinary Ops HTTP contracts through actual Axios', () => {
  it('loads scoped platform/group concurrency without changing fractional percentages', async () => {
    responseData = { enabled: true, platform: { openai: { platform: 'openai', current_in_use: 2, max_capacity: 7, load_percentage: 28.57, waiting_in_queue: 1 } }, group: {}, account: {}, timestamp: '2026-11-01T04:00:00Z' }
    expect(await opsAPI.getConcurrencyStats('openai', 83)).toEqual(responseData)
    expectWire('get', '/admin/ops/concurrency', { platform: 'openai', group_id: 83 })
  })
  it('preserves an explicitly disabled user-concurrency response', async () => {
    responseData = { enabled: false, user: {}, timestamp: '2026-11-01T04:00:00Z' }
    expect(await opsAPI.getUserConcurrencyStats()).toEqual(responseData)
    expectWire('get', '/admin/ops/user-concurrency')
  })
  it('reads scoped availability with remaining seconds kept as seconds', async () => {
    responseData = { enabled: true, platform: {}, group: {}, account: { '83': { account_id: 83, rate_limit_remaining_sec: 61, is_available: false } } }
    expect(await opsAPI.getAccountAvailabilityStats('grok', 83)).toEqual(responseData)
    expectWire('get', '/admin/ops/account-availability', { platform: 'grok', group_id: 83 })
  })
  it('omits a nonpositive optional group filter instead of sending the invalid group ID zero', async () => {
    await opsAPI.getAccountAvailabilityStats(undefined, 0)
    expectWire('get', '/admin/ops/account-availability')
  })
  it('sends the realtime window string and preserves QPS/TPS fractions', async () => {
    responseData = { enabled: true, summary: { window: '5min', qps: { current: 0.25, peak: 1.5, avg: 0.3 }, tps: { current: 100.5, peak: 200, avg: 125 } } }
    expect(await opsAPI.getRealtimeTrafficSummary('5min', 'openai', 83)).toEqual(responseData)
    expectWire('get', '/admin/ops/realtime-traffic', { window: '5min', platform: 'openai', group_id: 83 })
  })
  it.each([
    ['snapshot', '/admin/ops/dashboard/snapshot-v2', () => opsAPI.getDashboardSnapshotV2(dashboardQuery), { generated_at: end, overview, throughput_trend: throughput, error_trend: errorTrend }],
    ['overview', '/admin/ops/dashboard/overview', () => opsAPI.getDashboardOverview(dashboardQuery), overview],
    ['throughput', '/admin/ops/dashboard/throughput-trend', () => opsAPI.getThroughputTrend(dashboardQuery), throughput],
    ['latency', '/admin/ops/dashboard/latency-histogram', () => opsAPI.getLatencyHistogram(dashboardQuery), { start_time: start, end_time: end, platform: 'openai', group_id: 83, total_requests: 2, buckets: [{ range: '0-100ms', count: 2 }] }],
    ['error trend', '/admin/ops/dashboard/error-trend', () => opsAPI.getErrorTrend(dashboardQuery), errorTrend],
    ['error distribution', '/admin/ops/dashboard/error-distribution', () => opsAPI.getErrorDistribution(dashboardQuery), { total: 3, items: [{ status_code: 429, total: 1, sla: 0, business_limited: 1 }, { status_code: 503, total: 2, sla: 2, business_limited: 0 }] }],
  ] as const)('preserves RFC3339/Nano filters and response units for %s', async (_name, path, invoke, result) => {
    responseData = result
    expect(await invoke()).toEqual(responseData)
    expectWire('get', path, { time_range: '6h', start_time: start, end_time: end, platform: 'openai', group_id: 83, mode: 'raw' })
    const url = new URL(apiClient.getUri(wire[0].config), 'https://synthetic.invalid')
    expect(url.searchParams.get('start_time')).toBe(start)
  })
  it('keeps paged token statistics separate from a top-N request', async () => {
    responseData = { items: [{ model: 'synthetic-model', avg_tokens_per_sec: 27.5, avg_first_token_ms: 456.5 }], total: 1 }
    expect(await opsAPI.getOpenAITokenStats({ time_range: '15d', platform: 'openai', group_id: 83, page: 2, page_size: 50 })).toEqual(responseData)
    expectWire('get', '/admin/ops/dashboard/openai-token-stats', { time_range: '15d', platform: 'openai', group_id: 83, page: 2, page_size: 50 })
  })
  it('sends the backend-supported top-N form without fabricating pagination fields', async () => {
    await opsAPI.getOpenAITokenStats({ time_range: '1d', top_n: 10 })
    expectWire('get', '/admin/ops/dashboard/openai-token-stats', { time_range: '1d', top_n: 10 })
  })
  it('preserves request drilldown millisecond boundaries, all IDs and server sort', async () => {
    responseData = page
    const query = { start_time: start, end_time: end, kind: 'error', platform: 'openai', group_id: 83, account_id: 84, user_id: 85, api_key_id: 86, model: 'synthetic-model', request_id: 'synthetic-request', q: 'synthetic timeout', min_duration_ms: 0, max_duration_ms: 2500, sort: 'ttft_desc', page: 3, page_size: 25 } as const
    expect(await opsAPI.listRequestDetails(query)).toEqual(page)
    expectWire('get', '/admin/ops/requests', { ...query })
  })
  it.each([
    ['legacy', '/admin/ops/errors', opsAPI.listErrorLogs],
    ['request', '/admin/ops/request-errors', opsAPI.listRequestErrors],
    ['upstream', '/admin/ops/upstream-errors', opsAPI.listUpstreamErrors],
  ] as const)('sends the %s error list filters as the existing comma/bool/string query contract', async (_name, path, invoke) => {
    responseData = page
    const query = { page: 3, page_size: 25, start_time: start, end_time: end, platform: 'openai', group_id: 83, account_id: 84, model: 'synthetic-model', phase: 'upstream', category: 'upstream', error_owner: 'provider', error_source: 'upstream_http', resolved: 'false', view: 'all', q: 'synthetic failure', status_codes: '429,529,503', status_codes_other: 'true', sort_by: 'status_code', sort_order: 'asc' } as const
    expect(await invoke(query)).toEqual(page)
    expectWire('get', path, { ...query })
  })
  it.each([
    ['/admin/ops/errors/83', () => opsAPI.getErrorLogDetail(83)],
    ['/admin/ops/request-errors/83', () => opsAPI.getRequestErrorDetail(83)],
    ['/admin/ops/upstream-errors/83', () => opsAPI.getUpstreamErrorDetail(83)],
  ] as const)('returns actual detail timing without converting units at %s', async (path, invoke) => {
    responseData = { id: 83, error_body: 'Synthetic diagnostic only', request_id: 'synthetic-request', auth_latency_ms: 1, routing_latency_ms: 2, upstream_latency_ms: 1234, time_to_first_token_ms: 56, is_business_limited: false }
    expect(await invoke()).toEqual(responseData)
    expectWire('get', path)
  })
  it.each([
    ['/admin/ops/errors/83/resolve', () => opsAPI.updateErrorResolved(83, false)],
    ['/admin/ops/request-errors/83/resolve', () => opsAPI.updateRequestErrorResolved(83, false)],
    ['/admin/ops/upstream-errors/83/resolve', () => opsAPI.updateUpstreamErrorResolved(83, false)],
  ] as const)('retains explicit false in the resolve PUT at %s', async (path, invoke) => {
    responseData = { updated: true }
    expect(await invoke()).toBeUndefined()
    expectWire('put', path, {}, { resolved: false })
  })
  it('requests expanded correlated upstream details through include_detail=1 without mutating its input', async () => {
    const query = { page: 2, page_size: 10, time_range: '30d', error_source: 'upstream_http', q: 'synthetic correlation' }
    responseData = page
    expect(await opsAPI.listRequestErrorUpstreamErrors(83, query, { include_detail: true })).toEqual(page)
    expectWire('get', '/admin/ops/request-errors/83/upstream-errors', { ...query, include_detail: '1' })
    expect(query).not.toHaveProperty('include_detail')
  })
  it('leaves the correlated-detail option absent when the caller did not request expansion', async () => {
    await opsAPI.listRequestErrorUpstreamErrors(83)
    expectWire('get', '/admin/ops/request-errors/83/upstream-errors')
  })
  const rule: AlertRule = { name: 'Synthetic ratio rule', description: 'Synthetic only', enabled: false, metric_type: 'error_rate', operator: '>=', threshold: 7.5, window_minutes: 5, sustained_minutes: 2, severity: 'warning', cooldown_minutes: 10, notify_email: false, filters: { platform: 'openai', group_id: 83 } }
  it('lists alert rules through the original rules endpoint', async () => {
    responseData = [{ id: 83, ...rule, severity: 'WARNING' }]
    expect(await opsAPI.listAlertRules()).toEqual(responseData)
    expectWire('get', '/admin/ops/alert-rules')
  })
  it('creates a full rule with raw percentages/minutes and explicit disabled/email flags', async () => {
    responseData = { id: 83, ...rule, severity: 'WARNING' }
    expect(await opsAPI.createAlertRule(rule)).toEqual(responseData)
    expectWire('post', '/admin/ops/alert-rules', {}, rule)
  })
  it('updates a Go-valid full rule through PUT rather than inventing partial PATCH semantics', async () => {
    const body = { ...rule, threshold: 0, notify_email: false }
    responseData = { id: 83, ...body, severity: 'WARNING' }
    expect(await opsAPI.updateAlertRule(83, body)).toEqual(responseData)
    expectWire('put', '/admin/ops/alert-rules/83', {}, body)
  })
  it('deletes the selected rule and preserves the void API result', async () => {
    responseData = { deleted: true }
    expect(await opsAPI.deleteAlertRule(83)).toBeUndefined()
    expectWire('delete', '/admin/ops/alert-rules/83')
  })
  it('keeps event cursor pairs, false email_sent and time fields in the list query', async () => {
    responseData = [{ id: 83, status: 'firing', email_sent: false }]
    const query = { limit: 25, status: 'firing', severity: 'warning', email_sent: false, time_range: '6h', before_fired_at: '2026-11-01T01:02:03.123456789Z', before_id: 83, platform: 'openai', group_id: 84 }
    expect(await opsAPI.listAlertEvents(query)).toEqual(responseData)
    expectWire('get', '/admin/ops/alert-events', query)
    expect(new URL(apiClient.getUri(wire[0].config), 'https://synthetic.invalid').searchParams.get('email_sent')).toBe('false')
  })
  it('loads an event detail and manually resolves its exact selected ID', async () => {
    responseData = { id: 83, status: 'firing', email_sent: false }
    expect(await opsAPI.getAlertEvent(83)).toEqual(responseData)
    expectWire('get', '/admin/ops/alert-events/83')
    wire = []
    expect(await opsAPI.updateAlertEventStatus(83, 'manual_resolved')).toBeUndefined()
    expectWire('put', '/admin/ops/alert-events/83/status', {}, { status: 'manual_resolved' })
  })
  it('creates scoped silence with an RFC3339 until value and nullable dimensions', async () => {
    const body = { rule_id: 83, platform: 'openai', group_id: null, region: null, until: '2026-11-01T15:30:00+09:00', reason: 'Synthetic maintenance' }
    expect(await opsAPI.createAlertSilence(body)).toBeUndefined()
    expectWire('post', '/admin/ops/alert-silences', {}, body)
  })
  const logging = { level: 'warn', persist_access_logs: false, enable_sampling: true, sampling_initial: 100, sampling_thereafter: 5, caller: false, stacktrace_level: 'error', retention_days: 7, request_retention_days: 2 } as const
  it('reads runtime logger settings without touching the four 081 setting groups', async () => {
    responseData = logging
    expect(await opsAPI.getRuntimeLogConfig()).toEqual(logging)
    expectWire('get', '/admin/ops/runtime/logging')
  })
  it('updates sampling/counts and retention days using the original runtime logger DTO', async () => {
    responseData = logging
    expect(await opsAPI.updateRuntimeLogConfig(logging)).toEqual(logging)
    expectWire('put', '/admin/ops/runtime/logging', {}, logging)
  })
  it('resets the runtime logger through its original POST and unwraps returned settings', async () => {
    responseData = logging
    expect(await opsAPI.resetRuntimeLogConfig()).toEqual(logging)
    expectWire('post', '/admin/ops/runtime/logging/reset')
  })
  const logFilter = { start_time: start, end_time: end, host: 'synthetic-host', level: 'warn', component: 'gateway', request_id: 'synthetic-request', client_request_id: 'synthetic-client', user_id: 83, api_key_id: 84, account_id: 85, platform: 'openai', model: 'synthetic-model', q: 'Synthetic log only' }
  it('lists indexed synthetic logs with Go-defined filters and pagination', async () => {
    responseData = page
    expect(await opsAPI.listSystemLogs({ ...logFilter, page: 3, page_size: 25 })).toEqual(page)
    expectWire('get', '/admin/ops/system-logs', { ...logFilter, page: 3, page_size: 25 })
  })
  it('sends cleanup as a bounded mutating POST with only the existing cleanup DTO fields', async () => {
    responseData = { deleted: 3 }
    expect(await opsAPI.cleanupSystemLogs(logFilter)).toEqual({ deleted: 3 })
    expectWire('post', '/admin/ops/system-logs/cleanup', {}, logFilter)
  })
  it('returns log-sink queue and millisecond delay measurements without scaling', async () => {
    responseData = { queue_depth: 2, queue_capacity: 100, dropped_count: 1, write_failed_count: 0, written_count: 10, avg_write_delay_ms: 15.75, last_error: '' }
    expect(await opsAPI.getSystemLogSinkHealth()).toEqual(responseData)
    expectWire('get', '/admin/ops/system-logs/health')
  })
  it('propagates a Go validation rejection rather than synthesizing a success envelope', async () => {
    behavior = async request => { throw failure(request) }
    await expect(opsAPI.updateAlertRule(83, { enabled: false })).rejects.toMatchObject({ status: 400, reason: 'SYNTHETIC_INVALID_QUERY', message: 'Synthetic ops failure' })
    expectWire('put', '/admin/ops/alert-rules/83', {}, { enabled: false })
  })
  it('keeps a service-unavailable rejection distinct from a disabled or empty result', async () => {
    behavior = async request => { throw failure(request, 503, 'SYNTHETIC_SERVICE_UNAVAILABLE') }
    await expect(opsAPI.getDashboardOverview({ time_range: '1h' })).rejects.toMatchObject({ status: 503, message: 'Synthetic ops failure' })
    expectWire('get', '/admin/ops/dashboard/overview', { time_range: '1h' })
  })
  it('forwards the supported dashboard AbortSignal and lets the actual client reject a cancelled response', async () => {
    let finish!: () => void
    behavior = async () => new Promise(resolve => { finish = () => resolve({ synthetic: true }) })
    const controller = new AbortController()
    const request = opsAPI.getDashboardSnapshotV2({ time_range: '30m' }, { signal: controller.signal })
    const assertion = expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
    await Promise.resolve()
    controller.abort(); finish()
    await assertion
    expect(wire[0].config.signal?.aborted).toBe(true)
  })
})
