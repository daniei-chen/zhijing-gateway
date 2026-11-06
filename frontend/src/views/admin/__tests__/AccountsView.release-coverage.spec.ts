import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent } from 'vue'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import AccountsView from '../AccountsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const ui = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  accounts: {
    ...(await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')).accountsAPI,
    getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: true }),
    getBatchUsage: vi.fn().mockResolvedValue({ accounts: {} }),
    getBatchTodayStats: vi.fn().mockResolvedValue({ stats: {} })
  },
  proxies: { getAll: vi.fn().mockResolvedValue([]) },
  groups: { getAll: vi.fn().mockResolvedValue([{ id: 841, name: 'Synthetic routing group', platform: 'openai', status: 'active' }]) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({
  showSuccess: ui.success, showError: ui.error, showWarning: ui.warning, showInfo: ui.info
}) }))
vi.mock('@/stores', () => ({ useAppStore: () => ({
  showSuccess: ui.success, showError: ui.error, showWarning: ui.warning, showInfo: ui.info
}), useAuthStore: () => ({ isSimpleMode: false, token: 'synthetic-account-release-admin' }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: false, token: 'synthetic-account-release-admin' }) }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key })
}))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const ToolDialog = defineComponent({
  props: ['show'], emits: ['close'],
  template: '<section v-if="show" role="dialog" aria-label="Synthetic tool"><button type="button" @click="$emit(\'close\')">Close synthetic tool</button></section>'
})
type Wire = {
  method: string
  path: string
  body: Record<string, any>
  params: Record<string, any>
  config: InternalAxiosRequestConfig
}
const originalAdapter = apiClient.defaults.adapter
let view: VueWrapper | undefined
let wire: Wire[] = []
let unexpected: string[] = []
let data: ReturnType<typeof account>[] = []
let route: (request: Wire) => Promise<unknown>
const dom = () => new DOMWrapper(document.body)
function account(id = 84, patch: Record<string, unknown> = {}) {
  return {
    id, name: `Synthetic visible account ${id}`, platform: 'openai', type: 'apikey',
    credentials: { base_url: 'https://gateway.example.test/v1' }, extra: {},
    status: 'active', schedulable: true, concurrency: 3, priority: 5, rate_multiplier: 1,
    notes: 'Synthetic operator note', group_ids: [841], proxy_id: null,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
    last_used_at: null, expires_at: null, auto_pause_on_expired: true, ...patch
  }
}
const normal = async (request: Wire): Promise<unknown> => {
  if (request.method === 'get' && request.path === '/admin/accounts') {
    return { items: data, total: data.length, page: request.params.page ?? 1, page_size: request.params.page_size ?? 20, pages: 1 }
  }
  if (request.path === '/admin/accounts/84' && request.method === 'put') {
    data[0] = { ...data[0]!, ...request.body }
    return data[0]
  }
  if (/\/usage$/.test(request.path)) return { five_hour: { utilization: 15 }, seven_day: { utilization: 20 } }
  unexpected.push(`${request.method} ${request.path}`)
  throw new Error('Unexpected synthetic account release endpoint')
}
function rejected(request: Wire) {
  return new AxiosError('Synthetic priority rejected', 'ERR_BAD_RESPONSE', request.config, undefined, {
    status: 503, statusText: 'Synthetic', headers: {}, config: request.config, data: { message: 'Synthetic priority rejected' }
  })
}
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  await router.isReady()
  view = mount(AccountsView, {
    attachTo: document.body,
    global: {
      plugins: [router], mocks: { $t: (key: string) => key },
      stubs: {
        AppLayout: { template: '<main><slot /></main>' },
        Icon: true, Transition: true,
        CreateAccountModal: ToolDialog, EditAccountModal: ToolDialog, ReAuthAccountModal: ToolDialog,
        AccountTestModal: ToolDialog, AccountStatsModal: ToolDialog, ScheduledTestsPanel: ToolDialog,
        SyncFromCrsModal: ToolDialog, ImportDataModal: ToolDialog, BulkEditAccountModal: ToolDialog,
        TempUnschedStatusModal: ToolDialog, ErrorPassthroughRulesModal: ToolDialog, TLSFingerprintProfilesModal: ToolDialog
      }
    }
  })
  await flushPromises()
}
function button(text: string, root = dom()) {
  const found = root.findAll('button').find(node => node.text() === text)
  expect(found, `visible button ${text}`).toBeDefined()
  return found!
}
async function click(text: string, root = dom()) {
  const target = button(text, root).element as HTMLButtonElement
  target.click()
  await flushPromises()
}
function row(id = 84) {
  const found = dom().findAll('tbody tr').find(node => node.text().includes(`Synthetic visible account ${id}`))
  expect(found, `real account table row ${id}`).toBeDefined()
  return found!
}
async function option(text: string, selected: string) {
  const trigger = dom().findAll('button[aria-haspopup="true"]').find(node => node.text() === selected)
  expect(trigger, `filter trigger ${selected}`).toBeDefined()
  await trigger!.trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const found = dom().findAll('[role="option"]').find(node => node.text() === text)
  expect(found, `public Select option ${text}`).toBeDefined()
  ;(found!.element as HTMLElement).click()
  await flushPromises()
}
async function column(label: string) {
  await click('admin.accounts.moreActions')
  await click(label)
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}
const lists = () => wire.filter(request => request.path === '/admin/accounts' && request.method === 'get')

beforeEach(() => {
  wire = []
  unexpected = []
  data = [account()]
  route = normal
  Object.values(ui).forEach(mock => mock.mockReset())
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-account-release-admin', user: { id: 84, role: 'admin' } })
  apiClient.defaults.adapter = async config => {
    const request: Wire = {
      method: config.method ?? 'get', path: String(config.url), params: config.params ?? {},
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {}, config
    }
    wire.push(request)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: await route(request) } }
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  view?.unmount()
  view = undefined
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('account table release workflows through real cells, filters and API serialization', () => {
  it('serializes platform/type/status/privacy/group and search selected through real public controls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await render()
    await option('OpenAI', 'admin.accounts.allPlatforms')
    await option('admin.accounts.oauthType', 'admin.accounts.allTypes')
    await option('admin.accounts.status.inactive', 'admin.accounts.allStatus')
    await option('Privacy', 'admin.accounts.allPrivacyModes')
    await option('Synthetic routing group', 'admin.accounts.allGroups')
    await dom().get('input[placeholder="admin.accounts.searchAccounts"]').setValue('Synthetic search')
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(lists().at(-1)!.params).toMatchObject({
      platform: 'openai', type: 'oauth', status: 'inactive', privacy_mode: 'training_off',
      group: '841', search: 'Synthetic search', page: 1, lite: '1'
    })
    expect(JSON.parse(localStorage.getItem('account-filter-values')!)).toMatchObject({ platform: 'openai', status: 'inactive' })
  })
  it('makes scheduler scores an explicit opt-in and shows group, ungrouped and infinite sticky scores from the returned DTO', async () => {
    data = [account(84, { scheduler_scores: [
      { group_id: 841, group_name: 'Synthetic scoring group', base_score: 1.25, sticky_score: 2.5 },
      { group_id: 842, base_score: 0, sticky_score_infinity: true }
    ] }), account(85, { scheduler_score: { base_score: 4.125, sticky_score: 5 } })]
    await render()
    expect(dom().text()).not.toContain('Synthetic scoring group')
    await column('admin.accounts.columns.schedulerScore')
    expect(lists().at(-1)!.params.include_scheduler_score).toBe('1')
    expect(row(84).text()).toContain('Synthetic scoring group')
    expect(row(84).text()).toContain('1.25')
    expect(row(84).text()).toContain('+∞')
    expect(row(84).text()).toContain('#842')
    expect(row(85).text()).toContain('admin.accounts.schedulerScore.ungrouped')
    await column('admin.accounts.columns.schedulerScore')
    expect(row(84).text()).not.toContain('Synthetic scoring group')
    expect(lists().at(-1)!.params.include_scheduler_score).toBe('0')
  })
  it('exposes notes, a safe upstream homepage, proxy expiry and synchronized billing indicators only in their selected columns', async () => {
    data = [account(84, { rate_multiplier: 0, extra: { email: 'synthetic84@example.test', upstream_billing_rate_sync_enabled: true },
      proxy: { id: 9, name: 'Synthetic account relay', country_code: 'JP', expires_at: '2020-01-01T00:00:00Z' } })]
    await render()
    const homepage = row().get('a[href="https://gateway.example.test"]')
    expect(homepage.attributes('rel')).toBe('noopener noreferrer')
    expect(row().text()).toContain('synthetic84@example.test')
    expect(row().text()).not.toContain('Synthetic operator note')
    await column('admin.accounts.columns.notes')
    await column('admin.accounts.columns.proxy')
    await column('admin.accounts.columns.billingRateMultiplier')
    expect(row().text()).toContain('Synthetic operator note')
    expect(row().text()).toContain('Synthetic account relay')
    expect(row().text()).toContain('(JP)')
    expect(row().text()).toContain('0x')
    expect(row().find('[data-testid="account-rate-sync-indicator"]').exists()).toBe(true)
    expect(row().text()).toContain('admin.proxies.overdueDays')
  })
  it.each([
    [{ extra: { email_address: 'primary@example.test', email: 'secondary@example.test' } }, 'primary@example.test'],
    [{ credentials: { email: 'credential@example.test', base_url: 'javascript:synthetic' } }, 'credential@example.test'],
    [{ type: 'oauth', parent_email: 'parent@example.test', parent_chatgpt_account_id: 'synthetic-parent' }, 'parent@example.test']
  ])('keeps a normal row identity inspectable using the documented account/parent email precedence %#', async (patch, email) => {
    data = [account(84, patch)]
    await render()
    expect(row().text()).toContain(email)
    if ('credentials' in patch || ('type' in patch && patch.type === 'oauth')) expect(row().find('a').exists()).toBe(false)
    if ('parent_chatgpt_account_id' in patch) expect(row().find(`[title="${email} · synthetic-parent"]`).exists()).toBe(true)
  })
  it.each([
    ['free-tier', 'admin.accounts.tier.free'], ['g1-pro-tier', 'admin.accounts.tier.pro'], ['g1-ultra-tier', 'admin.accounts.tier.ultra']
  ])('renders the live Antigravity %s subscription badge without changing stored membership', async (tier, label) => {
    data = [account(84, { platform: 'antigravity', type: 'upstream', group_ids: [], extra: { load_code_assist: { paidTier: { id: tier } } } })]
    await render()
    expect(row().text()).toContain(label)
    expect(wire.filter(request => request.method !== 'get')).toEqual([])
  })
  it.each(['force_on', 'force_off', 'auto'])('shows the explicit OpenAI compact %s state in a normal account row', async mode => {
    data = [account(84, { extra: { openai_compact_mode: mode } })]
    await render()
    const title = row().find('[title*="admin.accounts.openai.compact"]')
    expect(title.exists()).toBe(true)
    expect(wire.filter(request => request.method !== 'get')).toEqual([])
  })
  it('updates an account priority from its real inline keyboard editor and merges the returned account in place', async () => {
    await render()
    await row().get('[data-testid="account-priority-value"]').trigger('click')
    await row().get('[data-testid="account-priority-input"]').setValue('19')
    await row().get('[data-testid="account-priority-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const writes = wire.filter(request => request.method === 'put')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe('/admin/accounts/84')
    expect(writes[0]!.body).toEqual({ priority: 19 })
    expect(row().get('[data-testid="account-priority-value"]').text()).toBe('19')
    expect(lists()).toHaveLength(1)
  })
  it('reports a real inline priority API rejection and permits correction with the original saved priority still visible', async () => {
    let attempts = 0
    route = async request => {
      if (request.method === 'put' && attempts++ === 0) throw rejected(request)
      return normal(request)
    }
    await render()
    await row().get('[data-testid="account-priority-value"]').trigger('click')
    await row().get('[data-testid="account-priority-input"]').setValue('20')
    await row().get('[data-testid="account-priority-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(ui.error).toHaveBeenCalledWith('Synthetic priority rejected')
    expect(row().get('[data-testid="account-priority-value"]').text()).toBe('5')
    await row().get('[data-testid="account-priority-value"]').trigger('click')
    await row().get('[data-testid="account-priority-input"]').setValue('21')
    await row().get('[data-testid="account-priority-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wire.filter(request => request.method === 'put').map(request => request.body.priority)).toEqual([20, 21])
    expect(row().get('[data-testid="account-priority-value"]').text()).toBe('21')
  })
  it.each(['admin.accounts.syncFromCrs', 'admin.errorPassthrough.title', 'admin.tlsFingerprintProfiles.title'])('opens and closes the intended public toolbar tool %s', async label => {
    await render()
    await click('admin.accounts.moreActions')
    await click(label)
    expect(dom().find('[role="dialog"][aria-label="Synthetic tool"]').exists()).toBe(true)
    await click('Close synthetic tool')
    expect(dom().find('[role="dialog"][aria-label="Synthetic tool"]').exists()).toBe(false)
  })
  it('persists an explicitly chosen auto-refresh interval and disables the timer through its native dropdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    await render()
    await click('admin.accounts.autoRefresh')
    await click('admin.accounts.refreshInterval5s')
    await click('admin.accounts.enableAutoRefresh')
    expect(JSON.parse(localStorage.getItem('account-auto-refresh')!)).toEqual({ enabled: true, interval_seconds: 5 })
    expect(dom().text()).toContain('admin.accounts.autoRefreshCountdown')
    await click('admin.accounts.enableAutoRefresh')
    expect(JSON.parse(localStorage.getItem('account-auto-refresh')!)).toEqual({ enabled: false, interval_seconds: 5 })
    const before = lists().length
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()
    expect(lists()).toHaveLength(before)
    expect(row().text()).toContain('Synthetic visible account 84')
  })
})
