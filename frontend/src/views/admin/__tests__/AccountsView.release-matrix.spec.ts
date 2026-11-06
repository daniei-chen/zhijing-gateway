import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AccountsView from '../AccountsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { Account } from '@/types'

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: notices.success, showError: notices.error, showWarning: notices.warning, showInfo: notices.info }) }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: notices.success, showError: notices.error, showWarning: notices.warning, showInfo: notices.info }), useAuthStore: () => ({ isSimpleMode: false, token: 'synthetic-matrix-admin' }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: false, token: 'synthetic-matrix-admin' }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

type Wire = { method: string; path: string; body: Record<string, any>; params: Record<string, any> }
const adapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
const dom = () => new DOMWrapper(document.body)
const providers = ['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go', 'typesafe', 'command_code', 'cline']
const groups = [841, 842, 843, 844, 845].map(id => ({ id, name: `Synthetic membership ${id}`, platform: 'openai', status: 'active', rate_multiplier: 1 }))
let rows: Account[] = []
let wire: Wire[] = []
let unexpected: string[] = []
let privacyResult = 'training_off'
let usage: Record<string, any> = {}
let listing: (request: Wire) => Promise<unknown>

function account(id = 840, patch: Record<string, unknown> = {}): Account {
  return {
    id, name: `Synthetic matrix ${id}`, platform: 'openai', type: 'apikey', credentials: { base_url: 'https://matrix.example.test/v1' },
    credentials_status: { has_api_key: true }, extra: {}, status: 'active', schedulable: true,
    concurrency: 4, current_concurrency: 0, priority: 5, rate_multiplier: 1, group_ids: [],
    notes: '', proxy_id: null, load_factor: null, expires_at: null, auto_pause_on_expired: true,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch
  } as unknown as Account
}
const normalList = async (request: Wire) => ({ items: rows, total: rows.length, pages: 1, page: request.params.page ?? 1, page_size: request.params.page_size ?? 20 })
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  const view = mount(AccountsView, { attachTo: document.body, global: {
    plugins: [router], mocks: { $t: (key: string) => key },
    stubs: { AppLayout: { template: '<main><slot /></main>' }, Icon: true, PlatformIcon: true, Transition: true }
  } })
  views.push(view)
  await flushPromises()
  return view
}
function row(id = 840) {
  const found = dom().findAll('tbody tr').find(node => node.text().includes(`Synthetic matrix ${id}`))
  expect(found, `actual row ${id}`).toBeDefined()
  return found!
}
function button(text: string, root: Pick<DOMWrapper<Element>, 'findAll'> = dom()) {
  const found = root.findAll('button').find(node => node.text() === text)
  expect(found, `visible button ${text}`).toBeDefined()
  return found!
}
async function click(text: string, root: Pick<DOMWrapper<Element>, 'findAll'> = dom()) {
  const element = button(text, root).element as HTMLButtonElement
  element.click()
  await flushPromises()
}
function field(label: string) {
  const found = dom().findAll('label').find(node => node.text() === label && node.attributes('for'))
  expect(found, `associated control ${label}`).toBeDefined()
  return new DOMWrapper(document.getElementById(found!.attributes('for')!)!)
}
async function choose(selected: string, value: string) {
  const found = dom().findAll('button[aria-haspopup="true"]').find(node => node.text() === selected)
  expect(found, `public Select ${selected}`).toBeDefined()
  await found!.trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const option = dom().findAll('[role="option"]').find(node => node.text() === value)
  expect(option, `public option ${value}`).toBeDefined()
  ;(option!.element as HTMLElement).click()
  await flushPromises()
}
async function saveEdit() {
  expect((dom().get('#edit-account-form').element as HTMLFormElement).checkValidity()).toBe(true)
  ;(dom().get('button[form="edit-account-form"]').element as HTMLButtonElement).click()
  await flushPromises()
}
async function openEdit() {
  await click('common.edit', row())
  await vi.waitFor(() => expect(dom().find('#edit-account-form').exists()).toBe(true))
}
const lists = () => wire.filter(request => request.method === 'get' && request.path === '/admin/accounts')
beforeEach(() => {
  rows = [account()]
  wire = []
  unexpected = []
  usage = {}
  privacyResult = 'training_off'
  listing = normalList
  Object.values(notices).forEach(mock => mock.mockReset())
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-matrix-admin', user: { id: 840, role: 'admin' } })
  localStorage.setItem('account-hidden-columns', '[]')
  localStorage.setItem('account-hidden-columns-version', 'scheduler-score-hidden-by-default')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T04:00:00Z'))
  apiClient.defaults.adapter = async config => {
    const request: Wire = { method: config.method ?? 'get', path: String(config.url), params: config.params ?? {}, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {} }
    wire.push(request)
    let result: unknown
    if (request.method === 'get' && request.path === '/admin/accounts') result = await listing(request)
    else if (request.path === '/admin/accounts/upstream-billing-probe/settings') result = { enabled: true }
    else if (request.path === '/admin/proxies/all') result = []
    else if (request.path === '/admin/groups/all') result = groups
    else if (request.path === '/admin/tls-fingerprint-profiles') result = []
    else if (request.path === '/admin/settings') result = { account_quota_notify_enabled: false }
    else if (request.path === '/admin/settings/web-search-emulation') result = { enabled: false, providers: [] }
    else if (/^\/admin\/cn-providers\/accounts\/\d+\/quota$/.test(request.path)) result = { provider: 'synthetic', success: true, credential_valid: true, tiers: [], fetched_at: 1793937600, persisted: false }
    else if (request.path === '/admin/accounts/usage/batch') result = { usage: Object.fromEntries(request.body.account_ids.map((id: number) => [String(id), usage[String(id)] ?? {}])), errors: {} }
    else if (request.path === '/admin/accounts/today-stats/batch') result = { stats: Object.fromEntries(request.body.account_ids.map((id: number) => [String(id), { requests: 12, tokens: 1234567, cost: 1.23, standard_cost: 2.34, user_cost: 0.8 }])) }
    else if (/\/admin\/accounts\/\d+\/usage$/.test(request.path)) result = usage[request.path.split('/')[3]!] ?? {}
    else if (/^\/admin\/accounts\/\d+$/.test(request.path)) {
      const id = Number(request.path.split('/').at(-1))
      if (request.method === 'get') result = rows.find(value => value.id === id)!
      else if (request.method === 'put') {
        const index = rows.findIndex(value => value.id === id)
        rows[index] = { ...rows[index]!, ...request.body, credentials: { ...rows[index]!.credentials, ...request.body.credentials } }
        result = rows[index]
      }
    } else if (/\/set-privacy$/.test(request.path)) {
      const id = Number(request.path.split('/')[3])
      const index = rows.findIndex(value => value.id === id)
      rows[index] = { ...rows[index]!, extra: { ...rows[index]!.extra, privacy_mode: privacyResult } }
      result = rows[index]
    } else {
      unexpected.push(`${request.method} ${request.path}`)
      throw new Error('Unexpected synthetic account matrix endpoint')
    }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: result } }
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = adapter
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('account table normal DTO matrix through the actual list client and rendered cells', () => {
  it.each(['sparse', 'rich'])('keeps thirteen registered provider accounts inspectable from %s list DTOs', async density => {
    rows = providers.map((platform, index) => account(1000 + index, density === 'sparse'
      ? { platform, credentials: {}, extra: {}, group_ids: undefined, notes: null, rate_multiplier: null, last_used_at: null }
      : { platform, notes: `Synthetic note for ${platform}`, group_ids: [841], rate_multiplier: 0.5,
        current_concurrency: 2, quota_daily_limit: 10, quota_daily_used: 8, quota_weekly_limit: 30, quota_weekly_used: 10,
        quota_limit: 100, quota_used: 60, expires_at: Math.floor(new Date('2099-01-01T00:00:00Z').getTime() / 1000), last_used_at: '2026-11-06T03:58:00Z',
        proxy: { id: 3, name: 'Synthetic table relay', country_code: null, expires_at: '2099-01-01T00:00:00Z' } }))
    await render()
    for (const item of rows) {
      expect(row(item.id).text()).toContain(`Synthetic matrix ${item.id}`)
      expect(row(item.id).text()).toContain('admin.accounts.status.active')
      if (density === 'rich') {
        expect(row(item.id).text()).toContain(`Synthetic note for ${item.platform}`)
        expect(row(item.id).text()).toContain('Synthetic table relay')
        expect(row(item.id).text()).toContain('admin.accounts.autoPauseOnExpired')
        expect(row(item.id).find('a[href="https://matrix.example.test"]').exists()).toBe(true)
      } else expect(row(item.id).find('a[href="https://matrix.example.test"]').exists()).toBe(false)
    }
    expect(lists()).toHaveLength(1)
    expect(lists()[0]!.params.include_scheduler_score).toBe('1')
    expect(wire.filter(request => request.method === 'put')).toEqual([])
  })
  it.each([
    ['active', {}, 'admin.accounts.status.active'],
    ['inactive', { status: 'inactive', expires_at: 4070908800 }, 'admin.accounts.status.inactive'],
    ['error', { status: 'error', error_message: 'Synthetic provider rejected login' }, 'admin.accounts.status.error'],
    ['rate limit', { rate_limit_reset_at: '2026-11-06T04:02:00Z' }, 'admin.accounts.status.rateLimited'],
    ['overload', { overload_until: '2026-11-06T04:00:40Z' }, 'admin.accounts.status.overloaded'],
    ['expired', { expires_at: 1577836800 }, 'admin.accounts.expired']
  ])('shows a real %s account status and expiration without hiding the source row', async (_name, patch, expected) => {
    rows = [account(840, patch)]
    await render()
    expect(row().text()).toContain(expected)
    if ('error_message' in patch) expect(row().text()).toContain(patch.error_message)
    if ('expires_at' in patch && patch.expires_at === 1577836800) expect(row().text()).toContain('admin.accounts.autoPauseOnExpired')
  })
  it.each([
    ['agentidentity', 'Agent Identity'], ['personal_access_token', 'PAT'], ['', 'OAuth']
  ])('labels an OpenAI OAuth %s credential independently from its inherited parent membership', async (mode, label) => {
    rows = [account(840, { type: 'oauth', parent_email: 'parent840@example.test', parent_plan_type: 'pro',
      credentials: { auth_mode: mode }, extra: { openai_compact_supported: false, openai_compact_checked_at: '2026-11-06T03:00:00Z' } })]
    usage['840'] = { five_hour: { utilization: 24 }, seven_day: { utilization: 12 } }
    await render()
    expect(row().text()).toContain(label)
    expect(row().text()).toContain('parent840@example.test')
    expect(row().text()).toContain('admin.accounts.openai.compactUnsupported')
    expect(row().get('[title*="admin.accounts.openai.compactLastChecked"]').attributes('title')).toContain('11/06/2026')
  })
  it.each([
    [{ currentTier: { id: 'g1-pro-tier' } }, 'admin.accounts.tier.pro'],
    [{ currentTier: { id: 'g1-ultra-tier' } }, 'admin.accounts.tier.ultra'],
    [{ paidTier: { id: 5 }, currentTier: { id: 'free-tier' } }, 'admin.accounts.tier.free']
  ])('honors a legacy/current Antigravity entitlement when paid metadata is absent or unusable %#', async (load_code_assist, label) => {
    rows = [account(840, { platform: 'antigravity', type: 'upstream', extra: { load_code_assist } })]
    await render()
    expect(row().text()).toContain(label)
  })
  it('displays remaining memberships in a native popover without truncating the stored account group IDs', async () => {
    rows = [account(840, { group_ids: groups.map(group => group.id) })]
    await render()
    expect(row().text()).toContain('Synthetic membership 843')
    expect(row().text()).not.toContain('Synthetic membership 845')
    await click('+2', row())
    expect(dom().text()).toContain('Synthetic membership 845')
    expect(rows[0]!.group_ids).toEqual([841, 842, 843, 844, 845])
  })
})

describe('persisted table choices remain validated before querying accounts', () => {
  it.each(['null', '[]', 'not-valid-json', '{"platform":7,"status":[]}', '{"platform":"unknown-platform","status":"unknown-status"}'])('falls back safely from invalid saved filter data %s', async saved => {
    localStorage.setItem('account-filter-values', saved)
    await render()
    expect(lists()[0]!.params).toMatchObject({ platform: '', status: '' })
    expect(row().text()).toContain('Synthetic matrix 840')
    expect(dom().findAll('button').some(node => node.text() === 'admin.accounts.allPlatforms')).toBe(true)
  })
  it.each([
    [{ key: 'name', order: 'desc' }, 'name', 'desc'],
    [{ key: 'id', order: 'unexpected' }, 'id', 'asc'],
    [{ key: 'not-a-sortable-field', order: 'desc' }, 'name', 'asc']
  ])('uses only a supported saved sort for the real list request %#', async (saved, key, order) => {
    localStorage.setItem('account-table-sort', JSON.stringify(saved))
    await render()
    expect(lists()[0]!.params).toMatchObject({ sort_by: key, sort_order: order })
    expect(row().text()).toContain('Synthetic matrix 840')
  })
})

describe('Grok subscription badges respect credential precedence and fresh Responses quota evidence', () => {
  it.each([
    ['unambiguous credential', { credentials: { subscription_tier: 'Free' }, extra: { grok_billing_snapshot: { plan: 'SuperGrok Heavy' } } }, 'Grok Free'],
    ['fresh 4.5 request quota', { credentials: { subscription_tier: 'SuperGrokPro' }, extra: { grok_usage_snapshot: { model: 'x-ai/grok-4.5-preview', last_headers_seen_at: '2026-11-06T03:59:00Z', requests: { limit: 8300 } } } }, 'SuperGrok Heavy'],
    ['fresh 4.5 token quota', { credentials: {}, extra: { grok_billing_snapshot: { plan: 'SuperGrok' }, grok_usage_snapshot: { model: 'grok-4.5', updated_at: '2026-11-06T03:59:00Z', tokens: { limit: 53000000 } } } }, 'SuperGrok Heavy'],
    ['carried 4.5 hint', { credentials: { subscription_tier: 'SuperGrokPro' }, extra: { grok_quota_snapshot: { plan_from_45_responses: 'SuperGrok Heavy', plan_from_45_responses_at: '2026-11-06T03:59:00Z' } } }, 'SuperGrok Heavy'],
    ['stale quota', { credentials: { subscription_tier: 'SuperGrokPro' }, extra: { grok_usage_snapshot: { model: 'grok-4.5', last_headers_seen_at: '2026-11-04T03:59:00Z', requests: { limit: 9999 } } } }, 'SuperGrok'],
    ['unrelated model', { credentials: { subscription_tier: 'SuperGrokPro' }, extra: { grok_usage_snapshot: { model: 'grok-4', last_headers_seen_at: '2026-11-06T03:59:00Z', tokens: { limit: 53000000 } } } }, 'SuperGrok'],
    ['unknown timestamp', { credentials: { subscription_tier: 'SuperGrokPro' }, extra: { grok_usage_snapshot: { model: 'grok-4.5', last_headers_seen_at: 'not-a-date', requests: { limit: 9999 } }, grok_billing_snapshot: { plan: 'SuperGrok Lite' } } }, 'SuperGrok Lite'],
    ['legacy subscription tier', { credentials: {}, extra: { grok_quota_snapshot: { subscription_tier: 'SuperGrok Plus' } } }, 'SuperGrok Plus'],
    ['inherited membership', { credentials: {}, extra: {}, parent_plan_type: 'SuperGrok' }, 'SuperGrok']
  ])('shows %s without promoting an unverified account to Heavy', async (_scenario, patch, expected) => {
    rows = [account(840, { platform: 'grok', type: 'oauth', ...patch })]
    await render()
    expect(row().text()).toContain(expected)
    if (expected !== 'SuperGrok Heavy') expect(row().text()).not.toContain('SuperGrok Heavy')
    expect(wire.filter(request => request.method === 'put')).toEqual([])
  })
})

describe('normal privacy and membership updates preserve the active list scope', () => {
  it.each([
    ['__unset__', '', 'training_off', 'success', 'admin.accounts.privacyTrainingOff'],
    ['training_off', 'training_off', 'training_set_cf_blocked', 'error', 'admin.accounts.privacyCfBlocked'],
    ['training_off', 'training_off', 'training_off', 'success', 'admin.accounts.privacyTrainingOff']
  ] as const)('reconciles the %s privacy scope with the returned server privacy value %s/%s', async (filter, initial, returned, level, message) => {
    rows = [account(840, { type: 'oauth', extra: { privacy_mode: initial } })]
    privacyResult = returned
    await render()
    await choose('admin.accounts.allPrivacyModes', filter === '__unset__' ? 'admin.accounts.privacyUnset' : 'Privacy')
    await new Promise(resolve => setTimeout(resolve, 650))
    await flushPromises()
    await click('common.more', row())
    await click('admin.accounts.setPrivacy')
    expect(wire.filter(request => request.path === '/admin/accounts/840/set-privacy')).toHaveLength(1)
    expect(notices[level]).toHaveBeenCalledWith(message)
    expect(dom().findAll('tbody tr').some(node => node.text().includes('Synthetic matrix 840'))).toBe(filter === returned)
  })
  it.each(['member', 'ungrouped'])('removes an edited account that leaves the selected %s group scope', async selected => {
    rows = [account(840, { group_ids: selected === 'member' ? [841] : [] })]
    await render()
    await choose('admin.accounts.allGroups', selected === 'member' ? 'Synthetic membership 841' : 'admin.accounts.ungroupedGroup')
    await new Promise(resolve => setTimeout(resolve, 650))
    await flushPromises()
    await openEdit()
    const group = dom().findAll('label').find(node => node.text().includes('Synthetic membership 841') && node.find('input[type="checkbox"]').exists())!
    await group.get('input[type="checkbox"]').setValue(selected !== 'member')
    await saveEdit()
    expect(wire.find(request => request.method === 'put')!.body.group_ids).toEqual(selected === 'member' ? [] : [841])
    expect(dom().findAll('tbody tr').some(node => node.text().includes('Synthetic matrix 840'))).toBe(false)
  })
})

describe('normal edits reconcile the visible account list with the active filter', () => {
  it.each([
    ['active', { schedulable: true }, 'common.inactive', 'inactive'],
    ['inactive', { status: 'inactive' }, 'common.active', 'active'],
    ['error', { status: 'error' }, 'common.active', 'active'],
    ['rate_limited', { rate_limit_reset_at: '2026-11-06T05:00:00Z' }, 'common.inactive', 'inactive'],
    ['temp_unschedulable', { temp_unschedulable_until: '2026-11-06T05:00:00Z' }, 'common.inactive', 'inactive'],
    ['unschedulable', { schedulable: false }, 'common.inactive', 'inactive']
  ])('removes a saved account that leaves the %s status scope while keeping its saved JSON intact', async (status, patch, label, expected) => {
    rows = [account(840, patch)]
    localStorage.setItem('account-filter-values', JSON.stringify({ platform: '', status }))
    await render()
    await openEdit()
    const trigger = field('common.status')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await dom().findAll('[role="option"]').find(node => node.text() === label)!.trigger('click')
    await saveEdit()
    expect(wire.find(request => request.method === 'put')?.body.status).toBe(expected)
    expect(dom().findAll('tbody tr').some(node => node.text().includes('Synthetic matrix 840'))).toBe(false)
    expect(notices.success).toHaveBeenCalled()
    expect(lists()).toHaveLength(1)
  })
  it('removes a renamed account from the current search and offers explicit list synchronization when other rows remain', async () => {
    rows = [account(), account(841)]
    const view = await render()
    await dom().get('input[placeholder="admin.accounts.searchAccounts"]').setValue('matrix')
    await new Promise(resolve => setTimeout(resolve, 650))
    await flushPromises()
    await openEdit()
    await field('common.name').setValue('Synthetic renamed outside search')
    await saveEdit()
    expect(view.text()).toContain('admin.accounts.listPendingSyncHint')
    expect(view.text()).not.toContain('Synthetic renamed outside search')
    const before = lists().length
    await click('admin.accounts.listPendingSyncAction')
    expect(lists()).toHaveLength(before + 1)
    expect(lists().at(-1)!.params.search).toBe('matrix')
  })
})
