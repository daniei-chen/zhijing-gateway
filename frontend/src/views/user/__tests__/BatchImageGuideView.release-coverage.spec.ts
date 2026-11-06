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

const fixture = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), copy: vi.fn(), save: vi.fn(), image: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: fixture.success, showError: fixture.error, apiBaseUrl: 'https://gateway.example.test', cachedPublicSettings: {}, publicSettings: {}, fetchPublicSettings: async () => ({}) }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: fixture.copy }) }))
vi.mock('@/api/batchImage', async () => ({ ...await vi.importActual<typeof import('@/api/batchImage')>('@/api/batchImage'), saveBlob: fixture.save }))
vi.mock('@/utils/imageThumbnail', () => ({ createImageThumbnail: fixture.image }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : ''), locale: { value: 'en' } }) }))
const nativeSelect = defineComponent({ inheritAttrs: false, props: ['modelValue', 'options'], emits: ['update:modelValue', 'change'], setup(props, { attrs, emit }) { return () => h('select', { ...attrs, value: props.modelValue ?? '', onChange: (event: Event) => { const raw = (event.target as HTMLSelectElement).value; const value = props.options.find((option: { value: unknown }) => String(option.value) === raw)?.value ?? raw; emit('update:modelValue', value); emit('change', value) } }, props.options.map((option: { value: unknown; label: string }) => h('option', { value: String(option.value) }, option.label))) } })
const table = defineComponent({ props: ['data', 'columns', 'loading'], template: `<table :aria-busy="loading"><thead><tr><th v-for="column in columns" :key="column.key"><slot :name="'header-'+column.key">{{column.label}}</slot></th></tr></thead><tbody><tr v-for="row in data" :key="row.id" :data-job="row.id"><td v-for="column in columns" :key="column.key"><slot :name="'cell-'+column.key" :row="row" :value="row[column.key]" /></td></tr></tbody></table>` })
const job = (id: string, patch: Partial<BatchImageJob> = {}): BatchImageJob => ({ id, object: 'batch', task_name: `Synthetic ${id}`, status: 'completed', model: 'gemini-3-pro-image-preview', provider: 'gemini_api', created_at: 1700000000, submitted_at: null, settled_at: 1700000100, item_count: 4, success_count: 1, fail_count: 3, actual_cost: .12, hold_amount: .24, estimated_cost: .24, ...patch })
const item = (id: string, patch: Partial<BatchImageItem> = {}): BatchImageItem => ({ custom_id: id, status: 'succeeded', prompt_preview: 'Synthetic full prompt with meaningful details', mime_type: 'image/png', file_extension: 'png', image_count: 1, ...patch })
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
  for (const mock of Object.values(fixture)) mock.mockReset()
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
    if (path.endsWith('/models')) return json({ object: 'list', data: [{ id: 'gemini-3-pro-image-preview', object: 'model', provider: 'gemini_api' }] })
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

describe('batch image rendered release workflows', () => {
  it('filters via actual search/status/download controls and resets the resulting transport query', async () => {
    vi.useFakeTimers(); await render(); await view!.get('input[type="search"]').setValue('  Synthetic A  '); await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(requests.filter(request => request.path === '/v1/images/batches').at(-1)!.query.task_name).toBe('Synthetic A')
    await view!.get('select[aria-label="common.status"]').setValue('completed'); await flushPromises(); expect(requests.filter(request => request.path === '/v1/images/batches').at(-1)!.query.status).toBe('completed')
    await action(view!, 'common.reset').trigger('click'); await flushPromises(); expect(requests.filter(request => request.path === '/v1/images/batches').at(-1)!.query).not.toHaveProperty('task_name')
  })
  it('changes the public page-size control and keeps later chronological pages reachable', async () => {
    jobs = Array.from({ length: 75 }, (_, index) => job(`task-${index}`, { created_at: 1700000000 - index })); await render(); await view!.get('select[aria-label="pagination.perPage"]').setValue('50'); await flushPromises()
    expect(view!.findAll('tbody tr')).toHaveLength(50); await action(view!, 'pagination.next').trigger('click'); await flushPromises(); expect(view!.find('[data-job="task-50"]').exists()).toBe(true); await action(view!, 'pagination.previous').trigger('click'); await flushPromises(); expect(view!.find('[data-job="task-0"]').exists()).toBe(true)
  })
  it('opens a prompt on keyboard focus, copies the exact full text and closes after the delay', async () => {
    vi.useFakeTimers(); await render(); const detail = await details(); await detail.get('.batch-prompt-trigger').trigger('focus'); await flushPromises()
    const popup = bodyRoot().get('.batch-prompt-popover'); expect(popup.text()).toContain('Synthetic full prompt with meaningful details'); await action(popup, 'common.copy').trigger('click'); expect(fixture.copy).toHaveBeenCalledWith('Synthetic full prompt with meaningful details', 'batchImage.promptPopover.copied')
    await popup.trigger('mouseleave'); await vi.advanceTimersByTimeAsync(180); expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(false)
  })
  it('delays pointer prompt previews, cancels premature hovers and keeps an entered popup open', async () => {
    vi.useFakeTimers(); await render(); const detail = await details(); const trigger = detail.get('.batch-prompt-trigger')
    await trigger.trigger('mouseenter'); await vi.advanceTimersByTimeAsync(300); expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(false); await trigger.trigger('mouseleave'); await vi.advanceTimersByTimeAsync(600); expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(false)
    await trigger.trigger('pointerenter'); await vi.advanceTimersByTimeAsync(520); expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(true); await trigger.trigger('pointerleave'); await bodyRoot().get('.batch-prompt-popover').trigger('mouseenter'); await vi.advanceTimersByTimeAsync(200); expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(true)
  })
  it('does not create a prompt popover for an absent prompt and displays clear item error categories', async () => {
    items[0].prompt_preview = null; await render(); const detail = await details(); await detail.get('.batch-prompt-trigger').trigger('click')
    expect(bodyRoot().find('.batch-prompt-popover').exists()).toBe(false); expect(detail.text()).toContain('batchImage.itemResult.emptyImageOutput'); expect(detail.text()).toContain('batchImage.itemResult.providerItemFailed'); expect(detail.text()).toContain('Synthetic detail failure')
  })
  it('loads an owned image through fetch, opens its real preview dialog and revokes URLs when detail closes', async () => {
    await render(); const detail = await details(); await detail.get('button[title="batchImage.detail.previewLoad"]').trigger('click'); await flushPromises()
    expect(requests.some(request => request.path.endsWith('/items/image/content'))).toBe(true); expect(detail.get('img').attributes('src')).toMatch(/^blob:release-/)
    await detail.get('button[title="batchImage.detail.previewZoom:image"]').trigger('click'); await flushPromises(); const preview = dialog('image'); expect(preview.get('img').attributes('alt')).toBe('image'); await preview.get('button[aria-label="Close modal"]').trigger('click'); await flushPromises()
    await detail.get('button[aria-label="Close modal"]').trigger('click'); await flushPromises(); expect(fixture.revokeUrl).toHaveBeenCalledWith(fixture.createUrl.mock.results[0].value)
  })
  it('lets a failed image resource be explicitly reloaded without using another item or key', async () => {
    await render(); const detail = await details(); await detail.get('button[title="batchImage.detail.previewLoad"]').trigger('click'); await flushPromises(); await detail.get('img').trigger('error')
    const reload = detail.find('button[title="batchImage.detail.previewReload"]'); expect(reload.exists()).toBe(true); await reload.trigger('click'); await flushPromises(); expect(detail.get('img').attributes('src')).toMatch(/^blob:release-/)
  })
  it('refreshes detail with a new server status and exposes terminal zero-cost semantics', async () => {
    await render(); const detail = await details('B'); expect(detail.text()).toContain('$0.00'); const row = jobs.find(row => row.id === 'B')!; Object.assign(row, { status: 'cancelled' }); await action(detail, 'common.refresh').trigger('click'); await flushPromises(); expect(detail.text()).toContain('batchImage.status.cancelled')
  })
  it('cancels a running task through its existing endpoint and keeps the exact job identity', async () => {
    await render(); const detail = await details('C'); await action(detail, 'batchImage.actions.cancelJob').trigger('click'); await flushPromises()
    expect(requests.some(request => request.method === 'POST' && request.path === '/v1/images/batches/C/cancel')).toBe(true); expect(detail.text()).toContain('batchImage.status.cancelled')
  })
  it('deletes one acknowledged record from its real row menu after confirmation', async () => {
    await render(); const row = view!.get('[data-job="B"]'); await row.get('button[title="batchImage.actions.moreActions"]').trigger('click'); await flushPromises(); await action(bodyRoot(), 'batchImage.actions.deleteRecords').trigger('click'); await flushPromises()
    expect(requests.some(request => request.method === 'DELETE' && request.path === '/v1/images/batches/B')).toBe(true); expect(view!.find('[data-job="B"]').exists()).toBe(false)
  })
  it('removes a selected reference image before submitting a prompt-only synthetic job', async () => {
    await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic image prompt')
    const input = create.get<HTMLInputElement>('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['synthetic'], 'reference.png', { type: 'image/png' })] }); await input.trigger('change'); await vi.waitFor(() => expect(create.text()).toContain('reference.png'))
    await create.get('button[title="batchImage.create.removeReferenceImage"]').trigger('click'); expect(create.text()).not.toContain('reference.png')
    const submit = create.findAll('button').find(node => node.text() === 'batchImage.actions.submitJob')!; expect(submit).toBeDefined(); await submit.trigger('click'); await flushPromises()
    const request = requests.find(request => request.method === 'POST' && request.path === '/v1/images/batches')!; expect(request).toBeDefined(); expect((request.body.items as Record<string, unknown>[])[0]).toEqual({ custom_id: 'img_001', prompt: 'Synthetic image prompt' })
  })
  it.each([
    ['BATCH_IMAGE_NO_ACCOUNT_AVAILABLE', 'noCompatibleAccount', true],
    ['BATCH_IMAGE_UNSUPPORTED_PROVIDER', 'unsupportedProvider', true],
    ['BATCH_IMAGE_QUEUE_NOT_CONFIGURED', 'queueFailed', true],
    ['BATCH_IMAGE_BILLING_HOLD_FAILED', 'billingHoldFailed', true],
    ['BATCH_IMAGE_GROUP_DISABLED', 'groupDisabled', false],
    ['BATCH_IMAGE_INSUFFICIENT_BALANCE', 'insufficientBalance', false],
    ['BATCH_IMAGE_INVALID_MODEL', 'invalidModel', false],
  ])('shows an actionable %s submission refusal and retains the user prompt', async (code, label, admin) => {
    await render(); const create = await createDialog(); await create.get('textarea').setValue('Synthetic retained prompt'); failure = { suffix: '/v1/images/batches', code }
    const submit = create.findAll('button').find(node => node.text() === 'batchImage.actions.submitJob')!; expect(submit).toBeDefined(); await submit.trigger('click'); await flushPromises()
    expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining(`batchImage.messages.${label}`)); expect(create.text()).toContain('Synthetic retained prompt')
    if (admin) expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('synthetic-request-206'))
    const refused = requests.find(request => request.method === 'POST' && request.path === '/v1/images/batches')!
    failure = undefined; await action(create, 'batchImage.actions.submitJob').trigger('click'); await flushPromises()
    const retried = requests.filter(request => request.method === 'POST' && request.path === '/v1/images/batches').at(-1)!
    expect(retried.body.items).toEqual(refused.body.items); expect(retried.body.items).toEqual([{ custom_id: 'img_001', prompt: 'Synthetic retained prompt' }]); expect(fixture.success).toHaveBeenCalledWith('batchImage.messages.submitted')
  })
})
