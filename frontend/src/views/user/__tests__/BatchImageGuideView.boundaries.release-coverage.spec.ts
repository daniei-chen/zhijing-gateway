/** Native member batch operations through actual keys/Axios + batch fetch APIs.
 * DataTable/Select are presentation adapters; image decoding and saveBlob are
 * mocked browser capabilities. No paid inference, download or network occurs.
 */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import BatchImageGuideView from '../BatchImageGuideView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { BatchImageJob, BatchImageItem } from '@/api/batchImage'

const fixture = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), copy: vi.fn(), save: vi.fn(), image: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(), language: 'en' }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: fixture.success, showError: fixture.error, apiBaseUrl: 'https://gateway.example.test', cachedPublicSettings: {}, publicSettings: {}, fetchPublicSettings: async () => ({}) }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: fixture.copy }) }))
vi.mock('@/api/batchImage', async () => ({ ...await vi.importActual<typeof import('@/api/batchImage')>('@/api/batchImage'), saveBlob: fixture.save }))
vi.mock('@/utils/imageThumbnail', () => ({ createImageThumbnail: fixture.image }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : ''), locale: { value: fixture.language } }) }))
const nativeSelect = defineComponent({ inheritAttrs: false, props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'], setup(props, { attrs, emit }) { return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => { const raw = (event.target as HTMLSelectElement).value; const value = props.options.find((option: { value: unknown }) => String(option.value) === raw)?.value ?? raw; emit('update:modelValue', value); emit('change', value) } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value) }, option.label))) } })
const table = defineComponent({ props: ['data', 'columns', 'loading'], template: `<table :aria-busy="loading"><thead><tr><th v-for="column in columns" :key="column.key"><slot :name="'header-'+column.key">{{column.label}}</slot></th></tr></thead><tbody><tr v-for="row in data" :key="row.id" :data-job="row.id"><td v-for="column in columns" :key="column.key"><slot :name="'cell-'+column.key" :row="row" :value="row[column.key]" /></td></tr></tbody></table>` })
const job = (id: string, patch: Partial<BatchImageJob> = {}): BatchImageJob => ({ id, object: 'batch', task_name: `Synthetic ${id}`, status: 'completed', model: 'gemini-3-pro-image-preview', provider: 'gemini_api', created_at: 1700000000, submitted_at: null, settled_at: 1700000100, item_count: 4, success_count: 1, fail_count: 3, actual_cost: .12, hold_amount: .24, estimated_cost: .24, ...patch })
const item = (id: string, patch: Partial<BatchImageItem> = {}): BatchImageItem => ({ custom_id: id, status: 'succeeded', prompt_preview: 'Synthetic full prompt with meaningful details', mime_type: 'image/png', file_extension: 'png', image_count: 1, ...patch })
let availableModels: string[]
let jobs: BatchImageJob[]
let items: BatchImageItem[]
let requests: { path: string; method: string; query: Record<string, string>; body: Record<string, unknown> }[]
let failure: { suffix: string; code: string; status?: number } | undefined
let view: VueWrapper | undefined
const oldAdapter = apiClient.defaults.adapter
const NativeURL = URL
const bodyRoot = () => new DOMWrapper(document.body)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'synthetic-request-206' } })
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'release-synthetic-batch-member', user: { id: 206 } }); vi.stubGlobal('crypto', webcrypto)
  for (const mock of [fixture.success, fixture.error, fixture.copy, fixture.save, fixture.image, fixture.createUrl, fixture.revokeUrl]) mock.mockReset()
  fixture.language = 'en'; availableModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-text-only']
  fixture.copy.mockResolvedValue(true); fixture.image.mockRejectedValue(new Error('Synthetic browser has no image decoder')); fixture.createUrl.mockImplementation(() => `blob:release-${fixture.createUrl.mock.calls.length}`)
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = fixture.createUrl; static revokeObjectURL = fixture.revokeUrl })
  vi.stubGlobal('confirm', vi.fn(() => true))
  jobs = [job('A'), job('B', { status: 'failed', actual_cost: null }), job('C', { status: 'running', actual_cost: null }), job('D', { status: 'output_deleted', downloaded_at: 1700000200 })]
  items = [item('image'), item('empty', { status: 'failed', image_count: 0, error: { code: 'EMPTY_IMAGE_OUTPUT', message: 'Synthetic empty' } }), item('provider', { status: 'failed', image_count: 0, error: { code: 'PROVIDER_ITEM_FAILED', message: 'Synthetic provider failure' } }), item('other', { status: 'failed', image_count: 0, error: { code: 'SYNTHETIC_ITEM', message: 'Synthetic detail failure' } })]
  requests = []; failure = undefined
  apiClient.defaults.adapter = async config => {
    if (config.url !== '/keys') throw new Error(`Unexpected synthetic member endpoint ${config.url}`)
    return { data: { code: 0, data: { items: [{ id: 206, key: 'synthetic-batch-key-206', status: 'active', name: 'Synthetic key', group: { id: 7, name: 'Synthetic Gemini', platform: 'gemini', allow_batch_image_generation: true } }], total: 1, page: 1, pages: 1 } }, status: 200, statusText: 'OK', headers: {}, config }
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://gateway.example.test'); const path = url.pathname; const method = init?.method ?? 'GET'
    requests.push({ path, method, query: Object.fromEntries(url.searchParams), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} })
    if (!path.startsWith('/v1/images/batches')) throw new Error(`Unexpected synthetic fetch ${path}`)
    if (failure && path.endsWith(failure.suffix)) return json({ error: { code: failure.code, message: 'Synthetic batch operation refused' } }, failure.status ?? 400)
    if (path.endsWith('/models')) return json({ object: 'list', data: availableModels.map(id => ({ id, object: 'model', provider: 'gemini_api' })) })
    if (/\/items\/[^/]+\/content$/.test(path)) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })
    if (path.endsWith('/items')) return json({ object: 'list', data: items, has_more: false })
    if (path.endsWith('/recovery')) return json({ object: 'image.batch.recovery', complete: true, batch_id: 'A', root_batch_id: 'A', root_custom_ids: items.map(entry => entry.custom_id), target_items: items, successful_items: [], pending_items: [], input_mode: 'prompt_only' })
    if (path.endsWith('/download')) return new Response('synthetic zip', { headers: { 'Content-Type': 'application/zip' } })
    if (path.endsWith('/cancel')) { const current = jobs.find(row => row.id === path.split('/').at(-2))!; Object.assign(current, { status: 'cancelled', actual_cost: null }); return json(current) }
    if (path === '/v1/images/batches' && method === 'POST') return json(job('new'))
    if (path === '/v1/images/batches') { const from = Number(url.searchParams.get('cursor') ?? 0); const limit = Number(url.searchParams.get('limit') ?? 20); return json({ object: 'list', data: jobs.slice(from, from + limit), has_more: from + limit < jobs.length }) }
    const id = decodeURIComponent(path.split('/').at(-1)!); const current = jobs.find(row => row.id === id)
    if (method === 'DELETE') { jobs = jobs.filter(row => row.id !== id); return new Response(null, { status: 204 }) }
    if (current) return json(current)
    throw new Error(`Unexpected synthetic batch endpoint ${method} ${path}`)
  }))
})
afterEach(() => { view?.unmount(); view = undefined; apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })
async function render() { view = mount(BatchImageGuideView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' }, DataTable: table, Select: nativeSelect, 'i18n-t': { template: '<span><slot name="count"/><slot name="page"/></span>' } } } }); await flushPromises(); return view }
function action(scope: Pick<VueWrapper, 'findAll'> | DOMWrapper<Element>, text: string) { const node = scope.findAll('button').find(node => node.text() === text); expect(node, text).toBeDefined(); return node! }
function dialog(title: string) { const result = bodyRoot().findAll('[role="dialog"]').find(node => node.find('.modal-title').exists() && node.get('.modal-title').text() === title); expect(result, title).toBeDefined(); return result! }
async function details(id = 'A') { await view!.get(`[data-job="${id}"] button[title="batchImage.actions.viewDetail"]`).trigger('click'); await flushPromises(); return dialog('batchImage.detail.title') }
async function createDialog() { await action(view!, 'batchImage.actions.createJob').trigger('click'); await flushPromises(); return dialog('batchImage.create.title') }

async function upload(scope: DOMWrapper<Element>, files: File[]) { const input = scope.get<HTMLInputElement>('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: files }); await input.trigger('change'); await flushPromises() }
async function submitCreate(scope: DOMWrapper<Element>) { await action(scope, 'batchImage.actions.submitJob').trigger('click'); await flushPromises() }
function modelSelect(scope: DOMWrapper<Element>) { const label = scope.findAll('label').find(label => label.text() === 'batchImage.create.model')!; expect(label).toBeDefined(); return scope.get(`#${label.attributes('for')}`) }

describe('batch image visible input and transport boundaries', () => {
  it('normalizes duplicate explicit item identities, preserves output counts and removes only the chosen draft row', async () => {
    await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic first prompt'); await create.get('input[aria-label="batchImage.create.customIdPlaceholder"]').setValue('  named / item  '); await create.get('select[aria-label="batchImage.create.outputCountPerPrompt"]').setValue('4'); await action(create, 'common.add').trigger('click'); await create.get('textarea').setValue('Synthetic second prompt'); await create.get('input[aria-label="batchImage.create.customIdPlaceholder"]').setValue('named / item'); await action(create, 'common.add').trigger('click'); expect(create.text()).toContain('named_item_2'); expect(create.text()).toContain('x4'); await create.get('textarea').setValue('Synthetic disposable prompt'); await action(create, 'common.add').trigger('click'); const remove = create.findAll('button[title="common.delete"]'); await remove[2].trigger('click'); expect(create.text()).not.toContain('Synthetic disposable prompt'); await submitCreate(create); expect(requests.find(request => request.path === '/v1/images/batches' && request.method === 'POST')!.body.items).toEqual([{ custom_id: 'named_item', prompt: 'Synthetic first prompt', output_count: 4 }, { custom_id: 'named_item_2', prompt: 'Synthetic second prompt' }])
  })
  it('submits a fallback identity when the explicit identifier contains only unsupported characters', async () => {
    await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic punctuation prompt'); await create.get('input[aria-label="batchImage.create.customIdPlaceholder"]').setValue('***'); await submitCreate(create); expect(requests.find(request => request.path === '/v1/images/batches' && request.method === 'POST')!.body.items).toEqual([{ custom_id: 'img_001', prompt: 'Synthetic punctuation prompt' }])
  })
  it('refuses unsupported or oversized references while retaining the valid prompt and other supported files', async () => {
    await render(); const create = await createDialog(); const large = new File(['synthetic'], 'oversized.png', { type: 'image/png' }); Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 }); await upload(create, [new File(['synthetic'], 'unsupported.gif', { type: 'image/gif' }), large, new File(['synthetic'], 'accepted.webp', { type: 'image/webp' })]); await vi.waitFor(() => expect(create.text()).toContain('accepted.webp')); expect(fixture.error).toHaveBeenCalledWith('batchImage.create.refFormatUnsupported'); expect(fixture.error).toHaveBeenCalledWith('batchImage.create.refFileTooLarge:oversized.png'); expect(create.text()).not.toContain('unsupported.gif'); expect(create.text()).not.toContain('oversized.png'); await create.get('textarea').setValue('Synthetic valid references'); await submitCreate(create); const posted = requests.find(request => request.path === '/v1/images/batches' && request.method === 'POST')!; expect((posted.body.items as Record<string, unknown>[])[0].reference_images).toEqual([expect.objectContaining({ id: 'accepted.webp', mime_type: 'image/webp', type: 'reference' })])
  })
  it('handles a native file-read failure and permits a fresh file selection afterwards', async () => {
    await render(); const create = await createDialog(); const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) { this.dispatchEvent(new ProgressEvent('error')) }); await upload(create, [new File(['synthetic'], 'broken.png', { type: 'image/png' })]); expect(fixture.error).toHaveBeenCalledWith('batchImage.create.refReadFailed'); expect(create.get('input[type="file"]').attributes('disabled')).toBeUndefined(); read.mockRestore(); await upload(create, [new File(['synthetic'], 'retry.png', { type: 'image/png' })]); await vi.waitFor(() => expect(create.text()).toContain('retry.png'))
  })
  it('caps a multi-file selection to the current model limit, then truncates refs when the member changes models', async () => {
    await render(); const create = await createDialog(); await upload(create, Array.from({ length: 15 }, (_, index) => new File(['synthetic'], `reference-${index}.png`, { type: 'image/png' }))); await vi.waitFor(() => expect(create.findAll('button[title="batchImage.create.removeReferenceImage"]')).toHaveLength(14)); expect(fixture.error).toHaveBeenCalledWith('batchImage.create.refLimitExceededIgnored:14'); expect(create.get('input[type="file"]').attributes('disabled')).toBeDefined(); await modelSelect(create).setValue('gemini-2.5-flash-image'); expect(create.findAll('button[title="batchImage.create.removeReferenceImage"]')).toHaveLength(3); await modelSelect(create).setValue('gemini-text-only'); expect(create.findAll('button[title="batchImage.create.removeReferenceImage"]')).toHaveLength(0); expect(create.get('input[type="file"]').attributes('disabled')).toBeDefined(); await create.get('textarea').setValue('Synthetic no-reference model'); await submitCreate(create); expect((requests.find(request => request.path === '/v1/images/batches' && request.method === 'POST')!.body.items as Record<string, unknown>[])[0]).not.toHaveProperty('reference_images')
  })
  it('shows a real empty model response as a disabled submission with the current key still selected', async () => {
    availableModels = []; await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic retained prompt'); expect(create.text()).toContain('batchImage.messages.noModelsHint'); expect(action(create, 'batchImage.actions.submitJob').attributes('disabled')).toBeDefined(); expect(requests.filter(request => request.method === 'POST')).toHaveLength(0)
  })
  it.each([
    ['BATCH_IMAGE_VERTEX_GCS_BUCKET_MISSING', 'vertexGcsBucketMissing'], ['BATCH_IMAGE_PROVIDER_MISSING_API_KEY', 'providerSubmitFailed'], ['BATCH_IMAGE_PROVIDER_MISSING_SERVICE_ACCOUNT', 'providerSubmitFailed'], ['BATCH_IMAGE_PROVIDER_UNSUPPORTED_ACCOUNT', 'providerSubmitFailed'], ['BATCH_IMAGE_SETTLEMENT_PRICING_MISSING', 'pricingMissing'], ['BATCH_IMAGE_INVALID_ITEMS', 'invalidItems'], ['BATCH_IMAGE_DUPLICATE_CUSTOM_ID', 'duplicateCustomId'], ['BATCH_IMAGE_PROMPT_TOO_LONG', 'promptTooLong'], ['BATCH_IMAGE_INVALID_REFERENCE_IMAGE', 'invalidReferenceImage'], ['BATCH_IMAGE_TOO_MANY_REFERENCE_IMAGES', 'tooManyReferenceImages'], ['BATCH_IMAGE_REFERENCE_IMAGES_TOO_LARGE', 'referenceImagesTooLarge'], ['BATCH_IMAGE_TOO_MANY_OUTPUT_IMAGES', 'tooManyOutputImages'], ['BATCH_IMAGE_IDEMPOTENCY_CONFLICT', 'idempotencyConflict'], ['BATCH_IMAGE_DISABLED', 'disabled'],
  ])('maps a real rejected submission %s to actionable member feedback without dropping its draft', async (code, label) => {
    await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic retained failed submission'); failure = { suffix: '/v1/images/batches', code }; await submitCreate(create); expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining(`batchImage.messages.${label}`)); expect(create.text()).toContain('Synthetic retained failed submission'); expect(requests.filter(request => request.method === 'POST')).toHaveLength(1)
  })
  it.each([
    ['BATCH_IMAGE_NOT_READY', 'notReady'], ['BATCH_IMAGE_OUTPUT_DELETED', 'outputDeleted'], ['BATCH_IMAGE_RESULT_MISSING', 'resultMissing'], ['BATCH_IMAGE_ITEM_FAILED', 'itemFailed'], ['BATCH_IMAGE_ITEM_IMAGE_INDEX_OUT_OF_RANGE', 'itemImageIndexOutOfRange'], ['BATCH_IMAGE_DOWNLOAD_LIMITED', 'downloadLimited'], ['BATCH_IMAGE_DOWNLOAD_TOO_LARGE', 'downloadTooLarge'],
  ])('shows %s from an actual ZIP request and succeeds on an explicit retry', async (code, label) => {
    await render(); failure = { suffix: '/A/download', code }; const download = view!.get('[data-job="A"] button[title="batchImage.actions.downloadZip"]'); await download.trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining(`batchImage.messages.${label}`)); expect(fixture.save).not.toHaveBeenCalled(); failure = undefined; await download.trigger('click'); await flushPromises(); expect(fixture.save).toHaveBeenCalledOnce(); expect(requests.filter(request => request.path === '/v1/images/batches/A/download')).toHaveLength(2)
  })
  it('explains a record delete refusal and keeps that exact row retryable', async () => {
    await render(); const button = view!.get('[data-job="B"] button[title="batchImage.actions.moreActions"]'); await button.trigger('click'); await flushPromises(); failure = { suffix: '/B', code: 'BATCH_IMAGE_RECORD_DELETE_NOT_READY' }; await action(bodyRoot(), 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('batchImage.messages.deleteNotReady'); expect(view!.find('[data-job="B"]').exists()).toBe(true); failure = undefined; await button.trigger('click'); await flushPromises(); await action(bodyRoot(), 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises(); expect(view!.find('[data-job="B"]').exists()).toBe(false)
  })
  it('renders processing job states and pending/cancelled/failed item outcomes without fabricating image output', async () => {
    jobs = [job('A', { status: 'queued' }), job('B', { status: 'indexing' }), job('C', { status: 'settling' }), job('D', { status: 'completed', success_count: 0, fail_count: 4 })]; items = [item('pending', { status: 'pending', image_count: 0 }), item('cancelled', { status: 'cancelled', image_count: 0 }), item('failed', { status: 'failed', image_count: 0 }), item('success', { status: 'success', image_count: 1 })]; await render(); expect(view!.text()).toContain('batchImage.status.queued'); expect(view!.text()).toContain('batchImage.status.processingResults'); expect(view!.text()).toContain('batchImage.status.settling'); expect(view!.text()).toContain('batchImage.status.allFailed'); const detail = await details(); expect(detail.text()).toContain('batchImage.itemResult.waiting'); expect(detail.text()).toContain('batchImage.itemResult.cancelled'); expect(detail.text()).toContain('batchImage.itemResult.noUsableImage'); expect(detail.text()).toContain('batchImage.itemResult.readyDownload')
  })
  it.each(['en', 'zh'])('preserves a useful server message for an unrecognized %s transport failure', async language => {
    fixture.language = language; await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic unknown failure'); failure = { suffix: '/v1/images/batches', code: 'SYNTHETIC_UNRECOGNIZED' }; await submitCreate(create); expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('Synthetic batch operation refused')); if (language === 'zh') expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('batchImage.messages.errorReference'))
  })
})
