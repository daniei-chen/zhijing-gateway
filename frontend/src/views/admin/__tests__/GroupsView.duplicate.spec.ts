import { defineComponent, h } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupsView from '@/views/admin/GroupsView.vue'
import { adminAPI } from '@/api/admin'

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
  allow_image_generation: false,
  allow_batch_image_generation: false,
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
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1,
  claude_code_only: false,
  fallback_group_id: null,
  fallback_group_id_on_invalid_request: null,
  allow_messages_dispatch: false,
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
  template: '<div><div v-for="row in data" :key="row.id"><slot name="cell-actions" :row="row" /></div></div>'
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
  setup(props, { emit }) {
    return () => h('select', { value: props.modelValue ?? '', onChange: (event: Event) => {
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
  template: '<section v-if="show" :data-dialog="title"><button @click="$emit(\'close\')">dialog-close</button><slot /><slot name="footer" /></section>'
})

const WorkflowConfirmStub = defineComponent({
  props: ['show', 'title', 'message'], emits: ['confirm', 'cancel'],
  template: '<aside v-if="show" :data-confirm="title"><p>{{ message }}</p><button @click="$emit(\'confirm\')">confirm</button><button @click="$emit(\'cancel\')">cancel</button></aside>'
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
        ConfirmDialog: workflows ? WorkflowConfirmStub : true,
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

describe('GroupsView duplicate action', () => {
  beforeEach(() => {
    authState.isSimpleMode = false
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const fn of [
      listGroups,
      duplicateGroup,
      updateGroup,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      showSuccess,
      showError
    ]) {
      fn.mockReset()
    }

    listGroups.mockResolvedValue({
      items: [sourceGroup],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    })
    duplicateGroup.mockResolvedValue({
      ...sourceGroup,
      id: 43,
      name: 'Primary (Copy)',
      status: 'inactive'
    })
    getModelAllowlistCandidates.mockResolvedValue([])
    getUsageSummary.mockResolvedValue([])
    getCapacitySummary.mockResolvedValue([])
    getLiveCapability.mockResolvedValue({ supported: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('duplicates the selected group, reports success, and refreshes the list', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="group-duplicate"]').trigger('click')
    await flushPromises()

    expect(duplicateGroup).toHaveBeenCalledTimes(1)
    expect(duplicateGroup).toHaveBeenCalledWith(42)
    expect(showSuccess).toHaveBeenCalledWith('admin.groups.duplicateSuccess')
    expect(listGroups).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('hides advanced group actions in simple mode', async () => {
    authState.isSimpleMode = true
    const compositeGroup = { ...sourceGroup, platform: 'composite' }
    listGroups.mockResolvedValueOnce({ items: [compositeGroup], total: 1, page: 1, page_size: 20, pages: 1 })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="group-duplicate"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="group-composite-routes"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="group-rate-multipliers"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="group-rpm-overrides"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores repeated clicks while the duplicate request is in flight', async () => {
    let resolveDuplicate!: (value: AdminGroup) => void
    duplicateGroup.mockImplementationOnce(
      () => new Promise<AdminGroup>((resolve) => { resolveDuplicate = resolve })
    )
    const wrapper = mountView()
    await flushPromises()

    const button = wrapper.get('[data-testid="group-duplicate"]')
    void button.trigger('click')
    void button.trigger('click')
    await wrapper.vm.$nextTick()

    expect(duplicateGroup).toHaveBeenCalledTimes(1)
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe('admin.groups.duplicating')

    resolveDuplicate({ ...sourceGroup, id: 43, name: 'Primary (Copy)', status: 'inactive' })
    await flushPromises()
    expect(wrapper.get('[data-testid="group-duplicate"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows the API error and restores the action when duplication fails', async () => {
    duplicateGroup.mockRejectedValueOnce(new Error('duplicate failed'))
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="group-duplicate"]').trigger('click')
    await flushPromises()

    expect(showError).toHaveBeenCalledWith('duplicate failed')
    expect(wrapper.get('[data-testid="group-duplicate"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not report a successful duplicate as failed when the refresh fails', async () => {
    listGroups
      .mockResolvedValueOnce({
        items: [sourceGroup],
        total: 1,
        page: 1,
        page_size: 20,
        pages: 1
      })
      .mockRejectedValueOnce(new Error('refresh failed'))
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="group-duplicate"]').trigger('click')
    await flushPromises()

    expect(showSuccess).toHaveBeenCalledWith('admin.groups.duplicateSuccess')
    expect(showError).toHaveBeenCalledWith('admin.groups.failedToLoad')
    expect(showError).not.toHaveBeenCalledWith('admin.groups.duplicateFailed')
    wrapper.unmount()
  })

  it('shows the standardized API message when updating a group fails', async () => {
    updateGroup.mockRejectedValueOnce({
      status: 409,
      code: 409,
      message: 'group name already exists',
      reason: 'GROUP_EXISTS'
    })
    const wrapper = mountView()
    await flushPromises()

    const editButton = wrapper.findAll('button').find((button) => button.text() === 'common.edit')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()
    await wrapper.get('#edit-group-form').trigger('submit')
    await flushPromises()

    expect(updateGroup).toHaveBeenCalledTimes(1)
    expect(showError).toHaveBeenCalledWith('group name already exists')
    wrapper.unmount()
  })

  it('loads, edits, and saves custom reasoning multipliers for group pricing', async () => {
    const group = {
      ...sourceGroup,
      model_pricing: [{
        platform: 'openai', models: ['example-model'], billing_mode: 'token',
        input_price: 3e-6, output_price: 15e-6, cache_write_price: null, cache_read_price: null,
        image_input_price: null, image_output_price: null, per_request_price: null,
        reasoning_effort_multipliers: { high: 1.5, max: 3 }, intervals: [], time_pricing: null,
      }],
    }
    listGroups.mockResolvedValue({ items: [group], total: 1, page: 1, page_size: 20, pages: 1 })
    updateGroup.mockResolvedValue(group)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'common.edit')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('[data-reasoning-effort="high"]').exists()).toBe(true))

    expect(wrapper.get<HTMLInputElement>('[data-reasoning-effort="high"]').element.value).toBe('1.5')
    await wrapper.get('[data-reasoning-effort="high"]').setValue('0.5')
    await wrapper.get('[data-reasoning-effort="max"]').setValue('')
    await wrapper.get('#edit-group-form').trigger('submit')
    await flushPromises()
    expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({
      model_pricing: [expect.objectContaining({ reasoning_effort_multipliers: { high: 0.5 } })],
    }))
    wrapper.unmount()
  })

  it('blocks saving an invalid group reasoning multiplier and allows clearing it', async () => {
    const group = {
      ...sourceGroup,
      model_pricing: [{
        platform: 'openai', models: ['example-model'], billing_mode: 'token',
        input_price: 3e-6, output_price: 15e-6, cache_write_price: null, cache_read_price: null,
        image_input_price: null, image_output_price: null, per_request_price: null,
        reasoning_effort_multipliers: { high: 1.5 }, intervals: [], time_pricing: null,
      }],
    }
    listGroups.mockResolvedValue({ items: [group], total: 1, page: 1, page_size: 20, pages: 1 })
    updateGroup.mockResolvedValue(group)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'common.edit')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('[data-reasoning-effort="high"]').exists()).toBe(true))

    await wrapper.get('[data-reasoning-effort="high"]').setValue('0')
    await wrapper.get('#edit-group-form').trigger('submit')
    expect(updateGroup).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('reasoningEffortMultiplierPositive'))

    await wrapper.get('[data-testid="reasoning-effort-multipliers"] button').trigger('click')
    await wrapper.get('#edit-group-form').trigger('submit')
    await flushPromises()
    expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({
      model_pricing: [expect.objectContaining({ reasoning_effort_multipliers: null })],
    }))
    wrapper.unmount()
  })

  it('updates manifest controls immediately and submits the displayed selection', async () => {
    vi.useFakeTimers()
    vi.mocked(adminAPI.accounts.list).mockResolvedValue({
      items: [{ id: 5, name: 'Manifest account' }]
    } as never)
    updateGroup.mockResolvedValue(sourceGroup)
    const wrapper = mountView()
    try {
      await flushPromises()
      const editButton = wrapper.findAll('button').find((button) => button.text() === 'common.edit')!
      await editButton.trigger('click')
      await flushPromises()

      const toggle = wrapper.get('[data-testid="codex-manifest-toggle"]')
      await toggle.trigger('click')
      expect(toggle.attributes('aria-checked')).toBe('true')
      const search = wrapper.get('[data-testid="codex-manifest-search"]')
      await search.trigger('focus')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(adminAPI.accounts.list).toHaveBeenCalledWith(
        1, 20, { search: '', platform: 'openai', group: '42' }, expect.anything()
      )
      await wrapper.get('[data-testid="codex-manifest-dropdown"] button').trigger('click')
      expect(wrapper.get('[data-testid="codex-manifest-selected-tags"]').text()).toContain('Manifest account')

      await wrapper.get('[aria-label="remove account 5"]').trigger('click')
      expect(wrapper.find('[data-testid="codex-manifest-selected-tags"]').exists()).toBe(false)
      await wrapper.get('#edit-group-form').trigger('submit')
      expect(updateGroup).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="codex-manifest-validation-error"]').exists()).toBe(true)

      await search.trigger('focus')
      await wrapper.get('[data-testid="codex-manifest-dropdown"] button').trigger('click')
      expect(wrapper.get('[data-testid="codex-manifest-selected-tags"]').text()).toContain('Manifest account')
      const fallback = wrapper.get('[data-testid="codex-manifest-fallback-toggle"]')
      await fallback.trigger('click')
      expect(fallback.attributes('aria-checked')).toBe('true')
      await fallback.trigger('click')
      expect(fallback.attributes('aria-checked')).toBe('false')
      await fallback.trigger('click')

      await toggle.trigger('click')
      expect(wrapper.find('[data-testid="codex-manifest-search"]').exists()).toBe(false)
      await toggle.trigger('click')
      expect(wrapper.get('[data-testid="codex-manifest-selected-tags"]').text()).toContain('Manifest account')
      await wrapper.get('#edit-group-form').trigger('submit')
      await flushPromises()
      expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({
        codex_models_manifest_config: {
          enabled: true, account_ids: [5], fallback_to_scheduler: true
        }
      }))

      // Reopening reads the saved group afresh, without retaining the prior draft.
      await editButton.trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="codex-manifest-toggle"]').attributes('aria-checked')).toBe('false')
      expect(wrapper.find('[data-testid="codex-manifest-search"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  describe('group workflows', () => {
    const mounted: ReturnType<typeof mountView>[] = []
    type Root = ReturnType<typeof mountView> | DOMWrapper<Element>
    const button = (root: Root, text: string) => {
      const result = root.findAll('button').find(node => node.text() === text)
      expect(result, `button ${text}`).toBeDefined()
      return result!
    }
    const control = (root: Root, text: string, selector = 'input, select, textarea, [role="switch"]') => {
      const label = root.findAll('label').find(node => node.text() === text)
      expect(label, `label ${text}`).toBeDefined()
      let parent: Element | null = label!.element
      while (parent && !parent.querySelector(selector)) parent = parent.parentElement
      expect(parent?.querySelector(selector), `control ${text}`).toBeTruthy()
      return new DOMWrapper(parent!.querySelector(selector)!)
    }
    const namedControl = (root: Root, text: string) => {
      const label = root.findAll<HTMLLabelElement>('label').find(node => node.text() === text)
      expect(label, text).toBeDefined()
      expect(label!.attributes('for'), text).toBeTruthy()
      expect(label!.element.control, text).toBeTruthy()
      return new DOMWrapper(label!.element.control!)
    }
    const mountWorkflow = () => {
      const wrapper = mountView(true)
      mounted.push(wrapper)
      return wrapper
    }
    const openCreate = async (wrapper: ReturnType<typeof mountView>) => {
      await button(wrapper, 'admin.groups.createGroup').trigger('click')
      await flushPromises()
      return wrapper.get('#create-group-form')
    }
    const openEdit = async (wrapper: ReturnType<typeof mountView>) => {
      await button(wrapper, 'common.edit').trigger('click')
      await flushPromises()
      return wrapper.get('#edit-group-form')
    }
    const submit = async (form: DOMWrapper<Element>) => {
      await form.trigger('submit')
      await flushPromises()
    }
    const choosePlatform = async (form: DOMWrapper<Element>, platform: string) => {
      await control(form, 'admin.groups.form.platform').setValue(platform)
      await flushPromises()
    }
    const setGroup = (overrides: Partial<AdminGroup>) => {
      listGroups.mockResolvedValue({ items: [{ ...sourceGroup, ...overrides }], total: 1, pages: 1 })
    }

    beforeEach(() => {
      for (const mock of [createGroup, getAllGroups, deleteGroup, updateSortOrder, listAccounts, getAccount,
        listCompositeRoutes, createCompositeRoute, updateCompositeRoute, deleteCompositeRoute, previewCompositeRoute]) mock.mockReset()
      createGroup.mockResolvedValue({ ...sourceGroup, id: 77 })
      updateGroup.mockResolvedValue(sourceGroup)
      getAllGroups.mockResolvedValue([sourceGroup])
      listAccounts.mockResolvedValue({ items: [{ id: 5, name: 'Synthetic Account' }] })
      getAccount.mockImplementation(async (id) => ({ id, name: `Account ${id}` }))
      deleteGroup.mockResolvedValue(undefined)
      updateSortOrder.mockResolvedValue(undefined)
      listCompositeRoutes.mockResolvedValue([])
      createCompositeRoute.mockResolvedValue(undefined)
      updateCompositeRoute.mockResolvedValue(undefined)
      deleteCompositeRoute.mockResolvedValue(undefined)
      previewCompositeRoute.mockResolvedValue({ matched: false, source: 'detector', reason: 'No matching route' })
    })

    afterEach(() => {
      mounted.splice(0).forEach(wrapper => wrapper.unmount())
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it.each(['create', 'edit'])('associates %s names, multipliers, RPM and quota labels with the submitted controls', async (mode) => {
      if (mode === 'edit') setGroup({ subscription_type: 'subscription' })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      await namedControl(form, 'admin.groups.form.name').setValue('Accessible Plan')
      if (mode === 'create') await namedControl(form, 'admin.groups.subscription.type').setValue('subscription')
      await namedControl(form, 'admin.groups.form.rateMultiplier').setValue('1.25')
      await namedControl(form, 'admin.groups.form.rpmLimit').setValue('45')
      await namedControl(form, 'admin.groups.subscription.dailyLimit').setValue('5')
      await namedControl(form, 'admin.groups.subscription.weeklyLimit').setValue('30')
      await namedControl(form, 'admin.groups.subscription.monthlyLimit').setValue('100')
      form.findAll<HTMLLabelElement>('label[for]').forEach(label => expect(label.element.control, label.text()).toBeTruthy())
      if (mode === 'edit') {
        expect(namedControl(form, 'admin.groups.form.platform').attributes('disabled')).toBeDefined()
        expect(namedControl(form, 'admin.groups.subscription.type').attributes('disabled')).toBeDefined()
      }
      await submit(form)
      expect((mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)).toEqual(expect.objectContaining({ name: 'Accessible Plan', rate_multiplier: 1.25, rpm_limit: 45, daily_limit_usd: 5, weekly_limit_usd: 30, monthly_limit_usd: 100 }))
    })

    it('uses the visible platform label for the real Select and supports keyboard selection before creating a group', async () => {
      const wrapper = mountView(true, true)
      mounted.push(wrapper)
      await flushPromises()
      const form = await openCreate(wrapper)
      await namedControl(form, 'admin.groups.form.name').setValue('Keyboard Group')
      const platform = namedControl(form, 'admin.groups.form.platform')
      expect(platform.element.tagName).toBe('BUTTON')
      expect(platform.attributes('aria-label')).toBeUndefined()
      await platform.trigger('keydown', { key: 'ArrowDown' })
      await flushPromises()
      const listbox = document.getElementById(platform.attributes('aria-controls')!)!
      expect(listbox).toBeTruthy()
      const dropdown = new DOMWrapper(listbox)
      await dropdown.trigger('keydown', { key: 'ArrowDown' })
      await dropdown.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(platform.text()).toContain('OpenAI')
      await submit(form)
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Keyboard Group', platform: 'openai' }))
    })

    it('keeps dynamic routing fields unique and correctly associated after removing and adding a rule', async () => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.modelRouting.title', '[role="switch"]').trigger('click')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      const patterns = () => form.findAll<HTMLInputElement>('[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]')
      await patterns()[1].setValue('keep-*')
      const preservedId = patterns()[1].attributes('id')
      await form.findAll('[title="admin.groups.modelRouting.removeRule"]')[0].trigger('click')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      expect(patterns()[0].attributes('id')).toBe(preservedId)
      expect(patterns()[0].element.value).toBe('keep-*')
      const ids = form.findAll('[id]').map(node => node.attributes('id'))
      expect(new Set(ids).size).toBe(ids.length)
      form.findAll<HTMLLabelElement>('label[for]').forEach(label => expect(label.element.control, label.text()).toBeTruthy())
    })

    it.each(['create', 'edit'])('resets %s batch-image pricing when image generation is disabled', async (mode) => {
      if (mode === 'edit') setGroup({ platform: 'gemini', allow_image_generation: true, allow_batch_image_generation: true, batch_image_discount_multiplier: 0.3, batch_image_hold_multiplier: 0.9 })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') {
        await namedControl(form, 'admin.groups.form.name').setValue('Image Plan')
        await choosePlatform(form, 'gemini')
        await control(form, 'admin.groups.imagePricing.allowBatchImageGeneration', 'input').setValue(true)
      }
      await namedControl(form, 'admin.groups.imagePricing.batchDiscountMultiplier').setValue('0.25')
      await namedControl(form, 'admin.groups.imagePricing.batchHoldMultiplier').setValue('0.8')
      await control(form, 'admin.groups.imagePricing.allowImageGeneration', 'input').setValue(false)
      expect(form.find('input[placeholder="0.5"]').exists()).toBe(false)
      await submit(form)
      expect((mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)).toEqual(expect.objectContaining({ allow_image_generation: false, allow_batch_image_generation: false, image_count_billing: false, batch_image_discount_multiplier: 0.5, batch_image_hold_multiplier: 0.6 }))
    })

    it.each(['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'deepseek', 'kimi', 'zhipu', 'minimax', 'opencode_go', 'composite'])(
      'creates a %s group from the platform selector with a disabled fixed-account manifest', async (platform) => {
        const wrapper = mountWorkflow()
        await flushPromises()
        const form = await openCreate(wrapper)
        await control(form, 'admin.groups.form.name').setValue(`Synthetic ${platform}`)
        await choosePlatform(form, platform)
        await submit(form)
        expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({
          name: `Synthetic ${platform}`, platform,
          codex_models_manifest_config: { enabled: false, account_ids: [], fallback_to_scheduler: false },
          profit_control_enabled: false,
        }))
        expect(showSuccess).toHaveBeenCalledWith('admin.groups.groupCreated')
        expect(wrapper.find('#create-group-form').exists()).toBe(false)
        expect(listGroups).toHaveBeenCalledTimes(2)
      }
    )

    it.each(['create', 'edit'])('rejects an empty %s name and permits saving after it is filled', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      const name = control(form, 'admin.groups.form.name')
      await name.setValue('  ')
      await submit(form)
      expect(createGroup).not.toHaveBeenCalled()
      expect(updateGroup).not.toHaveBeenCalled()
      expect(showError).toHaveBeenCalledWith('admin.groups.nameRequired')
      await name.setValue('Valid Group')
      await submit(form)
      expect(mode === 'create' ? createGroup : updateGroup).toHaveBeenCalledTimes(1)
    })

    it('clears the cancelled create draft, including routing enablement, before opening another group', async () => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Discard this')
      await control(form, 'admin.groups.modelRouting.title', '[role="switch"]').trigger('click')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      await form.get('[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]').setValue('claude-*')
      await button(wrapper, 'common.cancel').trigger('click')
      const reopened = await openCreate(wrapper)
      expect((control(reopened, 'admin.groups.form.name').element as HTMLInputElement).value).toBe('')
      expect(control(reopened, 'admin.groups.modelRouting.title', '[role="switch"]').attributes('aria-checked')).toBe('false')
      expect(reopened.find('[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]').exists()).toBe(false)
      expect(createGroup).not.toHaveBeenCalled()
    })

    it.each(['create', 'edit'])('retains a failed %s draft and retries the exact values', async (mode) => {
      const action = mode === 'create' ? createGroup : updateGroup
      action.mockRejectedValueOnce({ status: 409, message: 'Synthetic conflict' })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Retry Group')
      await submit(form)
      expect(showError).toHaveBeenCalledWith('Synthetic conflict')
      expect(form.exists()).toBe(true)
      expect((control(form, 'admin.groups.form.name').element as HTMLInputElement).value).toBe('Retry Group')
      expect(showSuccess).not.toHaveBeenCalled()
      await submit(form)
      expect(action).toHaveBeenCalledTimes(2)
      expect(action.mock.calls[1].at(-1)).toEqual(expect.objectContaining({ name: 'Retry Group' }))
      expect(wrapper.find(mode === 'create' ? '#create-group-form' : '#edit-group-form').exists()).toBe(false)
    })

    it.each(['create', 'edit'])('serializes subscription quotas, RPM, and peak pricing from the %s form', async (mode) => {
      if (mode === 'edit') setGroup({ subscription_type: 'subscription' })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Quota Plan')
      if (mode === 'create') await control(form, 'admin.groups.subscription.type').setValue('subscription')
      await control(form, 'admin.groups.subscription.dailyLimit').setValue('12.5')
      await control(form, 'admin.groups.subscription.weeklyLimit').setValue('0')
      await control(form, 'admin.groups.subscription.monthlyLimit').setValue('')
      await control(form, 'admin.groups.form.rpmLimit').setValue('90')
      await control(form, 'admin.groups.peakRate.enable', 'input').setValue(true)
      await control(form, 'admin.groups.peakRate.peakStart').setValue('09:30')
      await control(form, 'admin.groups.peakRate.peakEnd').setValue('19:00')
      await control(form, 'admin.groups.peakRate.peakMultiplier').setValue('1.75')
      await submit(form)
      const payload = (mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)
      expect(payload).toEqual(expect.objectContaining({ daily_limit_usd: 12.5, weekly_limit_usd: null, monthly_limit_usd: null, rpm_limit: 90,
        peak_rate_enabled: true, peak_start: '09:30', peak_end: '19:00', peak_rate_multiplier: 1.75 }))
      if (mode === 'create') expect(payload.is_exclusive).toBe(true)
    })

    it.each(['create'])('clears peak pricing when switching a %s subscription back to standard', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Standard Plan')
      await control(form, 'admin.groups.subscription.type').setValue('subscription')
      await control(form, 'admin.groups.peakRate.enable', 'input').setValue(true)
      await control(form, 'admin.groups.peakRate.peakStart').setValue('10:00')
      await control(form, 'admin.groups.peakRate.peakMultiplier').setValue('3')
      await control(form, 'admin.groups.subscription.type').setValue('standard')
      expect(form.find('input[type="time"]').exists()).toBe(false)
      await submit(form)
      expect((mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)).toEqual(expect.objectContaining({
        subscription_type: 'standard', peak_rate_enabled: false, peak_start: '', peak_end: '', peak_rate_multiplier: 1,
      }))
    })

    it.each(['create', 'edit'])('converts %s profit percentages to decimal API values', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Margin Group')
      await control(form, 'admin.groups.profitControl.enable', 'input').setValue(true)
      await control(form, 'admin.groups.profitControl.minMargin').setValue('20')
      await control(form, 'admin.groups.profitControl.safetyBuffer').setValue('5.5')
      await submit(form)
      const payload = (mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)
      expect(payload).toEqual(expect.objectContaining({ profit_control_enabled: true, profit_min_margin: 0.2, profit_safety_buffer: 0.055 }))
      expect(payload).not.toHaveProperty('profit_min_margin_percent')
      expect(payload).not.toHaveProperty('profit_safety_buffer_percent')
    })

    it.each(['create', 'edit'])('prevents %s profit margins of 100 percent and preserves the draft for correction', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Margin Group')
      await control(form, 'admin.groups.profitControl.enable', 'input').setValue(true)
      await control(form, 'admin.groups.profitControl.minMargin').setValue('100')
      await submit(form)
      expect(createGroup).not.toHaveBeenCalled()
      expect(updateGroup).not.toHaveBeenCalled()
      expect(showError).toHaveBeenCalledWith('admin.groups.profitControl.marginRangeError')
      await control(form, 'admin.groups.profitControl.minMargin').setValue('10')
      await submit(form)
      expect(mode === 'create' ? createGroup : updateGroup).toHaveBeenCalledTimes(1)
    })

    it.each(['create', 'edit'])('limits the %s payload to simple-mode fields', async (mode) => {
      authState.isSimpleMode = true
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Simple Group')
      await submit(form)
      const payload = (mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)
      expect(payload).toEqual(mode === 'create'
        ? { name: 'Simple Group', description: '', i18n: {}, platform: 'anthropic' }
        : { name: 'Simple Group', description: '', i18n: {} })
      expect(getLiveCapability).not.toHaveBeenCalled()
      expect(getCapacitySummary).not.toHaveBeenCalled()
    })

    it('loads saved routing account names, removes a route, and sends the remaining ordered mapping', async () => {
      setGroup({ platform: 'anthropic', model_routing_enabled: true, model_routing: { 'claude-*': [5], 'other-*': [6] } })
      getAccount.mockImplementation(async (id) => {
        if (id === 6) throw new Error('missing account')
        return { id, name: 'Routing Account' }
      })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openEdit(wrapper)
      expect(form.text()).toContain('Routing Account')
      expect(form.text()).toContain('#6')
      const rules = form.findAll('[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]')
      await rules[0].setValue(' claude-updated-* ')
      await form.findAll('[title="admin.groups.modelRouting.removeRule"]')[1].trigger('click')
      await submit(form)
      expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({ model_routing_enabled: true, model_routing: { 'claude-updated-*': [5] } }))
    })

    it('reopens the persisted edit values after cancelling unsaved changes', async () => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openEdit(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Unsaved rename')
      await button(wrapper, 'common.cancel').trigger('click')
      const reopened = await openEdit(wrapper)
      expect((control(reopened, 'admin.groups.form.name').element as HTMLInputElement).value).toBe('Primary')
      expect(updateGroup).not.toHaveBeenCalled()
    })

    it.each([true, false])('handles Live support=%s through the capability confirmation flow', async (supported) => {
      getLiveCapability.mockResolvedValue({ supported })
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Live Group')
      await choosePlatform(form, 'openai')
      await control(form, 'admin.groups.openaiLive.allow', '[role="switch"]').trigger('click')
      await flushPromises()
      if (!supported) {
        expect(control(form, 'admin.groups.openaiLive.allow', '[role="switch"]').attributes('aria-checked')).toBe('false')
        await wrapper.get('[data-confirm="admin.groups.openaiLive.unsupportedTitle"] button:last-child').trigger('click')
        expect(wrapper.find('[data-confirm="admin.groups.openaiLive.unsupportedTitle"]').exists()).toBe(false)
        await control(form, 'admin.groups.openaiLive.allow', '[role="switch"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-confirm="admin.groups.openaiLive.unsupportedTitle"] button').trigger('click')
      }
      expect(control(form, 'admin.groups.openaiLive.allow', '[role="switch"]').attributes('aria-checked')).toBe('true')
      await submit(form)
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ allow_live: true }))
      expect(getLiveCapability).toHaveBeenCalledTimes(1)
    })

    it('does not carry OpenAI-only switches and messages mappings when the platform changes to Grok', async () => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Changed Platform')
      await choosePlatform(form, 'openai')
      await form.get('[data-testid="create-force-openai-fast"]').trigger('click')
      await form.get('[data-testid="create-free-openai-fast"]').trigger('click')
      await control(form, 'admin.groups.openaiMessages.allowDispatch', '[role="switch"]').trigger('click')
      await form.get('[placeholder="admin.groups.openaiMessages.opusModelPlaceholder"]').setValue('mapped-opus')
      await choosePlatform(form, 'grok')
      expect(form.find('[data-testid="create-force-openai-fast"]').exists()).toBe(false)
      await submit(form)
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ platform: 'grok', force_openai_fast: false, free_openai_fast: false,
        allow_messages_dispatch: false, allow_live: false, require_oauth_only: false, require_privacy_set: false, messages_dispatch_model_config: undefined }))
    })

    it('debounces a trimmed group search, resets pagination, and ignores an outdated response', async () => {
      vi.useFakeTimers()
      let resolveFirst!: (result: unknown) => void
      listGroups.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      const wrapper = mountWorkflow()
      await flushPromises()
      await wrapper.get('[placeholder="admin.groups.searchGroups"]').setValue('  target  ')
      await vi.advanceTimersByTimeAsync(299)
      expect(listGroups).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      expect(listGroups).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ search: 'target' }), expect.anything())
      expect(listGroups.mock.calls[0][3].signal.aborted).toBe(true)
      resolveFirst({ items: [], total: 0, pages: 0 })
      await flushPromises()
      expect(wrapper.find('[data-testid="group-duplicate"]').exists()).toBe(true)
      expect(showError).not.toHaveBeenCalled()
    })

    it('applies status, platform, and exclusivity filters to the list request', async () => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const selects = wrapper.findAll('select')
      await selects[0].setValue('openai')
      await selects[1].setValue('inactive')
      await selects[2].setValue('true')
      await flushPromises()
      expect(listGroups).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ platform: 'openai', status: 'inactive', is_exclusive: true }), expect.anything())
    })

    it('confirms deletion of a subscription group, retains a failed confirmation, and retries', async () => {
      setGroup({ subscription_type: 'subscription' })
      deleteGroup.mockRejectedValueOnce({ response: { data: { detail: 'Synthetic deletion error' } } })
      const wrapper = mountWorkflow()
      await flushPromises()
      await button(wrapper, 'common.delete').trigger('click')
      const confirmation = wrapper.get('aside[data-confirm]')
      expect(confirmation.text()).toContain('admin.groups.deleteConfirmSubscription')
      await button(confirmation, 'confirm').trigger('click')
      await flushPromises()
      expect(showError).toHaveBeenCalledWith('Synthetic deletion error')
      expect(wrapper.find('aside[data-confirm]').exists()).toBe(true)
      await button(confirmation, 'confirm').trigger('click')
      await flushPromises()
      expect(deleteGroup).toHaveBeenCalledWith(42)
      expect(showSuccess).toHaveBeenCalledWith('admin.groups.groupDeleted')
      expect(wrapper.find('aside[data-confirm]').exists()).toBe(false)
      expect(listGroups).toHaveBeenCalledTimes(2)
    })

    it('loads the complete sort list, normalizes order, and retries a failed order update', async () => {
      getAllGroups.mockResolvedValue([{ ...sourceGroup, id: 2, sort_order: 20 }, { ...sourceGroup, id: 1, sort_order: 10 }])
      updateSortOrder.mockRejectedValueOnce({ response: { data: { detail: 'Synthetic sort error' } } })
      const wrapper = mountWorkflow()
      await flushPromises()
      await button(wrapper, 'admin.groups.sortOrder').trigger('click')
      await flushPromises()
      await button(wrapper, 'common.save').trigger('click')
      await flushPromises()
      expect(updateSortOrder).toHaveBeenCalledWith([{ id: 1, sort_order: 0 }, { id: 2, sort_order: 10 }])
      expect(showError).toHaveBeenCalledWith('Synthetic sort error')
      expect(wrapper.find('[data-dialog="admin.groups.sortOrder"]').exists()).toBe(true)
      await button(wrapper, 'common.save').trigger('click')
      await flushPromises()
      expect(showSuccess).toHaveBeenCalledWith('admin.groups.sortOrderUpdated')
      expect(wrapper.find('[data-dialog="admin.groups.sortOrder"]').exists()).toBe(false)
    })

    it('does not apply routing accounts from an earlier edit request to a newly selected group', async () => {
      let resolveAccount!: (result: { id: number; name: string }) => void
      getAccount.mockImplementationOnce(() => new Promise(resolve => { resolveAccount = resolve }))
      listGroups.mockResolvedValue({ items: [
        { ...sourceGroup, id: 41, platform: 'anthropic', model_routing_enabled: true, model_routing: { 'old-*': [5] } },
        { ...sourceGroup, id: 42, platform: 'anthropic', model_routing_enabled: false, model_routing: null },
      ], total: 2, pages: 1 })
      const wrapper = mountWorkflow()
      await flushPromises()
      const editButtons = wrapper.findAll('button').filter(node => node.text() === 'common.edit')
      await editButtons[0].trigger('click')
      await editButtons[1].trigger('click')
      await flushPromises()
      resolveAccount({ id: 5, name: 'Old Account' })
      await flushPromises()
      await submit(wrapper.get('#edit-group-form'))
      expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({ model_routing: null }))
    })

    it.each(['create', 'edit'])('enforces a nonempty %s allowlist and submits the added wildcard', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Allowlist Group')
      await control(form, 'admin.groups.modelAllowlist.title', '[role="switch"]').trigger('click')
      await submit(form)
      expect(createGroup).not.toHaveBeenCalled()
      expect(updateGroup).not.toHaveBeenCalled()
      expect(showError).toHaveBeenCalledWith('admin.groups.modelAllowlist.emptySelectionError')
      const custom = form.get('[placeholder="admin.groups.modelAllowlist.customPlaceholder"]')
      await custom.setValue('  custom-*  ')
      await custom.trigger('keydown', { key: 'Enter' })
      await submit(form)
      expect((mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)).toEqual(expect.objectContaining({
        model_allowlist: { enabled: true, models: ['custom-*'] },
      }))
    })

    it('preserves allowlist selection and order after moving candidates and inverting twice', async () => {
      getModelAllowlistCandidates.mockResolvedValue(['model-a', 'model-b'])
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Ordered Models')
      await control(form, 'admin.groups.modelAllowlist.title', '[role="switch"]').trigger('click')
      const item = form.findAll('span').find(node => node.text() === 'model-b')!
      const row = new DOMWrapper(item.element.parentElement!)
      await row.findAll('button')[0].trigger('click')
      await button(form, 'admin.groups.modelAllowlist.invertSelection').trigger('click')
      await button(form, 'admin.groups.modelAllowlist.invertSelection').trigger('click')
      await submit(form)
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ model_allowlist: { enabled: true, models: ['model-b', 'model-a'] } }))
    })

    it('creates an account routing rule from debounced account search and omits an incomplete rule', async () => {
      vi.useFakeTimers()
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openCreate(wrapper)
      await control(form, 'admin.groups.form.name').setValue('Routed Group')
      await control(form, 'admin.groups.modelRouting.title', '[role="switch"]').trigger('click')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      await form.get('[placeholder="admin.groups.modelRouting.modelPatternPlaceholder"]').setValue('  claude-*  ')
      const search = form.get('[placeholder="admin.groups.modelRouting.searchAccountPlaceholder"]')
      await search.trigger('focus')
      await search.setValue('Synthetic')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(listAccounts).toHaveBeenCalledWith(1, 20, { search: 'Synthetic', platform: 'anthropic' }, expect.anything())
      const result = form.findAll('button').find(node => node.text().includes('Synthetic Account'))!
      await result.trigger('click')
      expect((search.element as HTMLInputElement).value).toBe('')
      await button(form, 'admin.groups.modelRouting.addRule').trigger('click')
      await submit(form)
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ model_routing: { 'claude-*': [5] }, model_routing_enabled: true }))
    })

    it.each(['create', 'edit'])('submits %s token prices in per-token units and omits an empty pricing card', async (mode) => {
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = mode === 'create' ? await openCreate(wrapper) : await openEdit(wrapper)
      if (mode === 'create') await control(form, 'admin.groups.form.name').setValue('Priced Group')
      await button(form, 'admin.groups.modelPricing.add').trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(form.find('[placeholder="admin.channels.form.modelsPlaceholder"]').exists()).toBe(true))
      const model = form.get('[placeholder="admin.channels.form.modelsPlaceholder"]')
      await model.setValue('synthetic-model')
      await model.trigger('keydown', { key: 'Enter' })
      await control(form, 'admin.channels.form.inputPrice').setValue('3')
      await control(form, 'admin.channels.form.outputPrice').setValue('15')
      await button(form, 'admin.groups.modelPricing.add').trigger('click')
      await submit(form)
      const payload = (mode === 'create' ? createGroup : updateGroup).mock.calls[0].at(-1)
      expect(payload.model_pricing).toHaveLength(1)
      expect(payload.model_pricing[0]).toEqual(expect.objectContaining({ models: ['synthetic-model'], billing_mode: 'token', input_price: 0.000003, output_price: 0.000015, intervals: [], time_pricing: null }))
    })

    it('uses explicit clear sentinels when an edited Grok media price is emptied', async () => {
      setGroup({ platform: 'grok', search_price_per_1k: 4, audio_realtime_price_per_min: 0.5, audio_tts_price_per_million_chars: 25, audio_stt_price_per_hour: 1 } as Partial<AdminGroup>)
      const wrapper = mountWorkflow()
      await flushPromises()
      const form = await openEdit(wrapper)
      for (const name of ['search', 'audio-realtime', 'audio-tts', 'audio-stt']) {
        const price = form.get(`[data-testid="edit-${name}-price"]`)
        expect((price.element as HTMLInputElement).value).not.toBe('')
        await price.setValue('')
      }
      await submit(form)
      expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({ search_price_per_1k: -1, audio_realtime_price_per_min: -1, audio_tts_price_per_million_chars: -1, audio_stt_price_per_hour: -1 }))
    })

    describe('composite routes', () => {
      const route = { id: 7, group_id: 42, public_model: 'public-model', match_type: 'exact', target_platform: 'openai', upstream_model: 'upstream-model', endpoint: 'any', priority: 30, enabled: true, notes: 'Original note' }
      const openRoutes = async (wrapper: ReturnType<typeof mountView>) => {
        await wrapper.get('[data-testid="group-composite-routes"]').trigger('click')
        await flushPromises()
        return wrapper.get('[data-dialog="admin.groups.compositeRoutes.titleWithGroup"]')
      }
      beforeEach(() => { setGroup({ platform: 'composite' }) })

      it('sorts routes by priority and ID, and displays disabled routes and target fallbacks', async () => {
        listCompositeRoutes.mockResolvedValue([
          { ...route, id: 9, public_model: 'last', priority: 90 },
          { ...route, id: 8, public_model: 'second', priority: 30, enabled: false, upstream_model: '' },
          { ...route, id: 7, public_model: 'first', priority: 30 },
        ])
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        const rows = dialog.findAll('tbody tr')
        expect(rows.map(node => node.get('td').text())).toEqual([
          expect.stringContaining('first'), expect.stringContaining('second'), expect.stringContaining('last'),
        ])
        expect(rows[1].classes()).toContain('opacity-60')
        expect(rows[1].text()).toContain('admin.accounts.status.inactive')
        expect(rows[1].findAll('td')[1].text()).toContain('second')
      })

      it('validates a public model, retains a failed route draft, and retries with trimmed fields', async () => {
        createCompositeRoute.mockRejectedValueOnce({ response: { data: { message: 'Synthetic route failure' } } })
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        const form = dialog.get('form')
        await submit(form)
        expect(createCompositeRoute).not.toHaveBeenCalled()
        expect(showError).toHaveBeenCalledWith('admin.groups.compositeRoutes.publicModelRequired')
        await control(form, 'admin.groups.compositeRoutes.publicModel').setValue(' public-* ')
        await control(form, 'admin.groups.compositeRoutes.matchType').setValue('prefix')
        await control(form, 'admin.groups.compositeRoutes.targetPlatform').setValue('deepseek')
        await control(form, 'admin.groups.compositeRoutes.upstreamModel').setValue(' upstream-model ')
        await control(form, 'admin.groups.compositeRoutes.endpoint').setValue('responses')
        await control(form, 'admin.groups.compositeRoutes.priority').setValue('12')
        await control(form, 'admin.groups.compositeRoutes.notes').setValue(' Synthetic note ')
        await submit(form)
        expect(createCompositeRoute).toHaveBeenCalledWith(42, { public_model: 'public-*', match_type: 'prefix', target_platform: 'deepseek', upstream_model: 'upstream-model', endpoint: 'responses', priority: 12, enabled: true, notes: 'Synthetic note' })
        expect(showError).toHaveBeenCalledWith('Synthetic route failure')
        expect((control(form, 'admin.groups.compositeRoutes.publicModel').element as HTMLInputElement).value).toBe('public-*')
        await submit(form)
        expect(createCompositeRoute).toHaveBeenCalledTimes(2)
        expect(showSuccess).toHaveBeenCalledWith('admin.groups.compositeRoutes.routeCreated')
        expect((control(form, 'admin.groups.compositeRoutes.publicModel').element as HTMLInputElement).value).toBe('')
        expect(listCompositeRoutes).toHaveBeenCalledTimes(2)
      })

      it('edits a saved route and cancels the editor back to create mode', async () => {
        listCompositeRoutes.mockResolvedValue([route])
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        await dialog.get('[title="common.edit"]').trigger('click')
        const form = dialog.get('form')
        expect((control(form, 'admin.groups.compositeRoutes.upstreamModel').element as HTMLInputElement).value).toBe('upstream-model')
        await control(form, 'admin.groups.compositeRoutes.upstreamModel').setValue('updated-model')
        await submit(form)
        expect(updateCompositeRoute).toHaveBeenCalledWith(42, 7, expect.objectContaining({ upstream_model: 'updated-model' }))
        expect(showSuccess).toHaveBeenCalledWith('admin.groups.compositeRoutes.routeUpdated')
        await dialog.get('[title="common.edit"]').trigger('click')
        await button(form, 'common.cancel').trigger('click')
        expect(form.text()).toContain('admin.groups.compositeRoutes.addRoute')
        expect((control(form, 'admin.groups.compositeRoutes.publicModel').element as HTMLInputElement).value).toBe('')
      })

      it('requires deletion confirmation and clears the editor when its route is deleted', async () => {
        listCompositeRoutes.mockResolvedValue([route])
        const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
        vi.stubGlobal('confirm', confirm)
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        await dialog.get('[title="common.edit"]').trigger('click')
        await dialog.get('[title="common.delete"]').trigger('click')
        await flushPromises()
        expect(deleteCompositeRoute).not.toHaveBeenCalled()
        await dialog.get('[title="common.delete"]').trigger('click')
        await flushPromises()
        expect(deleteCompositeRoute).toHaveBeenCalledWith(42, 7)
        expect(showSuccess).toHaveBeenCalledWith('admin.groups.compositeRoutes.routeDeleted')
        expect(dialog.get('form').text()).toContain('admin.groups.compositeRoutes.addRoute')
      })

      it.each(['list', 'update', 'delete', 'preview'])('reports a composite %s failure and retains the open dialog', async (operation) => {
        listCompositeRoutes.mockResolvedValue([route])
        const failing = { list: listCompositeRoutes, update: updateCompositeRoute, delete: deleteCompositeRoute, preview: previewCompositeRoute }[operation as 'list' | 'update' | 'delete' | 'preview']
        failing.mockRejectedValueOnce({ response: { data: { detail: 'Synthetic composite failure' } } })
        vi.stubGlobal('confirm', vi.fn(() => true))
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        if (operation === 'update') {
          await dialog.get('[title="common.edit"]').trigger('click')
          await submit(dialog.get('form'))
        } else if (operation === 'delete') {
          await dialog.get('[title="common.delete"]').trigger('click')
        } else if (operation === 'preview') {
          const preview = dialog.findAll('input[placeholder="openrouter/gpt-5"]')[1]
          await preview.setValue('synthetic-model')
          await preview.trigger('keyup', { key: 'Enter' })
        }
        await flushPromises()
        expect(showError).toHaveBeenCalledWith('Synthetic composite failure')
        expect(wrapper.find('[data-dialog="admin.groups.compositeRoutes.titleWithGroup"]').exists()).toBe(true)
      })

      it.each([true, false])('previews a model route (matched=%s) and clears the result when reopened', async (matched) => {
        previewCompositeRoute.mockResolvedValue({ matched, source: 'route', target_platform: 'deepseek', upstream_model: 'mapped-model', reason: 'No matching route' })
        const wrapper = mountWorkflow()
        await flushPromises()
        const dialog = await openRoutes(wrapper)
        const preview = dialog.findAll('input[placeholder="openrouter/gpt-5"]')[1]
        await preview.setValue('  synthetic-model  ')
        await preview.trigger('keyup', { key: 'Enter' })
        await flushPromises()
        expect(previewCompositeRoute).toHaveBeenCalledWith(42, { model: 'synthetic-model', endpoint: 'any' })
        expect(dialog.text()).toContain(matched ? 'mapped-model' : 'No matching route')
        await button(dialog, 'dialog-close').trigger('click')
        const reopened = await openRoutes(wrapper)
        expect(reopened.text()).not.toContain(matched ? 'mapped-model' : 'No matching route')
        expect(reopened.findAll<HTMLInputElement>('input[placeholder="openrouter/gpt-5"]')[1].element.value).toBe('')
      })
    })
  })

})
