import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { replaceAuthSession } from '@/api/authSession'
import BatchImageGuideView from '../BatchImageGuideView.vue'

const api = vi.hoisted(() => ({
  keys: vi.fn(), models: vi.fn(), jobs: vi.fn(), items: vi.fn(), recovery: vi.fn(), job: vi.fn(), cancel: vi.fn(), content: vi.fn(), download: vi.fn(), save: vi.fn(), submit: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/api', () => ({ keysAPI: { list: api.keys } }))
vi.mock('@/api/batchImage', async () => ({
  ...await vi.importActual<typeof import('@/api/batchImage')>('@/api/batchImage'),
  listBatchImageModels: api.models, listBatchImageJobs: api.jobs, listBatchImageItems: api.items,
  getBatchImageJob: api.job, getBatchImageItemContent: api.content, downloadBatchImageZip: api.download,
  cancelBatchImageJob: api.cancel,
  saveBlob: api.save, submitBatchImageJob: api.submit,
  getBatchImageRecovery: api.recovery,
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error, publicSettings: {}, fetchPublicSettings: vi.fn().mockResolvedValue({}) }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }) }))
const fixtureJob = (id: string) => ({ id, task_name: id, status: 'running', model: 'fixture-image', created_at: 1, item_count: 1, success_count: 1, fail_count: 0 })
const fixtureKey = { id: 1, key: 'synthetic-key', status: 'active', name: 'fixture', group: { platform: 'gemini', allow_batch_image_generation: true } }
const history = (id: string, customId: string, prompt: string) => ({ object: 'image.batch.recovery', complete: true, batch_id: id, root_batch_id: id, root_custom_ids: [customId], target_items: [{ custom_id: customId, status: 'failed', prompt_preview: prompt }], successful_items: [], pending_items: [], input_mode: 'prompt_only' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

describe('batch image page lifecycle', () => {
  let wrapper: VueWrapper | undefined
  let view: any
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('confirm', vi.fn(() => true))
    localStorage.clear()
    for (const mock of Object.values(api)) mock.mockReset()
    api.keys.mockResolvedValue({ items: [fixtureKey] })
    api.models.mockResolvedValue({ data: [{ id: 'fixture-image' }] })
    api.jobs.mockResolvedValue({ data: [fixtureJob('A'), fixtureJob('B')] })
    api.items.mockResolvedValue({ data: [] })
    api.recovery.mockResolvedValue(history('A', 'original', 'Synthetic retry'))
    api.job.mockImplementation(async (_key, id) => fixtureJob(id))
    wrapper = shallowMount(BatchImageGuideView, { global: { stubs: {
      AppLayout: { template: '<main><slot /></main>' }, TablePageLayout: { template: '<section><slot name="table" /></section>' },
      'i18n-t': { template: '<span><slot /></span>' },
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

  it.each(['refresh', 'cancel', 'submit', 'retry'])('keeps the original API Key when a late %s result arrives after the create key changes', async (operation) => {
    const secondKey = { ...fixtureKey, id: 2, key: 'synthetic-second-key', name: 'Second key' }
    api.keys.mockResolvedValue({ items: [fixtureKey, secondKey] })
    await view.loadApiKeys()
    await view.loadBatchJobs()
    view.selectJob('A')
    await flushPromises()
    const response = deferred<ReturnType<typeof fixtureJob>>()
    let pending: Promise<void>
    let resultId = 'A'
    if (operation === 'refresh') {
      api.job.mockReturnValueOnce(response.promise)
      pending = view.refreshSelected()
      expect(api.job).toHaveBeenLastCalledWith('synthetic-key', 'A', expect.any(AbortSignal))
    } else if (operation === 'cancel') {
      vi.stubGlobal('confirm', vi.fn(() => true))
      api.cancel.mockReturnValueOnce(response.promise)
      pending = view.cancelSelected()
      expect(api.cancel).toHaveBeenCalledWith('synthetic-key', 'A', expect.any(AbortSignal))
    } else if (operation === 'submit') {
      resultId = 'new-A'
      view.promptDraft = 'Synthetic image prompt'
      api.submit.mockReturnValueOnce(response.promise)
      pending = view.submitJob()
      expect(api.submit).toHaveBeenCalledWith('synthetic-key', expect.objectContaining({ items: [expect.objectContaining({ prompt: 'Synthetic image prompt' })] }), expect.any(String), expect.any(AbortSignal))
    } else {
      resultId = 'retry-A'
      api.recovery.mockResolvedValueOnce(history('A', 'original', 'Retry this synthetic prompt'))
      api.submit.mockReturnValueOnce(response.promise)
      pending = view.retryFailedJob({ ...view.batchJobs.find((job: { id: string }) => job.id === 'A'), status: 'completed', fail_count: 1 })
      await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
      expect(api.submit).toHaveBeenCalledWith('synthetic-key', expect.objectContaining({ parent_batch_id: 'A' }), expect.any(String), expect.any(AbortSignal))
    }

    view.form.apiKeyId = 2
    await flushPromises()
    response.resolve(fixtureJob(resultId))
    await pending
    const row = view.batchJobs.find((job: { id: string }) => job.id === resultId)
    expect(row.api_key_id).toBe(1)
    expect(row.api_key_name).toBe('fixture')
    api.download.mockResolvedValue(new Blob(['synthetic archive']))
    await view.downloadJob(row)
    expect(api.download).toHaveBeenLastCalledWith('synthetic-key', resultId, expect.any(AbortSignal))
  })

  it('ends list loading when refreshed keys disappear after a filter starts another list request', async () => {
    const keys = deferred<{ items: unknown[] }>()
    api.keys.mockReturnValueOnce(keys.promise)
    const refreshing = view.refreshPage()
    const jobs = deferred<{ data: unknown[] }>()
    api.jobs.mockReturnValueOnce(jobs.promise)
    view.filters.status = 'running'
    view.applyFilters()
    expect(view.loadingJobs).toBe(true)
    const filterRequest = api.jobs.mock.calls.at(-1)!
    keys.resolve({ items: [] })
    await refreshing
    expect(filterRequest[2].aborted).toBe(true)
    jobs.resolve({ data: [fixtureJob('outdated')] })
    await flushPromises()
    expect(view.batchJobs).toEqual([])
    expect(view.loadingKeys).toBe(false)
    expect(view.loadingJobs).toBe(false)
  })

  it('ends model loading when the key is cleared and refuses the old model response', async () => {
    const response = deferred<{ data: { id: string }[] }>()
    api.models.mockReturnValueOnce(response.promise)
    const pending = view.loadAvailableModels()
    expect(view.loadingModels).toBe(true)
    view.form.apiKeyId = 0
    await flushPromises()
    response.resolve({ data: [{ id: 'stale-model' }] })
    await pending
    expect(view.form.model).toBe('')
    expect(view.availableBatchImageModels).toEqual([])
    expect(view.loadingModels).toBe(false)
  })

  it.each(['download', 'retry'])('uses the detail owner for %s after the create key changes', async (operation) => {
    const secondKey = { ...fixtureKey, id: 2, key: 'synthetic-second-key', name: 'Second key' }
    api.keys.mockResolvedValue({ items: [fixtureKey, secondKey] })
    await view.loadApiKeys()
    await view.loadBatchJobs()
    view.selectJob('A')
    await flushPromises()
    view.form.apiKeyId = 2
    await flushPromises()
    if (operation === 'download') {
      api.download.mockResolvedValue(new Blob(['archive']))
      await view.downloadSelected()
      expect(api.download).toHaveBeenCalledWith('synthetic-key', 'A', expect.any(AbortSignal))
    } else {
      view.currentJob = { ...fixtureJob('A'), status: 'completed', fail_count: 1 }
      api.recovery.mockResolvedValueOnce(history('A', 'failed', 'Synthetic retry'))
      api.submit.mockResolvedValueOnce(fixtureJob('retry-A'))
      await view.retrySelected()
      expect(api.recovery).toHaveBeenCalledWith('synthetic-key', 'A', expect.any(AbortSignal))
      expect(api.submit).toHaveBeenCalledWith('synthetic-key', expect.objectContaining({ parent_batch_id: 'A' }), expect.any(String), expect.any(AbortSignal))
    }
  })

  it.each(['download', 'retry', 'refresh', 'cancel'])('does not borrow another key for %s when the detail owner is removed', async (operation) => {
    const secondKey = { ...fixtureKey, id: 2, key: 'synthetic-second-key', name: 'Second key' }
    api.keys.mockResolvedValue({ items: [fixtureKey, secondKey] })
    await view.loadApiKeys()
    await view.loadBatchJobs()
    view.selectJob('A')
    await flushPromises()
    api.keys.mockResolvedValueOnce({ items: [secondKey] })
    await view.loadApiKeys()
    await flushPromises()
    api.job.mockClear()
    api.items.mockClear()
    api.recovery.mockClear()
    vi.stubGlobal('confirm', vi.fn(() => true))
    if (operation === 'download') await view.downloadSelected()
    if (operation === 'retry') {
      view.currentJob = { ...fixtureJob('A'), status: 'completed', fail_count: 1 }
      await view.retrySelected()
    }
    if (operation === 'refresh') await view.refreshSelected()
    if (operation === 'cancel') await view.cancelSelected()
    expect(api.download).not.toHaveBeenCalled()
    expect(api.items).not.toHaveBeenCalled()
    expect(api.recovery).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    expect(api.job).not.toHaveBeenCalled()
    expect(api.cancel).not.toHaveBeenCalled()
    expect(view.form.apiKeyId).toBe(2)
  })
})
