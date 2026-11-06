import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UsersView from '../UsersView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { AdminUser } from '@/types'

const api = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), updateBalance: vi.fn(), remove: vi.fn(), toggleStatus: vi.fn(),
  groups: vi.fn(), allGroups: vi.fn(), definitions: vi.fn(), attributes: vi.fn(), usage: vi.fn(), quotas: vi.fn(),
  showError: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: {
  users: { list: api.list, create: api.create, update: api.update, updateBalance: api.updateBalance, delete: api.remove, toggleStatus: api.toggleStatus, getPlatformQuotas: api.quotas },
  groups: { getAll: api.groups, getAllIncludingInactive: api.allGroups },
  dashboard: { getBatchUsersUsage: api.usage },
  userAttributes: { listEnabledDefinitions: api.definitions, getBatchUserAttributes: api.attributes, updateUserAttributeValues: vi.fn().mockResolvedValue({}) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: api.showError, showSuccess: api.showSuccess }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key
}) }))
const Table = {
  props: ['columns', 'data', 'selectedKeys'], emits: ['sort', 'update:selectedKeys'],
  template: `<div><div data-test="order">{{data.map(row => row.id).join(',')}}</div>
    <div v-for="column in columns" :key="column.key"><button v-if="column.sortable" :data-sort="column.key" @click="$emit('sort',column.key,'asc')">{{column.label}}</button><slot :name="'header-'+column.key" :column="column"/></div>
    <article v-for="row in data" :key="row.id" :data-user-id="row.id"><input data-test="select-row" type="checkbox" :checked="(selectedKeys||[]).includes(row.id)" @change="$emit('update:selectedKeys', [...(selectedKeys||[]),row.id])"/>
    <div v-for="column in columns" :key="column.key" :data-cell="column.key"><slot :name="'cell-'+column.key" :value="row[column.key]" :row="row"/></div></article></div>`
}
const Dialog = { props: ['show'], emits: ['close'], template: '<div v-if="show"><slot/><slot name="footer"/></div>' }
const NamedModal = { props: ['show', 'user', 'oldGroup'], emits: ['close', 'success'], template: '<div v-if="show" data-test="named-modal">{{user.id}}<span v-if="oldGroup" data-test="old-group">{{oldGroup.id}}</span><button data-test="modal-success" @click="$emit(\'success\')">success</button><button data-test="modal-close" @click="$emit(\'close\')">close</button></div>' }
const History = { props: ['show', 'user'], emits: ['close', 'deposit', 'withdraw'], template: '<div v-if="show" data-test="history">{{user.id}}<button data-test="history-deposit" @click="$emit(\'deposit\')">deposit</button><button data-test="history-withdraw" @click="$emit(\'withdraw\')">withdraw</button></div>' }
const Badge = { props: ['name', 'daysRemaining'], template: '<span class="synthetic-badge">{{name}}<span v-if="daysRemaining != null"> {{daysRemaining}} days</span></span>' }
const wrappers: VueWrapper[] = []
function user(id = 41, overrides: Partial<AdminUser> = {}): AdminUser {
  return { id, email: `synthetic-${id}@example.invalid`, username: 'Synthetic', role: 'user', status: 'active', balance: 5, concurrency: 3, current_concurrency: 2,
    allowed_groups: [7], notes: 'synthetic note', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', subscriptions: [], ...overrides } as AdminUser
}
const groups = [
  { id: 7, name: 'Synthetic Exclusive', platform: 'anthropic', status: 'active', is_exclusive: true, subscription_type: 'standard' },
  { id: 8, name: 'Synthetic Public', platform: 'openai', status: 'active', is_exclusive: false, subscription_type: 'standard' },
  { id: 9, name: 'Synthetic Disabled', platform: 'openai', status: 'disabled', is_exclusive: true, subscription_type: 'standard' },
  { id: 10, name: 'Synthetic Subscription', platform: 'gemini', status: 'active', is_exclusive: false, subscription_type: 'subscription' }
]
function page(items = [user(), user(42, { role: 'admin' })]) { return { items, total: items.length, pages: 1 } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
function view() {
  const wrapper = mount(UsersView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<div><slot/></div>' }, TablePageLayout: { template: '<div><slot name="actions"/><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
    DataTable: Table, BaseDialog: Dialog, Pagination: { props: ['page', 'pageSize'], emits: ['update:page', 'update:pageSize'], template: '<div><span data-test="page">{{page}}</span><button data-test="page-two" @click="$emit(\'update:page\',2)">next</button><button data-test="size-50" @click="$emit(\'update:pageSize\',50)">size 50</button></div>' },
    GroupBadge: Badge, Icon: true, Teleport: true, EmptyState: true, UserAttributeForm: true, TotpStepUpDialog: true,
    UserAttributesConfigModal: true, BulkEditUserModal: true, UserPlatformQuotaModal: NamedModal, UserApiKeysModal: NamedModal,
    UserAllowedGroupsModal: NamedModal, UserBalanceHistoryModal: History, GroupReplaceModal: NamedModal
  } } })
  wrappers.push(wrapper)
  return wrapper
}
function row(wrapper: VueWrapper, id = 41) { return wrapper.get(`[data-user-id="${id}"]`) }
async function clickText(wrapper: VueWrapper | DOMWrapper<Element>, text: string) {
  const button = wrapper.findAll('button').find(button => button.text() === text)!
  expect(button, text).toBeDefined()
  await button.trigger('click')
}
async function more(wrapper: VueWrapper, key: string, id = 41) {
  await clickText(row(wrapper, id), 'common.more')
  await clickText(wrapper.get('.action-menu-content'), key)
}
function field(wrapper: VueWrapper, key: string) {
  const label = wrapper.findAll('label').find(label => label.text() === key)!
  expect(label, key).toBeDefined()
  const id = label.attributes('for')
  expect(id, key).toBeTruthy()
  return wrapper.get(`[id="${id}"]`)
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('user-hidden-columns', '[]')
  localStorage.setItem('user-column-settings-version', '3')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime('2026-11-06T00:00:00Z')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  api.list.mockReset().mockResolvedValue(page())
  api.create.mockReset().mockResolvedValue(user())
  api.update.mockReset().mockResolvedValue(user())
  api.updateBalance.mockReset().mockResolvedValue(user())
  api.groups.mockReset().mockResolvedValue(groups)
  api.allGroups.mockReset().mockResolvedValue(groups)
  api.definitions.mockReset().mockResolvedValue([])
  api.attributes.mockReset().mockResolvedValue({ attributes: {} })
  api.usage.mockReset().mockResolvedValue({ stats: {} })
  api.quotas.mockReset().mockResolvedValue({ platform_quotas: [] })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers(); vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

describe('UsersView real modal and public API workflows', () => {
  it('creates a user through the real create form and refreshes the list on success', async () => {
    const wrapper = view()
    await flushPromises()
    await clickText(wrapper, 'admin.users.createUser')
    await field(wrapper, 'admin.users.email').setValue('created@example.invalid')
    await field(wrapper, 'admin.users.password').setValue('synthetic-password')
    await field(wrapper, 'admin.users.username').setValue('Created synthetic')
    await wrapper.get('#create-user-form').trigger('submit')
    await flushPromises()
    expect(api.create).toHaveBeenCalledExactlyOnceWith({ email: 'created@example.invalid', password: 'synthetic-password', username: 'Created synthetic', notes: '', role: 'user', concurrency: 1, rpm_limit: 0 })
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#create-user-form').exists()).toBe(false)
  })

  it('edits the selected user through the real form and preserves unlimited concurrency', async () => {
    const wrapper = view()
    await flushPromises()
    await clickText(row(wrapper), 'common.edit')
    await field(wrapper, 'admin.users.notes').setValue('edited note')
    await wrapper.get('[data-test="concurrency-input"]').setValue('0')
    await wrapper.get('#edit-user-form').trigger('submit')
    await flushPromises()
    expect(api.update).toHaveBeenCalledExactlyOnceWith(41, expect.objectContaining({ email: 'synthetic-41@example.invalid', notes: 'edited note', concurrency: 0 }))
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#edit-user-form').exists()).toBe(false)
  })

  it.each([
    ['admin.users.deposit', 'add'], ['admin.users.withdraw', 'subtract']
  ])('routes %s to the real balance form and exact captured user', async (key, operation) => {
    const wrapper = view()
    await flushPromises()
    await more(wrapper, key)
    await wrapper.get('#balance-form input[type="number"]').setValue('1.25')
    await wrapper.get('#balance-form textarea').setValue('synthetic ledger note')
    await wrapper.get('#balance-form').trigger('submit')
    await flushPromises()
    expect(api.updateBalance).toHaveBeenCalledExactlyOnceWith(41, 1.25, operation, 'synthetic ledger note')
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#balance-form').exists()).toBe(false)
  })

  it.each(['deposit', 'withdraw'])('keeps the history user as the target for its %s action', async (action) => {
    const wrapper = view()
    await flushPromises()
    await more(wrapper, 'admin.users.balanceHistory')
    expect(wrapper.get('[data-test="history"]').text()).toContain('41')
    await wrapper.get(`[data-test="history-${action}"]`).trigger('click')
    await wrapper.get('#balance-form input[type="number"]').setValue('2')
    await wrapper.get('#balance-form').trigger('submit')
    await flushPromises()
    expect(api.updateBalance).toHaveBeenCalledExactlyOnceWith(41, 2, action === 'deposit' ? 'add' : 'subtract', '')
  })

  it.each(['admin.users.groups', 'admin.users.apiKeys', 'admin.users.platformQuota.menuItem'])('passes the selected user to %s without reusing another row', async (key) => {
    const wrapper = view()
    await flushPromises()
    await more(wrapper, key, 42)
    expect(wrapper.get('[data-test="named-modal"]').text()).toContain('42')
    await wrapper.get('[data-test="modal-close"]').trigger('click')
    expect(wrapper.find('[data-test="named-modal"]').exists()).toBe(false)
  })

  it('keeps administrator status and delete actions absent while retaining their edit action', async () => {
    const wrapper = view()
    await flushPromises()
    expect(row(wrapper, 42).text()).toContain('common.edit')
    expect(row(wrapper, 42).text()).not.toContain('admin.users.disable')
    await clickText(row(wrapper, 42), 'common.more')
    expect(wrapper.get('.action-menu-content').text()).not.toContain('common.delete')
  })
})

describe('UsersView filters, secondary information and keyboard names', () => {
  it.each([
    ['text', 'synthetic text'], ['number', '12'], ['date', '2026-11-06'],
    ['select', 'gold'], ['multi_select', 'gold'], ['unrecognized', 'legacy text']
  ])('submits a %s attribute filter under its numeric attribute ID', async (type, value) => {
    localStorage.setItem('user-visible-filters', '["attr_31"]')
    localStorage.setItem('user-filter-values', JSON.stringify({ attributes: { 31: '' } }))
    api.definitions.mockResolvedValue([{ id: 31, name: 'Synthetic attribute', type, enabled: true, options: [{ value: 'gold', label: 'Synthetic Gold' }] }])
    const wrapper = view()
    await flushPromises()
    if (type === 'select' || type === 'multi_select') {
      await wrapper.get('button[aria-label="Synthetic attribute"]').trigger('click')
      await wrapper.findAll('[role="option"]').find(option => option.text() === 'Synthetic Gold')!.trigger('click')
    } else {
      const input = wrapper.get('input[aria-label="Synthetic attribute"]')
      expect(input.attributes('id')).toBeTruthy()
      await input.setValue(value)
      await input.trigger('keyup', { key: 'Enter' })
    }
    await flushPromises()
    expect(api.list.mock.calls.at(-1)?.[2].attributes).toEqual({ 31: value })
    expect(api.list.mock.calls.at(-1)?.[0]).toBe(1)
  })

  it('keeps disabled API-key groups selectable as numeric filter IDs', async () => {
    localStorage.setItem('user-visible-filters', '["apiKeyGroup"]')
    const wrapper = view()
    await flushPromises()
    await wrapper.get('button[aria-label="admin.users.apiKeyGroupFilter"]').trigger('click')
    const option = wrapper.findAll('[role="option"]').find(option => option.text() === 'Synthetic Disabled')!
    expect(option.attributes('aria-disabled')).toBe('false')
    await option.trigger('click')
    await flushPromises()
    expect(api.list.mock.calls.at(-1)?.[2].api_key_group_id).toBe(9)
    expect(JSON.parse(localStorage.getItem('user-filter-values')!).apiKeyGroup).toBe(9)
  })

  it('passes a custom fuzzy authorized-group search as a name rather than a group ID', async () => {
    localStorage.setItem('user-visible-filters', '["group"]')
    const wrapper = view()
    await flushPromises()
    await wrapper.get('button[aria-label="admin.users.authorizedGroupFilter"]').trigger('click')
    await wrapper.get('input[placeholder="admin.users.searchAuthorizedGroups"]').setValue('Synthetic custom team')
    const option = wrapper.findAll('[role="option"]').find(option => option.text().includes('Synthetic custom team'))!
    await option.trigger('click')
    await flushPromises()
    expect(api.list.mock.calls.at(-1)?.[2].group_name).toBe('Synthetic custom team')
  })

  it.each([
    ['usage', 'today', '41,42', '42,41'],
    ['usage', 'total', '42,41', '41,42'],
    ['usage_openai', 'today', '41,42', '42,41']
  ])('cycles the %s/%s current-page usage sort through descending, ascending and off', async (key, metric, descending, ascending) => {
    api.usage.mockResolvedValue({ stats: {
      41: { today_actual_cost: 2, total_actual_cost: 8, by_platform: [{ platform: 'openai', today_actual_cost: 2, total_actual_cost: 8 }] },
      42: { today_actual_cost: 1, total_actual_cost: 10, by_platform: [{ platform: 'openai', today_actual_cost: 1, total_actual_cost: 10 }] }
    } })
    const wrapper = view()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(51)
    await flushPromises()
    const cycle = async () => {
      await wrapper.get(`[data-test="usage-sort-trigger-${key}"]`).trigger('click')
      await wrapper.get(`[data-test="usage-sort-${key}-${metric}"]`).trigger('click')
    }
    await cycle()
    expect(wrapper.get('[data-test="order"]').text()).toBe(descending)
    expect(JSON.parse(localStorage.getItem('admin-users-usage-sort')!).order).toBe('desc')
    await cycle()
    expect(wrapper.get('[data-test="order"]').text()).toBe(ascending)
    await cycle()
    expect(wrapper.get('[data-test="order"]').text()).toBe('41,42')
    expect(localStorage.getItem('admin-users-usage-sort')).toBeNull()
    expect(api.list).toHaveBeenCalledOnce()
  })

  it.each(['page', 'login'])('does not schedule the remaining quota chunks after changing %s ownership', async (change) => {
    const old = deferred<{ platform_quotas: [] }>()
    const firstPage = Array.from({ length: 8 }, (_, index) => user(41 + index))
    api.list.mockImplementation((pageNumber: number) => Promise.resolve({ items: pageNumber === 2 ? [user(99)] : firstPage, total: 9, pages: 2 }))
    api.quotas.mockImplementation((id: number) => id < 47 ? old.promise : Promise.resolve({ platform_quotas: [] }))
    const wrapper = view()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(51)
    expect(api.quotas.mock.calls.map(([id]) => id)).toEqual([41, 42, 43, 44, 45, 46])
    if (change === 'page') {
      await wrapper.get('[data-test="page-two"]').trigger('click')
      await flushPromises()
    } else {
      replaceAuthSession({ accessToken: 'synthetic-next-login', user: { id: 71001 } })
    }
    old.resolve({ platform_quotas: [] })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(51)
    await flushPromises()
    expect(api.quotas.mock.calls.map(([id]) => id)).toEqual(change === 'page' ? [41, 42, 43, 44, 45, 46, 99] : [41, 42, 43, 44, 45, 46])
    if (change === 'page') expect(wrapper.get('[data-test="order"]').text()).toBe('99')
  })

  it.each(['filterSettings', 'columnSettings'])('closes the %s popover with Escape and restores its trigger focus', async (key) => {
    const wrapper = view()
    await flushPromises()
    const trigger = wrapper.get(`button[title="admin.users.${key}"]`)
    trigger.element.focus()
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const container = new DOMWrapper(trigger.element.parentElement!)
    const choice = container.findAll('button').at(-1)!
    choice.element.focus()
    await choice.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
  })
  it('debounces search into one request and resets a later page', async () => {
    api.list.mockResolvedValue({ ...page(), total: 60, pages: 3 })
    const wrapper = view()
    await flushPromises()
    await wrapper.get('[data-test="page-two"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[type="search"]').setValue('first')
    await wrapper.get('input[type="search"]').setValue('final synthetic')
    expect(api.list).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(301)
    await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(3)
    expect(api.list.mock.calls[2]).toEqual([1, 20, expect.objectContaining({ search: 'final synthetic', include_subscriptions: true }), expect.any(Object)])
  })

  it('changes server sort and page size through their visible controls', async () => {
    api.list.mockResolvedValue({ ...page(), total: 60, pages: 3 })
    const wrapper = view()
    await flushPromises()
    await wrapper.get('[data-test="page-two"]').trigger('click')
    await wrapper.get('[data-sort="balance"]').trigger('click')
    await flushPromises()
    expect(api.list.mock.calls.at(-1)).toEqual([1, 20, expect.objectContaining({ sort_by: 'balance', sort_order: 'asc' }), expect.any(Object)])
    await wrapper.get('[data-test="size-50"]').trigger('click')
    await flushPromises()
    expect(api.list.mock.calls.at(-1)).toEqual([1, 50, expect.objectContaining({ include_subscriptions: true }), expect.any(Object)])
  })

  it('shows active standard groups and subscription expiry from public child props', async () => {
    api.list.mockResolvedValue(page([user(41, { subscriptions: [{ id: 1, group: { id: 10, name: 'Synthetic subscription badge' }, expires_at: '2026-11-08T01:00:00Z' }] as AdminUser['subscriptions'] })]))
    const wrapper = view()
    await flushPromises()
    const groupsCell = row(wrapper).get('[data-cell="groups"]')
    expect(groupsCell.text()).toContain('Synthetic Exclusive')
    expect(groupsCell.text()).toContain('Synthetic Public')
    expect(groupsCell.text()).not.toContain('Synthetic Disabled')
    expect(groupsCell.text()).not.toContain('Synthetic Subscription')
    expect(row(wrapper).get('[data-cell="subscriptions"]').text()).toBe('Synthetic subscription badge3 days')
    expect(row(wrapper).get('[data-cell="concurrency"]').text()).toBe('2/3')
  })

  it('renders selected attribute labels after the deferred batch response', async () => {
    api.definitions.mockResolvedValue([
      { id: 1, name: 'Synthetic plan', type: 'select', enabled: true, options: [{ value: 'pro', label: 'Synthetic Pro' }] },
      { id: 2, name: 'Synthetic regions', type: 'multi_select', enabled: true, options: [{ value: 'a', label: 'Synthetic Alpha' }] }
    ])
    api.attributes.mockResolvedValue({ attributes: { 41: { 1: 'pro', 2: '["a","legacy"]' }, 42: { 1: 'unknown', 2: '{malformed' } } })
    const wrapper = view()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(51)
    await flushPromises()
    expect(api.attributes).toHaveBeenCalledWith([41, 42])
    expect(row(wrapper).get('[data-cell="attr_1"]').text()).toBe('Synthetic Pro')
    expect(row(wrapper).get('[data-cell="attr_2"]').text()).toBe('Synthetic Alpha, legacy')
    expect(row(wrapper, 42).get('[data-cell="attr_1"]').text()).toBe('unknown')
    expect(row(wrapper, 42).get('[data-cell="attr_2"]').text()).toBe('{malformed')
  })

  it('names each visible filter control for role, status, group and API-key group', async () => {
    localStorage.setItem('user-visible-filters', JSON.stringify(['role', 'status', 'group', 'apiKeyGroup']))
    const wrapper = view()
    await flushPromises()
    const names = wrapper.findAll('.select-trigger').map(control => control.attributes('aria-label'))
    expect(names).toEqual(['admin.users.columns.role', 'admin.users.columns.status', 'admin.users.authorizedGroupFilter', 'admin.users.apiKeyGroupFilter'])
    expect(api.allGroups).toHaveBeenCalledOnce()
  })

  it('exposes group replacement through native keyboard reachable buttons and the captured old group', async () => {
    const wrapper = view()
    await flushPromises()
    const groupsCell = row(wrapper).get('[data-cell="groups"]')
    const trigger = groupsCell.findAll('button').find(button => button.text().includes('admin.users.exclusiveLabel'))!
    expect(trigger).toBeDefined()
    expect(trigger.attributes('type')).toBe('button')
    trigger.element.focus()
    trigger.element.click()
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    await clickText(groupsCell, 'Synthetic Exclusive')
    expect(wrapper.get('[data-test="named-modal"]').text()).toContain('41')
    expect(wrapper.get('[data-test="old-group"]').text()).toBe('7')
  })

  it('closes the keyboard action menu with Escape, restores focus, and fits a narrow viewport', async () => {
    const wrapper = view()
    await flushPromises()
    const trigger = row(wrapper).findAll('button').find(button => button.text() === 'common.more')!
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({ left: 330, right: 350, top: 570, bottom: 590, width: 20, height: 20 } as DOMRect)
    trigger.element.focus()
    await trigger.trigger('click')
    const menu = wrapper.get('.action-menu-content')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const left = parseFloat((menu.element as HTMLElement).style.left)
    const top = parseFloat((menu.element as HTMLElement).style.top)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 200).toBeLessThanOrEqual(352)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + 240).toBeLessThanOrEqual(592)
    await menu.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.action-menu-content').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  })
})
