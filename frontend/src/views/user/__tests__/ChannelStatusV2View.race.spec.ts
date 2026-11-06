import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { MonitorFilter } from '@/api/channelMonitorV2'
import ChannelStatusV2View from '../ChannelStatusV2View.vue'

const { getDimensions, getSnapshot, getMatrix, getModels, getErrors, getUsers, showError } = vi.hoisted(() => ({
  getDimensions: vi.fn(), getSnapshot: vi.fn(), getMatrix: vi.fn(), getModels: vi.fn(),
  getErrors: vi.fn(), getUsers: vi.fn(), showError: vi.fn(),
}))
vi.mock('@/api/channelMonitorV2', () => ({ getDimensions, getSnapshot, getMatrix, getModels, getErrors, getUsers }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isAdmin: true }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError }) }))
vi.mock('@/components/layout/AppLayout.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/utils/featureFlags', () => ({ isChannelMonitorThroughputHidden: () => false, isChannelMonitorUserRankingHidden: () => false }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: { value: 'en' } }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
type ViewState = {
  filter: MonitorFilter
  activeTab: string
  modelRows: unknown[]
  tabLoading: boolean
}
const wrappers: ReturnType<typeof shallowMount>[] = []
function mountView() {
  const wrapper = shallowMount(ChannelStatusV2View)
  wrappers.push(wrapper)
  return { wrapper, state: wrapper.vm as unknown as ViewState }
}

describe('channel monitor V2 request ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getDimensions.mockReset().mockResolvedValue({ platforms: [], groups: [], models: [] })
    getSnapshot.mockReset().mockResolvedValue(null)
    getMatrix.mockReset().mockResolvedValue({ items: [] })
    getModels.mockReset().mockResolvedValue({ items: [] })
    getErrors.mockReset().mockResolvedValue({ items: [] })
    getUsers.mockReset().mockResolvedValue({ items: [] })
  })
  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not overwrite the current filter with a response whose adapter ignored abort', async () => {
    const old = deferred<object>()
    getModels.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [{ model: 'new' }] })
    const { state } = mountView()
    await flushPromises()
    const oldSignal = getModels.mock.calls[0][2] as AbortSignal
    state.filter.range = '24h'
    await flushPromises()
    expect(state.modelRows).toEqual([{ model: 'new' }])
    old.resolve({ items: [{ model: 'old' }] })
    await flushPromises()
    expect(state.modelRows).toEqual([{ model: 'new' }])
    expect(oldSignal.aborted).toBe(true)
  })

  it('preserves the new tab loading state when an earlier tab request finishes', async () => {
    const old = deferred<object>()
    const current = deferred<object>()
    getModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { state } = mountView()
    await flushPromises()
    state.activeTab = 'errors'
    await flushPromises()
    state.activeTab = 'models'
    await flushPromises()
    old.resolve({ items: [{ model: 'old' }] })
    await flushPromises()
    expect(state.tabLoading).toBe(true)
    expect(state.modelRows).toEqual([])
    current.resolve({ items: [{ model: 'current' }] })
    await flushPromises()
    expect(state.modelRows).toEqual([{ model: 'current' }])
    expect(state.tabLoading).toBe(false)
  })

  it('suppresses errors from a superseded tab request', async () => {
    const old = deferred<object>()
    getModels.mockReturnValueOnce(old.promise)
    const { state } = mountView()
    await flushPromises()
    state.activeTab = 'errors'
    await flushPromises()
    old.reject(new Error('obsolete failure'))
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })

  it('does not restart polling or load a tab after unmount during metrics loading', async () => {
    const slow = deferred<object>()
    getSnapshot.mockReturnValueOnce(slow.promise)
    const { wrapper } = mountView()
    await flushPromises()
    wrapper.unmount()
    slow.resolve({ config: { refresh_interval_seconds: 60 } })
    await flushPromises()
    expect(getModels).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(showError).not.toHaveBeenCalled()
  })
})
