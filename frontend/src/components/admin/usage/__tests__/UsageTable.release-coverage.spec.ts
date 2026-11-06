import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import UsageTable from '../UsageTable.vue'
import type { AdminUsageLog } from '@/types'
import type { IpGeoStatus } from '@/utils/ipGeoLookup'

const mocks = vi.hoisted(() => ({
  entries: new Map<string, { status: IpGeoStatus }>(),
  batch: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/utils/ipGeoLookup', () => ({ getEntry: (ip: string) => mocks.entries.get(ip) ?? { status: 'idle' }, fetchBatch: mocks.batch, fetchOne: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.success, showError: mocks.error }) }))
vi.mock('vue-i18n', async importOriginal => ({ ...await importOriginal<typeof import('vue-i18n')>(), useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${Object.values(params).join(',')}` : key }) }))

enableAutoUnmount(afterEach)
const keys = ['user', 'api_key', 'account', 'model', 'reasoning_effort', 'endpoint', 'group', 'stream', 'billing_mode', 'tokens', 'cost', 'latency', 'created_at', 'request_id', 'upstream_request_id', 'user_agent', 'ip_address']
const row = (patch: Partial<AdminUsageLog> = {}): AdminUsageLog => ({
  id: 1, user_id: 7, api_key_id: 11, account_id: null, request_id: 'synthetic-request', model: 'gpt-synthetic', group_id: null, subscription_id: null,
  input_tokens: 1500, output_tokens: 200, cache_creation_tokens: 0, cache_read_tokens: 0, cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 0,
  input_cost: 0.003, output_cost: 0.002, cache_creation_cost: 0, cache_read_cost: 0, total_cost: 0.005, actual_cost: 0.004, rate_multiplier: 0.8,
  long_context_billing_applied: false, billing_type: 0, stream: true, native_compaction_v2: false, duration_ms: 1500, first_token_ms: 500,
  image_count: 0, image_size: null, image_input_size: null, image_output_size: null, image_size_source: null, image_size_breakdown: null,
  image_input_tokens: 0, image_input_cost: 0, image_output_tokens: 0, image_output_cost: 0, user_agent: null, cache_ttl_overridden: false, created_at: '2030-01-01T00:00:00Z', ...patch,
})
function host(data = [row()], options: { flat?: boolean; showAccountBilling?: boolean; showUpstreamEndpoint?: boolean; columns?: string[] } = {}) {
  const columns = (options.columns ?? keys).map(key => ({ key, label: `Synthetic ${key}`, sortable: key === 'model' }))
  return mount(UsageTable, { attachTo: document.body, props: { data, ...options, columns, serverSideSort: true }, global: { stubs: { Icon: true } } })
}
type View = ReturnType<typeof host>
function cell(view: View, name: string, index = 0) { return view.findAll('tbody tr')[index].findAll('td')[keys.indexOf(name)] }
const portal = () => new DOMWrapper(document.body).get('[class~="z-[9999]"]')
async function hover(view: View, name: 'cost' | 'tokens', index = 0) { await cell(view, name, index).get('.group.relative').trigger('mouseenter'); return portal() }
beforeEach(() => { mocks.entries.clear(); mocks.batch.mockReset(); mocks.batch.mockResolvedValue(true); mocks.success.mockReset(); mocks.error.mockReset(); vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, left: 20, right: 120, top: 30, bottom: 50, width: 100, height: 20, toJSON: () => ({}) }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('usage table native cells, teleported details and real DataTable sorting', () => {
  it('renders sparse records, private billing visibility and model sort without a slot stub', async () => {
    const view = host([row({ request_id: '', input_tokens: 0, output_tokens: 0, duration_ms: null, first_token_ms: null })], { flat: true, showAccountBilling: false, showUpstreamEndpoint: false })
    expect(view.find('.card').exists()).toBe(false)
    for (const name of ['user', 'api_key', 'account', 'group', 'request_id', 'upstream_request_id', 'user_agent', 'ip_address']) expect(cell(view, name).text()).toContain('-')
    expect(cell(view, 'latency').text()).toContain('—')
    expect(cell(view, 'endpoint').text()).not.toContain('usage.upstream')
    await view.findAll('thead th')[keys.indexOf('model')].get('button').trigger('click')
    expect(view.emitted('sort')).toEqual([['model', 'asc']])
    const cost = await hover(view, 'cost'); expect(cost.text()).not.toContain('usage.accountMultiplier')
    await cell(view, 'cost').get('.group.relative').trigger('mouseleave'); expect(document.querySelector('[class~="z-[9999]"]')).toBeNull()
  })
  it('emits the exact user identity from a deleted-user row and preserves diagnostic titles', async () => {
    const user: NonNullable<AdminUsageLog['user']> = { id: 7, username: 'synthetic-user', email: 'synthetic@example.invalid', role: 'user', balance: 0, concurrency: 2, status: 'active', allowed_groups: [], balance_notify_enabled: false, balance_notify_threshold: null, balance_notify_extra_emails: [], created_at: '2030-01-01', updated_at: '2030-01-01', deleted_at: '2030-01-02' }
    const view = host([row({ user, account: { id: 22, name: 'Synthetic account' }, user_agent: 'Synthetic desktop', inbound_endpoint: ' /v1/responses ', upstream_endpoint: ' /responses ' })])
    await cell(view, 'user').get('button').trigger('click'); expect(view.emitted('userClick')).toEqual([[7, 'synthetic@example.invalid']])
    expect(cell(view, 'user').text()).toContain('admin.usage.userDeletedBadge'); expect(cell(view, 'account').text()).toBe('Synthetic account')
    expect(cell(view, 'user_agent').get('span').attributes('title')).toBe('Synthetic desktop')
    expect(cell(view, 'endpoint').text()).toContain('/v1/responses')
  })
  it.each([
    ['cyber', 'red'], ['live', 'emerald'], ['ws_v2', 'violet'], ['stream', 'blue'], ['sync', 'gray'], ['unknown', 'amber'],
  ] as const)('renders %s request type with its independent compaction marker', (request_type, color) => {
    const view = host([row({ request_type, native_compaction_v2: true })])
    const badge = cell(view, 'stream').get('[data-testid="request-type-badge"]')
    expect(badge.text()).toBe(`usage.${request_type === 'ws_v2' ? 'ws' : request_type}`)
    expect(badge.classes().join(' ')).toContain(`bg-${color}-100`)
    expect(cell(view, 'stream').get('[data-testid="native-compaction-badge"]').text()).toBe('usage.nativeCompactionV2')
  })
  it.each([[999, '999ms'], [1500, '1.50s'], [65000, '1m 5s'], [3660000, '1h 1m']] as const)('formats %s ms without confusing total duration and first token', (duration_ms, text) => {
    const view = host([row({ duration_ms, first_token_ms: null })]); expect(cell(view, 'latency').text()).toContain(text)
  })
  it('shows model chains, true substitutions and dated variants as distinct audits', () => {
    const view = host([
      row({ model_mapping_chain: 'client→mapped→upstream', upstream_model: 'alpha', upstream_response_model: 'alpha-2030-01-01', upstream_model_mismatch: true, reasoning_effort: ' high ', upstream_reasoning_effort: 'low' }),
      row({ id: 2, upstream_model: 'other', upstream_response_model: 'different', upstream_model_mismatch: true, reasoning_effort: '', upstream_reasoning_effort: 'high' }),
    ])
    expect(cell(view, 'model').text()).toContain('↳mapped'); expect(cell(view, 'model').text()).toContain('usage.modelVariant')
    expect(cell(view, 'model', 1).text()).toContain('usage.modelMismatch'); expect(cell(view, 'model', 1).text()).toContain('other')
    expect(cell(view, 'reasoning_effort').text()).toContain('↳'); expect(cell(view, 'reasoning_effort', 1).text()).not.toContain('↳')
  })
  it('opens, positions and closes the token detail portal with separate text/image/cache amounts', async () => {
    const view = host([row({ image_input_tokens: 500, image_output_tokens: 100, cache_creation_tokens: 300, cache_creation_5m_tokens: 100, cache_creation_1h_tokens: 200, cache_read_tokens: 400, cache_ttl_overridden: true })])
    const tip = await hover(view, 'tokens')
    for (const value of ['usage.tokenDetails', 'usage.imageInputTokens', 'usage.imageOutputTokens', 'admin.usage.cacheCreation5mTokens', 'admin.usage.cacheCreation1hTokens', 'admin.usage.cacheReadTokens', '1,000', '500', 'usage.totalTokens', '2,400']) expect(tip.text()).toContain(value)
    expect(tip.attributes('style')).toContain('left: 128px'); expect(tip.attributes('style')).toContain('top: 40px')
    await cell(view, 'tokens').get('.group.relative').trigger('mouseleave'); expect(document.body.textContent).not.toContain('usage.tokenDetails')
  })
  it('handles aggregate cache records and a cache override without one-hour detail', async () => {
    const view = host([row({ input_tokens: 0, output_tokens: 0, cache_creation_tokens: 100, cache_ttl_overridden: true })])
    const tip = await hover(view, 'tokens'); expect(tip.text()).toContain('admin.usage.cacheCreationTokens'); expect(tip.text()).toContain('R-1H'); expect(tip.text()).toContain('usage.cacheTtlOverridden5m')
  })
  it.each([
    { billing_mode: 'token', image_input_tokens: 500, image_output_tokens: 100, image_input_cost: 0.001, image_output_cost: 0.001, cache_creation_cost: 0.0001, cache_read_cost: 0.0002, account_stats_cost: 0.002, account_rate_multiplier: 3 },
    { billing_mode: 'per_request', total_cost: 0, actual_cost: 0, input_cost: 0, output_cost: 0, rate_multiplier: 0, account_rate_multiplier: 0 },
    { billing_mode: 'image', image_count: 2, image_size: '2K', image_size_source: 'output' as const, image_size_breakdown: { '2K': 1, '4K': 1 }, image_input_size: '1K', image_output_size: '2K' },
  ])('keeps the $billing_mode cost breakdown and account charge consistent', async patch => {
    const view = host([row(patch)]); const tip = await hover(view, 'cost')
    expect(tip.text()).toContain('usage.userBilled'); expect(tip.text()).toContain('usage.accountBilled')
    if (patch.billing_mode === 'token') { expect(tip.text()).toContain('usage.imageInputTokenPrice'); expect(tip.text()).toContain('usage.imageOutputCost'); expect(tip.text()).toContain('$0.00600000') }
    else if (patch.billing_mode === 'image') { expect(tip.text()).toContain('usage.imageSizeBreakdown'); expect(tip.text()).toContain('usage.imageUnitPrice'); expect(cell(view, 'tokens').text()).toContain('usage.imageUnit') }
    else { expect(tip.text()).toContain('usage.unitPrice'); expect(tip.text()).toContain('$0.00000000') }
  })
  it('copies both identifiers independently and clears only the current feedback timer', async () => {
    vi.useFakeTimers(); const view = host([row({ upstream_request_id: 'synthetic-upstream' })])
    await cell(view, 'request_id').get('button').trigger('click'); await flushPromises(); expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('synthetic-request')
    await vi.advanceTimersByTimeAsync(1000); await cell(view, 'upstream_request_id').get('button').trigger('click'); await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('synthetic-upstream'); expect(mocks.success).toHaveBeenLastCalledWith('admin.usage.upstreamRequestIdCopied')
    await vi.advanceTimersByTimeAsync(1000); expect(cell(view, 'upstream_request_id').get('button').attributes('title')).toBe('keys.copied')
    await vi.advanceTimersByTimeAsync(1000); expect(cell(view, 'upstream_request_id').get('button').attributes('title')).toBe('keys.copyToClipboard')
  })
  it('reports denied clipboard access without showing successful copy feedback', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Synthetic clipboard refused'))
    const view = host(); await cell(view, 'request_id').get('button').trigger('click'); await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('common.copyFailed'); expect(mocks.success).not.toHaveBeenCalled()
  })
  it.each([true, false])('deduplicates geo lookup IPs and reports unsuccessful batches (%s)', async ok => {
    mocks.entries.set('192.0.2.2', { status: 'error' }); mocks.entries.set('192.0.2.3', { status: 'success' }); mocks.entries.set('10.0.0.1', { status: 'private' })
    let resolve!: (result: boolean) => void; mocks.batch.mockReturnValue(new Promise<boolean>(done => { resolve = done }))
    const view = host([row({ ip_address: '192.0.2.1' }), row({ id: 2, ip_address: '192.0.2.1' }), row({ id: 3, ip_address: '192.0.2.2' }), row({ id: 4, ip_address: '192.0.2.3' }), row({ id: 5, ip_address: '10.0.0.1' })])
    const batch = view.findAll('button').find(button => button.text() === 'usage.ipGeo.batchFetch')!
    expect(view.text()).toContain('usage.ipGeo.pending:2'); await batch.trigger('click'); expect(batch.attributes('disabled')).toBeDefined(); expect(batch.text()).toBe('usage.ipGeo.batchFetching')
    expect(mocks.batch).toHaveBeenCalledWith(['192.0.2.1', '192.0.2.2', '192.0.2.3', '10.0.0.1'])
    resolve(ok); await flushPromises(); expect(Boolean(view.emitted('ipGeoBatchFailed'))).toBe(!ok); expect(batch.attributes('disabled')).toBeUndefined()
  })
  it('disables an empty geo batch and renders the real empty-state slot', () => { const view = host([]); expect(view.get('.empty-state-title').text()).toBe('common.noData'); expect(view.findAll('button').find(button => button.text() === 'usage.ipGeo.batchFetch')?.attributes('disabled')).toBeDefined() })
})
