import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

const { exportList, saveAs, sheetAddAoa, showError, xlsxWrite } = vi.hoisted(() => ({
  exportList: vi.fn(), saveAs: vi.fn(), sheetAddAoa: vi.fn(), showError: vi.fn(), xlsxWrite: vi.fn(),
}))
vi.mock('@/api/admin', () => ({ adminAPI: {
  usage: { list: vi.fn().mockResolvedValue({ items: [], total: 0, pages: 0 }), getStats: vi.fn().mockResolvedValue({}) },
  dashboard: { getSnapshotV2: vi.fn().mockResolvedValue({ trend: [], models: [], groups: [] }), getModelStats: vi.fn().mockResolvedValue({ models: [] }) },
  users: { getById: vi.fn() },
} }))
vi.mock('@/api/admin/usage', () => ({ adminUsageAPI: { list: exportList } }))
vi.mock('@/api/admin/ops', () => ({ listErrorLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showWarning: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<object>('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('file-saver', () => ({ saveAs }))
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: vi.fn(() => ({})), sheet_add_aoa: sheetAddAoa, book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  write: xlsxWrite,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const row = { created_at: '2026-11-01T00:00:00Z', model: 'synthetic-model', input_tokens: 1, output_tokens: 2, duration_ms: 10 }
const page = { items: Array.from({ length: 100 }, () => ({ ...row })), total: 101, pages: 2 }
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  exportList.mockReset()
  saveAs.mockClear()
  sheetAddAoa.mockClear()
  showError.mockClear()
  xlsxWrite.mockReset().mockReturnValue(new Uint8Array([1, 2, 3]))
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

async function setup() {
  const sessions = await import('@/api/authSession')
  sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-EXPORT-A', user: { id: 101 } })
  sessions.adoptDocumentAuthSession()
  const UsageView = (await import('../UsageView.vue')).default
  wrapper = mount(UsageView, { global: { stubs: {
    AppLayout: { template: '<div><slot /></div>' }, Pagination: true, Select: true, DateRangePicker: true,
    UsageStatsCards: true, UsageFilters: true, UsageTable: true, UsageExportProgress: true,
    UserTokenRanking: true, UsageCleanupDialog: true, UserBalanceHistoryModal: true,
    OpsErrorLogTable: true, OpsErrorDetailModal: true, ModelDistributionChart: true,
    GroupDistributionChart: true, TokenUsageTrend: true, EndpointDistributionChart: true, Icon: true,
  } } })
  vi.advanceTimersByTime(120)
  await flushPromises()
  const vm = wrapper.vm as any
  vm.filters.start_date = '2026-11-01'
  vm.filters.end_date = '2026-11-05'
  vm.filters.user_id = 101
  vm.sortState.sort_by = 'created_at'
  vm.sortState.sort_order = 'desc'
  return { vm, sessions }
}

describe('admin spreadsheet export ownership', () => {
  it('keeps its initial filters, ordering and filename across all pages', async () => {
    const first = deferred<typeof page>()
    exportList.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...page, items: [row] })
    const { vm } = await setup()
    const run = vm.exportToExcel()
    await flushPromises()
    expect(exportList).toHaveBeenCalledTimes(1)
    const initial = { ...exportList.mock.calls[0][0] }
    vm.filters.user_id = 202
    vm.filters.start_date = '2026-10-01'
    vm.filters.end_date = '2026-10-31'
    vm.sortState.sort_by = 'actual_cost'
    vm.sortState.sort_order = 'asc'
    first.resolve(page)
    await run
    expect(exportList.mock.calls.map(call => call[0])).toEqual([initial, { ...initial, page: 2 }])
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'usage_2026-11-01_to_2026-11-05.xlsx')
  })

  it('aborts and discards the old export when even the same administrator starts a new session', async () => {
    const first = deferred<typeof page>()
    exportList.mockReturnValueOnce(first.promise).mockResolvedValue({ ...page, items: [row] })
    const { vm, sessions } = await setup()
    const run = vm.exportToExcel()
    await flushPromises()
    const signal = exportList.mock.calls[0][1].signal as AbortSignal
    sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-EXPORT-B', user: { id: 101 } })
    const cancelled = signal.aborted
    first.resolve(page)
    await run
    expect(cancelled).toBe(true)
    expect(exportList).toHaveBeenCalledTimes(1)
    expect(sheetAddAoa).not.toHaveBeenCalled()
    expect(saveAs).not.toHaveBeenCalled()
  })

  it('does not show a late export error after leaving the page', async () => {
    const first = deferred<typeof page>()
    exportList.mockReturnValue(first.promise)
    const { vm } = await setup()
    const run = vm.exportToExcel()
    await flushPromises()
    wrapper!.unmount()
    wrapper = undefined
    first.reject(new DOMException('Cancelled by navigation', 'AbortError'))
    await run
    expect(showError).not.toHaveBeenCalled()
    expect(saveAs).not.toHaveBeenCalled()
  })

  it('checks ownership again after synchronous workbook serialization', async () => {
    exportList.mockResolvedValue({ items: [row], total: 1, pages: 1 })
    const { vm, sessions } = await setup()
    xlsxWrite.mockImplementationOnce(() => {
      sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-EXPORT-B', user: { id: 101 } })
      return new Uint8Array([1, 2, 3])
    })
    await vm.exportToExcel()
    expect(xlsxWrite).toHaveBeenCalledTimes(1)
    expect(saveAs).not.toHaveBeenCalled()
  })
})
