import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import OpsSettingsDialog from '../OpsSettingsDialog.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { EmailNotificationConfig, OpsAdvancedSettings, OpsAlertRuntimeSettings } from '@/api/admin/ops'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

const runtime = (): OpsAlertRuntimeSettings => ({
  evaluation_interval_seconds: 30,
  distributed_lock: { enabled: true, key: 'synthetic-ops-lock', ttl_seconds: 90 },
  silencing: { enabled: true, global_until_rfc3339: '', global_reason: 'Synthetic retained reason', entries: [{ rule_id: 7, severities: ['warning'], until_rfc3339: '2030-01-01T00:00:00Z', reason: 'Synthetic retained entry' }] },
  thresholds: { sla_percent_min: 98, ttft_p99_ms_max: 600, request_error_rate_percent_max: 4, upstream_error_rate_percent_max: 6 }
})
const email = (): EmailNotificationConfig => ({
  alert: { enabled: true, recipients: ['initial-alert@example.test'], min_severity: 'warning', rate_limit_per_hour: 12, batching_window_seconds: 45, include_resolved_alerts: true },
  report: { enabled: true, recipients: ['initial-report@example.test'], daily_summary_enabled: true, daily_summary_schedule: '0 9 * * *', weekly_summary_enabled: true, weekly_summary_schedule: '0 9 * * 1', error_digest_enabled: true, error_digest_schedule: '0 * * * *', error_digest_min_count: 9, account_health_enabled: true, account_health_schedule: '0 8 * * *', account_health_error_rate_threshold: 0.25 }
})
const advanced = (): OpsAdvancedSettings => ({
  data_retention: { cleanup_enabled: true, cleanup_schedule: '0 2 * * *', error_log_retention_days: 7, minute_metrics_retention_days: 8, hourly_metrics_retention_days: 90 },
  aggregation: { aggregation_enabled: true }, openai_account_quota_auto_pause: { default_threshold_5h: 0.83, default_threshold_7d: 0.95 },
  ignore_count_tokens_errors: true, ignore_context_canceled: true, ignore_no_available_accounts: true, ignore_invalid_api_key_errors: true, ignore_insufficient_balance_errors: true,
  display_openai_token_stats: true, display_alert_events: true, auto_refresh_enabled: true, auto_refresh_interval_seconds: 30
})
const thresholds = () => ({ sla_percent_min: 98.5, ttft_p99_ms_max: 650, request_error_rate_percent_max: 4.5, upstream_error_rate_percent_max: 6.5 })
const path = (suffix: string) => `/api/v1/admin/ops${suffix}`
const paths = ['/runtime/alert', '/email-notification/config', '/advanced-settings', '/settings/metric-thresholds'].map(path)
type Wire = { method: string; path: string; body: unknown; auth: string; signal?: AbortSignal }
type Reply = { value: unknown; status?: number; message?: string }
type Server = (request: Wire) => Promise<Reply>
const originalAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wire: Wire[]
let server: Server
const writes = () => wire.filter(request => request.method === 'PUT')
const write = (suffix: string) => writes().find(request => request.path === path(suffix))!
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-ops-admin-A', user: { id: 7, role: 'admin' } })
  feedback.success.mockReset(); feedback.error.mockReset(); wire = []
  server = async request => {
    if (request.method === 'PUT') return { value: request.body }
    const values: Record<string, unknown> = { [paths[0]]: runtime(), [paths[1]]: email(), [paths[2]]: advanced(), [paths[3]]: thresholds() }
    if (!(request.path in values)) throw new Error(`Unexpected synthetic endpoint ${request.path}`)
    return { value: values[request.path] }
  }
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid')
    const request: Wire = { method: String(config.method).toUpperCase(), path: url.pathname, body: config.data ? JSON.parse(config.data) : undefined, auth: String(config.headers.Authorization || ''), signal: config.signal as AbortSignal }
    wire.push(request)
    const reply = await server(request)
    const response = { config, status: reply.status || 200, statusText: 'Synthetic Ops response', headers: {}, data: reply.status ? { code: reply.status, message: reply.message } : { code: 0, data: clone(reply.value) } }
    if (reply.status) throw new AxiosError(reply.message, AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  expect(wire.every(request => paths.includes(request.path))).toBe(true)
  mounted.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks(); document.body.innerHTML = ''
})

async function render(initiallyOpen = false) {
  const view = mount(OpsSettingsDialog, { props: { show: initiallyOpen }, attachTo: document.body })
  mounted.push(view)
  if (!initiallyOpen) await view.setProps({ show: true })
  await flushPromises()
  return view
}
const panel = () => new DOMWrapper(document.body.querySelector<HTMLElement>('[role="dialog"]')!)
type Root = Pick<DOMWrapper<Element>, 'findAll'>
function button(root: Root, name: string) {
  const node = root.findAll('button').find(button => button.text() === name)
  expect(node, name).toBeDefined(); return node!
}
function field(name: string, selector = 'input, button[role="switch"], button[aria-haspopup]') {
  const label = panel().findAll('label').find(label => label.text() === `admin.ops.settings.${name}`)
  expect(label, name).toBeDefined()
  let container: Element | null = label!.element
  while (container && !container.querySelector(selector)) container = container.parentElement
  const control = container?.querySelector(selector)
  expect(control, name).toBeTruthy()
  return new DOMWrapper(control!)
}
async function save() { await button(panel(), 'common.save').trigger('click'); await flushPromises() }
async function reopen(view: VueWrapper) { await view.setProps({ show: false }); await view.setProps({ show: true }); await flushPromises() }
async function choose(control: DOMWrapper<Element>, label: string) {
  await control.trigger('click'); await flushPromises()
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}

describe('actual Ops settings DOM and Axios wire contracts', () => {
  it.each([0, 3])('waits for every PUT when path index %i rejects before its peer settles', async failedIndex => {
    const pending = deferred<Reply>(); const original = server
    server = async request => {
      if (request.method === 'PUT' && request.path === paths[failedIndex]) return { value: null, status: 400, message: 'Synthetic rejected ops setting' }
      if (request.method === 'PUT' && request.path === paths[2]) return pending.promise
      return original(request)
    }
    const view = await render(); await save()
    expect(writes()).toHaveLength(4)
    const action = panel().get<HTMLButtonElement>('button.btn-primary').element
    action.click(); await flushPromises()
    expect(writes()).toHaveLength(4)
    expect(action.disabled).toBe(true)
    expect(feedback.error).not.toHaveBeenCalled()
    pending.resolve({ value: advanced() }); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('Synthetic rejected ops setting')
    expect(view.emitted('saved')).toBeUndefined(); expect(view.emitted('close')).toBeUndefined()
    expect(panel().get<HTMLButtonElement>('button.btn-primary').element.disabled).toBe(false)
    server = original; await save()
    expect(writes()).toHaveLength(8)
    expect(view.emitted('saved')).toHaveLength(1)
  })
  it('loads all settings, edits ordinary sections and sends the four original typed payloads', async () => {
    const view = await render()
    expect(wire.map(request => request.path).sort()).toEqual([...paths].sort())
    expect(wire.every(request => request.auth === 'Bearer synthetic-ops-admin-A')).toBe(true)
    await field('evaluationInterval').setValue('45')
    await field('slaMinPercent').setValue('97.2'); await field('ttftP99MaxMs').setValue('900')
    await field('requestErrorRateMaxPercent').setValue('7.5'); await field('upstreamErrorRateMaxPercent').setValue('8.5')
    panel().get('details').element.open = true
    await field('cleanupSchedule').setValue('0 3 * * *')
    await field('errorLogRetentionDays').setValue('14'); await field('minuteMetricsRetentionDays').setValue('21'); await field('hourlyMetricsRetentionDays').setValue('120')
    await field('enableAggregation').trigger('click')
    for (const name of ['ignoreCountTokensErrors', 'ignoreContextCanceled', 'ignoreNoAvailableAccounts', 'ignoreInsufficientBalanceErrors', 'displayAlertEvents', 'displayOpenAITokenStats']) await field(name).trigger('click')
    await choose(field('refreshInterval'), 'admin.ops.settings.refreshInterval60s')
    await save()
    expect(writes()).toHaveLength(4)
    expect(write('/runtime/alert').body).toEqual({ ...runtime(), evaluation_interval_seconds: 45 })
    expect(write('/email-notification/config').body).toEqual(email())
    expect(write('/advanced-settings').body).toEqual({ ...advanced(), data_retention: { cleanup_enabled: true, cleanup_schedule: '0 3 * * *', error_log_retention_days: 14, minute_metrics_retention_days: 21, hourly_metrics_retention_days: 120 }, aggregation: { aggregation_enabled: false }, ignore_count_tokens_errors: false, ignore_context_canceled: false, ignore_no_available_accounts: false, ignore_insufficient_balance_errors: false, display_alert_events: false, display_openai_token_stats: false, auto_refresh_interval_seconds: 60 })
    expect(write('/settings/metric-thresholds').body).toEqual({ sla_percent_min: 97.2, ttft_p99_ms_max: 900, request_error_rate_percent_max: 7.5, upstream_error_rate_percent_max: 8.5 })
    expect(view.emitted('saved')).toHaveLength(1); expect(view.emitted('close')).toHaveLength(1)
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.settings.saveSuccess')
  })

  it('converts displayed quota percentages to the original 0-to-1 request fraction and clears to zero', async () => {
    await render(); panel().get('details').element.open = true
    expect((field('openaiQuotaAutoPauseDefault5h').element as HTMLInputElement).value).toBe('83')
    await field('openaiQuotaAutoPauseDefault5h').setValue('90.5')
    await field('openaiQuotaAutoPauseDefault7d').setValue('')
    await save()
    expect(write('/advanced-settings').body).toMatchObject({ openai_account_quota_auto_pause: { default_threshold_5h: 0.905, default_threshold_7d: 0 } })
  })

  it('validates and normalizes recipient additions, removes old recipients, and preserves hidden report options', async () => {
    await render()
    await field('alertRecipients').setValue('not-an-email'); await field('alertRecipients').trigger('keydown', { key: 'Enter' })
    expect(feedback.error).toHaveBeenCalledWith('common.invalidEmail')
    await field('alertRecipients').setValue(' NEW-ALERT@EXAMPLE.TEST '); await field('alertRecipients').trigger('keydown', { key: 'Enter' })
    await field('alertRecipients').setValue('new-alert@example.test'); await field('alertRecipients').trigger('keydown', { key: 'Enter' })
    const old = panel().findAll('span').find(span => span.text().startsWith('initial-alert@example.test'))!
    await old.get('button').trigger('click')
    await field('reportRecipients').setValue(' REPORT2@EXAMPLE.TEST '); await field('reportRecipients').trigger('keydown', { key: 'Enter' })
    await choose(field('minSeverity'), 'common.critical')
    await panel().get('input[placeholder="0 9 * * *"]').setValue('0 10 * * *')
    await field('weeklySummary').trigger('click')
    await save()
    expect(write('/email-notification/config').body).toEqual({
      alert: { ...email().alert, recipients: ['new-alert@example.test'], min_severity: 'critical' },
      report: { ...email().report, recipients: ['initial-report@example.test', 'report2@example.test'], daily_summary_schedule: '0 10 * * *', weekly_summary_enabled: false }
    })
  })

  it('disables empty recipient notifications in the request and keeps existing cadence fields', async () => {
    const original = server
    server = async request => request.method === 'GET' && request.path === paths[1] ? { value: { alert: { ...email().alert, recipients: [] }, report: { ...email().report, recipients: [] } } } : original(request)
    await render(); await save()
    expect(write('/email-notification/config').body).toEqual({ alert: { ...email().alert, enabled: false, recipients: [] }, report: { ...email().report, enabled: false, recipients: [] } })
  })

  it.each([
    ['evaluationInterval', '0', 'admin.ops.runtime.validation.evalIntervalRange', '30'],
    ['evaluationInterval', '1.5', 'admin.ops.runtime.validation.evalIntervalRange', '30'],
    ['slaMinPercent', '101', 'admin.ops.settings.validation.slaMinPercentRange', '99'],
    ['ttftP99MaxMs', '-1', 'admin.ops.settings.validation.ttftP99MaxRange', '500'],
    ['requestErrorRateMaxPercent', '-1', 'admin.ops.settings.validation.requestErrorRateMaxRange', '5'],
    ['upstreamErrorRateMaxPercent', '101', 'admin.ops.settings.validation.upstreamErrorRateMaxRange', '5'],
    ['errorLogRetentionDays', '366', 'admin.ops.settings.validation.retentionDaysRange', '7'],
    ['openaiQuotaAutoPauseDefault5h', '101', 'admin.ops.settings.validation.openaiQuotaAutoPauseRange', '85']
  ])('blocks invalid %s visibly and accepts a corrected explicit save', async (name, invalid, error, corrected) => {
    await render(); panel().get('details').element.open = true
    await field(name).setValue(invalid)
    expect(panel().text()).toContain(error)
    expect((button(panel(), 'common.save').element as HTMLButtonElement).disabled).toBe(true)
    button(panel(), 'common.save').element.click(); await flushPromises(); expect(writes()).toEqual([])
    await field(name).setValue(corrected); await save(); expect(writes()).toHaveLength(4)
  })

  it('shows the real structured HTTP error and retries the corrected current draft', async () => {
    const original = server; let failed = false
    server = async request => {
      if (!failed && request.method === 'PUT' && request.path === paths[2]) { failed = true; return { value: null, status: 400, message: 'Synthetic invalid cleanup schedule' } }
      return original(request)
    }
    const view = await render(); await save()
    expect(feedback.error).toHaveBeenCalledWith('Synthetic invalid cleanup schedule')
    expect(view.emitted('close')).toBeUndefined()
    await field('evaluationInterval').setValue('55'); await save()
    expect(writes().filter(request => request.path === paths[0]).map(request => (request.body as OpsAlertRuntimeSettings).evaluation_interval_seconds)).toEqual([30, 55])
    expect(view.emitted('saved')).toHaveLength(1)
  })

  it('sends nullable numeric thresholds instead of JSON strings when optional thresholds are cleared', async () => {
    await render()
    for (const name of ['slaMinPercent', 'ttftP99MaxMs', 'requestErrorRateMaxPercent', 'upstreamErrorRateMaxPercent']) await field(name).setValue('')
    await save()
    expect(write('/settings/metric-thresholds').body).toEqual({ sla_percent_min: null, ttft_p99_ms_max: null, request_error_rate_percent_max: null, upstream_error_rate_percent_max: null })
  })

  it('restores existing display defaults when the next read omits all nullable metric fields', async () => {
    const original = server; let first = true
    server = async request => {
      if (request.method === 'GET' && request.path === paths[3]) {
        if (first) { first = false; return { value: thresholds() } }
        return { value: {} }
      }
      return original(request)
    }
    const view = await render()
    expect((field('slaMinPercent').element as HTMLInputElement).value).toBe('98.5')
    await reopen(view)
    expect((field('slaMinPercent').element as HTMLInputElement).value).toBe('99.5')
    await save()
    expect(write('/settings/metric-thresholds').body).toEqual({ sla_percent_min: 99.5, ttft_p99_ms_max: 500, request_error_rate_percent_max: 5, upstream_error_rate_percent_max: 5 })
  })

  it.each([
    ['errorLogRetentionDays', ''], ['minuteMetricsRetentionDays', '1.5'], ['hourlyMetricsRetentionDays', '']
  ])('keeps invalid integer retention %s out of the wire and accepts an explicit zero', async (name, invalid) => {
    await render(); panel().get('details').element.open = true
    await field(name).setValue(invalid)
    expect((button(panel(), 'common.save').element as HTMLButtonElement).disabled).toBe(true)
    expect(panel().text()).toContain('admin.ops.settings.validation.retentionDaysRange')
    button(panel(), 'common.save').element.click(); await flushPromises(); expect(writes()).toEqual([])
    await field(name).setValue('0'); await save()
    expect(writes()).toHaveLength(4)
    const retention = (write('/advanced-settings').body as OpsAdvancedSettings).data_retention
    const key = { errorLogRetentionDays: 'error_log_retention_days', minuteMetricsRetentionDays: 'minute_metrics_retention_days', hourlyMetricsRetentionDays: 'hourly_metrics_retention_days' }[name] as keyof typeof retention
    expect(retention[key]).toBe(0)
  })

  it('turns collection-related visibility switches off without clearing their retained schedules or starting cleanup', async () => {
    await render(); panel().get('details').element.open = true
    for (const name of ['enableAlert', 'enableReport', 'enableCleanup', 'enableAutoRefresh']) await field(name).trigger('click')
    const labels = panel().findAll('label').map(label => label.text())
    for (const name of ['alertRecipients', 'reportRecipients', 'cleanupSchedule', 'refreshInterval']) expect(labels).not.toContain(`admin.ops.settings.${name}`)
    await save()
    expect(write('/email-notification/config').body).toEqual({ alert: { ...email().alert, enabled: false }, report: { ...email().report, enabled: false } })
    expect(write('/advanced-settings').body).toEqual({ ...advanced(), data_retention: { ...advanced().data_retention, cleanup_enabled: false }, auto_refresh_enabled: false })
    expect(writes().map(request => request.path).sort()).toEqual([...paths].sort())
  })

  it('edits a weekly report schedule while daily reporting is hidden and preserves other report settings', async () => {
    await render(); await field('dailySummary').trigger('click')
    expect(panel().find('input[placeholder="0 9 * * *"]').exists()).toBe(false)
    await panel().get('input[placeholder="0 9 * * 1"]').setValue('15 10 * * 2')
    await save()
    expect(write('/email-notification/config').body).toMatchObject({ report: { ...email().report, daily_summary_enabled: false, weekly_summary_schedule: '15 10 * * 2' } })
  })

  it('loads an older missing quota setting safely and preserves explicit zero metric values', async () => {
    const original = server
    server = async request => {
      if (request.method === 'GET' && request.path === paths[2]) {
        const { openai_account_quota_auto_pause: _old, ...older } = advanced()
        return { value: older }
      }
      if (request.method === 'GET' && request.path === paths[3]) return { value: { sla_percent_min: 0, ttft_p99_ms_max: 0, request_error_rate_percent_max: 0, upstream_error_rate_percent_max: 0 } }
      return original(request)
    }
    await render(); panel().get('details').element.open = true
    expect((field('openaiQuotaAutoPauseDefault5h').element as HTMLInputElement).value).toBe('')
    expect((field('openaiQuotaAutoPauseDefault7d').element as HTMLInputElement).value).toBe('')
    expect((field('slaMinPercent').element as HTMLInputElement).value).toBe('0')
    await save()
    expect(write('/advanced-settings').body).toMatchObject({ openai_account_quota_auto_pause: { default_threshold_5h: 0, default_threshold_7d: 0 } })
    expect(write('/settings/metric-thresholds').body).toEqual({ sla_percent_min: 0, ttft_p99_ms_max: 0, request_error_rate_percent_max: 0, upstream_error_rate_percent_max: 0 })
  })

  it('keeps a failed actual initial load blocked and retries by closing and reopening', async () => {
    const original = server; let first = true
    server = async request => {
      if (first && request.method === 'GET' && request.path === paths[3]) { first = false; return { value: null, status: 400, message: 'Synthetic initial threshold read unavailable' } }
      return original(request)
    }
    const view = await render()
    expect(feedback.error).toHaveBeenCalledWith('Synthetic initial threshold read unavailable')
    expect((button(panel(), 'common.save').element as HTMLButtonElement).disabled).toBe(true)
    button(panel(), 'common.save').element.click(); await flushPromises(); expect(writes()).toEqual([])
    await reopen(view); await save()
    expect(writes()).toHaveLength(4)
    expect(view.emitted('saved')).toHaveLength(1)
  })
})

describe('Ops settings dialog ownership across actual async wire', () => {
  it('locks synchronous native save clicks to one four-endpoint submission', async () => {
    const pending = deferred<Reply>(); const original = server
    server = async request => request.method === 'PUT' && request.path === paths[2] ? pending.promise : original(request)
    await render()
    const saveButton = button(panel(), 'common.save').element
    saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises(); expect(writes()).toHaveLength(4)
    pending.resolve({ value: advanced() }); await flushPromises()
    expect(feedback.success).toHaveBeenCalledTimes(1)
  })

  it('keeps the submitted recipient array fixed while later recipients remain an editable draft', async () => {
    const pending = deferred<Reply>(); const original = server; let first = true
    server = async request => {
      if (first && request.method === 'PUT' && request.path === paths[2]) { first = false; return pending.promise }
      return original(request)
    }
    const view = await render(); await save()
    await field('alertRecipients').setValue('later@example.test'); await field('alertRecipients').trigger('keydown', { key: 'Enter' })
    pending.resolve({ value: advanced() }); await flushPromises()
    expect(view.emitted('close')).toBeUndefined()
    const firstPayload = write('/email-notification/config').body as EmailNotificationConfig
    expect(firstPayload.alert.recipients).toEqual(['initial-alert@example.test'])
    expect(panel().text()).toContain('later@example.test')
    await save()
    const emails = writes().filter(request => request.path === paths[1]).map(request => (request.body as EmailNotificationConfig).alert.recipients)
    expect(emails).toEqual([['initial-alert@example.test'], ['initial-alert@example.test', 'later@example.test']])
  })

  it('ignores a late failed load after the dialog has unmounted', async () => {
    const pending = deferred<Reply>(); const original = server
    server = async request => request.method === 'GET' && request.path === paths[3] ? pending.promise : original(request)
    const view = await render(); view.unmount(); mounted.splice(mounted.indexOf(view), 1)
    pending.resolve({ value: null, status: 400, message: 'Synthetic disposed initial load error' }); await flushPromises()
    expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
  })

  it('loads a dialog mounted already open', async () => {
    await render(true)
    expect(wire.filter(request => request.method === 'GET')).toHaveLength(4)
    expect((field('evaluationInterval').element as HTMLInputElement).value).toBe('30')
  })

  it('keeps a newly reopened load when the previous dialog read arrives last', async () => {
    const pending = deferred<Reply>(); const original = server; let first = true
    server = async request => {
      if (request.method === 'GET' && request.path === paths[0]) {
        if (first) { first = false; return pending.promise }
        return { value: { ...runtime(), evaluation_interval_seconds: 75 } }
      }
      return original(request)
    }
    const view = await render(); await reopen(view)
    expect((field('evaluationInterval').element as HTMLInputElement).value).toBe('75')
    pending.resolve({ value: { ...runtime(), evaluation_interval_seconds: 10 } }); await flushPromises()
    expect((field('evaluationInterval').element as HTMLInputElement).value).toBe('75')
  })

  it.each(['success', 'error'])('does not let an old save %s close or notify a reopened draft', async outcome => {
    const pending = deferred<Reply>(); const original = server
    server = async request => request.method === 'PUT' && request.path === paths[2] ? pending.promise : original(request)
    const view = await render(); await save(); await reopen(view)
    await field('evaluationInterval').setValue('77')
    pending.resolve(outcome === 'success' ? { value: advanced() } : { value: null, status: 400, message: 'Synthetic old dialog save error' }); await flushPromises()
    expect((field('evaluationInterval').element as HTMLInputElement).value).toBe('77')
    expect(view.emitted('close')).toBeUndefined(); expect(view.emitted('saved')).toBeUndefined()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
  })

  it('preserves a later edit in the submitted dialog and unlocks a new explicit save', async () => {
    const pending = deferred<Reply>(); const original = server; let first = true
    server = async request => {
      if (first && request.method === 'PUT' && request.path === paths[2]) { first = false; return pending.promise }
      return original(request)
    }
    const view = await render(); await field('evaluationInterval').setValue('40'); await save()
    await field('evaluationInterval').setValue('80')
    pending.resolve({ value: advanced() }); await flushPromises()
    expect(view.emitted('close')).toBeUndefined(); expect(view.emitted('saved')).toBeUndefined()
    expect((field('evaluationInterval').element as HTMLInputElement).value).toBe('80')
    expect((button(panel(), 'common.save').element as HTMLButtonElement).disabled).toBe(false)
    await save()
    expect(writes().filter(request => request.path === paths[0]).map(request => (request.body as OpsAlertRuntimeSettings).evaluation_interval_seconds)).toEqual([40, 80])
  })

  it.each(['success', 'error'])('suppresses a late save %s after unmount', async outcome => {
    const pending = deferred<Reply>(); const original = server
    server = async request => request.method === 'PUT' && request.path === paths[2] ? pending.promise : original(request)
    const view = await render(); await save(); view.unmount(); mounted.splice(mounted.indexOf(view), 1)
    pending.resolve(outcome === 'success' ? { value: advanced() } : { value: null, status: 400, message: 'Synthetic disposed save error' }); await flushPromises()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
    expect(view.emitted('saved')).toBeUndefined(); expect(view.emitted('close')).toBeUndefined()
  })

  it('does not submit old settings after a same-ID replacement login', async () => {
    await render()
    replaceAuthSession({ accessToken: 'synthetic-ops-admin-B', user: { id: 7, role: 'admin' } })
    await save()
    expect(writes()).toEqual([]); expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
  })

  it('does not report the old save cancellation as an error after replacement login', async () => {
    const pending = deferred<Reply>(); const original = server
    server = async request => request.method === 'PUT' && request.path === paths[2] ? pending.promise : original(request)
    const view = await render(); await save()
    replaceAuthSession({ accessToken: 'synthetic-ops-admin-B', user: { id: 7, role: 'admin' } })
    pending.resolve({ value: advanced() }); await flushPromises()
    expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
    expect(view.emitted('saved')).toBeUndefined()
  })

  it('discards an uncommitted recipient input when the dialog is explicitly reopened', async () => {
    const view = await render(); await field('alertRecipients').setValue('unsaved@example.test')
    await reopen(view)
    expect((field('alertRecipients').element as HTMLInputElement).value).toBe('')
    await save()
    expect(write('/email-notification/config').body).toEqual(email())
  })
})
