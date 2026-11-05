import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BackupView from '../BackupView.vue'

const { getBackup, listBackups, showSuccess, showError, showWarning } = vi.hoisted(() => ({
  getBackup: vi.fn(), listBackups: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
}))
vi.mock('@/api', () => ({ adminAPI: { backup: {
  getS3Config: vi.fn().mockResolvedValue({}),
  getImageStorageConfig: vi.fn().mockResolvedValue({ config: {}, secret_configured: false }),
  getSchedule: vi.fn().mockResolvedValue({}),
  getBackup, listBackups,
} } }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess, showError, showWarning }) }))
vi.mock('@/composables/useStepUp', () => ({
  useStepUp: () => ({ run: (fn: () => unknown) => fn() }),
  isStepUpBlocked: () => false, isStepUpCancelled: () => false, stepUpBlockReason: () => '',
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function record(id: string, operation: string, completed = false) {
  return {
    id, file_name: `${id}.sql.gz`, status: operation === 'backup' && !completed ? 'running' : 'completed',
    restore_status: operation === 'restore' ? completed ? 'completed' : 'running' : undefined,
    started_at: '2026-10-01T00:00:00Z', size_bytes: 100,
  }
}

const wrappers: ReturnType<typeof mount>[] = []
function mountView() {
  const wrapper = mount(BackupView, { global: { stubs: { TotpStepUpDialog: true, BackupArchiveSettings: true } } })
  wrappers.push(wrapper)
  return wrapper
}

describe.each(['backup', 'restore'])('backup page %s poll ownership', (operation) => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getBackup.mockReset()
    listBackups.mockReset().mockResolvedValue({ items: [record('current', operation)] })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps at most one request in flight when a response takes several intervals', async () => {
    const slow = deferred<object>()
    getBackup.mockReturnValue(slow.promise)
    mountView()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(8000)
    expect(getBackup).toHaveBeenCalledTimes(1)
    slow.resolve(record('current', operation))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    expect(getBackup).toHaveBeenCalledTimes(2)
  })

  it('ignores a completion after navigation and does not reload the list or notify', async () => {
    const slow = deferred<object>()
    getBackup.mockReturnValueOnce(slow.promise)
    const wrapper = mountView()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    wrapper.unmount()
    slow.resolve(record('current', operation, true))
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(listBackups).toHaveBeenCalledTimes(1)
    expect(getBackup.mock.calls[0][1]?.aborted).toBe(true)
  })

  it('does not let an old poll stop the new poll after a visibility restart', async () => {
    const old = deferred<object>()
    const current = deferred<object>()
    getBackup.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mountView()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    listBackups.mockResolvedValue({ items: [record('new', operation)] })
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    expect(getBackup.mock.calls[1][0]).toBe('new')
    old.resolve(record('current', operation, true))
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    current.resolve(record('new', operation, true))
    await flushPromises()
    expect(showSuccess).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
