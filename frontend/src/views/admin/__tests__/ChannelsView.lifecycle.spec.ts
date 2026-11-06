import { defineComponent } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChannelsView from '@/views/admin/ChannelsView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { Channel } from '@/api/admin/channels'

const { list, getGroups, create, update, remove, syncModels, searchAccounts, getAccount, defaultPricing, showSuccess, showError } = vi.hoisted(() => ({
  list: vi.fn(), getGroups: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), syncModels: vi.fn(),
  searchAccounts: vi.fn(), getAccount: vi.fn(), defaultPricing: vi.fn(), showSuccess: vi.fn(), showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({ adminAPI: {
  channels: { list, create, update, remove, syncPricingModels: syncModels },
  groups: { getAll: getGroups },
  accounts: { list: searchAccounts, getById: getAccount },
  settings: { getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false }) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess, showError }) }))
vi.mock('@/api/admin/channels', async () => {
  const actual = await vi.importActual<typeof import('@/api/admin/channels')>('@/api/admin/channels')
  return { ...actual, default: { ...actual.default, getModelDefaultPricing: defaultPricing } }
})
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown> | string) =>
    params && typeof params === 'object' && params.name ? `${key}:${params.name}` : key })
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const groups = [
  { id: 11, name: 'Synthetic group A', platform: 'anthropic', rate_multiplier: 1 },
  { id: 12, name: 'Synthetic group B', platform: 'anthropic', rate_multiplier: 1 }
]
function channel(id: number, name: string, groupId: number, model: string): Channel {
  return {
    id, name, description: '', status: 'active', billing_model_source: 'channel_mapped', restrict_models: false,
    group_ids: [groupId], model_pricing: [{ platform: 'anthropic', models: [model], billing_mode: 'token', input_price: 0.000002 }],
    model_mapping: {}, features_config: {}, apply_pricing_to_account_stats: false, account_stats_pricing_rules: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
  } as Channel
}
let rows: Channel[]
const wrappers: VueWrapper[] = []
function mountView() {
  const wrapper = mount(ChannelsView, { attachTo: document.body, global: { stubs: {
    AppLayout: defineComponent({ template: '<main><slot /></main>' }),
    TablePageLayout: defineComponent({ template: '<section><slot name="filters" /><slot name="table" /><slot name="pagination" /></section>' }),
    teleport: true,
    Icon: true, PlatformIcon: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(scope: Pick<VueWrapper, 'findAll'>, text: string) {
  const result = scope.findAll('button').find(candidate => candidate.text() === text)
  expect(result, `DOM button ${text}`).toBeDefined()
  return result!
}
function row(wrapper: VueWrapper, name: string) {
  const result = wrapper.findAll('tbody tr').find(candidate => candidate.text().includes(name))
  expect(result, `DOM row ${name}`).toBeDefined()
  return result!
}
async function edit(wrapper: VueWrapper, name: string) {
  await button(row(wrapper, name), 'common.edit').trigger('click')
}
async function cancelEditor(wrapper: VueWrapper) {
  await button(wrapper.get('[role="dialog"]'), 'common.cancel').trigger('click')
}
async function createEditor(wrapper: VueWrapper) {
  await button(wrapper, 'admin.channels.createChannel').trigger('click')
  await flushPromises()
}
async function enablePlatform(wrapper: VueWrapper, platform: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === `admin.groups.platforms.${platform}`)
  expect(label).toBeDefined()
  await label!.get('input[type="checkbox"]').setValue(true)
  await button(wrapper, `admin.groups.platforms.${platform}`).trigger('click')
}
async function startRuleSearch(wrapper: VueWrapper) {
  await edit(wrapper, 'Channel A')
  await flushPromises()
  await button(wrapper, 'admin.groups.platforms.anthropic').trigger('click')
  await button(wrapper, '+ admin.channels.form.addRule').trigger('click')
  return wrapper.get('input[placeholder="admin.channels.form.searchAccountPlaceholder"]')
}
function labelInput(scope: Pick<VueWrapper, 'findAll'>, text: string) {
  const label = scope.findAll('label').find(candidate => candidate.text() === text)
  expect(label, `DOM field ${text}`).toBeDefined()
  if (label!.find('input').exists()) return label!.get('input')
  return new DOMWrapper(label!.element.parentElement!).get('input')
}
async function expandedPricing(wrapper: VueWrapper) {
  await edit(wrapper, 'Channel A')
  await flushPromises()
  await button(wrapper, 'admin.groups.platforms.anthropic').trigger('click')
  const card = wrapper.get('[data-channel-pricing="0"]')
  await card.get('.cursor-pointer').trigger('click')
  return card
}

describe('Channels dialog lifecycle through real DOM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    rows = [channel(1, 'Channel A', 11, 'model-a'), channel(2, 'Channel B', 12, 'model-b')]
    list.mockImplementation((_page: number, size: number) => Promise.resolve({ items: size === 1000 ? rows : rows, total: 100 }))
    getGroups.mockReset().mockResolvedValue(groups)
    create.mockReset().mockResolvedValue({})
    update.mockReset().mockResolvedValue({})
    remove.mockReset().mockResolvedValue({})
    syncModels.mockReset().mockResolvedValue({ models: ['synthetic-latest'] })
    searchAccounts.mockReset().mockResolvedValue({ items: [], total: 0 })
    getAccount.mockReset().mockResolvedValue({ id: 91, name: 'Synthetic account' })
    defaultPricing.mockReset().mockResolvedValue({ found: false })
  })
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('keeps the current row status consistent when a refresh replaces the row during its update', async () => {
    list.mockImplementation(() => Promise.resolve({ items: structuredClone(rows), total: 100 }))
    const pending = deferred<object>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = mountView()
    await flushPromises()
    await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    expect(update).toHaveBeenCalledWith(1, { status: 'disabled' })
    await wrapper.get('button[title="common.refresh"]').trigger('click')
    await flushPromises()
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('disabled')).toBeDefined()
    pending.resolve({})
    await flushPromises()
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('disabled')).toBeUndefined()
  })

  it('revalidates a list snapshot read before a status mutation finished', async () => {
    const oldRows = structuredClone(rows)
    const staleList = deferred<{ items: Channel[]; total: number }>()
    list.mockImplementation(() => Promise.resolve({ items: structuredClone(rows), total: 100 }))
    list.mockResolvedValueOnce({ items: structuredClone(rows), total: 100 }).mockReturnValueOnce(staleList.promise)
    const pending = deferred<object>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = mountView()
    await flushPromises()
    await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    await wrapper.get('button[title="common.refresh"]').trigger('click')
    rows[0].status = 'disabled' // The server commits the update before acknowledging it.
    pending.resolve({})
    await flushPromises()
    staleList.resolve({ items: oldRows, total: 100 })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(3)
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  it('never submits Channel A prices to Channel B when A edit preload arrives late', async () => {
    const wrapper = mountView()
    await flushPromises()
    const a = deferred<typeof groups>()
    const b = deferred<typeof groups>()
    getGroups.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await edit(wrapper, 'Channel A')
    await edit(wrapper, 'Channel B')
    b.resolve(groups)
    await flushPromises()
    expect((wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').element as HTMLInputElement).value).toBe('Channel B')
    a.resolve(groups)
    await flushPromises()
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0]).toBe(2)
    expect(update.mock.calls[0][1].model_pricing[0].models).toEqual(['model-b'])
    expect(update.mock.calls[0][1].group_ids).toEqual([12])
  })

  it('sends the backend boolean Bedrock flag when the visible switch is enabled', async () => {
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await button(wrapper, 'admin.groups.platforms.anthropic').trigger('click')
    const label = wrapper.findAll('label').find(candidate => candidate.text() === 'admin.channels.form.bedrockCCCompat')!
    const switchElement = label.element.parentElement!.parentElement!.querySelector('[role="switch"]') as HTMLElement
    expect(switchElement.getAttribute('aria-checked')).toBe('false')
    switchElement.click()
    await flushPromises()
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update.mock.calls[0][1].features_config.bedrock_cc_compat).toBe(true)
  })

  it('keeps the reopened B draft when cancelled A save completes', async () => {
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    const pending = deferred<object>()
    update.mockReturnValueOnce(pending.promise)
    await wrapper.get('#channel-form').trigger('submit')
    await cancelEditor(wrapper)
    await edit(wrapper, 'Channel B')
    await flushPromises()
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('B unsaved draft')
    pending.resolve({})
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(true)
    expect((wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').element as HTMLInputElement).value).toBe('B unsaved draft')
  })

  it('sends only one delete while its actual confirmation button is clicked twice', async () => {
    const wrapper = mountView()
    await flushPromises()
    const pending = deferred<void>()
    remove.mockReturnValue(pending.promise)
    await button(row(wrapper, 'Channel A'), 'common.delete').trigger('click')
    const confirm = button(wrapper.get('[role="dialog"]'), 'common.delete')
    await confirm.trigger('click')
    await confirm.trigger('click')
    expect(remove).toHaveBeenCalledTimes(1)
    pending.resolve()
    await flushPromises()
  })

  it('resets to page one when changing the status filter from a later page', async () => {
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('nav[aria-label="Pagination"] button[aria-label="pagination.next"]').trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.[0]).toBe(2)
    await wrapper.get('button[aria-label="admin.channels.allStatus"]').trigger('click')
    const active = wrapper.findAll('[role="option"]').find(candidate => candidate.text() === 'admin.channels.statusActive')
    expect(active).toBeDefined()
    await active!.trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.[2].status).toBe('active')
    expect(list.mock.calls.at(-1)?.[0]).toBe(1)
  })

  it('does not open a pending old-login editor after the login changes', async () => {
    replaceAuthSession({ accessToken: 'synthetic-admin-a', user: { id: 1 } })
    const wrapper = mountView()
    await flushPromises()
    const pending = deferred<typeof groups>()
    getGroups.mockReturnValueOnce(pending.promise)
    await edit(wrapper, 'Channel A')
    replaceAuthSession({ accessToken: 'synthetic-admin-b', user: { id: 2 } })
    pending.resolve(groups)
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(false)
  })

  it('sends an explicit empty description when the administrator clears existing text', async () => {
    rows[0].description = 'Synthetic previous description'
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await wrapper.get('textarea[placeholder="admin.channels.form.descriptionPlaceholder"]').setValue('')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update.mock.calls[0][1].description).toBe('')
  })

  it('preserves the platforms of an existing mixed-platform account statistics rule during an unrelated name edit', async () => {
    const openaiGroup = { id: 13, name: 'Synthetic OpenAI group', platform: 'openai', rate_multiplier: 1 }
    getGroups.mockResolvedValue([...groups, openaiGroup])
    rows[0].group_ids.push(13)
    rows[0].model_pricing.push({ ...rows[0].model_pricing[0], platform: 'openai', models: ['model-openai'] })
    rows[0].account_stats_pricing_rules = [{
      name: 'Existing mixed rule', group_ids: [11, 13], account_ids: [],
      pricing: [
        { ...rows[0].model_pricing[0], models: ['cost-anthropic'] },
        { ...rows[0].model_pricing[1], models: ['cost-openai'] }
      ]
    }]
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('Channel A renamed')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    const rules = update.mock.calls[0][1].account_stats_pricing_rules
    expect(rules).toHaveLength(1)
    expect(rules[0].pricing.map((price: { platform: string; models: string[] }) => ({ platform: price.platform, models: price.models }))).toEqual([
      { platform: 'anthropic', models: ['cost-anthropic'] },
      { platform: 'openai', models: ['cost-openai'] }
    ])
  })

  it('preserves an existing unrestricted account statistics price across Anthropic and OpenAI groups', async () => {
    getGroups.mockResolvedValue([...groups, { id: 13, name: 'Synthetic OpenAI group', platform: 'openai', rate_multiplier: 1 }])
    rows[0].group_ids.push(13)
    rows[0].model_pricing.push({ ...rows[0].model_pricing[0], platform: 'openai', models: ['model-openai'] })
    rows[0].account_stats_pricing_rules = [{
      name: 'Shared cost rule', group_ids: [11, 13], account_ids: [],
      pricing: [{ ...rows[0].model_pricing[0], platform: '', models: ['synthetic-shared'] }]
    }]
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('Renamed only')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0]).toBe(1)
    expect(update.mock.calls[0][1].account_stats_pricing_rules).toMatchObject([
      { group_ids: [11, 13], pricing: [{ platform: '', models: ['synthetic-shared'], input_price: 0.000002 }] }
    ])
  })

  it('uses the selected section platform for a newly added account statistics price', async () => {
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await button(wrapper, 'admin.groups.platforms.anthropic').trigger('click')
    await button(wrapper, '+ admin.channels.form.addRule').trigger('click')
    const rule = wrapper.get('[data-channel-rule="0"]')
    await button(rule, '+ common.add').trigger('click')
    const card = rule.get('[data-rule-pricing="0"]')
    const model = card.get('input[placeholder="admin.channels.form.modelsPlaceholder"]')
    await model.setValue('new-cost-model')
    await model.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await labelInput(card, 'admin.channels.form.inputPrice').setValue('4')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][1].account_stats_pricing_rules).toMatchObject([
      { pricing: [{ platform: 'anthropic', models: ['new-cost-model'], input_price: 0.000004 }] }
    ])
  })

  it('does not let cancelled model sync clear the new sync lock or display old success', async () => {
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'openai')
    const old = deferred<{ models: string[] }>()
    const current = deferred<{ models: string[] }>()
    syncModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await button(wrapper, 'admin.channels.form.syncLatestModels').trigger('click')
    await cancelEditor(wrapper)
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'openai')
    await button(wrapper, 'admin.channels.form.syncLatestModels').trigger('click')
    old.resolve({ models: ['obsolete-model'] })
    await flushPromises()
    expect(button(wrapper, 'admin.channels.form.syncingModels').attributes('disabled')).toBeDefined()
    expect(showSuccess).not.toHaveBeenCalled()
    current.resolve({ models: ['current-model'] })
    await flushPromises()
    expect(wrapper.text()).toContain('current-model')
    expect(wrapper.text()).not.toContain('obsolete-model')
  })

  it('adds each new synchronized model only once even when the catalog repeats its name', async () => {
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'openai')
    syncModels.mockResolvedValue({ models: ['model-one', 'model-one'] })
    await button(wrapper, 'admin.channels.form.syncLatestModels').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-channel-pricing]')).toHaveLength(1)
    expect(wrapper.get('[data-channel-pricing] .collapsible-inner').findAll('span').filter(span => span.text() === 'model-one')).toHaveLength(1)
  })

  it.each(['resolve', 'reject'] as const)('ignores model sync %s after unmount', async outcome => {
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'openai')
    const pending = deferred<{ models: string[] }>()
    syncModels.mockReturnValueOnce(pending.promise)
    await button(wrapper, 'admin.channels.form.syncLatestModels').trigger('click')
    wrapper.unmount()
    if (outcome === 'resolve') pending.resolve({ models: ['obsolete-model'] })
    else pending.reject(new Error('Synthetic catalog failure'))
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it('does not start a debounced old-login account search in the new login', async () => {
    replaceAuthSession({ accessToken: 'synthetic-admin-a', user: { id: 1 } })
    const wrapper = mountView()
    await flushPromises()
    const input = await startRuleSearch(wrapper)
    vi.useFakeTimers()
    await input.setValue('old admin search')
    replaceAuthSession({ accessToken: 'synthetic-admin-b', user: { id: 2 } })
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(searchAccounts).not.toHaveBeenCalled()
  })

  it('does not reveal old-login account search results after login replacement', async () => {
    replaceAuthSession({ accessToken: 'synthetic-admin-a', user: { id: 1 } })
    const wrapper = mountView()
    await flushPromises()
    const input = await startRuleSearch(wrapper)
    const pending = deferred<{ items: { id: number; name: string; platform: string }[] }>()
    searchAccounts.mockReturnValueOnce(pending.promise)
    vi.useFakeTimers()
    await input.setValue('private old admin account')
    await vi.advanceTimersByTimeAsync(300)
    expect(searchAccounts).toHaveBeenCalledOnce()
    replaceAuthSession({ accessToken: 'synthetic-admin-b', user: { id: 2 } })
    pending.resolve({ items: [{ id: 91, name: 'Old admin only account', platform: 'anthropic' }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Old admin only account')
  })

  it('submits a new channel once with selected group, mapping and per-token prices', async () => {
    rows = []
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('  Created channel  ')
    await wrapper.get('textarea').setValue('  Synthetic description  ')
    await enablePlatform(wrapper, 'anthropic')
    const pane = wrapper.get('[data-channel-platform="anthropic"]')
    const group = pane.findAll('label').find(candidate => candidate.text().includes('Synthetic group A'))!
    await group.get('input').setValue(true)
    await pane.findAll('button').find(candidate => candidate.text() === '+ common.add')!.trigger('click') // mapping
    await pane.get('input[placeholder="admin.channels.form.mappingSource"]').setValue('client-model')
    await pane.get('input[placeholder="admin.channels.form.mappingTarget"]').setValue('upstream-model')
    await pane.findAll('button').filter(candidate => candidate.text() === '+ common.add')[1].trigger('click') // pricing
    const card = pane.get('[data-channel-pricing="0"]')
    await labelInput(card, 'admin.channels.form.inputPrice').setValue('4.5')
    await card.get('input[placeholder="admin.channels.form.modelsPlaceholder"]').setValue('client-model')
    await card.get('input[placeholder="admin.channels.form.modelsPlaceholder"]').trigger('keydown', { key: 'Enter' })
    const pending = deferred<object>()
    create.mockReturnValueOnce(pending.promise)
    await wrapper.get('#channel-form').trigger('submit')
    await wrapper.get('#channel-form').trigger('submit')
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Created channel', description: 'Synthetic description', group_ids: [11],
      model_mapping: { anthropic: { 'client-model': 'upstream-model' } },
      model_pricing: [{ platform: 'anthropic', models: ['client-model'], billing_mode: 'token', input_price: 0.0000045 }]
    })
    expect(create.mock.calls[0][0]).not.toHaveProperty('status')
    expect(defaultPricing).not.toHaveBeenCalled()
    pending.resolve({})
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(false)
    expect(showSuccess).toHaveBeenCalledWith('admin.channels.createSuccess')
  })

  it('keeps a failed create draft editable and permits an explicit retry', async () => {
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('Retry draft')
    create.mockRejectedValueOnce(new Error('Synthetic create failure'))
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(true)
    expect(showError).toHaveBeenCalledWith('Synthetic create failure')
    expect(button(wrapper, 'common.create').attributes('disabled')).toBeUndefined()
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#channel-form').exists()).toBe(false)
  })

  it('keeps a failed update draft and displays the update error', async () => {
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    update.mockRejectedValueOnce({ response: { data: { message: 'Synthetic update rejected' } } })
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(true)
    expect(showError).toHaveBeenCalledWith('Synthetic update rejected')
    expect(button(wrapper, 'common.update').attributes('disabled')).toBeUndefined()
  })

  it.each(['save', 'delete', 'status'] as const)('ignores pending %s success after unmount', async operation => {
    const wrapper = mountView()
    await flushPromises()
    const pending = deferred<object>()
    update.mockReturnValueOnce(pending.promise)
    remove.mockReturnValueOnce(pending.promise)
    if (operation === 'save') {
      await edit(wrapper, 'Channel A')
      await flushPromises()
      await wrapper.get('#channel-form').trigger('submit')
    } else if (operation === 'delete') {
      await button(row(wrapper, 'Channel A'), 'common.delete').trigger('click')
      await button(wrapper.get('[role="dialog"]'), 'common.delete').trigger('click')
    } else await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    const calls = list.mock.calls.length
    wrapper.unmount()
    pending.resolve({})
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(calls)
  })

  it('keeps B deletion open after cancelled A deletion completes and retries B after failure', async () => {
    const wrapper = mountView()
    await flushPromises()
    const pending = deferred<void>()
    remove.mockReturnValueOnce(pending.promise)
    await button(row(wrapper, 'Channel A'), 'common.delete').trigger('click')
    await button(wrapper.get('[role="dialog"]'), 'common.delete').trigger('click')
    await button(wrapper.get('[role="dialog"]'), 'common.cancel').trigger('click')
    await button(row(wrapper, 'Channel B'), 'common.delete').trigger('click')
    pending.resolve()
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Channel B')
    expect(showSuccess).not.toHaveBeenCalled()
    remove.mockRejectedValueOnce(new Error('Synthetic delete failure'))
    await button(wrapper.get('[role="dialog"]'), 'common.delete').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Synthetic delete failure')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Channel B')
    await button(wrapper.get('[role="dialog"]'), 'common.delete').trigger('click')
    await flushPromises()
    expect(remove.mock.calls.map(call => call[0])).toEqual([1, 2, 2])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('locks a row status request, changes its visible switch, then reloads when it leaves the filter', async () => {
    const wrapper = mountView()
    await flushPromises()
    const pending = deferred<object>()
    update.mockReturnValueOnce(pending.promise)
    await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    expect(update).toHaveBeenCalledOnce()
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('disabled')).toBeDefined()
    pending.resolve({})
    await flushPromises()
    expect(update.mock.calls[0]).toEqual([1, { status: 'disabled' }])
    expect(row(wrapper, 'Channel A').get('[role="switch"]').attributes('aria-checked')).toBe('false')
    await wrapper.get('button[aria-label="admin.channels.allStatus"]').trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === 'admin.channels.statusDisabled')!.trigger('click')
    await flushPromises()
    const count = list.mock.calls.length
    await row(wrapper, 'Channel A').get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(update.mock.calls.at(-1)).toEqual([1, { status: 'active' }])
    expect(list).toHaveBeenCalledTimes(count + 1)
  })

  it('debounces list search, preserves sort and resets pagination for search, sort and size changes', async () => {
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('nav[aria-label="Pagination"] button[aria-label="pagination.next"]').trigger('click')
    await flushPromises()
    vi.useFakeTimers()
    const input = wrapper.get('input[placeholder="admin.channels.searchChannels"]')
    await input.setValue('first')
    await input.setValue('latest')
    const count = list.mock.calls.length
    await vi.advanceTimersByTimeAsync(299)
    expect(list).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(list.mock.calls.at(-1)?.slice(0, 3)).toEqual([1, 20, { status: undefined, search: 'latest', sort_by: 'created_at', sort_order: 'desc' }])
    await wrapper.findAll('th').find(header => header.text() === 'admin.channels.columns.name')!.trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.[2]).toMatchObject({ sort_by: 'name', sort_order: 'asc', search: 'latest' })
    await wrapper.get('.page-size-select button.select-trigger').trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === '50')!.trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.slice(0, 2)).toEqual([1, 50])
  })

  it('ignores superseded list failure and clears an active list failure for manual refresh', async () => {
    const stale = deferred<{ items: Channel[]; total: number }>()
    list.mockReturnValueOnce(stale.promise)
    const wrapper = mountView()
    await flushPromises()
    vi.useFakeTimers()
    await wrapper.get('input[placeholder="admin.channels.searchChannels"]').setValue('latest')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    stale.reject(new Error('Superseded failure'))
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
    list.mockRejectedValueOnce(new Error('Active list failure'))
    await wrapper.get('button[title="common.refresh"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Active list failure')
    expect(wrapper.get('button[title="common.refresh"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('button[title="common.refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('submits literal token units, tier multipliers, effort and a valid time window from real controls', async () => {
    rows[0].features_config = { unmanaged: { keep: true }, bedrock_cc_compat: true }
    const wrapper = mountView()
    await flushPromises()
    const card = await expandedPricing(wrapper)
    await labelInput(card, 'admin.channels.form.inputPrice').setValue('7.25')
    await labelInput(card, 'admin.channels.form.outputPrice').setValue('10')
    await labelInput(card, 'admin.channels.form.cacheWrite1hPrice').setValue('3')
    await labelInput(card, 'admin.channels.form.fastMultiplier').setValue('1.5')
    await labelInput(card, 'admin.channels.form.flexMultiplier').setValue('0.5')
    await labelInput(card, 'high').setValue('2.5')
    await card.get('[data-testid="add-time-period"]').trigger('click')
    await labelInput(card, 'admin.channels.form.startTime').setValue('01:00:00')
    await labelInput(card, 'admin.channels.form.endTime').setValue('02:00:00')
    await labelInput(card, 'admin.channels.form.multiplier').setValue('1.25')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update.mock.calls[0][1]).toMatchObject({
      features_config: { unmanaged: { keep: true }, bedrock_cc_compat: true },
      model_pricing: [{ input_price: 0.00000725, output_price: 0.00001, cache_write_1h_price: 0.000003,
        fast_multiplier: 1.5, flex_multiplier: 0.5, reasoning_effort_multipliers: { high: 2.5 },
        time_pricing: { timezone: 'Asia/Shanghai', weekdays_only: false, periods: [{ start_time: '01:00:00', end_time: '02:00:00', multiplier: 1.25 }] } }]
    })
  })

  it.each([
    ['name', 'admin.channels.nameRequired'],
    ['group', 'admin.channels.noGroupsSelected'],
    ['models', 'admin.channels.emptyModelsInPricing'],
    ['duplicate', 'admin.channels.modelConflict'],
    ['multiplier', 'admin.channels.form.multiplierPositive'],
    ['effort', 'admin.channels.form.reasoningEffortMultiplierPositive'],
    ['per-request', 'admin.channels.form.perRequestPriceRequired'],
    ['time-window', 'admin.channels.timePricingValidation.range'],
  ])('rejects invalid %s through the visible form before any write', async (kind, message) => {
    const wrapper = mountView()
    await flushPromises()
    const card = await expandedPricing(wrapper)
    if (kind === 'name') await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('  ')
    else if (kind === 'group') {
      const group = wrapper.get('[data-channel-platform="anthropic"]').findAll('label').find(label => label.text().includes('Synthetic group A'))!
      await group.get('input').setValue(false)
    } else if (kind === 'models') await card.get('span button').trigger('click')
    else if (kind === 'duplicate') {
      const input = card.get('.collapsible-inner input[type="text"]')
      await input.setValue('MODEL-A')
      await input.trigger('keydown', { key: 'Enter' })
    } else if (kind === 'multiplier') await labelInput(card, 'admin.channels.form.fastMultiplier').setValue('0')
    else if (kind === 'effort') await labelInput(card, 'high').setValue('0')
    else if (kind === 'per-request') {
      await card.get('button.select-trigger').trigger('click')
      await wrapper.findAll('[role="option"]').find(option => option.text() === 'admin.channels.billingMode.perRequest')!.trigger('click')
    } else {
      await card.get('[data-testid="add-time-period"]').trigger('click')
      await labelInput(card, 'admin.channels.form.startTime').setValue('03:00:00')
      await labelInput(card, 'admin.channels.form.endTime').setValue('02:00:00')
    }
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(showError.mock.calls.at(-1)?.[0]).toContain(message)
  })

  it('restores a rejected duplicate mapping source so the visible draft matches the submitted mapping', async () => {
    rows[0].model_mapping = { anthropic: { first: 'one', second: 'two' } }
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await button(wrapper, 'admin.groups.platforms.anthropic').trigger('click')
    const source = wrapper.findAll('input[placeholder="admin.channels.form.mappingSource"]')[1]
    await source.setValue('first')
    expect((source.element as HTMLInputElement).value).toBe('second')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(update.mock.calls[0][1].model_mapping).toEqual({ anthropic: { first: 'one', second: 'two' } })
  })

  it('keeps a wildcard price when synchronized catalog models are already covered by it', async () => {
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'openai')
    const pane = wrapper.get('[data-channel-platform="openai"]')
    await pane.findAll('button').filter(candidate => candidate.text() === '+ common.add')[1].trigger('click')
    const input = pane.get('[data-channel-pricing="0"] input[placeholder="admin.channels.form.modelsPlaceholder"]')
    await input.setValue('gpt-*')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    syncModels.mockResolvedValue({ models: ['gpt-small', 'gpt-large'] })
    await button(pane, 'admin.channels.form.syncLatestModels').trigger('click')
    await flushPromises()
    expect(pane.findAll('[data-channel-pricing]')).toHaveLength(1)
    expect(showSuccess).toHaveBeenCalledWith('admin.channels.form.syncModelsAlreadyUpToDate')
  })

  it('keeps a newer keyword result, selects an account once, and removes its chip through DOM', async () => {
    const wrapper = mountView()
    await flushPromises()
    const input = await startRuleSearch(wrapper)
    const stale = deferred<{ items: { id: number; name: string; platform: string }[] }>()
    searchAccounts.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ items: [{ id: 92, name: 'Latest account', platform: 'anthropic' }] })
    vi.useFakeTimers()
    await input.setValue('old keyword')
    await vi.advanceTimersByTimeAsync(300)
    await input.setValue('latest keyword')
    expect(searchAccounts.mock.calls[0][3].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    stale.resolve({ items: [{ id: 91, name: 'Stale account', platform: 'anthropic' }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Stale account')
    expect(searchAccounts.mock.calls[1].slice(0, 3)).toEqual([1, 20, { platform: 'anthropic', search: 'latest keyword' }])
    await wrapper.findAll('button').find(candidate => candidate.text() === 'Latest account#92')!.trigger('click')
    const rule = wrapper.get('[data-channel-rule="0"]')
    expect(rule.text()).toContain('Latest account #92')
    expect((input.element as HTMLInputElement).value).toBe('')
    const chip = rule.findAll('span').find(span => span.text() === 'Latest account #92' && span.find('button').exists())!
    await chip.get('button').trigger('click')
    expect(rule.text()).not.toContain('Latest account #92')
  })

  it('clears pending account results when removing a rule and shifting indexes', async () => {
    const wrapper = mountView()
    await flushPromises()
    await startRuleSearch(wrapper)
    await button(wrapper, '+ admin.channels.form.addRule').trigger('click')
    const pending = deferred<{ items: { id: number; name: string; platform: string }[] }>()
    searchAccounts.mockReturnValueOnce(pending.promise)
    vi.useFakeTimers()
    await wrapper.get('[data-channel-rule="0"] input[placeholder="admin.channels.form.searchAccountPlaceholder"]').setValue('deleted rule')
    await vi.advanceTimersByTimeAsync(300)
    const signal = searchAccounts.mock.calls[0][3].signal
    await button(wrapper.get('[data-channel-rule="0"]'), 'common.delete').trigger('click')
    expect(signal.aborted).toBe(true)
    pending.resolve({ items: [{ id: 91, name: 'Removed rule account', platform: 'anthropic' }] })
    await flushPromises()
    expect(wrapper.findAll('[data-channel-rule]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Removed rule account')
  })

  it('tolerates failed account search, cancels a scheduled query on close and removes stale errors', async () => {
    const wrapper = mountView()
    await flushPromises()
    const input = await startRuleSearch(wrapper)
    vi.useFakeTimers()
    searchAccounts.mockRejectedValueOnce(new Error('Synthetic account search failure'))
    await input.setValue('query failure')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.get('.rule-account-search-container').findAll('button')).toHaveLength(0)
    await input.setValue('closed query')
    await cancelEditor(wrapper)
    await vi.advanceTimersByTimeAsync(300)
    expect(searchAccounts).toHaveBeenCalledOnce()
  })

  it('preserves account-rule priority, scope and hidden pricing fields on an unrelated edit', async () => {
    getGroups.mockResolvedValue([...groups, { id: 13, name: 'OpenAI synthetic', platform: 'openai', rate_multiplier: 1 }])
    rows[0].group_ids.push(13)
    rows[0].model_pricing.push({ ...rows[0].model_pricing[0], platform: 'openai', models: ['openai-model'] })
    rows[0].account_stats_pricing_rules = [
      { name: 'First OpenAI', group_ids: [13], account_ids: [91], pricing: [{ ...rows[0].model_pricing[1], models: ['openai-cost'], fast_multiplier: 2,
        flex_multiplier: 0.75, time_pricing: { timezone: 'UTC', periods: [{ start_time: '01:00:00', end_time: '02:00:00', multiplier: 1.5 }] } }] },
      { name: 'Second Anthropic', group_ids: [11], account_ids: [], pricing: [{ ...rows[0].model_pricing[0], models: ['anthropic-cost'] }] },
      { name: 'Unknown preserved', group_ids: [], account_ids: [91], pricing: [{ ...rows[0].model_pricing[0], platform: 'future-provider', models: ['future-cost'] }] }
    ]
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    await wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').setValue('Renamed only')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    const rules = update.mock.calls[0][1].account_stats_pricing_rules
    expect(rules.map((rule: { name: string }) => rule.name)).toEqual(['First OpenAI', 'Second Anthropic', 'Unknown preserved'])
    expect(rules[0]).toMatchObject({ group_ids: [13], account_ids: [91], pricing: [{ platform: 'openai', models: ['openai-cost'], fast_multiplier: 2, flex_multiplier: 0.75,
      time_pricing: { timezone: 'UTC', periods: [{ start_time: '01:00:00', end_time: '02:00:00', multiplier: 1.5 }] } }] })
    expect(rules[2]).toEqual(rows[0].account_stats_pricing_rules[2])
  })

  it('does not resurrect A after rule account-name loading is superseded by B', async () => {
    rows[0].account_stats_pricing_rules = [{ name: 'A account rule', group_ids: [11], account_ids: [91], pricing: [rows[0].model_pricing[0]] }]
    const pending = deferred<{ id: number; name: string }>()
    getAccount.mockReturnValueOnce(pending.promise)
    const wrapper = mountView()
    await flushPromises()
    await edit(wrapper, 'Channel A')
    await flushPromises()
    expect(getAccount).toHaveBeenCalledWith(91)
    await edit(wrapper, 'Channel B')
    await flushPromises()
    pending.resolve({ id: 91, name: 'A private account' })
    await flushPromises()
    expect((wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').element as HTMLInputElement).value).toBe('Channel B')
    expect(wrapper.text()).not.toContain('A private account')
  })

  it('leaves the editor closed when required option loading fails and supports a fresh attempt', async () => {
    const wrapper = mountView()
    await flushPromises()
    getGroups.mockRejectedValueOnce(new Error('Synthetic groups unavailable'))
    await edit(wrapper, 'Channel A')
    await flushPromises()
    expect(wrapper.find('#channel-form').exists()).toBe(false)
    expect(showError).toHaveBeenCalledWith('Synthetic groups unavailable')
    await edit(wrapper, 'Channel B')
    await flushPromises()
    expect((wrapper.get('input[placeholder="admin.channels.form.namePlaceholder"]').element as HTMLInputElement).value).toBe('Channel B')
  })

  it('keeps the administrator price entered while a default model price is still pending', async () => {
    const pending = deferred<{ found: boolean; input_price: number }>()
    defaultPricing.mockReturnValueOnce(pending.promise)
    const wrapper = mountView()
    await flushPromises()
    await createEditor(wrapper)
    await enablePlatform(wrapper, 'anthropic')
    const pane = wrapper.get('[data-channel-platform="anthropic"]')
    await pane.findAll('button').filter(candidate => candidate.text() === '+ common.add')[1].trigger('click')
    const card = pane.get('[data-channel-pricing="0"]')
    const model = card.get('input[placeholder="admin.channels.form.modelsPlaceholder"]')
    await model.setValue('synthetic-model')
    await model.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(defaultPricing).toHaveBeenCalledWith('synthetic-model')
    await labelInput(card, 'admin.channels.form.inputPrice').setValue('7')
    pending.resolve({ found: true, input_price: 0.000099 })
    await flushPromises()
    expect((labelInput(card, 'admin.channels.form.inputPrice').element as HTMLInputElement).value).toBe('7')
  })
})
