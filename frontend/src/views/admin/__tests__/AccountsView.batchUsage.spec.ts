import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import AccountsView from '../AccountsView.vue'
import type { AccountUsageInfo } from '@/types'

const { list, getBatchUsage, getUsage } = vi.hoisted(() => ({ list: vi.fn(), getBatchUsage: vi.fn(), getUsage: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { list, listWithEtag: vi.fn().mockResolvedValue({ notModified: true, data: null }), getBatchUsage, getUsage,
    getBatchTodayStats: vi.fn().mockResolvedValue({ stats: {} }), getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: false }) },
  proxies: { getAll: vi.fn().mockResolvedValue([]) }, groups: { getAll: vi.fn().mockResolvedValue([]) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: vi.fn(), showWarning: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ token: 'synthetic-login', isSimpleMode: false }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

const Table = defineComponent({
  props: ['data'], setup: () => ({ visible: ref(true) }),
  template: '<div><button data-test="toggle-cell" @click="visible = !visible">toggle cell</button><div v-if="visible" v-for="row in data" :key="row.id"><slot name="cell-usage" :row="row"/></div></div>'
})
const Reset = defineComponent({ emits: ['redeemed'], template: '<div><slot name="pre-actions"/><button data-test="redeemed" @click="$emit(\'redeemed\')">redeemed credit</button></div>' })
const wrappers: VueWrapper[] = []
const account = { id: 41, name: 'Synthetic usage account', platform: 'anthropic', type: 'oauth', status: 'active', schedulable: true, group_ids: [], concurrency: 1, priority: 1, credentials: {}, extra: {} }
function usage(percent: number): AccountUsageInfo { return { five_hour: { utilization: percent, resets_at: null } } as AccountUsageInfo }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
function view() {
  const wrapper = mount(AccountsView, { global: { stubs: {
    AppLayout: { template: '<div><slot/></div>' }, TablePageLayout: { template: '<div><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
    DataTable: Table, AccountTableFilters: true, AccountTableActions: { template: '<div><slot name="after"/></div>' }, AccountBulkActionsBar: true,
    Pagination: true, ConfirmDialog: true, AccountActionMenu: true, ImportDataModal: true, ReAuthAccountModal: true, AccountTestModal: true, AccountStatsModal: true,
    ScheduledTestsPanel: true, SyncFromCrsModal: true, TempUnschedStatusModal: true, ErrorPassthroughRulesModal: true, TLSFingerprintProfilesModal: true,
    CreateAccountModal: true, EditAccountModal: true, BulkEditAccountModal: true, PlatformTypeBadge: true, AccountCapacityCell: true, AccountStatusIndicator: true,
    AccountTodayStatsCell: true, AccountGroupsCell: true, UpstreamBillingRateCell: true, HelpTooltip: true, Icon: true, Teleport: true,
    ClaudeResetCreditsCell: Reset, OpenAIQuotaResetCell: true, GrokQuotaProbeCell: true, AccountQuotaInfo: true, CNProviderQuotaCell: true, CNProviderBalanceCell: true,
    OllamaCloudUsageCell: true, OpenCodeGoUsageCell: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
async function startBatch() { await flushPromises(); await vi.advanceTimersByTimeAsync(1); await flushPromises() }
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
  list.mockReset().mockResolvedValue({ items: [account], total: 1, pages: 1 })
  getBatchUsage.mockReset()
  getUsage.mockReset().mockResolvedValue(usage(72))
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('AccountsView active and passive usage coordination', () => {
  it.each(['success', 'error'])('keeps the active snapshot after the older batch %s completes', async (outcome) => {
    const pending = deferred<{ usage: Record<string, AccountUsageInfo>; errors: Record<string, string> }>()
    getBatchUsage.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await startBatch()
    expect(getBatchUsage).toHaveBeenCalledExactlyOnceWith([41], false)
    await wrapper.get('[data-test="redeemed"]').trigger('click')
    await flushPromises()
    expect(getUsage).toHaveBeenCalledExactlyOnceWith(41, 'active', true)
    expect(wrapper.text()).toContain('72%')
    if (outcome === 'success') pending.resolve({ usage: { '41': usage(13) }, errors: {} })
    else pending.reject(new Error('synthetic old batch failure'))
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('13%')
    expect(wrapper.text()).not.toContain('Failed')
  })

  it('reuses the completed active snapshot when the same visible row is remounted', async () => {
    getBatchUsage.mockResolvedValueOnce({ usage: { '41': usage(11) }, errors: {} })
    const wrapper = view()
    await startBatch()
    expect(wrapper.text()).toContain('11%')
    await wrapper.get('[data-test="redeemed"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('72%')
    await wrapper.get('[data-test="toggle-cell"]').trigger('click')
    await wrapper.get('[data-test="toggle-cell"]').trigger('click')
    await startBatch()
    expect(getBatchUsage).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('72%')
    expect(wrapper.text()).not.toContain('11%')
  })
})
