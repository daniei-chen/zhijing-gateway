import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { defineComponent, h } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BatchImageGuideView from '@/views/user/BatchImageGuideView.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({ keys: vi.fn(), models: vi.fn(), jobs: vi.fn(), items: vi.fn(), recovery: vi.fn(), job: vi.fn(), cancel: vi.fn(), content: vi.fn(), download: vi.fn(), remove: vi.fn(), save: vi.fn(), submit: vi.fn(), replay: vi.fn(), success: vi.fn(), error: vi.fn(), copy: vi.fn() }))
vi.mock('@/api', () => ({ keysAPI: { list: api.keys } }))
vi.mock('@/api/batchImage', async () => ({
  ...await vi.importActual<typeof import('@/api/batchImage')>('@/api/batchImage'),
  listBatchImageModels: api.models, listBatchImageJobs: api.jobs, listBatchImageItems: api.items,
  getBatchImageJob: api.job, getBatchImageItemContent: api.content, downloadBatchImageZip: api.download,
  cancelBatchImageJob: api.cancel, deleteBatchImageJobRecord: api.remove, saveBlob: api.save, submitBatchImageJob: api.submit,
  replayBatchImageSubmission: api.replay,
  getBatchImageRecovery: api.recovery,
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error, publicSettings: {}, apiBaseUrl: 'https://gateway.example.test', fetchPublicSettings: vi.fn().mockResolvedValue({}) }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: api.copy }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : ''), locale: { value: 'en' } }) }))

const nativeSelect = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit }) {
    return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => {
      const raw = (event.target as HTMLSelectElement).value
      const value = props.options.find((option: { value: unknown }) => String(option.value) === raw)?.value ?? raw
      emit('update:modelValue', value); emit('change', value)
    } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value) }, option.label)))
  },
})
const dataTable = defineComponent({
  props: ['data', 'columns', 'loading'],
  template: '<table :aria-busy="loading"><thead><tr><th v-for="column in columns" :key="column.key"><slot :name="`header-${column.key}`">{{column.label}}</slot></th></tr></thead><tbody><tr v-for="row in data" :key="row.id" :data-job="row.id"><td v-for="column in columns" :key="column.key"><slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]" /></td></tr></tbody></table>',
})
const key = (id = 1, overrides: Record<string, unknown> = {}) => ({ id, key: `synthetic-key-${id}`, status: 'active', name: `Member key ${id}`, group: { platform: 'gemini', allow_batch_image_generation: true, name: 'Synthetic Gemini' }, ...overrides })
const job = (id: string, overrides: Record<string, unknown> = {}) => ({ id, object: 'batch', task_name: `Task ${id}`, status: 'completed', model: 'gemini-3-pro-image-preview', provider: 'gemini_api', created_at: 1700000000, item_count: 2, success_count: 1, fail_count: 1, actual_cost: 0.12, hold_amount: 0.24, estimated_cost: 0.24, ...overrides })
function deferred<T>() { let resolve!: (result: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const wrappers: VueWrapper[] = []
async function render() {
  const wrapper = mount(BatchImageGuideView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot /></main>' },
    TablePageLayout: { template: '<section><div data-filters><slot name="filters" /></div><slot name="table" /><div data-pagination><slot name="pagination" /></div></section>' },
    DataTable: dataTable, Select: nativeSelect, Icon: true,
    BaseDialog: { props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :data-dialog="title"><button type="button" @click="$emit(\'close\')">dialog-close</button><slot /><slot name="footer" /></section>' },
    'i18n-t': { template: '<span><slot name="count" /><slot name="page" /></span>' },
  } } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
function button(root: VueWrapper | ReturnType<VueWrapper['get']>, text: string) {
  const found = root.findAll('button').find(element => element.text() === text)
  expect(found, `visible button ${text}`).toBeDefined(); return found!
}
async function createDialog(wrapper: VueWrapper) { await button(wrapper, 'batchImage.actions.createJob').trigger('click'); await flushPromises(); return wrapper.get('[data-dialog="batchImage.create.title"]') }
function prompt(dialog: ReturnType<VueWrapper['get']>) { return dialog.get('textarea') }
function row(wrapper: VueWrapper, id: string) { return wrapper.get(`[data-job="${id}"]`) }

function history(batchId: string, targetItems: { custom_id: string; status: string; prompt_preview?: string; image_count?: number }[], extra: Record<string, unknown> = {}) {
  return { object: 'image.batch.recovery', complete: true, batch_id: batchId, root_batch_id: batchId, root_custom_ids: targetItems.map(item => item.custom_id), target_items: targetItems, successful_items: [], pending_items: [], input_mode: 'prompt_only', ...extra }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-batch-workflow', user: { id: 51 } })
  for (const mock of Object.values(api)) mock.mockReset()
  api.keys.mockResolvedValue({ items: [key()] })
  api.models.mockResolvedValue({ data: [{ id: 'gemini-3-pro-image-preview' }, { id: 'gemini-2.5-flash-image' }] })
  api.jobs.mockResolvedValue({ data: [job('A'), job('B')], has_more: false })
  api.items.mockResolvedValue({ data: [] })
  api.recovery.mockResolvedValue(history('A', []))
  api.job.mockImplementation(async (_key: string, id: string) => job(id))
  api.submit.mockResolvedValue(job('new'))
  api.replay.mockResolvedValue(job('new'))
  api.download.mockResolvedValue(new Blob(['synthetic archive']))
  api.remove.mockResolvedValue({})
  api.cancel.mockResolvedValue(job('A', { status: 'cancelled', actual_cost: null }))
  api.copy.mockResolvedValue(true)
  vi.stubGlobal('confirm', vi.fn(() => true))
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('batch image normal member workflows through visible controls', () => {
  it('lists only active batch-enabled Gemini keys and de-duplicates model options without displaying secrets', async () => {
    api.keys.mockResolvedValue({ items: [key(), key(2), key(3, { status: 'inactive' }), key(4, { group: { platform: 'openai', allow_batch_image_generation: true } }), key(5, { group: { platform: 'gemini', allow_batch_image_generation: false } })] })
    api.models.mockResolvedValue({ data: [{ id: ' image-a ' }, { id: '' }, { id: 'image-a' }, { id: 'image-b' }] })
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    expect(api.jobs.mock.calls.map(call => call[0])).toEqual(['synthetic-key-1', 'synthetic-key-2'])
    expect(dialog.findAll('select')[0]!.text()).toContain('Member key 2')
    expect(dialog.findAll('select')[0]!.text()).not.toContain('Member key 3')
    expect(dialog.findAll('select')[1]!.findAll('option').map(option => option.text())).toEqual(['image-a', 'image-b'])
    expect(wrapper.text()).not.toContain('synthetic-key-')
  })
  it('explains missing eligible keys and disables submission', async () => {
    api.keys.mockResolvedValue({ items: [key(2, { status: 'inactive' })] })
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    expect(dialog.text()).toContain('batchImage.create.noKeysHint')
    expect(button(dialog, 'batchImage.actions.submitJob').attributes('disabled')).toBeDefined()
    expect(api.models).not.toHaveBeenCalled(); expect(api.jobs).not.toHaveBeenCalled()
  })
  it('refreshes after a key-list error and restores the ordinary create workflow', async () => {
    api.keys.mockRejectedValueOnce(new Error('synthetic key load failure'))
    const wrapper = await render()
    expect(api.error).toHaveBeenCalled()
    await wrapper.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    const dialog = await createDialog(wrapper)
    expect(dialog.findAll('select')[1]!.element).toHaveProperty('value', 'gemini-3-pro-image-preview')
    expect(api.keys).toHaveBeenCalledTimes(2)
  })
  it('submits the displayed name, model, output format, unique IDs and output counts', async () => {
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await dialog.get('input[placeholder="batchImage.create.taskNamePlaceholder"]').setValue('  Studio batch  ')
    await dialog.findAll('select')[1]!.setValue('gemini-2.5-flash-image')
    await dialog.findAll('select')[2]!.setValue('image/webp')
    await prompt(dialog).setValue('  First synthetic prompt  ')
    await dialog.get('input[placeholder="batchImage.create.customIdPlaceholder"]').setValue('scene / one')
    await dialog.get('select[aria-label="batchImage.create.outputCountPerPrompt"]').setValue('3')
    await button(dialog, 'common.add').trigger('click')
    await prompt(dialog).setValue(' Second synthetic prompt ')
    await dialog.get('input[placeholder="batchImage.create.customIdPlaceholder"]').setValue('scene / one')
    await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    expect(api.submit).toHaveBeenCalledWith('synthetic-key-1', { model: 'gemini-2.5-flash-image', task_name: 'Studio batch', image_size: '1K', response_mime_type: 'image/webp', items: [{ custom_id: 'scene_one', prompt: 'First synthetic prompt', output_count: 3 }, { custom_id: 'scene_one_2', prompt: 'Second synthetic prompt' }] }, expect.any(String), expect.any(AbortSignal))
    expect(wrapper.find('[data-dialog="batchImage.create.title"]').exists()).toBe(false)
    expect(row(wrapper, 'new').text()).toContain('Task new')
  })
  it('removes an added prompt and clears a cancelled draft before reopening', async () => {
    const wrapper = await render(); let dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('discarded prompt'); await button(dialog, 'common.add').trigger('click')
    await dialog.get('button[title="common.delete"]').trigger('click')
    expect(dialog.text()).toContain('batchImage.create.noPrompts')
    await prompt(dialog).setValue('also discarded'); await button(dialog, 'common.cancel').trigger('click')
    dialog = await createDialog(wrapper)
    expect(prompt(dialog).element).toHaveProperty('value', '')
    expect(dialog.text()).toContain('batchImage.create.noPrompts'); expect(api.submit).not.toHaveBeenCalled()
  })
  it('locks duplicate native form submissions until the first request completes', async () => {
    const pending = deferred<ReturnType<typeof job>>(); api.submit.mockReturnValueOnce(pending.promise)
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Synthetic prompt')
    await dialog.get('form').trigger('submit'); await dialog.get('form').trigger('submit')
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(button(dialog, 'common.submitting').attributes('disabled')).toBeDefined()
    pending.resolve(job('new')); await flushPromises()
    expect(wrapper.find('[data-dialog="batchImage.create.title"]').exists()).toBe(false)
  })
  it('keeps a rejected prompt draft visible and permits a corrected submission', async () => {
    api.submit.mockRejectedValueOnce(Object.assign(new Error('synthetic request rejected'), { status: 400 }))
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Synthetic saved draft'); await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    expect(dialog.text()).toContain('Synthetic saved draft'); expect(api.error).toHaveBeenCalled()
    await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    expect(api.submit.mock.calls[1]![1].items).toEqual(api.submit.mock.calls[0]![1].items)
    expect(row(wrapper, 'new').exists()).toBe(true)
  })
  it('opens row details and downloads only the selected completed job', async () => {
    const wrapper = await render()
    await row(wrapper, 'B').get('button[title="batchImage.actions.viewDetail"]').trigger('click'); await flushPromises()
    expect(api.job).toHaveBeenCalledWith('synthetic-key-1', 'B', expect.any(AbortSignal))
    expect(api.items).toHaveBeenCalledWith('synthetic-key-1', 'B', '', expect.any(AbortSignal))
    await row(wrapper, 'B').get('button[title="batchImage.actions.downloadZip"]').trigger('click'); await flushPromises()
    expect(api.download).toHaveBeenCalledWith('synthetic-key-1', 'B', expect.any(AbortSignal))
    expect(api.save).toHaveBeenCalledWith(expect.any(Blob), 'B.zip')
    expect(row(wrapper, 'B').text()).not.toContain('batchImage.list.notDownloaded')
    expect(row(wrapper, 'A').text()).toContain('batchImage.list.notDownloaded')
  })
  it.each([
    ['queued', 0, 0, true, 'queued'], ['running', 0, 0, true, 'running'], ['indexing', 0, 0, true, 'processingResults'],
    ['processing_results', 0, 0, true, 'processingResults'], ['settling', 0, 0, true, 'settling'],
    ['completed', 2, 0, false, 'completed'], ['completed', 1, 1, false, 'partialSuccess'], ['completed', 0, 2, true, 'allFailed'],
    ['failed', 0, 2, true, 'failed'], ['cancelled', 0, 0, true, 'cancelled'], ['output_deleted', 1, 0, true, 'outputDeleted'],
  ])('renders %s (%s successes/%s failures) and enables ZIP only for completed successful outputs', async (status, success, failed, disabled, label) => {
    api.jobs.mockResolvedValue({ data: [job('status', { status, success_count: success, fail_count: failed, actual_cost: null })] })
    const wrapper = await render(); const target = row(wrapper, 'status')
    expect(target.text()).toContain(`batchImage.status.${label}`)
    expect((target.get('button[title="batchImage.actions.downloadZip"]').element as HTMLButtonElement).disabled).toBe(disabled)
    if (status === 'failed' || status === 'cancelled') expect(target.text()).toContain('$0.00')
    else expect(target.text()).toContain('batchImage.detail.holdCost:$0.24')
  })
  it('expands retry children and preserves the selected set when toggling another row', async () => {
    api.jobs.mockResolvedValue({ data: [job('A'), job('child', { parent_batch_id: 'A' }), job('B')] })
    const wrapper = await render()
    expect(wrapper.find('[data-job="child"]').exists()).toBe(false)
    await row(wrapper, 'A').get('button[title^="batchImage.list.expandChildren"]').trigger('click')
    expect(row(wrapper, 'child').text()).toContain('batchImage.list.childBadge')
    await row(wrapper, 'A').get('input[type="checkbox"]').setValue(true)
    await row(wrapper, 'B').get('input[type="checkbox"]').setValue(true)
    await row(wrapper, 'B').get('input[type="checkbox"]').setValue(false)
    await button(wrapper, 'batchImage.actions.downloadSelected').trigger('click'); await flushPromises()
    expect(api.download.mock.calls.map(call => call[1])).toEqual(['A'])
    await wrapper.get('thead input[type="checkbox"]').setValue(true)
    await button(wrapper, 'batchImage.actions.downloadSelected').trigger('click'); await flushPromises()
    expect(api.download.mock.calls.slice(1).map(call => call[1])).toEqual(['A', 'child', 'B'])
  })
  it('confirms bulk removal, excludes active tasks, and removes only acknowledged records', async () => {
    api.jobs.mockResolvedValue({ data: [job('A'), job('running', { status: 'running' }), job('B')] })
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true); vi.stubGlobal('confirm', confirm)
    const wrapper = await render(); await wrapper.get('thead input[type="checkbox"]').setValue(true)
    await button(wrapper, 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises()
    expect(api.remove).not.toHaveBeenCalled()
    await button(wrapper, 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises()
    expect(api.remove.mock.calls.map(call => call[1])).toEqual(['A', 'B'])
    expect(wrapper.find('[data-job="A"]').exists()).toBe(false); expect(wrapper.find('[data-job="B"]').exists()).toBe(false)
    expect(row(wrapper, 'running').exists()).toBe(true)
  })
  it('retains failed removal records and allows the user to retry', async () => {
    api.remove.mockRejectedValueOnce(new Error('synthetic removal failure'))
    const wrapper = await render(); await row(wrapper, 'A').get('input[type="checkbox"]').setValue(true)
    await button(wrapper, 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises()
    expect(row(wrapper, 'A').exists()).toBe(true); expect(api.error).toHaveBeenCalled()
    await button(wrapper, 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises()
    expect(api.remove).toHaveBeenCalledTimes(2); expect(wrapper.find('[data-job="A"]').exists()).toBe(false)
  })
  it('copies a usable guide with the configured endpoint and no API secret', async () => {
    const wrapper = await render(); await button(wrapper, 'batchImage.actions.usageGuide').trigger('click')
    const guide = wrapper.get('[data-dialog="batchImage.guide.title"]')
    await button(guide, 'batchImage.actions.copyInstruction').trigger('click')
    expect(api.copy).toHaveBeenCalledWith(expect.stringContaining('https://gateway.example.test'), expect.any(String))
    expect(api.copy.mock.calls[0]![0]).not.toContain('synthetic-key-1')
  })

  it.each(['batchImage.create.taskName', 'API Key', 'batchImage.create.model', 'batchImage.create.outputFormat', 'Prompt'])('connects the visible %s label to its actual submitted control', async label => {
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    const visibleLabel = dialog.findAll('label').find(element => element.text() === label)
    expect(visibleLabel, `label ${label}`).toBeDefined()
    const id = visibleLabel!.attributes('for')
    expect(id).toBeTruthy()
    const control = dialog.get(`[id="${id}"]`)
    expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(control.element.tagName)
    expect(control.element).toBe((visibleLabel!.element as HTMLLabelElement).control)
  })
  it('gives task selection checkboxes a name identifying their target', async () => {
    const wrapper = await render()
    expect(wrapper.get('thead input[type="checkbox"]').attributes('aria-label')).toBeTruthy()
    expect(row(wrapper, 'A').get('input[type="checkbox"]').attributes('aria-label')).toContain('Task A')
    expect(row(wrapper, 'B').get('input[type="checkbox"]').attributes('aria-label')).toContain('Task B')
  })
  it('keeps chronological tasks across two keys accessible on successive merged pages', async () => {
    api.keys.mockResolvedValue({ items: [key(), key(2)] })
    const source = {
      'synthetic-key-1': Array.from({ length: 20 }, (_, index) => job(`a${index}`, { created_at: 200 - index * 2 })),
      'synthetic-key-2': Array.from({ length: 20 }, (_, index) => job(`b${index}`, { created_at: 199 - index * 2 })),
    }
    api.jobs.mockImplementation(async (owner: keyof typeof source, options: { cursor: string; limit: number }) => {
      const offset = Number(options.cursor); const data = source[owner].slice(offset, offset + options.limit)
      return { data, has_more: source[owner].length > offset + data.length }
    })
    const wrapper = await render()
    const first = wrapper.findAll('[data-job]').map(element => element.attributes('data-job'))
    expect(first).toHaveLength(20)
    const next = wrapper.get('[data-pagination]').findAll('button').at(-1)!
    expect((next.element as HTMLButtonElement).disabled).toBe(false)
    await next.trigger('click'); await flushPromises()
    const second = wrapper.findAll('[data-job]').map(element => element.attributes('data-job'))
    expect(second).toHaveLength(20)
    expect(new Set([...first, ...second]).size).toBe(40)
    expect(new Set([...first, ...second])).toEqual(new Set([...source['synthetic-key-1'], ...source['synthetic-key-2']].map(item => item.id)))
  })
  it('reuses the operation identity when retrying an unknown submit result with the same key and unchanged draft', async () => {
    api.submit.mockRejectedValueOnce(new Error('synthetic lost response after the server may have created a job'))
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('One synthetic paid job')
    await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    const original = api.submit.mock.calls[0]!
    expect(dialog.get('fieldset').attributes('disabled')).toBeDefined()
    await button(dialog, 'batchImage.messages.checkSubmission').trigger('click'); await flushPromises()
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.replay.mock.calls[0]![0]).toBe(original[0])
    expect(api.replay.mock.calls[0]![1]).toEqual(original[1])
    expect(api.replay.mock.calls[0]![2]).toBe(original[2])
  })
  it.each([404, 409, 503])('retains the frozen draft and identity after read-only recovery refuses (%s)', async status => {
    api.submit.mockRejectedValueOnce(new TypeError('synthetic response lost'))
    api.replay.mockRejectedValue(Object.assign(new Error('synthetic result unconfirmed'), { status, code: 'BATCH_IMAGE_RESULT_UNCONFIRMED' }))
    const wrapper = await render(); let dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Retained original prompt')
    await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    const original = api.submit.mock.calls[0]!
    await button(dialog, 'common.cancel').trigger('click')
    dialog = await createDialog(wrapper)
    expect(dialog.text()).toContain('Retained original prompt')
    for (let attempt = 0; attempt < 2; attempt++) {
      await button(dialog, 'batchImage.messages.checkSubmission').trigger('click'); await flushPromises()
      expect(dialog.get('fieldset').attributes('disabled')).toBeDefined()
    }
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.replay).toHaveBeenCalledTimes(2)
    for (const call of api.replay.mock.calls) expect(call.slice(0, 3)).toEqual(original.slice(0, 3))
    expect(api.error).toHaveBeenLastCalledWith('batchImage.messages.resultUnconfirmed')
    expect(JSON.stringify({ ...localStorage })).not.toContain('Retained original prompt')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Retained original prompt')
  })
  it('requires an explicit reconciliation confirmation to abandon an unknown result and start a new task', async () => {
    api.submit.mockRejectedValueOnce(new TypeError('synthetic response lost'))
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true); vi.stubGlobal('confirm', confirm)
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Original task'); await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    const original = api.submit.mock.calls[0]!
    await button(dialog, 'batchImage.messages.startNewSubmission').trigger('click')
    expect(dialog.text()).toContain('Original task'); expect(dialog.get('fieldset').attributes('disabled')).toBeDefined()
    await button(dialog, 'batchImage.messages.startNewSubmission').trigger('click'); await flushPromises()
    expect(dialog.text()).toContain('batchImage.create.noPrompts')
    await prompt(dialog).setValue('Deliberate different task'); await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    expect(api.submit).toHaveBeenCalledTimes(2)
    expect(api.submit.mock.calls[1]![2]).not.toBe(original[2]); expect(api.replay).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith('batchImage.messages.startNewSubmissionConfirm')
  })
  it('queries the original key after a refresh omits it instead of borrowing another member key', async () => {
    api.submit.mockRejectedValueOnce(new TypeError('synthetic response lost'))
    api.replay.mockRejectedValue(Object.assign(new Error('synthetic key no longer authorized'), { status: 401, code: 'API_KEY_DISABLED' }))
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Original key task'); await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    api.keys.mockResolvedValue({ items: [key(2)] })
    await wrapper.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(dialog.get('select').element).toHaveProperty('value', '1')
    await button(dialog, 'batchImage.messages.checkSubmission').trigger('click'); await flushPromises()
    expect(api.replay.mock.calls[0]![0]).toBe('synthetic-key-1'); expect(api.submit).toHaveBeenCalledTimes(1)
    expect(dialog.find('fieldset[disabled]').exists()).toBe(true)
  })
  it('shows retry children whose parent is outside the current filter or page', async () => {
    api.jobs.mockResolvedValue({ data: [job('orphan', { parent_batch_id: 'earlier-page' })] })
    const wrapper = await render()
    expect(row(wrapper, 'orphan').text()).toContain('Task orphan')
    expect(row(wrapper, 'orphan').text()).toContain('batchImage.list.childBadge')
  })
  it('requests bounded prefixes for later pages and preserves every chronological offset', async () => {
    const source = Array.from({ length: 150 }, (_, index) => job(`page-${index}`, { created_at: 10000 - index }))
    api.jobs.mockImplementation(async (_key: string, options: { cursor: string; limit: number }) => {
      const offset = Number(options.cursor); const data = source.slice(offset, offset + options.limit)
      return { data, has_more: offset + data.length < source.length }
    })
    const wrapper = await render()
    for (let page = 1; page <= 6; page++) {
      expect(wrapper.findAll('[data-job]').map(element => element.attributes('data-job'))).toEqual(source.slice((page - 1) * 20, page * 20).map(item => item.id))
      if (page !== 6) { await wrapper.get('[data-pagination]').findAll('button').at(-1)!.trigger('click'); await flushPromises() }
    }
    expect(api.jobs.mock.calls.every(call => call[1].limit <= 100)).toBe(true)
    expect(api.jobs.mock.calls.at(-1)![1]).toMatchObject({ cursor: '100', limit: 20 })
  })
  it('recovers a lost retry result with the original failed-item IDs, parent, key and operation identity', async () => {
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'failed-scene', status: 'failed', prompt_preview: 'Retry only this scene', image_count: 0 }]))
    api.submit.mockRejectedValueOnce(new TypeError('synthetic retry response lost'))
    api.replay.mockResolvedValue(job('retry-A', { parent_batch_id: 'A' }))
    const wrapper = await render()
    await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    const original = api.submit.mock.calls[0]!
    expect(original[1]).toMatchObject({ parent_batch_id: 'A', items: [{ custom_id: expect.stringMatching(/^zjretry_v1_[a-f0-9]{64}_/), prompt: 'Retry only this scene' }] })
    await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.messages.checkSubmission').trigger('click'); await flushPromises()
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.replay.mock.calls[0]!.slice(0, 3)).toEqual(original.slice(0, 3))
    expect(row(wrapper, 'retry-A').exists()).toBe(true)
  })
  it('retries only unresolved original failures from an aggregated detail with a successful child recovery', async () => {
    const root = job('A', { item_count: 2, success_count: 0, fail_count: 2 })
    const child = job('child', { item_count: 1, success_count: 1, fail_count: 0, parent_batch_id: 'A' })
    api.jobs.mockResolvedValue({ data: [root, child] }); api.job.mockResolvedValue(root)
    api.items.mockImplementation(async (_key: string, id: string) => ({ data: id === 'A'
      ? [{ custom_id: 'scene-one', status: 'failed', prompt_preview: 'Already recovered', image_count: 0 }, { custom_id: 'scene-two', status: 'failed', prompt_preview: 'Still needs retry', image_count: 0 }]
      : [{ custom_id: 'scene-one_retry_abc123', status: 'succeeded', prompt_preview: 'Already recovered', image_count: 1 }] }))
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'scene-one', status: 'failed', prompt_preview: 'Already recovered', image_count: 0 }, { custom_id: 'scene-two', status: 'failed', prompt_preview: 'Still needs retry', image_count: 0 }], { successful_items: [{ batch_id: 'child', custom_id: 'scene-one_retry_abc123', image_count: 1 }] }))
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.viewDetail"]').trigger('click'); await flushPromises()
    const detail = wrapper.get('[data-dialog="batchImage.detail.title"]')
    expect(detail.text()).toContain('batchImage.itemStatus.recovered')
    await button(detail, 'batchImage.actions.retryFailedItems').trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0]![1].items).toEqual([{ custom_id: expect.stringMatching(/^zjretry_v1_[a-f0-9]{64}_/), prompt: 'Still needs retry' }])
  })
  it('waits for selected reference files before the visible submit control can create a paid job', async () => {
    let finishRead!: () => void
    vi.stubGlobal('FileReader', class {
      result = ''; error = null; onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null
      readAsDataURL() { finishRead = () => { this.result = 'data:image/png;base64,c3ludGhldGlj'; this.onload?.() } }
      abort() { this.onabort?.() }
    })
    const wrapper = await render(); const dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Use the selected reference image')
    const fileInput = dialog.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [new File(['synthetic'], 'reference.png', { type: 'image/png' })] })
    await fileInput.trigger('change')
    expect((button(dialog, 'batchImage.actions.submitJob').element as HTMLButtonElement).disabled).toBe(true)
    await dialog.get('form').trigger('submit'); expect(api.submit).not.toHaveBeenCalled()
    finishRead(); await flushPromises()
    expect((button(dialog, 'batchImage.actions.submitJob').element as HTMLButtonElement).disabled).toBe(false)
    await button(dialog, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    expect(api.submit.mock.calls[0]![1].items[0].reference_images).toEqual([{ id: 'reference.png', type: 'reference', mime_type: 'image/png', data: 'c3ludGhldGlj' }])
  })
  it.each(['failure', 'cancel', 'model'])('finishes a reference read safely after %s and does not attach it to another draft', async action => {
    let finish!: () => void; let fail!: () => void; const aborted = vi.fn()
    vi.stubGlobal('FileReader', class {
      result = ''; error = new Error('synthetic read error'); onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null
      readAsDataURL() { finish = () => { this.result = 'data:image/png;base64,c3ludGhldGlj'; this.onload?.() }; fail = () => this.onerror?.() }
      abort() { aborted(); this.onabort?.() }
    })
    const wrapper = await render(); let dialog = await createDialog(wrapper)
    await prompt(dialog).setValue('Draft during file read')
    const input = dialog.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['synthetic'], 'reference.png', { type: 'image/png' })] })
    await input.trigger('change')
    if (action === 'failure') { fail(); await flushPromises(); expect(api.error).toHaveBeenCalledWith('batchImage.create.refReadFailed') }
    else if (action === 'cancel') { await button(dialog, 'common.cancel').trigger('click'); dialog = await createDialog(wrapper) }
    else { await dialog.findAll('select')[1]!.setValue('gemini-2.5-flash-image'); await flushPromises() }
    finish(); await flushPromises()
    expect(dialog.text()).not.toContain('reference.png')
    if (action !== 'failure') { expect(aborted).toHaveBeenCalledTimes(1); expect(api.error).not.toHaveBeenCalled() }
    if (action !== 'cancel') expect((button(dialog, 'batchImage.actions.submitJob').element as HTMLButtonElement).disabled).toBe(false)
    expect(api.submit).not.toHaveBeenCalled()
  })
  it('loads all 200 detail items instead of presenting the first default page as complete', async () => {
    const all = Array.from({ length: 200 }, (_, index) => ({ custom_id: `scene-${index}`, status: 'failed', prompt_preview: `Full original prompt ${index}`, image_count: 0 }))
    api.job.mockResolvedValue(job('A', { item_count: 200, fail_count: 200, success_count: 0 }))
    api.items.mockImplementation(async (_key: string, _id: string, _status: string, _signal: AbortSignal, pagination?: { cursor?: string; limit?: number }) => {
      const start = Number(pagination?.cursor || 0); const limit = pagination?.limit || 100
      return { data: all.slice(start, start + limit), has_more: start + limit < all.length }
    })
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.viewDetail"]').trigger('click'); await flushPromises()
    const detail = wrapper.get('[data-dialog="batchImage.detail.title"]')
    expect(detail.findAll('tbody tr')).toHaveLength(200)
    expect(detail.text()).toContain('Full original prompt 199')
    expect(api.items).toHaveBeenCalledTimes(2)
    expect(api.items.mock.calls[1]![4]).toEqual({ cursor: '100', limit: 100 })
  })
  it('stops an inconsistent empty continuation page and does not display an incomplete list as the full detail', async () => {
    api.items.mockResolvedValueOnce({ data: [{ custom_id: 'partial', status: 'failed', prompt_preview: 'Incomplete page', image_count: 0 }], has_more: true }).mockResolvedValueOnce({ data: [], has_more: true })
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.viewDetail"]').trigger('click'); await flushPromises()
    expect(api.items).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-dialog="batchImage.detail.title"]').text()).not.toContain('Incomplete page')
    expect(api.error).toHaveBeenCalledWith('batchImage.messages.retryHistoryUnconfirmed')
    expect(api.submit).not.toHaveBeenCalled()
  })
  it('lets the member cancel a prompt-only retry review before any paid submission', async () => {
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'one', status: 'failed', prompt_preview: 'First prompt' }, { custom_id: 'two', status: 'failed', prompt_preview: 'Second prompt' }]))
    const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm)
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith('batchImage.messages.retryPromptOnlyConfirm:2'))
    expect(api.submit).not.toHaveBeenCalled(); expect(api.replay).not.toHaveBeenCalled()
  })
  it.each(['successful_items', 'pending_items'])('does not submit another paid retry when complete history already contains %s', async bucket => {
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'scene', status: 'failed', prompt_preview: 'Saved prompt' }], { [bucket]: [{ batch_id: 'hidden-child', custom_id: 'scene_retry_abc123', image_count: 1 }] }))
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.error).toHaveBeenCalledWith('batchImage.messages.noUnresolvedFailures'))
    expect(api.submit).not.toHaveBeenCalled(); expect(api.replay).not.toHaveBeenCalled()
  })
  it('refuses an ambiguous legacy recovery source before asking to submit another task', async () => {
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'scene/a', status: 'failed', prompt_preview: 'First source' }, { custom_id: 'scene a', status: 'failed', prompt_preview: 'Second source' }], { successful_items: [{ batch_id: 'legacy-child', custom_id: 'scene_a_retry_abc123', image_count: 1 }] }))
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.error).toHaveBeenCalledWith('batchImage.messages.retryHistoryUnconfirmed'))
    expect(window.confirm).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled()
  })
  it('keeps an unknown list retry reachable after its original key and row disappear from active lists', async () => {
    api.recovery.mockResolvedValue(history('A', [{ custom_id: 'one', status: 'failed', prompt_preview: 'Original failed item' }]))
    api.submit.mockRejectedValueOnce(new TypeError('synthetic lost retry result'))
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    await flushPromises(); const original = api.submit.mock.calls[0]!
    api.keys.mockResolvedValue({ items: [key(2)] }); api.jobs.mockResolvedValue({ data: [] })
    await wrapper.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-job="A"]').exists()).toBe(false)
    const recovery = button(wrapper.get('[data-filters]'), 'batchImage.messages.checkSubmission')
    await recovery.trigger('click'); await flushPromises()
    expect(api.replay.mock.calls[0]!.slice(0, 3)).toEqual(original.slice(0, 3))
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.success).toHaveBeenLastCalledWith('batchImage.messages.resultRecovered')
  })
  it('anchors a retry to its visible target when historical ancestors have been hidden', async () => {
    const targetJob = job('visible-child', { parent_batch_id: 'hidden-parent', success_count: 0, fail_count: 1 })
    api.jobs.mockResolvedValue({ data: [targetJob], has_more: false })
    api.recovery.mockResolvedValue(history('visible-child', [{ custom_id: 'source_retry_abc', status: 'failed', prompt_preview: 'Saved original prompt' }], { root_batch_id: 'hidden-root', root_custom_ids: ['source'] }))
    const wrapper = await render()
    await row(wrapper, 'visible-child').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0]![1].parent_batch_id).toBe('visible-child')
    expect(api.submit.mock.calls[0]![1].items[0].prompt).toBe('Saved original prompt')
  })
  it('round-trips actual generated retry IDs when one of two distinct external source IDs later recovers', async () => {
    const root = job('A', { item_count: 2, success_count: 0, fail_count: 2 })
    api.jobs.mockResolvedValue({ data: [root] })
    const target = [{ custom_id: 'scene/a', status: 'failed', prompt_preview: 'Slash source' }, { custom_id: 'scene a', status: 'failed', prompt_preview: 'Space source' }]
    api.recovery.mockResolvedValueOnce(history('A', target))
    api.submit.mockResolvedValueOnce(job('child', { parent_batch_id: 'A', success_count: 1, fail_count: 1 }))
    const wrapper = await render(); await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1)); await flushPromises()
    const sent = api.submit.mock.calls[0]![1].items
    expect(new Set(sent.map((item: { custom_id: string }) => item.custom_id)).size).toBe(2)
    for (const item of sent) expect(new TextEncoder().encode(item.custom_id).byteLength).toBeLessThanOrEqual(255)
    api.recovery.mockResolvedValue(history('A', target, { successful_items: [{ batch_id: 'child', custom_id: sent[0].custom_id, image_count: 1 }] }))
    await button(wrapper.get('[data-dialog="batchImage.detail.title"]'), 'dialog-close').trigger('click')
    await row(wrapper, 'A').get('button[title="batchImage.actions.moreActions"]').trigger('click')
    await button(new DOMWrapper(document.body), 'batchImage.actions.retryFailedItems').trigger('click')
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2))
    expect(api.submit.mock.calls[1]![1].items).toEqual([{ custom_id: expect.any(String), prompt: 'Space source' }])
  })
})
