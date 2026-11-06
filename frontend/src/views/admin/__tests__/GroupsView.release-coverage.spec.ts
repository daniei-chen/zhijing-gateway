import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import GroupsView from '../GroupsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  groups: await vi.importActual('@/api/admin/groups'),
  accounts: await vi.importActual('@/api/admin/accounts'),
} }))
vi.mock('@/api/admin/channels', () => ({ default: { getModelDefaultPricing: async () => ({ found: false }) } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('@/stores/onboarding', () => ({ useOnboardingStore: () => ({ isCurrentStep: () => false, nextStep: vi.fn() }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

interface Wire {
  method: string
  path: string
  body: Record<string, unknown>
  params: Record<string, unknown>
}
interface GroupRow extends Record<string, unknown> { id: number; name: string; platform: string }
const views: VueWrapper[] = []
const previousAdapter = apiClient.defaults.adapter
let groups: GroupRow[]
let usage: Record<string, unknown>[]
let capacity: Record<string, unknown>[]
let requests: Wire[]
let candidates: string[]
let rejectNext: string | undefined
let unexpected: string[]
let liveSupported: boolean

function group(id = 42, patch: Record<string, unknown> = {}): GroupRow {
  return {
    id, name: `Release group ${id}`, description: '', platform: 'anthropic', status: 'active',
    rate_multiplier: 1, rpm_limit: 0, is_exclusive: false, subscription_type: 'standard',
    daily_limit_usd: null, weekly_limit_usd: null, monthly_limit_usd: null,
    long_context_pricing_enabled: true, force_openai_fast: false, free_openai_fast: false, model_pricing: [],
    profit_control_enabled: false, profit_min_margin: 0, profit_safety_buffer: 0,
    allow_image_generation: false, allow_batch_image_generation: false, image_count_billing: false,
    image_rate_independent: false, image_rate_multiplier: 1, image_price_1k: null, image_price_2k: null, image_price_4k: null,
    batch_image_discount_multiplier: 0.5, batch_image_hold_multiplier: 0.6,
    video_rate_independent: false, video_rate_multiplier: 1, video_price_480p: null, video_price_720p: null, video_price_1080p: null,
    peak_rate_enabled: false, peak_start: '', peak_end: '', peak_rate_multiplier: 1,
    claude_code_only: false, fallback_group_id: null, fallback_group_id_on_invalid_request: null,
    allow_messages_dispatch: false, allow_live: false, model_routing: null, model_routing_enabled: false,
    supported_model_scopes: ['claude', 'gemini_text', 'gemini_image'], mcp_xml_inject: true,
    account_count: 3, active_account_count: 2, rate_limited_account_count: 1, sort_order: id,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch,
  }
}
async function render() {
  const view = mount(GroupsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' },
    BaseDialog: { props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :aria-label="title"><button type="button" aria-label="Close dialog" @click="$emit(\'close\')">close</button><slot/><slot name="footer"/></section>' },
    GroupRateMultipliersModal: { props: ['show', 'group'], emits: ['close'], template: '<section v-if="show" role="dialog" aria-label="user multipliers">{{ group.id }}: {{ group.name }}<button @click="$emit(\'close\')">close multipliers</button></section>' },
    GroupRPMOverridesModal: { props: ['show', 'group'], emits: ['close'], template: '<section v-if="show" role="dialog" aria-label="user RPM">{{ group.id }}: {{ group.name }}<button @click="$emit(\'close\')">close RPM</button></section>' },
    VueDraggable: { template: '<div><slot/></div>' },
  } } })
  views.push(view)
  await flushPromises()
  return view
}
type Root = Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>
function button(root: Root, name: string) {
  const found = root.findAll('button').find(node => node.text() === name)
  expect(found, `Button ${name}`).toBeDefined()
  return found!
}
function row(view: VueWrapper, id = 42) {
  const found = view.findAll('tbody tr').find(node => node.text().includes(`Release group ${id}`))
  expect(found, `Row ${id}`).toBeDefined()
  return found!
}
function checkbox(root: Root, label: string) {
  const found = root.findAll('label').find(node => node.text() === label)
  expect(found, `Checkbox ${label}`).toBeDefined()
  return found!.get<HTMLInputElement>('input[type="checkbox"]')
}
async function choose(root: Pick<VueWrapper, 'get'> | Pick<DOMWrapper<Element>, 'get'>, selector: string, label: string) {
  await root.get(selector).trigger('click')
  await flushPromises()
  const listbox = document.getElementById(root.get(selector).attributes('aria-controls')!)
  expect(listbox).toBeTruthy()
  const option = Array.from(listbox!.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, `Option ${label}`).toBeDefined()
  option!.click()
  await flushPromises()
}
async function createForm(view: VueWrapper, platform = 'anthropic') {
  await button(view, 'admin.groups.createGroup').trigger('click')
  await flushPromises()
  const form = view.get('#create-group-form')
  const nameLabel = form.findAll<HTMLLabelElement>('label').find(node => node.text() === 'admin.groups.form.name')!
  await new DOMWrapper(nameLabel.element.control!).setValue('Synthetic release group')
  if (platform !== 'anthropic') await choose(form, '#groups-create-form-platform', { openai: 'OpenAI', gemini: 'Gemini', grok: 'Grok', antigravity: 'Antigravity', composite: 'Composite' }[platform] ?? platform)
  return form
}
async function editForm(view: VueWrapper) {
  await button(row(view), 'common.edit').trigger('click')
  await flushPromises()
  return view.get('#edit-group-form')
}
async function submit(form: Pick<DOMWrapper<Element>, 'trigger'>) {
  await form.trigger('submit')
  await flushPromises()
}
const mutations = () => requests.filter(request => ['post', 'put', 'delete'].includes(request.method))
const lastBody = () => mutations().at(-1)!.body
const listRequests = () => requests.filter(request => request.path === '/admin/groups' && request.method === 'get')

beforeEach(() => {
  requests = []
  unexpected = []
  rejectNext = undefined
  liveSupported = true
  groups = [group()]
  usage = []
  capacity = []
  candidates = ['release-model-a', 'release-model-b']
  feedback.success.mockReset()
  feedback.error.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-release-groups-admin', user: { id: 7, role: 'admin' } })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request: Wire = { method: config.method ?? 'get', path: String(config.url), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}, params: { ...config.params } }
    requests.push(request)
    if (rejectNext === `${request.method} ${request.path}`) {
      rejectNext = undefined
      throw new AxiosError('Synthetic group failure', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Synthetic rejection', data: { message: 'Synthetic group failure' }, headers: {}, config })
    }
    let data: unknown
    if (request.path === '/admin/groups' && request.method === 'get') data = { items: groups, page: request.params.page, page_size: request.params.page_size, total: 80, pages: 4 }
    else if (request.path === '/admin/groups/all') data = groups
    else if (request.path === '/admin/groups/usage-summary') data = usage
    else if (request.path === '/admin/groups/capacity-summary') data = capacity
    else if (request.path === '/admin/groups/live-capability') data = { supported: liveSupported }
    else if (/^\/admin\/groups\/\d+\/model-allowlist-candidates$/.test(request.path)) data = { models: candidates }
    else if (request.path === '/admin/groups' && request.method === 'post') data = group(91, request.body)
    else if (request.path === '/admin/groups/42' && request.method === 'put') data = group(42, request.body)
    else if (/^\/admin\/accounts\/\d+$/.test(request.path)) data = { id: Number(request.path.split('/').at(-1)), name: `Synthetic account ${request.path.split('/').at(-1)}`, platform: 'anthropic', type: 'oauth' }
    else if (request.path === '/admin/accounts') data = { items: [{ id: 71, name: 'Synthetic account 71' }, { id: 72, name: 'Synthetic account 72' }], total: 2, page: 1, page_size: 20, pages: 1 }
    else {
      unexpected.push(`${request.method} ${request.path}`)
      throw new Error(`Unexpected synthetic group endpoint: ${unexpected.at(-1)}`)
    }
    return { data: { code: 0, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = previousAdapter
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('Groups release display and read contracts', () => {
  it.each(['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'deepseek', 'kimi', 'zhipu', 'minimax', 'opencode_go', 'composite'])('renders the %s platform, account availability and rate from server rows', async platform => {
    groups = [group(42, { platform, rate_multiplier: 1.25, is_exclusive: true })]
    const view = await render()
    const item = row(view)
    expect(item.text()).toContain(`admin.groups.platforms.${platform}`)
    expect(item.text()).toContain('1.25x')
    expect(item.text()).toContain('admin.groups.exclusive')
    expect(item.text()).toContain('admin.groups.accountsRateLimited')
    expect(item.text()).toContain('admin.accounts.status.active')
    expect(item.findAll('td').map(cell => cell.text())).toEqual(expect.arrayContaining([expect.stringContaining('admin.groups.accountsAvailable2')]))
  })

  it.each([
    { used: 5, className: 'text-gray-700', label: '$5.00' },
    { used: 8, className: 'text-amber-600', label: '$8.00' },
    { used: 11, className: 'text-red-600', label: '$11.00' },
  ])('shows the correct quota state for $used dollars used against a ten-dollar daily limit', async ({ used, className, label }) => {
    groups = [group(42, { subscription_type: 'subscription', daily_limit_usd: 10, weekly_limit_usd: 70, monthly_limit_usd: 300 })]
    usage = [{ group_id: 42, today_cost: used, yesterday_cost: 1.5, total_cost: 1200 }]
    const view = await render()
    const item = row(view)
    expect(item.text()).toContain('admin.groups.subscription.subscription')
    expect(item.text()).toContain('$70.00/admin.groups.limitWeek')
    expect(item.text()).toContain('$300.0/admin.groups.limitMonth')
    const amount = item.findAll('span').find(node => node.text() === label && node.classes().includes(className))
    expect(amount, `${label} state ${className}`).toBeDefined()
    expect(item.text()).toContain('$1200')
  })

  it('displays unlimited subscription quotas, zero account counts and an inactive status without inventing usage', async () => {
    groups = [group(42, { subscription_type: 'subscription', account_count: 0, active_account_count: 0, rate_limited_account_count: 0, status: 'inactive' })]
    const view = await render()
    expect(row(view).text()).toContain('admin.groups.subscription.noLimit')
    expect(row(view).text()).toContain('admin.accounts.status.inactive')
    expect(row(view).text()).not.toContain('admin.groups.accountsRateLimited')
    expect(row(view).text()).toContain('$0.00')
  })

  it('renders capacity ratios from the summary endpoint and a dash for a group absent from that summary', async () => {
    groups = [group(), group(43)]
    capacity = [{ group_id: 42, concurrency_used: 2, concurrency_max: 4, sessions_used: 3, sessions_max: 5, rpm_used: 6, rpm_max: 10 }]
    const view = await render()
    expect(row(view, 42).text()).toContain('2/4')
    expect(row(view, 42).text()).toContain('3/5')
    expect(row(view, 42).text()).toContain('6/10')
    expect(row(view, 43).text()).toContain('—')
    expect(requests.some(request => request.path === '/admin/groups/capacity-summary')).toBe(true)
  })

  it('uses native pagination, page size and column sorting to send the corresponding server query', async () => {
    const view = await render()
    await view.get('[aria-label="pagination.next"]').trigger('click')
    await flushPromises()
    expect(listRequests().at(-1)!.params).toMatchObject({ page: 2, page_size: 20, sort_by: 'sort_order', sort_order: 'asc' })
    await choose(view, '.page-size-select button', '50')
    expect(listRequests().at(-1)!.params).toMatchObject({ page: 1, page_size: 50 })
    const header = view.findAll('th').find(node => node.text().includes('admin.groups.columns.name'))
    expect(header).toBeDefined()
    await header!.trigger('click')
    await flushPromises()
    expect(listRequests().at(-1)!.params).toMatchObject({ page: 1, page_size: 50, sort_by: 'name', sort_order: 'asc' })
  })

  it('keeps a failed list read recoverable with the refresh button and restores visible server rows', async () => {
    rejectNext = 'get /admin/groups'
    const view = await render()
    expect(feedback.error).toHaveBeenCalledWith('admin.groups.failedToLoad')
    expect(view.findAll('tbody tr').some(node => node.text().includes('Release group 42'))).toBe(false)
    await view.get('[title="common.refresh"]').trigger('click')
    await flushPromises()
    expect(row(view).text()).toContain('Release group 42')
    expect(listRequests()).toHaveLength(2)
  })

  it.each([
    { action: 'group-rate-multipliers', dialog: 'user multipliers', close: 'close multipliers' },
    { action: 'group-rpm-overrides', dialog: 'user RPM', close: 'close RPM' },
  ])('passes the selected group to the public $action dialog and closes through its public event', async ({ action, dialog, close }) => {
    const view = await render()
    await row(view).get(`[data-testid="${action}"]`).trigger('click')
    const modal = view.get(`[aria-label="${dialog}"]`)
    expect(modal.text()).toContain('42: Release group 42')
    await button(modal, close).trigger('click')
    expect(view.find(`[aria-label="${dialog}"]`).exists()).toBe(false)
    expect(mutations()).toEqual([])
  })
})

describe('Groups release edit and create contracts', () => {
  it.each(['create', 'edit'] as const)('filters Claude fallback targets and saves an eligible target from the %s form', async mode => {
    groups = [group(), group(43), group(44, { platform: 'openai' }), group(45, { status: 'inactive' }), group(46, { claude_code_only: true })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view) : await editForm(view)
    const toggle = form.get('[aria-label="admin.groups.claudeCode.title"]')
    await toggle.trigger('click')
    await form.get(`#groups-${mode}-form-fallback-group-id`).trigger('click')
    await flushPromises()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(options.map(node => node.textContent?.trim())).toContain('Release group 43')
    for (const invalid of ['Release group 44', 'Release group 45', 'Release group 46']) expect(options.map(node => node.textContent?.trim())).not.toContain(invalid)
    if (mode === 'edit') expect(options.map(node => node.textContent?.trim())).not.toContain('Release group 42')
    options.find(node => node.textContent?.trim() === 'Release group 43')!.click()
    await submit(form)
    expect(lastBody()).toMatchObject({ claude_code_only: true, fallback_group_id: 43 })
  })

  it.each(['create', 'edit'] as const)('sends independently configured image prices and multipliers from the %s form', async mode => {
    groups = [group(42, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    await checkbox(form, 'admin.groups.imagePricing.allowImageGeneration').setValue(true)
    await checkbox(form, 'admin.groups.imagePricing.independentMultiplier').setValue(true)
    await checkbox(form, 'admin.groups.imagePricing.perImageBilling').setValue(true)
    await form.get(`#groups-${mode}-form-image-rate-multiplier`).setValue('1.25')
    await form.get(`#groups-${mode}-form-image-price-1k`).setValue('0.012')
    await form.get(`#groups-${mode}-form-image-price-2k`).setValue('0.024')
    await form.get(`#groups-${mode}-form-image-price-4k`).setValue('0.048')
    await submit(form)
    expect(lastBody()).toMatchObject({ allow_image_generation: true, image_count_billing: true, image_rate_independent: true, image_rate_multiplier: 1.25, image_price_1k: 0.012, image_price_2k: 0.024, image_price_4k: 0.048 })
    expect(feedback.success).toHaveBeenCalledWith(`admin.groups.group${mode === 'create' ? 'Created' : 'Updated'}`)
  })

  it.each(['create', 'edit'] as const)('preserves explicit Gemini batch discount and reserve multipliers in the %s request', async mode => {
    groups = [group(42, { platform: 'gemini' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'gemini') : await editForm(view)
    await checkbox(form, 'admin.groups.imagePricing.allowImageGeneration').setValue(true)
    await checkbox(form, 'admin.groups.imagePricing.allowBatchImageGeneration').setValue(true)
    await form.get(`#groups-${mode}-form-batch-image-discount-multiplier`).setValue('0.45')
    await form.get(`#groups-${mode}-form-batch-image-hold-multiplier`).setValue('0.7')
    await submit(form)
    expect(lastBody()).toMatchObject({ allow_image_generation: true, allow_batch_image_generation: true, batch_image_discount_multiplier: 0.45, batch_image_hold_multiplier: 0.7 })
  })

  it.each(['create', 'edit'] as const)('saves Grok video resolution prices with an independent multiplier through the %s form', async mode => {
    groups = [group(42, { platform: 'grok' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'grok') : await editForm(view)
    await checkbox(form, 'admin.groups.videoPricing.independentMultiplier').setValue(true)
    await form.get(`#groups-${mode}-form-video-rate-multiplier`).setValue('1.4')
    await form.get(`#groups-${mode}-form-video-price-480p`).setValue('0.13')
    await form.get(`#groups-${mode}-form-video-price-720p`).setValue('0.27')
    await form.get(`#groups-${mode}-form-video-price-1080p`).setValue('0.54')
    await submit(form)
    expect(lastBody()).toMatchObject({ video_rate_independent: true, video_rate_multiplier: 1.4, video_price_480p: 0.13, video_price_720p: 0.27, video_price_1080p: 0.54 })
  })

  it.each(['create', 'edit'] as const)('removes one messages mapping and submits the remaining family mappings from the %s form', async mode => {
    groups = [group(42, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    await form.get(`#groups-${mode}-form-allow-messages-dispatch`).trigger('click')
    await form.get(`#groups-${mode}-form-sonnet-mapped-model`).setValue('release-sonnet-target')
    await form.get(`#groups-${mode}-form-haiku-mapped-model`).setValue('release-haiku-target')
    await button(form, 'admin.groups.openaiMessages.addExactMapping').trigger('click')
    const mapping = form.get(`input[id^="groups-${mode}-dispatch-source-"]`)
    await mapping.setValue('claude-release-exact')
    await form.get('[title="admin.groups.openaiMessages.removeExactMapping"]').trigger('click')
    expect(form.findAll(`input[id^="groups-${mode}-dispatch-source-"]`)).toHaveLength(0)
    await submit(form)
    expect(lastBody()).toMatchObject({ allow_messages_dispatch: true, messages_dispatch_model_config: { sonnet_mapped_model: 'release-sonnet-target', haiku_mapped_model: 'release-haiku-target', exact_model_mappings: {} } })
  })

  it('blocks an empty candidate view after lookup failure, then reopens with the saved policy intact', async () => {
    groups = [group(42, { model_allowlist: { enabled: true, models: ['saved-release-model', 'saved-release-*'] } })]
    rejectNext = 'get /admin/groups/42/model-allowlist-candidates'
    const view = await render()
    let form = await editForm(view)
    expect(form.text()).toContain('admin.groups.modelAllowlist.empty')
    await submit(form)
    expect(mutations()).toEqual([])
    expect(feedback.error).toHaveBeenCalledWith('admin.groups.modelAllowlist.emptySelectionError')
    await view.get('[aria-label="Close dialog"]').trigger('click')
    form = await editForm(view)
    expect(form.get<HTMLInputElement>('input[aria-label="saved-release-model"]').element.checked).toBe(true)
    await submit(form)
    expect(lastBody().model_allowlist).toEqual({ enabled: true, models: ['saved-release-model', 'saved-release-*'] })
  })

  it('allows a saved model to move in the edit allowlist and saves its explicit order', async () => {
    groups = [group(42, { model_allowlist: { enabled: true, models: ['saved-release-a', 'saved-release-b'] } })]
    candidates = []
    const view = await render()
    const form = await editForm(view)
    const input = form.get('input[aria-label="saved-release-b"]')
    await new DOMWrapper(input.element.parentElement!).findAll('button')[0].trigger('click')
    await submit(form)
    expect(lastBody().model_allowlist).toEqual({ enabled: true, models: ['saved-release-b', 'saved-release-a'] })
  })

  it.each(['create', 'edit'] as const)('saves multilingual names and descriptions from the actual %s child fields without replacing default text', async mode => {
    groups = [group(42, { i18n: { zh: { name: '原名称', description: '原说明' } } })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view) : await editForm(view)
    const menus = form.findAll('[data-testid="group-i18n-menu"]')
    await menus[0].trigger('click')
    await form.get('[data-locale="zh"]').trigger('click')
    const name = form.get<HTMLInputElement>('input[id^="group-name-"]')
    expect(name.attributes('required')).toBeUndefined()
    await name.setValue('发布测试分组')
    await menus[1].trigger('click')
    await form.get('[data-locale="zh"]').trigger('click')
    await form.get('textarea[id^="group-description-"]').setValue('合成的中文说明')
    await submit(form)
    expect(lastBody()).toMatchObject({ name: mode === 'create' ? 'Synthetic release group' : 'Release group 42', i18n: { zh: { name: '发布测试分组', description: '合成的中文说明' } } })
  })

  it.each(['create', 'edit'] as const)('saves Grok per-model video overrides without erasing a future saved family in %s mode', async mode => {
    groups = [group(42, { platform: 'grok', video_model_prices: { 'future-video': { '1440p': 0.9 } } })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'grok') : await editForm(view)
    await form.get(`[data-testid="${mode}-grok-video-price-grok-imagine-video-480p"]`).setValue('0')
    await form.get(`[data-testid="${mode}-grok-video-price-grok-imagine-video-1.5-1080p"]`).setValue('0.33')
    await submit(form)
    expect(lastBody().video_model_prices).toMatchObject({ 'grok-imagine-video': { '480p': 0 }, 'grok-imagine-video-1.5': { '1080p': 0.33 } })
    if (mode === 'edit') expect(lastBody().video_model_prices).toMatchObject({ 'future-video': { '1440p': 0.9 } })
  })

  it.each(['create', 'edit'] as const)('uses eligible non-subscription groups for the invalid-request fallback in the %s request', async mode => {
    groups = [group(), group(43), group(44, { subscription_type: 'subscription' }), group(45, { fallback_group_id_on_invalid_request: 43 }), group(46, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view) : await editForm(view)
    await form.get(`#groups-${mode}-form-fallback-group-id-on-invalid-request`).trigger('click')
    await flushPromises()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(options.map(node => node.textContent?.trim())).toContain('Release group 43')
    for (const id of [44, 45, 46]) expect(options.map(node => node.textContent?.trim())).not.toContain(`Release group ${id}`)
    if (mode === 'edit') expect(options.map(node => node.textContent?.trim())).not.toContain('Release group 42')
    options.find(node => node.textContent?.trim() === 'Release group 43')!.click()
    await submit(form)
    expect(lastBody().fallback_group_id_on_invalid_request).toBe(43)
  })

  it.each(['create', 'edit'] as const)('submits reasoning effort limits and an explicitly scoped translation from the %s editor', async mode => {
    groups = [group(42, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    expect(form.get(`#${mode}-group-reasoning-over-limit`).attributes('disabled')).toBeDefined()
    await choose(form, `#${mode}-group-reasoning-max-effort`, 'high')
    await choose(form, `#${mode}-group-reasoning-over-limit`, 'admin.groups.form.maxReasoningEffortOverLimitDeny')
    await button(form, 'admin.groups.form.addReasoningEffortMapping').trigger('click')
    await choose(form, '[aria-label="admin.groups.form.reasoningEffortMatchType"]', 'admin.groups.form.reasoningEffortMatchPrefix')
    await form.get('[aria-label="admin.groups.form.reasoningEffortModel"]').setValue(' release-model- ')
    await choose(form, '[aria-label="admin.groups.form.reasoningEffortFrom"]', 'none')
    await choose(form, '[aria-label="admin.groups.form.reasoningEffortTo"]', 'low')
    await submit(form)
    expect(form.findAll('[role="alert"]').map(node => node.text())).toEqual([])
    expect(lastBody()).toMatchObject({ max_reasoning_effort: 'high', max_reasoning_effort_over_limit: 'deny', reasoning_effort_mappings: [{ from: 'none', to: 'low', match_type: 'prefix', model: 'release-model-' }] })
  })

  it.each(['create', 'edit'] as const)('requires both reasoning translation endpoints and permits correction through the %s controls', async mode => {
    groups = [group(42, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    await button(form, 'admin.groups.form.addReasoningEffortMapping').trigger('click')
    await submit(form)
    expect(mutations()).toEqual([])
    expect(form.findAll('[role="alert"]').length).toBeGreaterThan(0)
    await choose(form, '[aria-label="admin.groups.form.reasoningEffortFrom"]', 'max')
    await choose(form, '[aria-label="admin.groups.form.reasoningEffortTo"]', 'admin.groups.form.reasoningEffortToDeny')
    await button(form, 'admin.groups.form.addReasoningEffortPair').trigger('click')
    await form.findAll('[aria-label="admin.groups.form.removeReasoningEffortPair"]')[1].trigger('click')
    await submit(form)
    expect(lastBody().reasoning_effort_mappings).toEqual([{ from: 'max', to: 'deny' }])
  })

  it.each(['create', 'edit'] as const)('removes a reasoning group and clears the maximum while preserving an explicit %s save', async mode => {
    groups = [group(42, { platform: 'openai' })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    await choose(form, `#${mode}-group-reasoning-max-effort`, 'medium')
    const max = form.get(`#${mode}-group-reasoning-max-effort`)
    await new DOMWrapper(max.element.parentElement!).get('[aria-label="Clear selection"]').trigger('click')
    await button(form, 'admin.groups.form.addReasoningEffortMapping').trigger('click')
    await form.get('[aria-label="admin.groups.form.removeReasoningEffortMapping"]').trigger('click')
    expect(form.get(`#${mode}-group-reasoning-over-limit`).attributes('disabled')).toBeDefined()
    await submit(form)
    expect(lastBody()).toMatchObject({ max_reasoning_effort: '', reasoning_effort_mappings: [] })
  })

  it.each([
    { mode: 'create', billing: 'per_request', label: 'admin.channels.billingMode.perRequest' },
    { mode: 'edit', billing: 'per_request', label: 'admin.channels.billingMode.perRequest' },
    { mode: 'create', billing: 'image', label: 'admin.channels.billingMode.image' },
    { mode: 'edit', billing: 'image', label: 'admin.channels.billingMode.image' },
    { mode: 'create', billing: 'video', label: 'admin.channels.billingMode.video' },
    { mode: 'edit', billing: 'video', label: 'admin.channels.billingMode.video' },
  ])('sends literal dollar-per-request prices and a named tier from the $mode $billing pricing card', async ({ mode, billing, label }) => {
    const view = await render()
    const form = mode === 'create' ? await createForm(view) : await editForm(view)
    await button(form, 'admin.groups.modelPricing.add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(form.find('[aria-label="admin.channels.form.pricingEntry"]').exists()).toBe(true))
    const header = form.get('[aria-label="admin.channels.form.pricingEntry"]')
    const card = new DOMWrapper(header.element.parentElement!.parentElement!)
    if (header.attributes('aria-expanded') === 'false') await header.trigger('click')
    const model = card.get('input[placeholder="admin.channels.form.modelsPlaceholder"]')
    await model.setValue('release-priced-model')
    await model.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await choose(card, '.w-40 button', label)
    await card.get('input[placeholder="admin.channels.form.pricePlaceholder"]').setValue('0.075')
    await button(card, '+ admin.channels.form.addTier').trigger('click')
    const labelledInput = (name: string) => {
      const fieldLabel = card.findAll('label').find(node => node.text().startsWith(name))
      expect(fieldLabel, name).toBeDefined()
      return new DOMWrapper(fieldLabel!.element.parentElement!).get('input')
    }
    await labelledInput(billing === 'image' ? 'admin.channels.form.resolution' : 'admin.channels.form.tierLabel').setValue('release-tier')
    await labelledInput('admin.channels.form.minTokens').setValue('128')
    await labelledInput('admin.channels.form.maxTokens').setValue('1024')
    await labelledInput('admin.channels.form.perRequestPrice').setValue('0.11')
    await submit(form)
    expect(lastBody().model_pricing).toEqual([expect.objectContaining({
      platform: 'anthropic', models: ['release-priced-model'], billing_mode: billing, per_request_price: 0.075,
      intervals: [expect.objectContaining({ min_tokens: 128, max_tokens: 1024, tier_label: 'release-tier', per_request_price: 0.11 })],
      time_pricing: null,
    })])
  })

  it.each(['create', 'edit'] as const)('removes a model pricing card through its public button and sends an explicit empty %s pricing list', async mode => {
    groups = [group(42, { model_pricing: [{ models: ['saved-priced-model'], billing_mode: 'token', input_price: 0.000003 }] })]
    const view = await render()
    const form = mode === 'create' ? await createForm(view) : await editForm(view)
    if (mode === 'create') await button(form, 'admin.groups.modelPricing.add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(form.findAll('button').some(node => node.attributes('aria-label')?.startsWith('admin.channels.form.pricingEntry'))).toBe(true))
    const header = form.findAll('button').find(node => node.attributes('aria-label')?.startsWith('admin.channels.form.pricingEntry'))!
    expect(header).toBeDefined()
    const card = new DOMWrapper(header.element.parentElement!.parentElement!)
    await card.get('[aria-label="common.delete"]').trigger('click')
    expect(form.findAll('button').some(node => node.attributes('aria-label')?.startsWith('admin.channels.form.pricingEntry'))).toBe(false)
    await submit(form)
    expect(lastBody().model_pricing).toEqual([])
  })
})

describe('Group release data and input boundaries beyond ordinary CRUD', () => {
  it.each([
    { saved: '["usage", "obsolete-column", 99]', version: '1', hidden: ['usage', 'id'] },
    { saved: '["id", "capacity"]', version: '1', hidden: ['id', 'capacity'] },
    { saved: '{"old":true}', version: '1', hidden: ['id'] },
    { saved: '["capacity"]', version: '2', hidden: ['capacity'] },
  ])('migrates stored column preferences $saved at version $version without retaining unknown columns or hiding row actions', async ({ saved, version, hidden }) => {
    localStorage.setItem('group-hidden-columns', saved); localStorage.setItem('group-column-settings-version', version)
    const view = await render(); const headings = view.findAll('th').map(node => node.text())
    for (const [key, label] of Object.entries({ id: 'admin.groups.columns.id', usage: 'admin.groups.columns.usage', capacity: 'admin.groups.columns.capacity' })) expect(headings.includes(label), label).toBe(!hidden.includes(key))
    expect(headings).toContain('admin.groups.columns.actions'); expect(headings).toContain('admin.groups.columns.name'); expect(localStorage.getItem('group-column-settings-version')).toBe('2'); expect(mutations()).toEqual([])
  })

  it('recovers a corrupt stored column preference with usable default columns and no management command', async () => {
    localStorage.setItem('group-hidden-columns', 'not valid JSON'); const view = await render()
    expect(view.findAll('th').map(node => node.text())).not.toContain('admin.groups.columns.id'); expect(row(view).text()).toContain('Release group 42'); expect(mutations()).toEqual([])
  })

  it.each([
    { daily: null, weekly: 70, monthly: null, visible: '$70.00/admin.groups.limitWeek' },
    { daily: null, weekly: null, monthly: 300, visible: '$300.0/admin.groups.limitMonth' },
    { daily: 10, weekly: null, monthly: null, visible: '$0.00/$10.00' },
  ])('renders a subscription with the independently configured quota $visible and no invented consumption', async ({ daily, weekly, monthly, visible }) => {
    groups = [group(42, { subscription_type: 'subscription', daily_limit_usd: daily, weekly_limit_usd: weekly, monthly_limit_usd: monthly })]
    const view = await render(); expect(row(view).text().replace(/\s/g, '')).toContain(visible.replace(/\s/g, '')); expect(row(view).text()).not.toContain('admin.groups.subscription.noLimit'); expect(mutations()).toEqual([])
  })

  it('loads absent legacy OpenAI capabilities into explicit defaults and uses the existing media-price clearing sentinel', async () => {
    groups = [group(42, { platform: 'openai', subscription_type: null, allow_image_generation: null, allow_batch_image_generation: null, image_rate_independent: null, image_rate_multiplier: null, batch_image_discount_multiplier: null, batch_image_hold_multiplier: null, video_rate_independent: null, video_rate_multiplier: null, peak_rate_enabled: null, peak_start: null, peak_end: null, peak_rate_multiplier: null, supported_model_scopes: null, mcp_xml_inject: null, rpm_limit: null, codex_models_manifest_config: { enabled: null, account_ids: null, fallback_to_scheduler: null } })]
    const view = await render(); const form = await editForm(view); await submit(form)
    expect(lastBody()).toMatchObject({ subscription_type: 'standard', allow_image_generation: false, allow_batch_image_generation: false, image_rate_independent: false, image_rate_multiplier: 1, batch_image_discount_multiplier: 0.5, batch_image_hold_multiplier: 0.6, video_rate_independent: false, video_rate_multiplier: 1, peak_rate_enabled: false, peak_start: '', peak_end: '', peak_rate_multiplier: 1, mcp_xml_inject: true, rpm_limit: 0, codex_models_manifest_config: { enabled: false, account_ids: [], fallback_to_scheduler: false }, image_price_1k: -1, image_price_2k: -1, image_price_4k: -1 })
  })

  it.each(['create', 'edit'] as const)('submits null for unset/zero subscription quotas while preserving a positive decimal monthly quota in %s', async mode => {
    groups = [group(42, { subscription_type: 'subscription' })]; const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
    if (mode === 'create') await choose(form, '#groups-create-form-subscription-type', 'admin.groups.subscription.subscription')
    await form.get(`#groups-${mode}-form-daily-limit-usd`).setValue(''); await form.get(`#groups-${mode}-form-weekly-limit-usd`).setValue('0'); await form.get(`#groups-${mode}-form-monthly-limit-usd`).setValue('12.75'); await form.get(`#groups-${mode}-form-rate-multiplier`).setValue('0')
    await submit(form); expect(lastBody()).toMatchObject({ daily_limit_usd: null, weekly_limit_usd: null, monthly_limit_usd: 12.75, rate_multiplier: 0 })
  })

  it('keeps the existing subscription type immutable in the editor and preserves its peak window on a normal save', async () => {
    groups = [group(42, { subscription_type: 'subscription', peak_rate_enabled: true, peak_start: '22:00', peak_end: '06:00', peak_rate_multiplier: 2 })]
    const view = await render(); const form = await editForm(view); expect(form.get('#groups-edit-form-subscription-type').attributes('disabled')).toBeDefined(); await submit(form)
    expect(lastBody()).toMatchObject({ subscription_type: 'subscription', peak_rate_enabled: true, peak_start: '22:00', peak_end: '06:00', peak_rate_multiplier: 2 })
  })

  it.each(['create', 'edit'] as const)('shows empty and duplicate custom allowlist errors then saves one corrected wildcard through %s controls', async mode => {
    candidates = []; const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
    await form.get(`#groups-${mode}-model-allowlist-state-enabled`).trigger('click'); const input = form.get<HTMLInputElement>('input[aria-label="admin.groups.modelAllowlist.addCustom"]')
    await input.setValue('   '); await input.trigger('keydown', { key: 'Enter' }); expect(form.text()).toContain('admin.groups.modelAllowlist.errors.empty')
    await input.setValue('synthetic-*'); await button(form, 'admin.groups.modelAllowlist.addCustom').trigger('click'); expect(input.element.value).toBe('')
    await input.setValue('SYNTHETIC-*'); await input.trigger('keydown', { key: 'Enter' }); expect(form.text()).toContain('admin.groups.modelAllowlist.errors.duplicate')
    await input.setValue('synthetic-exact'); await input.trigger('keydown', { key: 'Enter' }); expect(form.text()).not.toContain('admin.groups.modelAllowlist.errors.duplicate')
    await submit(form); expect(lastBody().model_allowlist).toEqual({ enabled: true, models: ['synthetic-*', 'synthetic-exact'] })
  })

  it.each(['create', 'edit'] as const)('retains a zero per-image base price and zero independent multiplier in %s without treating free pricing as missing', async mode => {
    groups = [group(42, { platform: 'openai' })]; const view = await render(); const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    await checkbox(form, 'admin.groups.imagePricing.allowImageGeneration').setValue(true)
    await checkbox(form, 'admin.groups.imagePricing.independentMultiplier').setValue(true)
    await form.get(`#groups-${mode}-form-image-rate-multiplier`).setValue('0'); await form.get(`#groups-${mode}-form-image-price-1k`).setValue('0')
    expect(form.text()).toContain('$0'); await submit(form); expect(lastBody()).toMatchObject({ image_rate_multiplier: 0, image_price_1k: 0, image_price_2k: mode === 'edit' ? -1 : null, image_price_4k: mode === 'edit' ? -1 : null })
  })

  it.each(['create', 'edit'] as const)('can remove and restore an Antigravity model scope and submit the exact final scope list in %s', async mode => {
    groups = [group(42, { platform: 'antigravity' })]; const view = await render(); const form = mode === 'create' ? await createForm(view, 'antigravity') : await editForm(view)
    const claude = checkbox(form, 'admin.groups.supportedScopes.claude'); await claude.setValue(false); await claude.setValue(true)
    await checkbox(form, 'admin.groups.supportedScopes.geminiImage').setValue(false); await submit(form)
    expect(lastBody().supported_model_scopes).toEqual(['gemini_text', 'claude'])
  })

  it.each(['create', 'edit'] as const)('keeps unsupported Live disabled after cancel, enables it only after explicit acknowledgment, and can turn it off again in %s', async mode => {
    liveSupported = false; groups = [group(42, { platform: 'openai' })]; const view = await render(); const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
    const live = form.get(`#groups-${mode}-form-allow-live`); await live.trigger('click'); await flushPromises()
    const dialog = view.findAll('[role="dialog"]').find(node => node.text().includes('admin.groups.openaiLive.unsupportedMessage'))!
    expect(dialog).toBeDefined(); await button(dialog, 'common.cancel').trigger('click'); expect(live.attributes('aria-checked')).toBe('false')
    await live.trigger('click'); await flushPromises(); await button(view, 'admin.groups.openaiLive.enableAnyway').trigger('click'); expect(live.attributes('aria-checked')).toBe('true')
    await live.trigger('click'); expect(live.attributes('aria-checked')).toBe('false'); await submit(form); expect(lastBody().allow_live).toBe(false)
  })

  it.each(['create', 'edit'] as const)('builds a routed model with only the final selected account, ignores an empty-account rule, and closes search on outside click in %s', async mode => {
    const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
    await form.get('[aria-label="admin.groups.modelRouting.title"]').trigger('click'); await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
    await form.get('input[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]').setValue('no-account-*')
    await button(form, 'admin.groups.modelRouting.addRule').trigger('click'); const patterns = form.findAll('input[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]'); await patterns[1].setValue(' synthetic-model-* ')
    vi.useFakeTimers(); const search = form.findAll('input[placeholder="admin.groups.modelRouting.searchAccountPlaceholder"]')[1]
    await search.trigger('focus'); await search.setValue('synthetic'); await vi.advanceTimersByTimeAsync(301); await flushPromises()
    const result = form.findAll('button').find(node => node.text().includes('Synthetic account 71') && node.text().includes('#71'))!; expect(result).toBeDefined(); await result.trigger('click')
    const chip = form.findAll('span.rounded-full').find(node => node.text().includes('Synthetic account 71'))!; await chip.get('button').trigger('click')
    await search.trigger('focus'); await vi.advanceTimersByTimeAsync(301); await flushPromises(); await form.findAll('button').find(node => node.text().includes('Synthetic account 72') && node.text().includes('#72'))!.trigger('click')
    document.body.click(); await flushPromises(); await submit(form); expect(lastBody().model_routing).toEqual({ 'synthetic-model-*': [72] }); expect(lastBody().model_routing_enabled).toBe(true)
  })
})
