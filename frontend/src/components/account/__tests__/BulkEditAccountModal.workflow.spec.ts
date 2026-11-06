import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import BulkEditAccountModal from '../BulkEditAccountModal.vue'

const { bulkUpdate, checkRisk, showError, showSuccess } = vi.hoisted(() => ({
  bulkUpdate: vi.fn(), checkRisk: vi.fn(), showError: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: { accounts: { bulkUpdate, checkMixedChannelRisk: checkRisk } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess, showInfo: vi.fn() }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

const Dialog = defineComponent({
  props: ['show'], emits: ['close'],
  template: '<div v-if="show"><button data-testid="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>'
})
const Confirm = defineComponent({
  props: ['show', 'message'], emits: ['confirm', 'cancel'],
  template: '<div v-if="show" data-testid="risk-dialog">{{ message }}<button data-testid="confirm" @click="$emit(\'confirm\')">confirm</button><button data-testid="cancel-risk" @click="$emit(\'cancel\')">cancel</button></div>'
})
const Select = defineComponent({
  props: ['modelValue', 'options'], emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>'
})
const GroupSelector = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  template: '<button type="button" data-testid="set-groups" @click="$emit(\'update:modelValue\', [7])">groups</button>'
})
const ProxySelector = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  template: '<select data-testid="proxy" :value="modelValue ?? \'\'" @change="$emit(\'update:modelValue\', $event.target.value === \'\' ? null : Number($event.target.value))"><option value="">none</option><option value="9">proxy</option></select>'
})
const wrappers: VueWrapper[] = []
function modal(props: Record<string, unknown> = {}) {
  const wrapper = mount(BulkEditAccountModal, {
    props: { show: true, accountIds: [1, 2], selectedPlatforms: ['anthropic'], selectedTypes: ['apikey'], groups: [], proxies: [], ...props } as any,
    global: { stubs: { BaseDialog: Dialog, ConfirmDialog: Confirm, Select, GroupSelector, ProxySelector, Icon: true, ModelWhitelistSelector: true } }
  })
  wrappers.push(wrapper)
  return wrapper
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
async function clickText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === text)
  expect(button).toBeDefined()
  await button!.trigger('click')
}
beforeEach(() => {
  vi.clearAllMocks()
  bulkUpdate.mockReset().mockResolvedValue({ success: 2, failed: 0, results: [] })
  checkRisk.mockReset().mockResolvedValue({ has_risk: false })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('BulkEditAccountModal workflow', () => {
  it('disables inactive edit bodies for keyboard input until their edit checkbox is selected', async () => {
    const wrapper = modal({ selectedPlatforms: ['openai'], selectedTypes: ['oauth'] })
    const toggle = wrapper.get('#bulk-edit-openai-passthrough-toggle')
    expect(toggle.element.matches(':disabled')).toBe(true)
    await wrapper.get('#bulk-edit-openai-passthrough-enabled').setValue(true)
    expect(toggle.element.matches(':disabled')).toBe(false)
    await toggle.trigger('click')
    await submit(wrapper)
    expect(bulkUpdate.mock.calls[0][1]).toMatchObject({ extra: { openai_passthrough: true } })
  })
  it('names each passthrough switch and exposes its selected state', async () => {
    const wrapper = modal({ selectedPlatforms: ['openai'], selectedTypes: ['oauth'] })
    const toggle = wrapper.get('#bulk-edit-openai-passthrough-toggle')
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('admin.accounts.openai.oauthPassthrough')
    await wrapper.get('#bulk-edit-openai-passthrough-enabled').setValue(true)
    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('true')
  })

  it('keeps unique compact mapping IDs after removing a row and submits the remaining mapping', async () => {
    const wrapper = modal({ selectedPlatforms: ['openai'], selectedTypes: ['oauth'] })
    await wrapper.get('#bulk-edit-openai-compact-model-mapping-enabled').setValue(true)
    await wrapper.get('[data-testid="bulk-edit-openai-compact-model-mapping-add"]').trigger('click')
    await wrapper.get('[data-testid="bulk-edit-openai-compact-model-mapping-add"]').trigger('click')
    let inputs = wrapper.findAll('[data-testid="bulk-edit-openai-compact-model-mapping-input"]')
    expect(inputs).toHaveLength(4)
    expect(new Set(inputs.map(input => input.attributes('id'))).size).toBe(4)
    await inputs[0].setValue('discard')
    await inputs[1].setValue('old-target')
    await inputs[2].setValue('keep')
    await inputs[3].setValue('new-target')
    const remainingIDs = inputs.slice(2).map(input => input.attributes('id'))
    const remove = inputs[0].element.parentElement!.querySelector('button')!
    expect(remove.getAttribute('aria-label')).toBeTruthy()
    await new DOMWrapper(remove).trigger('click')
    inputs = wrapper.findAll('[data-testid="bulk-edit-openai-compact-model-mapping-input"]')
    expect(inputs.map(input => input.attributes('id'))).toEqual(remainingIDs)
    await submit(wrapper)
    expect(bulkUpdate.mock.calls[0][1]).toMatchObject({ credentials: { compact_model_mapping: { keep: 'new-target' } } })
  })
  it.each([
    [{ accountIds: [] }, 'admin.accounts.bulkEdit.noSelection'],
    [{}, 'admin.accounts.bulkEdit.noFieldsSelected']
  ])('rejects an unusable selection or empty edit', async (props, error) => {
    await submit(modal(props))
    expect(showError).toHaveBeenCalledWith(error)
    expect(bulkUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['concurrency', '6', { concurrency: 6 }],
    ['load-factor', '', { load_factor: 0 }],
    ['load-factor', '-1', { load_factor: 0 }],
    ['load-factor', '2.5', { load_factor: 2.5 }],
    ['priority', '3', { priority: 3 }],
    ['rate-multiplier', '0.8', { rate_multiplier: 0.8 }],
    ['base-url', '  https://synthetic.example/v1  ', { credentials: { base_url: 'https://synthetic.example/v1' } }]
  ])('submits only the selected %s edit', async (field, value, payload) => {
    const wrapper = modal()
    await wrapper.get(`#bulk-edit-${field}-enabled`).setValue(true)
    await wrapper.get(`#bulk-edit-${field}`).setValue(value)
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], payload)
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('allows clearing the proxy and assigning groups in one explicit edit', async () => {
    const wrapper = modal()
    await wrapper.get('#bulk-edit-proxy-enabled').setValue(true)
    await wrapper.get('[data-testid="proxy"]').setValue('9')
    await wrapper.get('[data-testid="proxy"]').setValue('')
    await wrapper.get('#bulk-edit-groups-enabled').setValue(true)
    await wrapper.get('[data-testid="set-groups"]').trigger('click')
    await submit(wrapper)
    expect(checkRisk).toHaveBeenCalledExactlyOnceWith({ platform: 'anthropic', group_ids: [7] })
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], { proxy_id: 0, group_ids: [7] })
  })

  it('rejects malformed base URLs and permits correcting the same draft', async () => {
    const wrapper = modal()
    await wrapper.get('#bulk-edit-base-url-enabled').setValue(true)
    await wrapper.get('#bulk-edit-base-url').setValue('ftp://synthetic.example')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.accounts.grokCustomBaseUrl.invalid')
    expect(bulkUpdate).not.toHaveBeenCalled()
    await wrapper.get('#bulk-edit-base-url').setValue('https://synthetic.example')
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], { credentials: { base_url: 'https://synthetic.example' } })
  })

  it('does not send an empty base URL as an accidental reset', async () => {
    const wrapper = modal()
    await wrapper.get('#bulk-edit-base-url-enabled').setValue(true)
    await submit(wrapper)
    expect(bulkUpdate).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith('admin.accounts.bulkEdit.noFieldsSelected')
  })

  it('requires a nonempty header replacement, then saves a validated row', async () => {
    const wrapper = modal()
    await wrapper.get('#bulk-edit-header-override-enabled').setValue(true)
    await wrapper.get('#bulk-edit-header-override-body > button').trigger('click')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.accounts.headerOverride.bulkEmptyRows')
    expect(bulkUpdate).not.toHaveBeenCalled()
    await clickText(wrapper, 'admin.accounts.headerOverride.addRow')
    await wrapper.get('input[placeholder="admin.accounts.headerOverride.namePlaceholder"]').setValue('X-Synthetic-Trace')
    await wrapper.get('input[placeholder="admin.accounts.headerOverride.valuePlaceholder"]').setValue('fixed')
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledWith([1, 2], { credentials: { header_override_enabled: true, header_overrides: { 'x-synthetic-trace': 'fixed' } } })
  })

  it('explicitly clears headers when replacement is disabled', async () => {
    const wrapper = modal()
    await wrapper.get('#bulk-edit-header-override-enabled').setValue(true)
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledWith([1, 2], { credentials: { header_override_enabled: false, header_overrides: {} } })
  })

  it('preserves a draft across a failed write and retries once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    bulkUpdate.mockRejectedValueOnce({ message: 'synthetic unavailable' })
    const wrapper = modal()
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await wrapper.get('#bulk-edit-status select').setValue('inactive')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic unavailable')
    expect(wrapper.emitted('close')).toBeUndefined()
    await submit(wrapper)
    expect(bulkUpdate.mock.calls).toEqual([[[1, 2], { status: 'inactive' }], [[1, 2], { status: 'inactive' }]])
    expect(wrapper.emitted('updated')).toHaveLength(1)
    error.mockRestore()
  })

  it.each([
    [{ success: 0, failed: 2 }, 'admin.accounts.bulkEdit.failed', false],
    [{ success: 1, failed: 1 }, 'admin.accounts.bulkEdit.partialSuccess', true]
  ])('reports zero or partial success and refreshes only changed rows', async (result, message, closed) => {
    bulkUpdate.mockResolvedValueOnce(result)
    const wrapper = modal()
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith(message)
    expect(Boolean(wrapper.emitted('updated'))).toBe(closed)
    expect(Boolean(wrapper.emitted('close'))).toBe(closed)
  })

  it('waits for mixed-channel consent and supports cancellation before a fresh submission', async () => {
    checkRisk.mockResolvedValue({ has_risk: true, message: 'synthetic mixed risk' })
    const wrapper = modal()
    await wrapper.get('#bulk-edit-groups-enabled').setValue(true)
    await wrapper.get('[data-testid="set-groups"]').trigger('click')
    await submit(wrapper)
    expect(wrapper.get('[data-testid="risk-dialog"]').text()).toContain('synthetic mixed risk')
    expect(bulkUpdate).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="cancel-risk"]').trigger('click')
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(false)
    await submit(wrapper)
    expect(checkRisk).toHaveBeenCalledTimes(2)
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], { group_ids: [7], confirm_mixed_channel_risk: true })
  })

  it('retries a server mixed-channel warning only after explicit confirmation', async () => {
    bulkUpdate.mockRejectedValueOnce({ status: 409, error: 'mixed_channel_warning', message: 'server risk' })
    const wrapper = modal({ selectedPlatforms: ['anthropic', 'antigravity'] })
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await submit(wrapper)
    expect(checkRisk).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="risk-dialog"]').text()).toContain('server risk')
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()
    expect(bulkUpdate).toHaveBeenNthCalledWith(1, [1, 2], { status: 'active' })
    expect(bulkUpdate).toHaveBeenNthCalledWith(2, [1, 2], { status: 'active', confirm_mixed_channel_risk: true })
  })

  it('keeps a precheck error retryable without sending a write', async () => {
    checkRisk.mockRejectedValueOnce({ message: 'precheck unavailable' })
    const wrapper = modal()
    await wrapper.get('#bulk-edit-groups-enabled').setValue(true)
    await wrapper.get('[data-testid="set-groups"]').trigger('click')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('precheck unavailable')
    expect(bulkUpdate).not.toHaveBeenCalled()
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], { group_ids: [7] })
  })

  it('prevents duplicate writes while a bulk save is pending', async () => {
    const request = deferred<any>()
    bulkUpdate.mockReturnValueOnce(request.promise)
    const wrapper = modal()
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await submit(wrapper)
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledTimes(1)
    request.resolve({ success: 2, failed: 0 })
    await flushPromises()
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it.each(['close', 'selection', 'filtered-target', 'unmount'])('discards a precheck result after %s', async (change) => {
    const request = deferred<any>()
    checkRisk.mockReturnValueOnce(request.promise)
    const wrapper = modal()
    await wrapper.get('#bulk-edit-groups-enabled').setValue(true)
    await wrapper.get('[data-testid="set-groups"]').trigger('click')
    await submit(wrapper)
    if (change === 'close') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'selection') await wrapper.setProps({ accountIds: [9] })
    if (change === 'filtered-target') await wrapper.setProps({ target: { mode: 'filtered', filters: { platform: 'anthropic', search: 'new-target' }, previewCount: 9, selectedPlatforms: ['anthropic'], selectedTypes: ['apikey'] } } as any)
    if (change === 'unmount') wrapper.unmount()
    request.resolve({ has_risk: false })
    await flushPromises()
    expect(bulkUpdate).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['success', 'error', 'risk'])('does not let an old %s response affect a reopened editor', async (outcome) => {
    const request = deferred<any>()
    bulkUpdate.mockReturnValueOnce(request.promise)
    const wrapper = modal()
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await submit(wrapper)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await wrapper.get('#bulk-edit-priority-enabled').setValue(true)
    await wrapper.get('#bulk-edit-priority').setValue('4')
    if (outcome === 'success') request.resolve({ success: 2, failed: 0 })
    else request.reject(outcome === 'risk' ? { status: 409, error: 'mixed_channel_warning', message: 'old risk' } : { message: 'old failure' })
    await flushPromises()
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(false)
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenLastCalledWith([1, 2], { priority: 4 })
  })

  it('omits all provider settings when the target changes to an incompatible platform', async () => {
    const wrapper = modal({ selectedPlatforms: ['openai'], selectedTypes: ['oauth'] })
    for (const field of ['openai-passthrough', 'openai-ws-mode', 'openai-codex-cli-only', 'openai-codex-fingerprint-mode', 'openai-compact-mode', 'openai-compact-model-mapping']) {
      await wrapper.get(`#bulk-edit-${field}-enabled`).setValue(true)
    }
    await wrapper.setProps({ selectedPlatforms: ['anthropic'], selectedTypes: ['apikey'] })
    await wrapper.get('#bulk-edit-status-enabled').setValue(true)
    await submit(wrapper)
    expect(bulkUpdate).toHaveBeenCalledExactlyOnceWith([1, 2], { status: 'active' })
  })
})
