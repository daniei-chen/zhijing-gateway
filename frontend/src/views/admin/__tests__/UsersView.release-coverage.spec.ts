import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import UsersView from '../UsersView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  users: await vi.importActual('@/api/admin/users'), groups: await vi.importActual('@/api/admin/groups'),
  dashboard: await vi.importActual('@/api/admin/dashboard'), userAttributes: await vi.importActual('@/api/admin/userAttributes'),
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let requests: Wire[]
let unexpected: string[]
let users: Record<string, unknown>[]
let definitions: Record<string, unknown>[]
let attributes: Record<number, Record<number, string>>
let stats: Record<number, Record<string, unknown>>
let quotas: Record<string, unknown>[]
let rejectList: boolean
const user = (id = 42, patch: Record<string, unknown> = {}) => ({
  id, email: `wave-${id}@example.invalid`, username: `Wave ${id}`, role: 'user', status: 'active', balance: 12.5,
  concurrency: 4, current_concurrency: 1, notes: 'Synthetic release note', allowed_groups: [11], subscriptions: [],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', last_used_at: null, last_active_at: null, ...patch,
})
const definition = (type = 'text', options: unknown = undefined) => ({ id: 1, name: 'Release attribute', key: 'release_attribute', type, enabled: true, required: false, sort_order: 1, options })
async function settle() { await flushPromises(); await vi.advanceTimersByTimeAsync(60); await flushPromises() }
async function render() {
  const view = mount(UsersView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<section><slot name="actions"/><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' },
    UserCreateModal: true, UserEditModal: true, UserBalanceModal: true, UserBalanceHistoryModal: true,
    UserAllowedGroupsModal: true, UserApiKeysModal: true, UserPlatformQuotaModal: true,
    UserAttributesModal: true, BulkEditUserModal: true, GroupReplaceModal: true,
  } } })
  views.push(view)
  await settle()
  return view
}
type Root = Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>
function button(root: Root, label: string) {
  const found = root.findAll('button').find(node => node.text() === label)
  expect(found, label).toBeDefined()
  return found!
}
function row(view: VueWrapper, id = 42) {
  const found = view.findAll('tbody tr').find(node => node.text().includes(`wave-${id}@example.invalid`))
  expect(found, `User ${id}`).toBeDefined()
  return found!
}
function cell(view: VueWrapper, label: string, id = 42) {
  const index = view.findAll('th').findIndex(node => node.text() === label)
  expect(index, `Column ${label}`).toBeGreaterThanOrEqual(0)
  return row(view, id).findAll('td')[index]
}
async function dropdown(view: VueWrapper, title: string) {
  const trigger = view.get(`[title="${title}"]`)
  if (trigger.attributes('aria-expanded') !== 'true') await trigger.trigger('click')
  return view.get(`[id="${trigger.attributes('aria-controls')}"]`)
}
async function choose(view: VueWrapper, selector: string, label: string) {
  const trigger = view.get(selector)
  await trigger.trigger('click')
  await flushPromises()
  const listbox = document.getElementById(trigger.attributes('aria-controls')!)!
  const option = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined()
  option!.click()
  await settle()
}
const lists = () => requests.filter(request => request.path === '/admin/users' && request.method === 'get')

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-wave-users', user: { id: 7, role: 'admin' } })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await vi.advanceTimersByTimeAsync(0)
  localStorage.setItem('user-hidden-columns', '[]')
  localStorage.setItem('user-column-settings-version', '3')
  requests = []; unexpected = []; rejectList = false
  users = [user()]; definitions = [definition()]; attributes = { 42: { 1: 'Synthetic attribute' } }; stats = {}
  quotas = []
  feedback.error.mockReset(); feedback.success.mockReset()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }
    requests.push(request)
    let data: unknown
    if (request.path === '/admin/users' && rejectList) {
      rejectList = false
      throw new AxiosError('Synthetic users unavailable', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Synthetic rejection', headers: {}, data: { message: 'Synthetic users unavailable' }, config })
    }
    if (request.path === '/admin/users') data = { items: users, total: users.length, page: request.params.page, page_size: request.params.page_size, pages: 1 }
    else if (request.path === '/admin/groups/all') data = [
      { id: 11, name: 'Release exclusive', platform: 'openai', is_exclusive: true, status: 'active', subscription_type: 'standard' },
      { id: 12, name: 'Release public', platform: 'anthropic', is_exclusive: false, status: 'active', subscription_type: 'standard' },
    ]
    else if (request.path === '/admin/user-attributes') data = definitions
    else if (request.path === '/admin/user-attributes/batch') data = { attributes }
    else if (request.path === '/admin/dashboard/users-usage') data = { stats }
    else if (/^\/admin\/users\/\d+\/platform-quotas$/.test(request.path)) data = { platform_quotas: quotas }
    else { unexpected.push(`${request.method} ${request.path}`); throw new Error(`Unexpected synthetic users endpoint ${request.path}`) }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data } }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = previousAdapter
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('Users release table, attributes and filter contracts', () => {
  it.each([
    { type: 'multi_select', raw: '["a","unknown"]', expected: 'Alpha, unknown', options: [{ value: 'a', label: 'Alpha' }] },
    { type: 'multi_select', raw: 'not-json', expected: 'not-json', options: [] },
    { type: 'multi_select', raw: '{"legacy":true}', expected: '{"legacy":true}', options: [] },
    { type: 'select', raw: 'a', expected: 'Alpha', options: [{ value: 'a', label: 'Alpha' }] },
    { type: 'select', raw: 'unknown', expected: 'unknown', options: [] },
    { type: 'select', raw: 'legacy', expected: 'legacy', options: undefined },
    { type: 'number', raw: '0', expected: '0', options: undefined },
    { type: 'text', raw: '', expected: '-', options: undefined },
    { type: 'date', raw: '2026-11-06', expected: '2026-11-06', options: undefined },
  ])('renders a $type attribute value of $raw with its public display contract', async ({ type, raw, expected, options }) => {
    definitions = [definition(type, options)]; attributes = { 42: { 1: raw } }
    const view = await render()
    expect(cell(view, 'Release attribute').text()).toBe(expected)
    expect(requests.find(request => request.path === '/admin/user-attributes/batch')!.body).toEqual({ user_ids: [42] })
  })

  it.each([
    { role: 'admin', status: 'active', username: '', notes: '', expectedStatus: 'common.active', disabledAction: false },
    { role: 'user', status: 'disabled', username: 'Wave user', notes: 'A synthetic long note that must be truncated in the table', expectedStatus: 'admin.users.disabled', disabledAction: true },
  ])('shows $role/$status table state, literal balance and note disclosure without issuing a mutation', async ({ role, status, username, notes, expectedStatus, disabledAction }) => {
    users = [user(42, { role, status, username, notes, current_concurrency: 5 })]
    const view = await render()
    expect(cell(view, 'admin.users.columns.role').text()).toBe(`admin.users.roles.${role}`)
    expect(cell(view, 'admin.users.columns.status').text()).toBe(expectedStatus)
    expect(cell(view, 'admin.users.columns.username').text()).toBe(username || '-')
    expect(cell(view, 'admin.users.columns.balance').text()).toContain('$12.50')
    if (notes) expect(cell(view, 'admin.users.columns.notes').get('span[title]').attributes('title')).toBe(notes)
    expect(row(view).findAll('button').some(node => ['admin.users.enable', 'admin.users.disable'].includes(node.text()))).toBe(disabledAction)
    expect(requests.filter(request => request.method !== 'get').every(request => ['/admin/user-attributes/batch', '/admin/dashboard/users-usage'].includes(request.path))).toBe(true)
  })

  it('shows authorized exclusive and public groups, opens the exclusive choices and closes them with Escape', async () => {
    const view = await render()
    expect(cell(view, 'admin.users.columns.groups').text()).toContain('Release public')
    const trigger = row(view).findAll('button').find(node => node.text().includes('admin.users.exclusiveLabel'))!
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(view.get(`[id="${trigger.attributes('aria-controls')}"]`).text()).toContain('Release exclusive')
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('renders missing secondary rows as empty usage rather than reusing another user totals', async () => {
    users = [user(), user(43)]
    stats = { 42: { today_actual_cost: 12.5, total_actual_cost: 43.75, by_platform: [{ platform: 'openai', today_actual_cost: 12.5, total_actual_cost: 43.75 }] } }
    attributes = { 42: { 1: 'Only first user' } }
    const view = await render()
    expect(cell(view, 'admin.users.columns.usage', 42).text()).toContain('12.50')
    expect(cell(view, 'admin.users.columns.usage', 43).text()).not.toContain('43.75')
    expect(cell(view, 'Release attribute', 43).text()).toBe('-')
  })

  it.each([
    { type: 'text', value: 'release text' }, { type: 'number', value: '17' },
    { type: 'select', value: 'a' }, { type: 'multi_select', value: 'a' }, { type: 'date', value: '2026-11-06' },
  ])('enables a $type filter, sends the literal attr query and clears it when that filter is hidden', async ({ type, value }) => {
    definitions = [definition(type, [{ value: 'a', label: 'Alpha' }])]
    const view = await render()
    await button(await dropdown(view, 'admin.users.filterSettings'), 'Release attribute').trigger('click')
    await settle()
    if (['select', 'multi_select'].includes(type)) await choose(view, '[aria-label="Release attribute"]', 'Alpha')
    else {
      const input = view.get('input[aria-label="Release attribute"]')
      await input.setValue(value); await input.trigger('keyup', { key: 'Enter' }); await settle()
    }
    expect(lists().at(-1)!.params).toMatchObject({ 'attr[1]': value, page: 1, include_subscriptions: true })
    await button(await dropdown(view, 'admin.users.filterSettings'), 'Release attribute').trigger('click')
    await settle()
    expect(lists().at(-1)!.params).not.toHaveProperty('attr[1]')
    expect(view.find('[aria-label="Release attribute"]').exists()).toBe(false)
  })

  it.each([
    { key: 'role', label: 'admin.users.columns.role', selector: '[aria-label="admin.users.columns.role"]', option: 'admin.users.admin', field: 'role', value: 'admin' },
    { key: 'status', label: 'admin.users.columns.status', selector: '[aria-label="admin.users.columns.status"]', option: 'admin.users.disabled', field: 'status', value: 'disabled' },
    { key: 'group', label: 'admin.users.authorizedGroupFilter', selector: '[aria-label="admin.users.authorizedGroupFilter"]', option: 'Release exclusive', field: 'group_name', value: 'Release exclusive' },
    { key: 'apiKeyGroup', label: 'admin.users.apiKeyGroupFilter', selector: '[aria-label="admin.users.apiKeyGroupFilter"]', option: 'Release exclusive', field: 'api_key_group_id', value: 11 },
  ])('applies and removes the built-in $key filter through its visible selector', async ({ label, selector, option, field, value }) => {
    const view = await render()
    const menu = await dropdown(view, 'admin.users.filterSettings')
    const item = button(menu, label)
    if (item.attributes('aria-pressed') !== 'true') { await item.trigger('click'); await settle() }
    await choose(view, selector, option)
    expect(lists().at(-1)!.params[field]).toBe(value)
    await button(await dropdown(view, 'admin.users.filterSettings'), label).trigger('click')
    await settle()
    expect(lists().at(-1)!.params[field] || undefined).toBeUndefined()
  })

  it.each(['admin.users.columns.usage', 'Release attribute', 'admin.users.columns.balancePlatformQuota', 'admin.users.columns.subscriptions'])('hides and restores the %s column through the public preference control', async label => {
    const view = await render()
    await button(await dropdown(view, 'admin.users.columnSettings'), label).trigger('click')
    await settle()
    expect(view.findAll('th').some(node => node.text() === label)).toBe(false)
    await button(await dropdown(view, 'admin.users.columnSettings'), label).trigger('click')
    await settle()
    expect(view.findAll('th').some(node => node.text() === label)).toBe(true)
    expect(lists().at(-1)!.params.include_subscriptions).toBe(true)
  })

  it('restores persisted filter and sort intent from the prior visit into the first actual list request', async () => {
    localStorage.setItem('user-visible-filters', JSON.stringify(['role', 'status', 'group', 'apiKeyGroup', 'attr_1']))
    localStorage.setItem('user-filter-values', JSON.stringify({ role: 'admin', status: 'disabled', group: 'Release exclusive', apiKeyGroup: 11, attributes: { 1: 'stored attribute' } }))
    localStorage.setItem('admin-users-table-sort', JSON.stringify({ key: 'balance', order: 'asc' }))
    const view = await render()
    expect(lists()[0].params).toMatchObject({ role: 'admin', status: 'disabled', group_name: 'Release exclusive', api_key_group_id: 11, 'attr[1]': 'stored attribute', sort_by: 'balance', sort_order: 'asc' })
    expect(view.get<HTMLInputElement>('input[aria-label="Release attribute"]').element.value).toBe('stored attribute')
  })

  it('recovers a failed list read through the native refresh action without a user mutation', async () => {
    rejectList = true
    const view = await render()
    expect(feedback.error).toHaveBeenCalledWith('Synthetic users unavailable')
    await view.get('[title="common.refresh"]').trigger('click'); await settle()
    expect(row(view).text()).toContain('Wave 42')
    expect(lists()).toHaveLength(2)
  })

  it.each([{ key: 'usage', metric: 'today' }, { key: 'usage_openai', metric: 'total' }])('sorts $key by $metric including users without secondary stats, then restores server order', async ({ key, metric }) => {
    users = [user(), user(43)]
    stats = { 42: { today_actual_cost: 12.5, total_actual_cost: 43.75, by_platform: [{ platform: 'openai', today_actual_cost: 12.5, total_actual_cost: 43.75 }] } }
    const view = await render()
    const orderedEmails = () => view.findAll('tbody tr').map(node => node.text().match(/wave-\d+@example\.invalid/)?.[0])
    for (const expected of [
      ['wave-42@example.invalid', 'wave-43@example.invalid'],
      ['wave-43@example.invalid', 'wave-42@example.invalid'],
      ['wave-42@example.invalid', 'wave-43@example.invalid'],
    ]) {
      await view.get(`[data-test="usage-sort-trigger-${key}"]`).trigger('click')
      await view.get(`[data-test="usage-sort-${key}-${metric}"]`).trigger('click')
      expect(orderedEmails()).toEqual(expected)
    }
    expect(lists()).toHaveLength(1)
  })

  it.each([
    { version: '1', hidden: ['notes'], added: ['usage_anthropic', 'usage_openai', 'usage_gemini', 'usage_antigravity', 'balance_platform_quota'] },
    { version: '2', hidden: ['usage_openai'], added: ['balance_platform_quota'] },
  ])('migrates version $version column preferences without changing unrelated explicit choices', async ({ version, hidden, added }) => {
    localStorage.setItem('user-column-settings-version', version)
    localStorage.setItem('user-hidden-columns', JSON.stringify(hidden))
    const view = await render()
    expect(JSON.parse(localStorage.getItem('user-hidden-columns')!)).toEqual(expect.arrayContaining([...hidden, ...added]))
    expect(localStorage.getItem('user-column-settings-version')).toBe('3')
    expect(view.findAll('th').some(node => node.text() === 'admin.users.columns.username')).toBe(true)
    expect(cell(view, 'admin.users.columns.usage').text()).toContain('admin.users.today')
  })

  it('recovers corrupted column preferences using the default visible columns and still loads users', async () => {
    localStorage.setItem('user-hidden-columns', '{broken-json')
    const view = await render()
    expect(row(view).text()).toContain('wave-42@example.invalid')
    expect(view.findAll('th').some(node => node.text() === 'admin.users.columns.notes')).toBe(false)
    expect(view.findAll('th').some(node => node.text() === 'admin.users.columns.lastActive')).toBe(true)
  })

  it.each([
    { key: 'username', order: 'desc', expected: 'username' },
    { key: 'not-a-sortable-column', order: 'asc', expected: 'created_at' },
    { key: 42, order: 'asc', expected: 'created_at' },
  ])('restores a saved sort key $key or uses the safe server-sort fallback', async ({ key, order, expected }) => {
    localStorage.setItem('admin-users-table-sort', JSON.stringify({ key, order }))
    const view = await render()
    expect(lists()[0].params).toMatchObject({ sort_by: expected, sort_order: 'desc' })
    expect(row(view).text()).toContain('wave-42@example.invalid')
  })

  it('does not expose or fetch disabled custom attributes', async () => {
    definitions = [{ ...definition(), enabled: false }]
    const view = await render()
    expect(view.findAll('th').some(node => node.text() === 'Release attribute')).toBe(false)
    expect((await dropdown(view, 'admin.users.filterSettings')).text()).not.toContain('Release attribute')
    expect(requests.some(request => request.path === '/admin/user-attributes/batch')).toBe(false)
  })

  it('keeps heavy secondary reads idle when all their consuming columns are hidden', async () => {
    localStorage.setItem('user-hidden-columns', JSON.stringify(['usage', 'usage_anthropic', 'usage_openai', 'usage_gemini', 'usage_antigravity', 'attr_1', 'balance_platform_quota']))
    const view = await render()
    expect(row(view).text()).toContain('wave-42@example.invalid')
    expect(requests.some(request => ['/admin/dashboard/users-usage', '/admin/user-attributes/batch'].includes(request.path) || request.path.endsWith('/platform-quotas'))).toBe(false)
    expect(lists()[0].params.include_subscriptions).toBe(true)
  })

  it.each([
    { daily: 0, weekly: null, expected: '0/0' },
    { daily: 15.5, weekly: 40, expected: '0/15.5' },
  ])('displays an explicit daily platform quota of $daily without treating it as an omitted limit', async ({ daily, weekly, expected }) => {
    quotas = [{ platform: 'openai', daily_limit_usd: daily, weekly_limit_usd: weekly, monthly_limit_usd: null, daily_usage_usd: 0, weekly_usage_usd: 2, monthly_usage_usd: 0 }]
    const view = await render()
    const quota = cell(view, 'admin.users.columns.balancePlatformQuota')
    expect(quota.text()).toContain('openai')
    expect(quota.text()).toContain(expected)
    expect(quota.text()).toContain('0/—')
  })
})
