import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { InternalAxiosRequestConfig } from 'axios'
import ChannelsView from '../ChannelsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: { channels: await vi.importActual('@/api/admin/channels'), groups: await vi.importActual('@/api/admin/groups'), accounts: await vi.importActual('@/api/admin/accounts'), settings: await vi.importActual('@/api/admin/settings') } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown> | string) => key + (values && typeof values === 'object' ? `:${JSON.stringify(values)}` : '') }) }))
interface Wire { method: string; path: string; body: Record<string, unknown>; params: Record<string, unknown> }
const adapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: Record<string, unknown>[]
let groups: Record<string, unknown>[]
let webSearch: Record<string, unknown>
let fail: string
let unexpected: string[]
const price = (patch: Record<string, unknown> = {}) => ({ platform: 'openai', models: ['synthetic-model'], billing_mode: 'token', input_price: null, output_price: null, cache_write_price: null, cache_write_1h_price: null, cache_read_price: null, image_input_price: null, image_output_price: null, per_request_price: null, intervals: [], time_pricing: null, ...patch })
const channel = (patch: Record<string, unknown> = {}) => ({ id: 81, name: 'Synthetic Channel', description: '', status: 'active', billing_model_source: 'channel_mapped', restrict_models: false, group_ids: [11], model_pricing: [], model_mapping: {}, features_config: {}, apply_pricing_to_account_stats: false, account_stats_pricing_rules: [], created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll('button').find(node => node.text() === label && node.isVisible()); expect(found, label).toBeDefined(); return found! }
function labelledInput(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll('label').find(node => node.text() === label); expect(found, label).toBeDefined(); return found!.find('input').exists() ? found!.get('input') : new DOMWrapper(found!.element.parentElement!).get('input') }
async function render() {
  const view = mount(ChannelsView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' }, teleport: true, transition: true } } })
  mounted.push(view); await flushPromises(); return view
}
async function edit(view: VueWrapper, platform = 'openai') {
  await button(view.get('tbody tr'), 'common.edit').trigger('click'); await flushPromises()
  if (platform) await button(view, `admin.groups.platforms.${platform}`).trigger('click')
  return view.get(`[data-channel-platform="${platform}"]`)
}
async function save(view: VueWrapper) { view.get<HTMLButtonElement>('button[form="channel-form"]').element.click(); await flushPromises() }
const writes = () => wires.filter(wire => wire.method !== 'get')
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-channel-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [channel()]; groups = [{ id: 11, name: 'OpenAI group', platform: 'openai', rate_multiplier: 1 }, { id: 12, name: 'Claude group', platform: 'anthropic', rate_multiplier: 1 }]; webSearch = { enabled: true, providers: [{ id: 'synthetic-provider' }] }; fail = ''; unexpected = []
  feedback.error.mockReset(); feedback.success.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }; wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new Error('Synthetic channel service unavailable') }
    let data: unknown
    if (wire.path === '/admin/channels' && wire.method === 'get') data = { items: rows, total: rows.length }
    else if (wire.path === '/admin/channels/81' && wire.method === 'put') data = channel(wire.body)
    else if (wire.path === '/admin/groups/all' && wire.method === 'get') data = groups
    else if (wire.path === '/admin/settings/web-search-emulation' && wire.method === 'get') data = webSearch
    else if (wire.path === '/admin/accounts/91' && wire.method === 'get') data = { id: 91, name: 'Resolved synthetic account', platform: 'openai' }
    else if (wire.path === '/admin/accounts/92' && wire.method === 'get') throw new Error('Synthetic removed account')
    else if (wire.path === '/admin/accounts' && wire.method === 'get') data = { items: [{ id: 91, name: 'Search synthetic account', platform: 'openai' }], total: 1 }
    else if (wire.path === '/admin/channels/model-pricing' && wire.method === 'get') data = { found: false }
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic channel request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = adapter; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Channel data boundaries not covered by the normal CRUD lifecycle suite', () => {
  it.each([{ enabled: false, providers: [{ id: 'synthetic' }] }, { enabled: true, providers: [] }])('hides web-search controls when no globally usable provider is configured: %j', async config => {
    webSearch = config; const view = await render(); const section = await edit(view)
    expect(section.text()).not.toContain('admin.channels.form.webSearchEmulationHint'); expect(writes()).toEqual([])
  })

  it('keeps channel editing usable after a failed global web-search lookup and does not enable the missing capability', async () => {
    fail = 'get /admin/settings/web-search-emulation'; const view = await render(); const section = await edit(view)
    expect(section.text()).not.toContain('admin.channels.form.webSearchEmulationHint'); expect(feedback.error).not.toHaveBeenCalled(); expect(section.text()).toContain('OpenAI group')
  })

  it('renders legacy null list arrays and a missing creation date as zero counts without creating a command', async () => {
    rows = [channel({ group_ids: null, model_pricing: null, created_at: null })]
    const view = await render(); const row = view.get('tbody tr')
    expect(row.text()).toContain('0 admin.channels.groupsUnit'); expect(row.text()).toContain('0 admin.channels.pricingUnit'); expect(row.findAll('td').filter(node => node.text() === '-').length).toBeGreaterThanOrEqual(2); expect(writes()).toEqual([])
  })

  it('disables a group assigned to another channel and identifies that channel while retaining this row’s own editable group', async () => {
    rows.push(channel({ id: 82, name: 'Other Channel', group_ids: [13] })); groups.push({ id: 13, name: 'Busy OpenAI group', platform: 'openai', rate_multiplier: 1 })
    const view = await render(); const section = await edit(view)
    const busy = section.findAll('label').find(node => node.text().includes('Busy OpenAI group'))!
    expect(busy.text()).toContain('Other Channel'); expect(busy.get('input').attributes('disabled')).toBeDefined()
    const own = section.findAll('label').find(node => node.text().includes('OpenAI group') && !node.text().includes('Busy'))!
    expect(own.get('input').attributes('disabled')).toBeUndefined(); expect(writes()).toEqual([])
  })

  it('shares a composite group across platform sections but sends its ID only once and preserves unrelated feature metadata', async () => {
    groups = [{ id: 15, name: 'Composite group', platform: 'composite', rate_multiplier: 1 }]
    rows = [channel({ group_ids: [15], features_config: { synthetic_extension: { retain: true }, web_search_emulation: { openai: true }, codex_image_generation_bridge: { openai: true }, bedrock_cc_compat: true } })]
    const view = await render(); const section = await edit(view)
    expect(section.findAll<HTMLInputElement>('input[type="checkbox"]').some(node => node.element.checked)).toBe(true)
    await save(view); expect(writes()).toHaveLength(1)
    expect(writes()[0].body.group_ids).toEqual([15]); expect(writes()[0].body.features_config).toMatchObject({ synthetic_extension: { retain: true }, web_search_emulation: { openai: true, anthropic: false }, codex_image_generation_bridge: { openai: true }, bedrock_cc_compat: true })
  })

  it.each(['per_request', 'image'])('preserves a literal zero %s price and decimal reasoning multipliers in the actual update payload', async mode => {
    rows = [channel({ model_pricing: [price({ billing_mode: mode, per_request_price: 0, fast_multiplier: 1.5, flex_multiplier: 0.5, reasoning_effort_multipliers: { high: 1.25 } })] })]
    const view = await render(); await edit(view); await save(view)
    expect(feedback.error).not.toHaveBeenCalled(); const pricing = writes()[0].body.model_pricing as Record<string, unknown>[]
    expect(pricing).toHaveLength(1); expect(pricing[0]).toMatchObject({ platform: 'openai', models: ['synthetic-model'], billing_mode: mode, per_request_price: 0, fast_multiplier: 1.5, flex_multiplier: 0.5, reasoning_effort_multipliers: { high: 1.25 } })
  })

  it('converts edited per-million token prices back to per-token units while retaining a missing platform’s legacy Anthropic meaning', async () => {
    rows = [channel({ group_ids: [12], model_pricing: [price({ platform: '', input_price: 0.000002, output_price: 0.000003, reasoning_effort_multipliers: null })] })]
    const view = await render(); const section = await edit(view, 'anthropic'); const card = section.get('[data-channel-pricing="0"]')
    await card.get('button[aria-expanded]').trigger('click'); const input = labelledInput(card, 'admin.channels.form.inputPrice')
    expect((input.element as HTMLInputElement).value).toBe('2'); await input.setValue('2.5'); await save(view)
    expect((writes()[0].body.model_pricing as Record<string, unknown>[])[0]).toMatchObject({ platform: 'anthropic', input_price: 0.0000025, output_price: 0.000003, reasoning_effort_multipliers: null })
  })

  it('retains historical pricing rules for a platform outside the current catalog in their original order when editing the channel name', async () => {
    const legacy = { name: 'Legacy vendor rule', group_ids: [999], account_ids: [987], pricing: [price({ platform: 'legacy_vendor', models: ['legacy-only'], per_request_price: 2, billing_mode: 'per_request' })] }
    rows = [channel({ account_stats_pricing_rules: [legacy, { name: 'Current rule', group_ids: [11], account_ids: [], pricing: [price({ input_price: 0.000004 })] }] })]
    const view = await render(); await edit(view); await button(view, 'admin.channels.form.basicSettings').trigger('click')
    await view.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('Renamed synthetic channel'); await save(view)
    const rules = writes()[0].body.account_stats_pricing_rules as Record<string, unknown>[]
    expect(rules[0]).toEqual(legacy); expect(rules[1]).toMatchObject({ name: 'Current rule', group_ids: [11], pricing: [expect.objectContaining({ platform: 'openai', input_price: 0.000004 })] }); expect(writes()[0].body.name).toBe('Renamed synthetic channel')
  })

  it('uses pricing platform inference for a global rule, preserves its empty platform semantics and displays failed account lookups as IDs', async () => {
    rows = [channel({ account_stats_pricing_rules: [{ name: 'Global existing rule', group_ids: [], account_ids: [91, 92], pricing: [price({ input_price: 0, reasoning_effort_multipliers: { low: 0.5 }, per_request_price: 0 })] }, { name: '', group_ids: [11], account_ids: [], pricing: [price({ platform: '', input_price: null })] }] })]
    const view = await render(); const section = await edit(view)
    expect(section.text()).toContain('Resolved synthetic account #91'); expect(section.text()).toContain('#92')
    await save(view); const rules = writes()[0].body.account_stats_pricing_rules as { pricing: Record<string, unknown>[]; account_ids: number[] }[]
    expect(rules[0].account_ids).toEqual([91, 92]); expect(rules[0].pricing[0]).toMatchObject({ input_price: 0, per_request_price: 0, reasoning_effort_multipliers: { low: 0.5 } }); expect(rules[1].pricing[0].platform).toBe('')
  })

  it('adds and removes account/group rule targets through visible controls and submits the final exact selections', async () => {
    const view = await render(); const section = await edit(view); await button(section, '+ admin.channels.form.addRule').trigger('click'); const rule = section.get('[data-channel-rule="0"]')
    await rule.get('input[placeholder="admin.channels.form.ruleName"]').setValue('Selection rule')
    const group = rule.get('input[type="checkbox"]'); await group.setValue(true); await group.setValue(false); await group.setValue(true)
    vi.useFakeTimers(); const search = rule.get('input[placeholder="admin.channels.form.searchAccountPlaceholder"]'); await search.trigger('focus'); await vi.advanceTimersByTimeAsync(301); await flushPromises()
    const result = rule.findAll('button').find(node => node.text().includes('Search synthetic account') && node.text().includes('#91'))!; expect(result).toBeDefined(); expect(result.findAll('span').map(node => node.text())).toEqual(['Search synthetic account', '#91']); await result.trigger('click')
    expect(rule.text()).toContain('Search synthetic account #91'); expect((search.element as HTMLInputElement).value).toBe('')
    await search.trigger('focus'); await vi.advanceTimersByTimeAsync(301); await flushPromises(); expect(rule.findAll('button').find(node => node.text().includes('Search synthetic account') && node.text().includes('#91'))!.attributes('disabled')).toBeDefined()
    document.body.click(); await flushPromises(); expect(rule.findAll('button').filter(node => node.text().includes('Search synthetic account'))).toHaveLength(0)
    await save(view); expect((writes()[0].body.account_stats_pricing_rules as Record<string, unknown>[])[0]).toMatchObject({ group_ids: [11], account_ids: [91], pricing: [] })
    expect(wires.find(wire => wire.path === '/admin/accounts')?.params).toMatchObject({ page: 1, page_size: 20, platform: 'openai', search: '' })
  })

  it('rejects overlapping mapping patterns added via native mapping inputs and preserves the editable form without a PUT', async () => {
    rows = [channel({ model_mapping: { openai: { 'synthetic-*': 'target' } } })]
    const view = await render(); const section = await edit(view); await section.findAll('button').find(node => node.text() === '+ common.add')!.trigger('click')
    const sources = section.findAll('input[placeholder="admin.channels.form.mappingSource"]'); await sources[1].setValue('synthetic-model'); await sources[1].trigger('change')
    await save(view); expect(feedback.error).toHaveBeenCalledWith(expect.stringContaining('admin.channels.mappingConflict')); expect(writes()).toEqual([]); expect(view.find('#channel-form').exists()).toBe(true)
  })

  it('keeps a failed account search empty and retryable and removes an entire empty rule through the public delete action', async () => {
    const view = await render(); const section = await edit(view); await button(section, '+ admin.channels.form.addRule').trigger('click'); const rule = section.get('[data-channel-rule="0"]'); vi.useFakeTimers(); fail = 'get /admin/accounts'
    const search = rule.get('input[placeholder="admin.channels.form.searchAccountPlaceholder"]'); await search.setValue('missing'); await vi.advanceTimersByTimeAsync(301); await flushPromises(); expect(rule.text()).not.toContain('Search synthetic account')
    await search.setValue('synthetic'); await vi.advanceTimersByTimeAsync(301); await flushPromises(); expect(rule.text()).toContain('Search synthetic account')
    await button(rule, 'common.delete').trigger('click'); await save(view); expect(writes()[0].body.account_stats_pricing_rules).toEqual([])
  })

  it('clears OpenAI-only and web-search feature flags when its platform is explicitly disabled while retaining the remaining platform', async () => {
    rows = [channel({ group_ids: [11, 12], features_config: { codex_image_generation_bridge: { openai: true }, web_search_emulation: { openai: true, anthropic: true } } })]
    const view = await render(); await edit(view); await button(view, 'admin.channels.form.basicSettings').trigger('click')
    await labelledInput(view.get('#channel-form'), 'admin.groups.platforms.openai').setValue(false); await save(view)
    expect(writes()[0].body.group_ids).toEqual([12]); const config = writes()[0].body.features_config as Record<string, unknown>
    expect(config).not.toHaveProperty('codex_image_generation_bridge'); expect(config.web_search_emulation).toMatchObject({ openai: false, anthropic: true })
  })
})
