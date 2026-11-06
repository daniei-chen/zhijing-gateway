import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { InternalAxiosRequestConfig } from 'axios'
import RiskControlView from '../RiskControlView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  riskControl: await vi.importActual('@/api/admin/riskControl'),
  groups: await vi.importActual('@/api/admin/groups'), proxies: await vi.importActual('@/api/admin/proxies'),
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))

interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let requests: Wire[]
let unexpected: string[]
let configData: Record<string, unknown>
let statusData: Record<string, unknown>
let logs: Record<string, unknown>[]
let auditReply: Record<string, unknown>
let failPath: string
const savedKey = (patch: Record<string, unknown> = {}) => ({ index: 0, key_hash: 'synthetic-key-hash', masked: '***release', status: 'ok', configured: true, failure_count: 0, success_count: 1, last_error: '', last_latency_ms: 90, last_http_status: 200, last_tested: true, ...patch })
const log = (patch: Record<string, unknown> = {}) => ({ id: 42, created_at: '2026-11-06T00:00:00Z', group_id: 11, group_name: 'Release plan', user_id: 51, user_email: 'risk-wave@example.invalid', user_status: 'active', api_key_name: 'Synthetic key', endpoint: '/v1/responses', provider: 'openai', model: 'synthetic-model', flagged: false, action: 'observe', highest_category: 'sexual', highest_score: 0.1, violation_count: 1, ban_threshold: 10, auto_banned: false, email_sent: false, upstream_latency_ms: 125, queue_delay_ms: 5, input_excerpt: 'Synthetic risk excerpt', error: '', ...patch })
function button(root: Pick<VueWrapper, 'findAll'> | Pick<ReturnType<VueWrapper['get']>, 'findAll'>, key: string) {
  const found = root.findAll('button').find(node => node.text() === key)
  expect(found, key).toBeDefined(); return found!
}
async function render() {
  const view = mount(RiskControlView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' }, teleport: true, transition: true,
    ProxySelector: true, ModelWhitelistSelector: true,
  } } })
  views.push(view); await flushPromises(); return view
}
async function open(view: VueWrapper, tab = 'basic') {
  await button(view, 'admin.riskControl.openSettings').trigger('click'); await flushPromises()
  const dialog = view.get('[role="dialog"]')
  if (tab !== 'basic') { await button(dialog, `admin.riskControl.tabs.${tab}`).trigger('click'); await flushPromises() }
  return dialog
}
const commands = () => requests.filter(request => request.method !== 'get')

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-wave-risk', user: { id: 7, role: 'admin' } })
  requests = []; unexpected = []
  configData = { engine: 'openai', enabled: true, mode: 'observe', base_url: 'https://moderation.invalid', model: 'omni-moderation-latest', proxy_id: null, api_key_configured: false, api_key_masked: '', api_key_count: 0, api_key_masks: [], api_key_statuses: [], timeout_ms: 3000, sample_rate: 100, all_groups: true, group_ids: [], record_non_hits: false, worker_count: 4, queue_size: 32768, block_status: 403, block_message: 'Synthetic blocked message', email_on_hit: true, auto_ban_enabled: true, ban_threshold: 10, violation_window_hours: 720, retry_count: 2, hit_retention_days: 180, non_hit_retention_days: 3, pre_hash_check_enabled: false, blocked_keywords: [], keyword_blocking_mode: 'keyword_and_api', thresholds: { sexual: 0.65 }, model_filter: { type: 'all', models: [] }, cyber_policy_exclude_from_ban_count: false }
  statusData = { engine: 'openai', enabled: true, risk_control_enabled: true, mode: 'observe', worker_count: 4, active_workers: 2, idle_workers: 2, queue_size: 32768, queue_length: 2, queue_usage_percent: 50, enqueued: 9, processed: 7, dropped: 0, errors: 0, flagged_hash_count: 2, api_key_statuses: [], pre_block_api_key_available_count: 1, pre_block_api_key_loads: [] }
  logs = [log()]
  auditReply = { items: [savedKey()], audit_result: null }
  failPath = ''
  feedback.error.mockReset(); feedback.success.mockReset()
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }
    requests.push(request)
    if (request.path === failPath) { failPath = ''; throw new Error('Synthetic risk transport failure') }
    let data: unknown
    if (request.path === '/admin/risk-control/config') data = request.method === 'put' ? { ...configData, ...request.body } : configData
    else if (request.path === '/admin/risk-control/status') data = statusData
    else if (request.path === '/admin/risk-control/logs') data = { items: logs, total: logs.length, page: 1, page_size: 20, pages: 1 }
    else if (request.path === '/admin/groups/all') data = [{ id: 11, name: 'Release plan', platform: 'openai' }]
    else if (request.path === '/admin/proxies/all') data = []
    else if (request.path === '/admin/risk-control/api-keys/test') data = auditReply
    else { unexpected.push(`${request.method} ${request.path}`); throw new Error(`Unexpected synthetic risk endpoint ${request.path}`) }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data } }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = previousAdapter
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('Risk release audit states at the actual transport boundary', () => {
  it.each([
    { action: 'cyber_policy', flagged: true, error: '', label: 'admin.riskControl.action.cyberPolicy', tone: 'bg-red-100' },
    { action: 'keyword_block', flagged: true, error: '', label: 'admin.riskControl.action.keywordBlock', tone: 'bg-red-100' },
    { action: 'block', flagged: true, error: '', label: 'admin.riskControl.action.block', tone: 'bg-red-100' },
    { action: 'error', flagged: false, error: '', label: 'admin.riskControl.action.error', tone: 'bg-amber-100' },
    { action: 'observe', flagged: false, error: 'Synthetic engine error', label: 'admin.riskControl.action.error', tone: 'bg-amber-100' },
    { action: 'observe', flagged: true, error: '', label: 'admin.riskControl.result.hit', tone: 'bg-pink-100' },
    { action: 'observe', flagged: false, error: '', label: 'admin.riskControl.result.pass', tone: 'bg-green-100' },
  ])('renders the $action / flagged=$flagged audit outcome with its correct visible state', async ({ action, flagged, error, label, tone }) => {
    logs = [log({ action, flagged, error })]
    const view = await render()
    const row = view.get('tbody tr')
    expect(row.get(`.${tone}`).text()).toBe(label)
    expect(commands()).toEqual([])
  })

  it('displays empty optional audit metadata and a zero violation count without inventing a user or prior violation', async () => {
    logs = [log({ user_id: 0, user_email: '', group_name: '', api_key_name: '', endpoint: '', provider: '', model: '', highest_category: '', flagged: true, violation_count: 0, upstream_latency_ms: null, queue_delay_ms: null, input_excerpt: '', error: '' })]
    const view = await render()
    const row = view.get('tbody tr')
    expect(row.text()).toContain('admin.riskControl.violationNotCounted')
    expect(row.text()).not.toContain('UID')
    expect(row.text()).not.toContain('admin.riskControl.queueDelay')
    expect(row.findAll('td').filter(node => node.text() === '-').length).toBeGreaterThanOrEqual(4)
    expect(row.findAll('button').some(node => node.text() === 'admin.riskControl.unbanUser')).toBe(false)
  })

  it('uses the saved error as the input fallback in both the audit row and its public detail dialog', async () => {
    logs = [log({ input_excerpt: '', error: 'Synthetic unreadable audit body', action: 'error', matched_keyword: 'synthetic-match', email_sent: true })]
    const view = await render()
    await view.get('[title="Synthetic unreadable audit body"]').trigger('click')
    const detail = view.get('[role="dialog"]')
    expect(detail.get('pre').text()).toBe('Synthetic unreadable audit body')
    expect(detail.text()).toContain('synthetic-match')
    expect(view.get('tbody tr').text()).toContain('admin.riskControl.emailSent')
  })

  it.each([
    { mode: 'pre_block', strategy: 'keyword_only', notice: 'admin.riskControl.keywordModeKeywordOnlyNotice' },
    { mode: 'pre_block', strategy: 'keyword_and_api', notice: 'admin.riskControl.blockedKeywordsPreBlockHint' },
    { mode: 'pre_block', strategy: 'api_only', notice: 'admin.riskControl.keywordModeApiOnlyNotice' },
    { mode: 'off', strategy: 'keyword_only', notice: 'admin.riskControl.blockedKeywordsModeWarning' },
  ])('explains the $mode/$strategy keyword policy without saving or changing it', async ({ mode, strategy, notice }) => {
    Object.assign(configData, { mode, keyword_blocking_mode: strategy, blocked_keywords: ['synthetic-word'] })
    const view = await render()
    const panel = await open(view, 'keywords')
    expect(panel.text()).toContain(notice)
    expect(panel.get<HTMLTextAreaElement>('textarea').element.value).toBe('synthetic-word')
    expect(panel.get('textarea').attributes('disabled') !== undefined).toBe(strategy === 'api_only')
    expect(commands()).toEqual([])
  })

  it.each([
    { status: 'ok', extra: { last_checked_at: '2026-11-06T00:00:00Z' }, meta: 'admin.riskControl.apiKeyLastChecked' },
    { status: 'frozen', extra: { frozen_until: '2026-11-07T00:00:00Z', last_error: 'Synthetic cooldown' }, meta: 'admin.riskControl.apiKeyFrozenUntil' },
    { status: 'error', extra: { last_error: 'Synthetic provider failure', last_latency_ms: 0, last_http_status: 0 }, meta: 'admin.riskControl.apiKeyNotTested' },
    { status: 'unknown', extra: { last_tested: false }, meta: 'admin.riskControl.apiKeyNotTested' },
  ])('shows a saved $status key with $meta metadata while leaving its secret and configuration untouched', async ({ status, extra, meta }) => {
    const item = savedKey({ status, ...extra })
    Object.assign(configData, { api_key_configured: true, api_key_count: 1, api_key_masks: ['***release'], api_key_statuses: [item] })
    statusData.api_key_statuses = [item]
    const view = await render()
    const panel = await open(view)
    const statuses = panel.get('[data-test="audit-key-statuses"]')
    expect(statuses.text()).toContain('***release')
    expect(statuses.text()).toContain(meta)
    if ('last_error' in extra) expect(statuses.text()).toContain(extra.last_error)
    expect(commands()).toEqual([])
  })

  it('shows an unknown health summary for configured legacy keys whose status rows were not reported', async () => {
    Object.assign(configData, { api_key_configured: true, api_key_count: 3, api_key_masked: '***legacy', api_key_masks: ['***1', '***2', '***3'] })
    const view = await render()
    expect(view.text()).toContain('admin.riskControl.apiKeyStatusUnknown')
    expect(view.text()).toContain('admin.riskControl.apiKeyCount:{"count":3}')
  })

  it('renders the disabled runtime separately from active and idle workers', async () => {
    Object.assign(configData, { enabled: false })
    Object.assign(statusData, { enabled: false, risk_control_enabled: false })
    const view = await render()
    expect(view.findAll('[title="admin.riskControl.workerDisabled"]')).toHaveLength(4)
    expect(view.text()).toContain('admin.riskControl.overview.disabled')
    expect(view.findAll('.bg-gray-300').length).toBeGreaterThan(0)
  })

  it('shows cleanup evidence and clamped queue utilization from the readonly runtime response', async () => {
    Object.assign(statusData, { queue_usage_percent: 120, last_cleanup_at: '2026-11-06T00:00:00Z', last_cleanup_deleted_hit: 4, last_cleanup_deleted_non_hit: 12 })
    const view = await render()
    expect(view.text()).toContain('admin.riskControl.lastCleanup')
    expect(view.findAll('[style]').some(node => node.attributes('style')?.includes('width: 100%'))).toBe(true)
    expect(commands()).toEqual([])
  })

  it('summarizes an exclude model policy and its hidden model count without modifying that admission policy', async () => {
    Object.assign(configData, { model_filter: { type: 'exclude', models: ['release-a', 'release-b', 'release-c', 'release-d', 'release-e', 'release-f', 'release-g'] } })
    const view = await render()
    expect(view.text()).toContain('admin.riskControl.modelFilterExcludeSummary')
    expect(view.text()).toContain('release-a')
    expect(view.text()).not.toContain('release-g')
    expect(commands()).toEqual([])
  })

  it('keeps an explicit zero threshold and false ban-count flag on the actual settings wire', async () => {
    const view = await render()
    const panel = await open(view, 'riskThresholds')
    await panel.get('[data-test="risk-threshold-sexual"]').setValue('0')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()).toHaveLength(1)
    expect(commands()[0]).toMatchObject({ method: 'put', path: '/admin/risk-control/config', body: { thresholds: { sexual: 0 }, cyber_policy_exclude_from_ban_count: false } })
  })

  it('clears a synthetic pending key draft before an explicit stored-key deletion and never sends that draft', async () => {
    Object.assign(configData, { api_key_configured: true, api_key_count: 1, api_key_masks: ['***stored'] })
    const view = await render()
    const panel = await open(view)
    const field = panel.get<HTMLTextAreaElement>('textarea[autocomplete="new-password"]')
    await field.setValue('synthetic-unsaved-key')
    await button(panel, 'admin.riskControl.clearApiKey').trigger('click')
    expect(field.element.value).toBe('')
    expect(button(panel, 'admin.riskControl.testInputApiKeys').attributes('disabled')).toBeDefined()
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0]).toMatchObject({ method: 'put', path: '/admin/risk-control/config', body: { clear_api_key: true } })
    expect(JSON.stringify(commands()[0].body)).not.toContain('synthetic-unsaved-key')
  })

  it('expands and collapses a larger saved key inventory without changing or exposing key material', async () => {
    const items = Array.from({ length: 8 }, (_, index) => savedKey({ index, key_hash: `synthetic-hash-${index}`, masked: `***release-${index}` }))
    Object.assign(configData, { api_key_configured: true, api_key_count: 8, api_key_masks: items.map(item => item.masked), api_key_statuses: items })
    statusData.api_key_statuses = items
    const view = await render()
    const panel = await open(view)
    const statuses = panel.get('[data-test="audit-key-statuses"]')
    expect(statuses.text()).not.toContain('***release-7')
    await button(statuses, 'admin.riskControl.expandApiKeyRows').trigger('click')
    expect(statuses.text()).toContain('***release-7')
    await button(statuses, 'admin.riskControl.collapseApiKeyRows').trigger('click')
    expect(statuses.text()).not.toContain('***release-7')
    expect(commands()).toEqual([])
  })
})

async function chooseRisk(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const option = Array.from(document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
function riskInput(panel: Pick<VueWrapper, 'findAll'>, label: string) {
  const field = panel.findAll('label').find(node => node.text() === label); expect(field, label).toBeDefined()
  return new DOMWrapper(field!.element.parentElement!).get<HTMLInputElement>('input')
}

describe('Risk release boundaries for independent engines, scope and audit results', () => {
  it('retains separate editable OpenAI and TypeSafe engine drafts and submits each endpoint/model/key only to its own engine config', async () => {
    const view = await render(); const panel = await open(view)
    await panel.get('[data-test="audit-base-url"]').setValue('https://openai.synthetic.invalid'); await panel.get('[data-test="audit-model"]').setValue('synthetic-openai-model')
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-openai-key')
    await chooseRisk(panel.get('[data-test="audit-engine-select"] button'), 'TypeSafe AI')
    expect(panel.text()).toContain('admin.riskControl.typeSafeNotice'); expect(panel.get<HTMLInputElement>('[data-test="audit-base-url"]').element.value).toBe('https://api.typesafe.ai')
    await panel.get('[data-test="audit-base-url"]').setValue('https://typesafe.synthetic.invalid'); await panel.get('[data-test="audit-model"]').setValue('synthetic-typesafe-model')
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-typesafe-key')
    await chooseRisk(panel.get('[data-test="audit-engine-select"] button'), 'OpenAI')
    expect(panel.get<HTMLInputElement>('[data-test="audit-model"]').element.value).toBe('synthetic-openai-model'); expect(panel.get<HTMLTextAreaElement>('textarea[autocomplete="new-password"]').element.value).toBe('synthetic-openai-key')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0].body).toMatchObject({ engine: 'openai', api_keys: ['synthetic-openai-key'], engine_configs: { openai: { base_url: 'https://openai.synthetic.invalid', model: 'synthetic-openai-model', api_keys: ['synthetic-openai-key'] }, typesafe: { base_url: 'https://typesafe.synthetic.invalid', model: 'synthetic-typesafe-model', api_keys: ['synthetic-typesafe-key'] } } })
  })

  it('hydrates an older config with missing optional arrays/default values and preserves legitimate zero retry/sample settings on save', async () => {
    Object.assign(configData, { engine: undefined, base_url: '', model: '', proxy_id: null, api_key_masks: null, api_key_statuses: null, api_key_count: 0, timeout_ms: 0, retry_count: 0, sample_rate: 0, group_ids: null, worker_count: 0, queue_size: 0, block_status: 0, block_message: '', email_on_hit: null, auto_ban_enabled: null, ban_threshold: 0, violation_window_hours: 0, hit_retention_days: 0, non_hit_retention_days: 0, blocked_keywords: null, keyword_blocking_mode: 'legacy', model_filter: null })
    const view = await render(); const panel = await open(view)
    expect(panel.get<HTMLInputElement>('[data-test="audit-base-url"]').element.value).toBe('https://api.openai.com')
    expect(panel.get<HTMLInputElement>('[data-test="audit-model"]').element.value).toBe('omni-moderation-latest')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0].body).toMatchObject({ engine: 'openai', timeout_ms: 3000, retry_count: 0, sample_rate: 0, proxy_id: 0, worker_count: 4, queue_size: 32768, block_status: 403, email_on_hit: true, auto_ban_enabled: true, ban_threshold: 10, violation_window_hours: 720, hit_retention_days: 180, non_hit_retention_days: 3, blocked_keywords: [], keyword_blocking_mode: 'keyword_and_api', model_filter: { type: 'all', models: [] } })
  })

  it('keeps explicit false policy switches, clamps non-hit retention to the supported three-day boundary and shows an empty keyword draft', async () => {
    Object.assign(configData, { retry_count: 0, sample_rate: 0, email_on_hit: false, auto_ban_enabled: false, pre_hash_check_enabled: false, non_hit_retention_days: 9, blocked_keywords: [] })
    const view = await render(); const panel = await open(view, 'retention')
    expect(riskInput(panel, 'admin.riskControl.nonHitRetentionDays').element.value).toBe('3')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0].body).toMatchObject({ email_on_hit: false, auto_ban_enabled: false, non_hit_retention_days: 3, pre_hash_check_enabled: false, retry_count: 0, sample_rate: 0 })
  })

  it('filters selectable groups by name or platform and toggles the final targeted scope without sending hidden groups', async () => {
    Object.assign(configData, { all_groups: false, group_ids: [11] })
    const view = await render(); const panel = await open(view, 'scope'); const query = panel.get('input[type="search"]')
    await query.setValue('no-match'); expect(panel.text()).toContain('admin.riskControl.noGroups')
    await query.setValue('OPENAI'); const target = panel.findAll('button').find(node => node.text().includes('Release plan') && node.text().includes('openai'))!
    expect(target).toBeDefined(); await target.trigger('click'); await target.trigger('click')
    await query.setValue('release'); expect(panel.text()).toContain('Release plan')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises(); expect(commands()[0].body).toMatchObject({ all_groups: false, group_ids: [11] })
  })

  it('requires models for a selective filter and explicitly returns to all models without retaining a stale whitelist', async () => {
    Object.assign(configData, { model_filter: { type: 'include', models: [] } })
    const view = await render(); const panel = await open(view, 'scope')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises(); expect(commands()).toEqual([]); expect(feedback.error).toHaveBeenCalledWith('admin.riskControl.modelFilterModelsRequired')
    const all = panel.findAll('button').find(node => node.text().startsWith('admin.riskControl.modelFilterAll'))!; await all.trigger('click')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises(); expect(commands()[0].body.model_filter).toEqual({ type: 'all', models: [] })
  })

  it('normalizes saved model filters with whitespace, duplicate and empty entries, retaining exact case in the literal model strings', async () => {
    Object.assign(configData, { model_filter: { type: 'include', models: [' synthetic-A ', '', 'synthetic-A', null, 'synthetic-B'] } })
    const view = await render(); expect(view.text()).toContain('admin.riskControl.modelFilterIncludeSummary')
    const panel = await open(view); await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0].body.model_filter).toEqual({ type: 'include', models: ['synthetic-A', 'synthetic-B'] })
  })

  it('rejects replacement mode without keys, then accepts deduplicated explicit synthetic replacement keys', async () => {
    const view = await render(); const panel = await open(view)
    await button(panel, 'admin.riskControl.apiKeysModeReplace').trigger('click'); await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()).toEqual([]); expect(feedback.error).toHaveBeenCalledWith('admin.riskControl.apiKeysReplaceNoInput')
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-key-A\n synthetic-key-B \nsynthetic-key-A')
    await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises(); expect(commands()[0].body).toMatchObject({ api_keys: ['synthetic-key-A', 'synthetic-key-B'], api_keys_mode: 'replace', clear_api_key: false })
  })

  it('allows a pending stored-key deletion to be undone, then clears that pending deletion when switching to replacement', async () => {
    const item = savedKey(); Object.assign(configData, { api_key_configured: true, api_key_count: 1, api_key_masks: ['***release'], api_key_statuses: [item] })
    statusData.api_key_statuses = [item]
    const view = await render(); const panel = await open(view)
    await panel.get('[title="admin.riskControl.deleteApiKey"]').trigger('click'); expect(panel.text()).toContain('admin.riskControl.apiKeyPendingDeleteCount')
    await panel.get('[title="admin.riskControl.undoDeleteApiKey"]').trigger('click'); expect(panel.find('[title="admin.riskControl.undoDeleteApiKey"]').exists()).toBe(false)
    await panel.get('[title="admin.riskControl.deleteApiKey"]').trigger('click'); await button(panel, 'admin.riskControl.apiKeysModeReplace').trigger('click')
    expect(panel.find('[title="admin.riskControl.undoDeleteApiKey"]').exists()).toBe(false)
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-replacement-only'); await button(panel, 'admin.riskControl.saveConfig').trigger('click'); await flushPromises()
    expect(commands()[0].body).not.toHaveProperty('delete_api_key_hashes'); expect(commands()[0].body).toMatchObject({ api_keys_mode: 'replace', api_keys: ['synthetic-replacement-only'] })
  })

  it.each([true, false])('renders an explicit moderation test flagged=$flagged result with category ordering, thresholds and engine metadata', async flagged => {
    auditReply = { items: [savedKey({ configured: false })], audit_result: { flagged, highest_category: flagged ? 'violence' : '', highest_score: 0.75, composite_score: 0.4, category_scores: { synthetic_unknown: 0.25, violence: 0.75 }, thresholds: { violence: 0.6 }, engine_meta: { engine: 'typesafe', model: 'synthetic-test-model', rules_version: 'synthetic-rules', skipped_images: 1 } } }
    const view = await render(); const panel = await open(view)
    await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-test-key'); await panel.get('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').setValue('Synthetic moderation input')
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises()
    expect(commands()[0]).toMatchObject({ method: 'post', path: '/admin/risk-control/api-keys/test', body: { engine: 'openai', api_keys: ['synthetic-test-key'], prompt: 'Synthetic moderation input', images: [], proxy_id: 0 } })
    expect(panel.text()).toContain(flagged ? 'admin.riskControl.auditTestFlagged' : 'admin.riskControl.auditTestPassed'); expect(panel.text()).toContain('TypeSafe AI · synthetic-test-model · synthetic-rules'); expect(panel.text()).toContain('admin.riskControl.skippedImages:{"count":1}')
    expect(panel.text()).toContain('75.0% / 60.0%'); expect(panel.text()).toContain('25.0% / 100.0%')
    await button(panel, 'admin.riskControl.clearAuditTest').trigger('click'); expect(panel.text()).not.toContain('admin.riskControl.auditTestHighest'); expect(panel.get<HTMLTextAreaElement>('textarea[placeholder="admin.riskControl.auditTestPromptPlaceholder"]').element.value).toBe('')
  })

  it.each(['error', 'frozen', 'empty'])('shows a failed key test for a $status result without saving the tested input key', async status => {
    auditReply = { items: status === 'empty' ? [] : [savedKey({ status, configured: false })], audit_result: null }
    const view = await render(); const panel = await open(view); await panel.get('textarea[autocomplete="new-password"]').setValue('synthetic-rejected-key')
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('admin.riskControl.apiKeyTestFailed'); expect(commands()).toHaveLength(1); expect(commands()[0].method).toBe('post')
  })

  it('retains a failed test draft for explicit retry and never persists a tested key by itself', async () => {
    const view = await render(); const panel = await open(view); const input = panel.get<HTMLTextAreaElement>('textarea[autocomplete="new-password"]'); await input.setValue('synthetic-retry-key'); failPath = '/admin/risk-control/api-keys/test'
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith('Network error. Please check your connection.'); expect(input.element.value).toBe('synthetic-retry-key')
    await button(panel, 'admin.riskControl.testInputApiKeys').trigger('click'); await flushPromises(); expect(feedback.success).toHaveBeenCalledWith('admin.riskControl.apiKeyTestDone:{"count":1}'); expect(commands().map(request => request.method)).toEqual(['post', 'post'])
  })

  it('uses a refreshed stored-key status without audit text and sends no plaintext keys in a saved-key test', async () => {
    const item = savedKey(); Object.assign(configData, { api_key_configured: true, api_key_count: 1, api_key_masks: ['***release'], api_key_statuses: [] }); auditReply = { items: [item], audit_result: null }; statusData.api_key_statuses = [item]
    const view = await render(); const panel = await open(view); await button(panel, 'admin.riskControl.testStoredApiKeys').trigger('click'); await flushPromises()
    expect(commands()[0].body).toMatchObject({ api_keys: [], prompt: '', images: [] }); expect(panel.get('[data-test="audit-key-statuses"]').text()).toContain('***release'); expect(feedback.success).toHaveBeenCalledWith('admin.riskControl.apiKeyTestDone:{"count":1}')
  })
})
