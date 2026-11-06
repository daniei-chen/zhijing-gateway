import { defineComponent, h } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupsView from '@/views/admin/GroupsView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { VueWrapper } from '@vue/test-utils'

const {
  listGroups,
  duplicateGroup,
  updateGroup,
  getModelAllowlistCandidates,
  getUsageSummary,
  getCapacitySummary,
  getLiveCapability,
  showSuccess,
  showError,
  createGroup, getAllGroups, deleteGroup, updateSortOrder, listAccounts, getAccount,
  listCompositeRoutes, createCompositeRoute, updateCompositeRoute, deleteCompositeRoute, previewCompositeRoute
} = vi.hoisted(() => ({
  listGroups: vi.fn(),
  duplicateGroup: vi.fn(),
  updateGroup: vi.fn(),
  getModelAllowlistCandidates: vi.fn(),
  getUsageSummary: vi.fn(),
  getCapacitySummary: vi.fn(),
  getLiveCapability: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  createGroup: vi.fn(), getAllGroups: vi.fn(), deleteGroup: vi.fn(), updateSortOrder: vi.fn(),
  listAccounts: vi.fn(), getAccount: vi.fn(), listCompositeRoutes: vi.fn(), createCompositeRoute: vi.fn(),
  updateCompositeRoute: vi.fn(), deleteCompositeRoute: vi.fn(), previewCompositeRoute: vi.fn()
}))

const authState = vi.hoisted(() => ({ isSimpleMode: false }))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    groups: {
      list: listGroups,
      duplicate: duplicateGroup,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      getAll: getAllGroups,
      create: createGroup,
      update: updateGroup,
      delete: deleteGroup,
      updateSortOrder,
      listCompositeRoutes, createCompositeRoute, updateCompositeRoute, deleteCompositeRoute, previewCompositeRoute
    },
    accounts: {
      list: listAccounts,
      getById: getAccount
    }
  }
}))

vi.mock('@/api/admin/channels', () => ({
  default: { getModelDefaultPricing: vi.fn().mockResolvedValue({ found: false }) }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess, showError })
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState
}))

vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => ({
    isCurrentStep: vi.fn(() => false),
    nextStep: vi.fn()
  })
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key })
  }

})

const sourceGroup: AdminGroup = {
  id: 42,
  name: 'Primary',
  description: null,
  platform: 'openai',
  rate_multiplier: 1,
  rpm_limit: 0,
  is_exclusive: false,
  status: 'active',
  subscription_type: 'standard',
  daily_limit_usd: null,
  weekly_limit_usd: null,
  monthly_limit_usd: null,
  long_context_pricing_enabled: true,
  force_openai_fast: false,
  free_openai_fast: false,
  model_pricing: [],
  profit_control_enabled: false,
  profit_min_margin: 0,
  profit_safety_buffer: 0,
  allow_image_generation: false,
  allow_batch_image_generation: false,
  image_count_billing: false,
  image_rate_independent: false,
  image_rate_multiplier: 1,
  batch_image_discount_multiplier: 0.5,
  batch_image_hold_multiplier: 0.6,
  image_price_1k: null,
  image_price_2k: null,
  image_price_4k: null,
  video_rate_independent: false,
  video_rate_multiplier: 1,
  video_price_480p: null,
  video_price_720p: null,
  video_price_1080p: null,
  web_search_price_per_call: null,
  search_price_per_1k: null,
  audio_realtime_price_per_min: null,
  audio_tts_price_per_million_chars: null,
  audio_stt_price_per_hour: null,
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1,
  claude_code_only: false,
  fallback_group_id: null,
  fallback_group_id_on_invalid_request: null,
  allow_messages_dispatch: false,
  allow_live: false,
  default_mapped_model: '',
  messages_dispatch_model_config: undefined,
  require_oauth_only: false,
  require_privacy_set: false,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
  model_routing: null,
  model_routing_enabled: false,
  mcp_xml_inject: true,
  supported_model_scopes: [],
  account_count: 1,
  active_account_count: 1,
  rate_limited_account_count: 0,
  model_allowlist: undefined,
  sort_order: 10
}

const AppLayoutStub = defineComponent({
  template: '<main><slot /></main>'
})

const TablePageLayoutStub = defineComponent({
  template: '<section><slot name="filters" /><slot name="table" /><slot name="pagination" /></section>'
})

const DataTableStub = defineComponent({
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false }
  },
  template: '<div><div v-for="row in data" :key="row.id" :data-group="row.id"><slot name="cell-actions" :row="row" /></div></div>'
})

const BaseDialogStub = defineComponent({
  props: {
    show: { type: Boolean, default: false }
  },
  template: '<div v-if="show"><slot /><slot name="footer" /></div>'
})

const NativeSelectStub = defineComponent({
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  inheritAttrs: false,
  setup(props, { emit, attrs }) {
    return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => {
      const value = (event.target as HTMLSelectElement).value
      const option = props.options.find((item: { value: unknown }) => String(item.value ?? '') === value)
      emit('update:modelValue', option?.value ?? value)
      emit('change', option?.value ?? value, option)
    } }, props.options.map((option: { value: string; label: string }) =>
      h('option', { value: option.value ?? '' }, option.label)))
  }
})

const WorkflowDialogStub = defineComponent({
  props: ['show', 'title'], emits: ['close'],
  template: '<section v-if="show" role="dialog" :aria-label="title" :data-dialog="title"><button type="button" @click="$emit(\'close\')">dialog-close</button><slot /><slot name="footer" /></section>'
})

function mountView(workflows = false, realSelect = false) {
  return mount(GroupsView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        TablePageLayout: TablePageLayoutStub,
        DataTable: DataTableStub,
        Pagination: true,
        BaseDialog: workflows ? WorkflowDialogStub : BaseDialogStub,
        ConfirmDialog: false,
        EmptyState: true,
        Select: realSelect ? false : workflows ? NativeSelectStub : true,
        PlatformIcon: true,
        Icon: true,
        GroupCapacityBadge: true,
        GroupRateMultipliersModal: true,
        GroupRPMOverridesModal: true,
        VueDraggable: true
      }
    }
  })
}


const mounted: VueWrapper[] = []
const group = (id = 42, extra: Partial<AdminGroup> = {}): AdminGroup => ({ ...sourceGroup, id, name: `Synthetic group ${id}`, ...extra })
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
async function render() { const view = mountView(true); mounted.push(view); await flushPromises(); return view }
type NativeRoot = Pick<DOMWrapper<Element>, 'findAll'>
function button(root: NativeRoot, name: string) {
 const found = root.findAll('button').find(node => node.text() === name)
 expect(found, `button ${name}`).toBeDefined(); return found!
}
function field(root: NativeRoot, label: string) {
 const found = root.findAll<HTMLLabelElement>('label').find(node => node.text() === label)
 expect(found, `label ${label}`).toBeDefined(); expect(found!.element.control, label).toBeTruthy()
 return new DOMWrapper(found!.element.control!)
}
async function createForm(view: VueWrapper, platform = 'anthropic') { await button(view, 'admin.groups.createGroup').trigger('click'); await flushPromises(); const form = view.get('#create-group-form'); await field(form, 'admin.groups.form.name').setValue('Synthetic new group'); await form.get('#groups-create-form-platform').setValue(platform); await flushPromises(); return form }
async function editForm(view: VueWrapper, id = 42) { await button(view.get(`[data-group="${id}"]`), 'common.edit').trigger('click'); await flushPromises(); return view.get('#edit-group-form') }
async function submit(form: Pick<DOMWrapper<Element>, 'trigger'>) { await form.trigger('submit'); await flushPromises() }
const created = () => createGroup.mock.calls[createGroup.mock.calls.length - 1][0]
const updated = () => updateGroup.mock.calls[updateGroup.mock.calls.length - 1][1]

beforeEach(() => {
 authState.isSimpleMode = false; localStorage.clear(); sessionStorage.clear()
 replaceAuthSession({ accessToken: 'synthetic-groups-native-admin', user: { id: 7, role: 'admin' } })
 for (const mock of [listGroups,duplicateGroup,updateGroup,getModelAllowlistCandidates,getUsageSummary,getCapacitySummary,getLiveCapability,showSuccess,showError,createGroup,getAllGroups,deleteGroup,updateSortOrder,listAccounts,getAccount,listCompositeRoutes,createCompositeRoute,updateCompositeRoute,deleteCompositeRoute,previewCompositeRoute]) mock.mockReset()
 listGroups.mockResolvedValue({ items: [group()], total: 1, page: 1, page_size: 20, pages: 1 })
 getAllGroups.mockResolvedValue([group()]); createGroup.mockResolvedValue(group(91)); updateGroup.mockResolvedValue(group()); duplicateGroup.mockResolvedValue(group(92)); deleteGroup.mockResolvedValue(undefined); updateSortOrder.mockResolvedValue(undefined)
 getModelAllowlistCandidates.mockResolvedValue([]);getUsageSummary.mockResolvedValue([]);getCapacitySummary.mockResolvedValue([]);getLiveCapability.mockResolvedValue({ supported: true })
 listAccounts.mockResolvedValue({ items: [] });getAccount.mockImplementation(async id => ({ id, name: `Synthetic account ${id}` }))
 listCompositeRoutes.mockResolvedValue([]);createCompositeRoute.mockResolvedValue({});updateCompositeRoute.mockResolvedValue({});deleteCompositeRoute.mockResolvedValue({});previewCompositeRoute.mockResolvedValue({ matched: false, source: 'detector', reason: 'Synthetic no match' })
 vi.spyOn(console, 'error').mockImplementation(() => {})
 vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('native group platform and account-source contracts', () => {
 it.each(['create', 'edit'] as const)('preserves explicit positive Grok search and audio units in a %s request', async mode => {
  listGroups.mockResolvedValue({ items: [group(42, { platform: 'grok', video_model_prices: { 'future-synthetic-video': { '1440p': 0.12 } } })], total: 1, pages: 1 })
  const view = await render(); const form = mode === 'create' ? await createForm(view, 'grok') : await editForm(view)
  await form.get(`[data-testid="${mode}-search-price"]`).setValue('4.25')
  await form.get(`[data-testid="${mode}-audio-realtime-price"]`).setValue('0.75')
  await form.get(`[data-testid="${mode}-audio-tts-price"]`).setValue('31')
  await form.get(`[data-testid="${mode}-audio-stt-price"]`).setValue('2.5')
  await form.get(`[data-testid="${mode}-grok-video-price-grok-imagine-video-1.5-720p"]`).setValue('0.05')
  await submit(form)
  expect(mode === 'create' ? created() : updated()).toMatchObject({ platform: 'grok', search_price_per_1k: 4.25, audio_realtime_price_per_min: 0.75, audio_tts_price_per_million_chars: 31, audio_stt_price_per_hour: 2.5 })
  expect((mode === 'create' ? created() : updated()).video_model_prices).toMatchObject({ 'grok-imagine-video-1.5': { '720p': 0.05 } })
  if (mode === 'edit') expect(updated().video_model_prices).toMatchObject({ 'future-synthetic-video': { '1440p': 0.12 } })
  expect(showError).not.toHaveBeenCalled()
 })

 it('restricts copied account sources by platform and allows explicit cross-platform sources for a composite group', async () => {
  const sources = [group(11, { platform: 'anthropic' }), group(12, { platform: 'anthropic', account_count: 0 }), group(42), group(43, { platform: 'grok' })]
  listGroups.mockResolvedValue({ items: sources, total: 4, pages: 1 })
  const view = await render(); const form = await createForm(view)
  let source = form.get('#groups-create-group-form-admin-groups-copy-accounts-title')
  expect(source.findAll('option').map(option => option.attributes('value'))).toEqual(['', '11'])
  await source.setValue('11')
  await form.get('#groups-create-form-platform').setValue('composite'); await flushPromises()
  source = form.get('#groups-create-group-form-admin-groups-copy-accounts-title')
  expect(source.findAll('option').map(option => option.attributes('value'))).toEqual(['', '11', '42', '43'])
  await source.setValue('42'); await source.setValue('43')
  await submit(form)
  expect(created()).toMatchObject({ platform: 'composite', copy_accounts_from_group_ids: [42, 43] })
 })

 it('excludes the edited group and mismatched platforms from account-copy sources', async () => {
  listGroups.mockResolvedValue({ items: [group(), group(44), group(45, { platform: 'grok' })], total: 3, pages: 1 })
  const view = await render(); const form = await editForm(view)
  const source = form.get('#groups-edit-group-form-admin-groups-copy-accounts-title')
  expect(source.findAll('option').map(option => option.attributes('value'))).toEqual(['', '44'])
  await source.setValue('44'); await submit(form)
  expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({ copy_accounts_from_group_ids: [44] }))
 })

 it('sends an explicit OpenAI per-call search price without converting it into a token rate', async () => {
  const view = await render(); const form = await createForm(view, 'openai')
  await form.get('#groups-create-form-web-search-price-per-call').setValue('0.125')
  await form.get('#groups-create-form-rate-multiplier').setValue('2.5')
  await submit(form)
  expect(created()).toMatchObject({ platform: 'openai', web_search_price_per_call: 0.125, rate_multiplier: 2.5 })
 })

 it.each(['create', 'edit'] as const)('saves explicit Antigravity scope and MCP choices from the %s form', async mode => {
  listGroups.mockResolvedValue({ items: [group(42, { platform: 'antigravity', supported_model_scopes: ['claude', 'gemini_text', 'gemini_image'] })], total: 1, pages: 1 })
  const view = await render(); const form = mode === 'create' ? await createForm(view, 'antigravity') : await editForm(view)
  await field(form, 'admin.groups.supportedScopes.geminiText').setValue(false)
  await field(form, 'admin.groups.supportedScopes.geminiImage').setValue(false)
  await form.get(`#groups-${mode}-form-mcp-xml-inject`).trigger('click')
  await submit(form)
  expect(mode === 'create' ? created() : updated()).toMatchObject({ platform: 'antigravity', supported_model_scopes: ['claude'], mcp_xml_inject: false })
 })

 it.each(['create', 'edit'] as const)('saves an OpenAI messages family and exact-model mapping through %s controls', async mode => {
  const view = await render(); const form = mode === 'create' ? await createForm(view, 'openai') : await editForm(view)
  await form.get(`#groups-${mode}-form-allow-messages-dispatch`).trigger('click')
  await form.get(`#groups-${mode}-form-opus-mapped-model`).setValue(' synthetic-opus-model ')
  await button(form, 'admin.groups.openaiMessages.addExactMapping').trigger('click')
  await form.get(`input[id^="groups-${mode}-dispatch-source-"]`).setValue(' claude-synthetic-alias ')
  await form.get(`input[id^="groups-${mode}-dispatch-target-"]`).setValue(' synthetic-exact-model ')
  await submit(form)
  expect(mode === 'create' ? created() : updated()).toMatchObject({ allow_messages_dispatch: true, messages_dispatch_model_config: {
   opus_mapped_model: 'synthetic-opus-model', exact_model_mappings: { 'claude-synthetic-alias': 'synthetic-exact-model' },
  } })
 })
})

describe('native group mutation ownership', () => {
 it.each(['create', 'edit'] as const)('locks synchronous native %s submit events before the disabled DOM updates', async mode => {
  const pending = deferred<AdminGroup>()
  const action = mode === 'create' ? createGroup : updateGroup; action.mockReturnValue(pending.promise)
  const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
  form.element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  form.element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
  expect(action).toHaveBeenCalledTimes(1)
  pending.resolve(group(91)); await flushPromises()
 })

 it.each(['create', 'edit'] as const)('keeps a reopened %s draft when the previous operation finishes', async mode => {
  const pending = deferred<AdminGroup>(); (mode === 'create' ? createGroup : updateGroup).mockReturnValue(pending.promise)
  const view = await render(); const first = mode === 'create' ? await createForm(view) : await editForm(view)
  await submit(first)
  const host = new DOMWrapper(first.element.closest('section[data-dialog]')!)
  await button(host, 'dialog-close').trigger('click'); await flushPromises()
  const current = mode === 'create' ? await createForm(view) : await editForm(view)
  await field(current, 'admin.groups.form.name').setValue('Current unsaved group draft')
  const reads = listGroups.mock.calls.length
  pending.resolve(group(91)); await flushPromises()
  expect(view.find(mode === 'create' ? '#create-group-form' : '#edit-group-form').exists()).toBe(true)
  expect((field(current, 'admin.groups.form.name').element as HTMLInputElement).value).toBe('Current unsaved group draft')
  expect(listGroups).toHaveBeenCalledTimes(reads)
  expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })

 it.each(['create', 'edit'] as const)('does not start follow-ups or publish a late %s result after unmount', async mode => {
  const pending = deferred<AdminGroup>(); (mode === 'create' ? createGroup : updateGroup).mockReturnValue(pending.promise)
  const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
  await submit(form); const reads = listGroups.mock.calls.length
  view.unmount(); mounted.splice(mounted.indexOf(view), 1)
  pending.resolve(group(91)); await flushPromises()
  expect(listGroups).toHaveBeenCalledTimes(reads)
  expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })

 it.each(['create', 'edit'] as const)('does not submit an old %s page after same-ID replacement login', async mode => {
  const view = await render(); const form = mode === 'create' ? await createForm(view) : await editForm(view)
  replaceAuthSession({ accessToken: 'synthetic-next-group-login', user: { id: 7, role: 'admin' } })
  await submit(form)
  expect(mode === 'create' ? createGroup : updateGroup).not.toHaveBeenCalled()
  expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })

 it('does not let an old delete close a replacement group confirmation', async () => {
  listGroups.mockResolvedValue({ items: [group(), group(43)], total: 2, pages: 1 })
  const pending = deferred<void>(); deleteGroup.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined)
  const view = await render()
  await button(view.get('[data-group="42"]'), 'common.delete').trigger('click'); await flushPromises()
  let confirm = view.get('section[data-dialog="admin.groups.deleteGroup"]')
  await button(confirm, 'common.delete').trigger('click'); await flushPromises()
  await button(confirm, 'common.cancel').trigger('click')
  await button(view.get('[data-group="43"]'), 'common.delete').trigger('click'); await flushPromises()
  const reads = listGroups.mock.calls.length
  pending.resolve(); await flushPromises()
  expect(view.find('section[data-dialog="admin.groups.deleteGroup"]').exists()).toBe(true)
  expect(listGroups).toHaveBeenCalledTimes(reads); expect(showSuccess).not.toHaveBeenCalled()
  confirm = view.get('section[data-dialog="admin.groups.deleteGroup"]')
  await button(confirm, 'common.delete').trigger('click'); await flushPromises()
  expect(deleteGroup.mock.calls).toEqual([[42], [43]])
 })

 it('does not open the sort dialog from an initial list arriving after page disposal', async () => {
  const pending = deferred<AdminGroup[]>(); getAllGroups.mockReturnValue(pending.promise)
  const view = await render()
  await button(view, 'admin.groups.sortOrder').trigger('click'); await flushPromises()
  view.unmount(); mounted.splice(mounted.indexOf(view), 1)
  pending.reject(new Error('Synthetic obsolete sort load')); await flushPromises()
  expect(showError).not.toHaveBeenCalled(); expect(showSuccess).not.toHaveBeenCalled()
 })

 it('retains later edits in the same submitted edit form and unlocks an explicit new save', async () => {
  const pending = deferred<AdminGroup>(); let sent: unknown
  updateGroup.mockImplementationOnce((_id, request) => { sent = JSON.parse(JSON.stringify(request)); return pending.promise }).mockResolvedValueOnce(group())
  const view = await render(); const form = await editForm(view)
  await field(form, 'admin.groups.form.name').setValue('Captured old name'); await submit(form)
  await field(form, 'admin.groups.form.name').setValue('Later unsaved name')
  pending.resolve(group()); await flushPromises()
  expect(sent).toMatchObject({ name: 'Captured old name' })
  expect(view.find('#edit-group-form').exists()).toBe(true)
  expect((field(form, 'admin.groups.form.name').element as HTMLInputElement).value).toBe('Later unsaved name')
  await submit(form)
  expect(updateGroup.mock.calls.map(call => call[0])).toEqual([42, 42])
  expect(updated().name).toBe('Later unsaved name')
 })

 it('does not dispatch a duplicate from an old page after the same administrator signs in again', async () => {
  const view = await render()
  replaceAuthSession({ accessToken: 'synthetic-next-duplicate-login', user: { id: 7, role: 'admin' } })
  await view.get('[data-group="42"] [data-testid="group-duplicate"]').trigger('click'); await flushPromises()
  expect(duplicateGroup).not.toHaveBeenCalled(); expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })

 it('does not toast a completed duplicate from a disposed page or start list reads', async () => {
  const pending = deferred<AdminGroup>(); duplicateGroup.mockReturnValue(pending.promise)
  const view = await render(); await view.get('[data-group="42"] [data-testid="group-duplicate"]').trigger('click'); await flushPromises()
  const reads = listGroups.mock.calls.length; view.unmount(); mounted.splice(mounted.indexOf(view), 1)
  pending.resolve(group(92)); await flushPromises()
  expect(duplicateGroup).toHaveBeenCalledExactlyOnceWith(42)
  expect(listGroups).toHaveBeenCalledTimes(reads); expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })
})

describe('native composite route workflow ownership', () => {
 const route = (id: number, model: string) => ({ id, public_model: model, match_type: 'exact', target_platform: 'openai', upstream_model: 'synthetic-upstream', endpoint: 'responses', priority: 10, enabled: true, notes: '' })
 async function compositeView() {
  listGroups.mockResolvedValue({ items: [group(42, { platform: 'composite' }), group(43, { platform: 'composite' })], total: 2, pages: 1 })
  return render()
 }
 async function openRoutes(view: VueWrapper, id = 42) {
  await view.get(`[data-group="${id}"] [data-testid="group-composite-routes"]`).trigger('click'); await flushPromises()
  return view.get('section[data-dialog="admin.groups.compositeRoutes.titleWithGroup"]')
 }

 it('keeps routes for group B when a late list response for group A arrives', async () => {
  const pending = deferred<ReturnType<typeof route>[]>()
  listCompositeRoutes.mockImplementation(id => id === 42 ? pending.promise : Promise.resolve([route(13, 'Current B route')]))
  const view = await compositeView(); const first = await openRoutes(view)
  await button(first, 'dialog-close').trigger('click')
  const current = await openRoutes(view, 43)
  expect(current.text()).toContain('Current B route')
  pending.resolve([route(12, 'Obsolete A route')]); await flushPromises()
  expect(current.text()).toContain('Current B route'); expect(current.text()).not.toContain('Obsolete A route')
 })

 it('keeps a new group B route draft when group A creation finishes', async () => {
  const pending = deferred<unknown>(); createCompositeRoute.mockReturnValue(pending.promise)
  const view = await compositeView(); const first = await openRoutes(view)
  await first.get('#groups-composite-route-form-public-model').setValue('Captured A model')
  await submit(first.get('form'))
  await button(first, 'dialog-close').trigger('click')
  const current = await openRoutes(view, 43)
  await current.get('#groups-composite-route-form-public-model').setValue('Unsaved B model')
  const loads = listCompositeRoutes.mock.calls.length
  pending.resolve({}); await flushPromises()
  expect((current.get('#groups-composite-route-form-public-model').element as HTMLInputElement).value).toBe('Unsaved B model')
  expect(listCompositeRoutes).toHaveBeenCalledTimes(loads)
  expect(createCompositeRoute.mock.calls[0][0]).toBe(42)
  expect(showSuccess).not.toHaveBeenCalled(); expect(showError).not.toHaveBeenCalled()
 })

 it('does not reset a newer route draft typed in the same open form during a save', async () => {
  const pending = deferred<unknown>(); createCompositeRoute.mockReturnValue(pending.promise)
  const view = await compositeView(); const panel = await openRoutes(view)
  await panel.get('#groups-composite-route-form-public-model').setValue('Submitted route')
  await submit(panel.get('form'))
  await panel.get('#groups-composite-route-form-public-model').setValue('Later route draft')
  pending.resolve({}); await flushPromises()
  expect((panel.get('#groups-composite-route-form-public-model').element as HTMLInputElement).value).toBe('Later route draft')
  expect((panel.get('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(false)
  createCompositeRoute.mockResolvedValue({}); await submit(panel.get('form'))
  expect(createCompositeRoute.mock.calls.map(call => call[1].public_model)).toEqual(['Submitted route', 'Later route draft'])
 })

 it('keeps the most recent preview when the older readonly preview arrives last', async () => {
  const pending = deferred<unknown>()
  previewCompositeRoute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ matched: false, source: 'detector', reason: 'Current synthetic preview' })
  const view = await compositeView(); const panel = await openRoutes(view)
  const model = panel.get('input[aria-label="admin.groups.compositeRoutes.preview"]')
  await model.setValue('first-model'); await model.trigger('keyup.enter'); await flushPromises()
  await model.setValue('second-model'); await model.trigger('keyup.enter'); await flushPromises()
  expect(panel.text()).toContain('Current synthetic preview')
  pending.resolve({ matched: false, source: 'detector', reason: 'Obsolete synthetic preview' }); await flushPromises()
  expect(panel.text()).toContain('Current synthetic preview'); expect(panel.text()).not.toContain('Obsolete synthetic preview')
  expect(previewCompositeRoute.mock.calls.map(call => call[1].model)).toEqual(['first-model', 'second-model'])
 })

 it('locks two native route create submissions to one command', async () => {
  const pending = deferred<unknown>(); createCompositeRoute.mockReturnValue(pending.promise)
  const view = await compositeView(); const panel = await openRoutes(view)
  await panel.get('#groups-composite-route-form-public-model').setValue('One route command')
  const form = panel.get('form').element
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
  expect(createCompositeRoute).toHaveBeenCalledTimes(1)
  pending.resolve({}); await flushPromises()
 })

 it('does not notify or reload routes when a previous route delete fails after unmount', async () => {
  listCompositeRoutes.mockResolvedValue([route(12, 'Route to remove')])
  const pending = deferred<unknown>(); deleteCompositeRoute.mockReturnValue(pending.promise)
  const view = await compositeView(); const panel = await openRoutes(view)
  await panel.get('button[title="common.delete"]').trigger('click'); await flushPromises()
  const loads = listCompositeRoutes.mock.calls.length
  view.unmount(); mounted.splice(mounted.indexOf(view), 1)
  pending.reject(new Error('Synthetic old delete failure')); await flushPromises()
  expect(listCompositeRoutes).toHaveBeenCalledTimes(loads); expect(showError).not.toHaveBeenCalled(); expect(showSuccess).not.toHaveBeenCalled()
 })
})
