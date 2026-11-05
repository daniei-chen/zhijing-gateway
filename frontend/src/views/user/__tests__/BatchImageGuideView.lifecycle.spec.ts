import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { replaceAuthSession } from '@/api/authSession'
import BatchImageGuideView from '../BatchImageGuideView.vue'

const api = vi.hoisted(() => ({
  keys: vi.fn(), models: vi.fn(), jobs: vi.fn(), items: vi.fn(), job: vi.fn(), content: vi.fn(), download: vi.fn(), save: vi.fn(), submit: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/api', () => ({ keysAPI: { list: api.keys } }))
vi.mock('@/api/batchImage', async () => ({
  ...await vi.importActual<typeof import('@/api/batchImage')>('@/api/batchImage'),
  listBatchImageModels: api.models, listBatchImageJobs: api.jobs, listBatchImageItems: api.items,
  getBatchImageJob: api.job, getBatchImageItemContent: api.content, downloadBatchImageZip: api.download,
  saveBlob: api.save, submitBatchImageJob: api.submit,
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error, publicSettings: {}, fetchPublicSettings: vi.fn().mockResolvedValue({}) }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }) }))
const fixtureJob = (id: string) => ({ id, task_name: id, status: 'running', model: 'fixture-image', created_at: 1, item_count: 1, success_count: 1, fail_count: 0 })
const fixtureKey = { id: 1, key: 'synthetic-key', status: 'active', name: 'fixture', group: { platform: 'gemini', allow_batch_image_generation: true } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

describe('batch image page lifecycle', () => {
  let wrapper: VueWrapper | undefined
  let view: any
  beforeEach(async () => {
    localStorage.clear()
    for (const mock of Object.values(api)) mock.mockReset()
    api.keys.mockResolvedValue({ items: [fixtureKey] })
    api.models.mockResolvedValue({ data: [{ id: 'fixture-image' }] })
    api.jobs.mockResolvedValue({ data: [fixtureJob('A'), fixtureJob('B')] })
    api.items.mockResolvedValue({ data: [] })
    api.job.mockImplementation(async (_key, id) => fixtureJob(id))
    wrapper = shallowMount(BatchImageGuideView, { global: { stubs: {
      AppLayout: { template: '<main><slot /></main>' }, TablePageLayout: { template: '<section><slot name="table" /></section>' },
    } } })
    view = wrapper.vm as any
    await flushPromises()
  })
  afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('does not let an old A response overwrite a newer A selection after A to B to A', async () => {
    const old = deferred<ReturnType<typeof fixtureJob>>()
    api.job.mockImplementationOnce(() => old.promise)
    view.selectJob('A')
    view.selectJob('B')
    view.selectJob('A')
    await flushPromises()
    expect(view.currentJob.id).toBe('A')
    old.resolve({ ...fixtureJob('A'), task_name: 'stale response' })
    await flushPromises()
    expect(view.currentJob.task_name).toBe('A')
  })
  it('never downloads a late archive after logout and another account login', async () => {
    const archive = deferred<Blob>()
    api.download.mockReturnValue(archive.promise)
    const task = view.downloadJob({ ...fixtureJob('A'), api_key_id: 1 })
    replaceAuthSession({ accessToken: 'other-fixture-token', user: { id: 9 } })
    archive.resolve(new Blob(['synthetic archive']))
    await task
    expect(api.save).not.toHaveBeenCalled()
  })
  it('does not abort an active download when the same action is clicked twice', async () => {
    const archive = deferred<Blob>()
    api.download.mockReturnValue(archive.promise)
    const job = { ...fixtureJob('A'), api_key_id: 1 }
    const first = view.downloadJob(job)
    await view.downloadJob(job)
    expect(api.download).toHaveBeenCalledTimes(1)
    expect(api.download.mock.calls[0][2].aborted).toBe(false)
    archive.resolve(new Blob(['synthetic archive']))
    await first
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(view.downloading).toBe(false)
  })
  it('does not allocate a preview URL after the component has unmounted', async () => {
    const content = deferred<Blob>()
    api.content.mockReturnValue(content.promise)
    const create = vi.fn(() => 'blob:fixture')
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn() })
    view.selectJob('A');await flushPromises()
    const task = view.loadItemPreview({ batch_id: 'A', custom_id: 'fixture', status: 'succeeded', image_count: 1 })
    await flushPromises()
    expect(api.content).toHaveBeenCalledTimes(1)
    wrapper!.unmount();wrapper=undefined
    content.resolve(new Blob(['fixture']))
    await task
    expect(create).not.toHaveBeenCalled()
  })
  it('serializes polls when a refresh is slower than the poll interval', async () => {
    vi.useFakeTimers()
    view.selectJob('A');await flushPromises()
    const refresh = deferred<ReturnType<typeof fixtureJob>>()
    api.job.mockReturnValue(refresh.promise)
    const before = api.job.mock.calls.length
    await vi.advanceTimersByTimeAsync(8000)
    await vi.advanceTimersByTimeAsync(24000)
    expect(api.job).toHaveBeenCalledTimes(before + 1)
    refresh.resolve(fixtureJob('A'));await flushPromises()
    await vi.advanceTimersByTimeAsync(7999)
    expect(api.job).toHaveBeenCalledTimes(before + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.job).toHaveBeenCalledTimes(before + 2)
  })
})
