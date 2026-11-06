import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UsersView from '../UsersView.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { AdminUser } from '@/types'

const { list, remove, toggleStatus, definitions, showError, showSuccess } = vi.hoisted(() => ({
  list: vi.fn(), remove: vi.fn(), toggleStatus: vi.fn(), definitions: vi.fn(), showError: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: {
  users: { list, delete: remove, toggleStatus, getPlatformQuotas: vi.fn().mockResolvedValue({ platform_quotas: [] }) },
  groups: { getAll: vi.fn().mockResolvedValue([]), getAllIncludingInactive: vi.fn().mockResolvedValue([]) },
  dashboard: { getBatchUsersUsage: vi.fn().mockResolvedValue({ stats: {} }) },
  userAttributes: { listEnabledDefinitions: definitions, getBatchUserAttributes: vi.fn().mockResolvedValue({ attributes: {} }) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const Table = {
  props: ['data', 'selectedKeys'], emits: ['update:selectedKeys'],
  template: `<div><div data-test="rows">{{ data.map(row => row.id+':'+row.status).join(',') }}</div>
    <div v-for="row in data" :data-test="'row-'+row.id"><button :data-test="'select-'+row.id" @click="$emit('update:selectedKeys', [...(selectedKeys||[]), row.id])">select</button><slot name="cell-actions" :row="row"/></div></div>`
}
const Confirm = { props: ['show', 'message'], emits: ['confirm', 'cancel'], template: '<div v-if="show" data-test="confirm-dialog">{{message}}<button data-test="confirm" @click="$emit(\'confirm\')">confirm</button><button data-test="cancel" @click="$emit(\'cancel\')">cancel</button></div>' }
const wrappers: VueWrapper[] = []
const user = (id: number) => ({ id, email: `synthetic-${id}@example.invalid`, role: 'user', status: 'active', concurrency: 1, balance: 0, allowed_groups: [], created_at: '2026-11-06T00:00:00Z' } as AdminUser)
const page = (items = [user(41), user(42)]) => ({ items, total: items.length, pages: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function view(realSelect = false) {
  const wrapper = mount(UsersView, { global: { stubs: {
    AppLayout: { template: '<div><slot/></div>' }, TablePageLayout: { template: '<div><slot name="actions"/><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
    DataTable: Table, ConfirmDialog: Confirm, Pagination: { emits: ['update:page'], template: '<button data-test="page-two" @click="$emit(\'update:page\', 2)">next</button>' },
    EmptyState: true, GroupBadge: true, Select: realSelect ? false : true, UserAttributesConfigModal: true, UserConcurrencyCell: true,
    UserCreateModal: true, UserEditModal: true, BulkEditUserModal: true, UserPlatformQuotaModal: true, UserApiKeysModal: true,
    UserAllowedGroupsModal: true, UserBalanceModal: true, UserBalanceHistoryModal: true, GroupReplaceModal: true, Icon: true, Teleport: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
async function action(wrapper: VueWrapper, id: number, key: string) {
  const button = wrapper.get(`[data-test="row-${id}"]`).findAll('button').find(button => button.text() === key)!
  expect(button).toBeDefined()
  await button.trigger('click')
}
async function menuDelete(wrapper: VueWrapper, id: number) {
  await action(wrapper, id, 'common.more')
  const target = wrapper.findAll('button').find(button => button.text() === 'common.delete')!
  expect(target).toBeDefined()
  await target.trigger('click')
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  definitions.mockReset().mockResolvedValue([])
  list.mockReset().mockResolvedValue(page())
  remove.mockReset().mockResolvedValue({})
  toggleStatus.mockReset().mockResolvedValue({ status: 'disabled', updated_at: 'new' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('UsersView page and mutation ownership', () => {
  it('resets pagination when applying a narrower role filter through the real Select', async () => {
    localStorage.setItem('user-visible-filters', JSON.stringify(['role']))
    list.mockResolvedValue({ ...page(), total: 80, pages: 4 })
    const wrapper = view(true)
    await flushPromises()
    await wrapper.get('[data-test="page-two"]').trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.[0]).toBe(2)
    await wrapper.findAll('button.select-trigger').find(button => button.text() === 'admin.users.allRoles')!.trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === 'admin.users.admin')!.trigger('click')
    await flushPromises()
    expect(list.mock.calls.at(-1)?.[2].role).toBe('admin')
    expect(list.mock.calls.at(-1)?.[0]).toBe(1)
  })

  it('does not initialize a page after unmounting during attribute definitions', async () => {
    const pending = deferred<[]>()
    definitions.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    wrapper.unmount()
    pending.resolve([])
    await flushPromises()
    expect(list).not.toHaveBeenCalled()
  })

  it('does not toast a failed list that a newer search has superseded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const old = deferred<ReturnType<typeof page>>()
    list.mockReturnValueOnce(old.promise)
    const wrapper = view()
    await flushPromises()
    await wrapper.get('input[type="search"]').setValue('synthetic-next')
    await vi.advanceTimersByTimeAsync(301)
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    old.reject(new Error('synthetic stale failure'))
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })

  it('prevents duplicate status writes for one row', async () => {
    const pending = deferred<{ status: string }>()
    toggleStatus.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await flushPromises()
    await action(wrapper, 41, 'admin.users.disable')
    await action(wrapper, 41, 'admin.users.disable')
    expect(toggleStatus).toHaveBeenCalledOnce()
    pending.resolve({ status: 'disabled' })
  })

  it('does not toast a status result after page unmount', async () => {
    const pending = deferred<{ status: string }>()
    toggleStatus.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await flushPromises()
    await action(wrapper, 41, 'admin.users.disable')
    wrapper.unmount()
    pending.resolve({ status: 'disabled' })
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('does not close the next deletion confirmation when an earlier deletion completes', async () => {
    const pending = deferred<{}>()
    remove.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await flushPromises()
    await menuDelete(wrapper, 41)
    await wrapper.get('[data-test="confirm"]').trigger('click')
    await wrapper.get('[data-test="cancel"]').trigger('click')
    await menuDelete(wrapper, 42)
    pending.resolve({})
    await flushPromises()
    expect(wrapper.find('[data-test="confirm-dialog"]').exists()).toBe(true)
  })

  it('prevents duplicate single-user deletion requests', async () => {
    const pending = deferred<{}>()
    remove.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await flushPromises()
    await menuDelete(wrapper, 41)
    await wrapper.get('[data-test="confirm"]').trigger('click')
    await wrapper.get('[data-test="confirm"]').trigger('click')
    expect(remove).toHaveBeenCalledOnce()
    pending.resolve({})
  })

  it.each(['unmount', 'login'])('stops the next scheduled deletion after %s', async (change) => {
    const pending = deferred<{}>()
    remove.mockReturnValueOnce(pending.promise)
    const wrapper = view()
    await flushPromises()
    await wrapper.get('[data-test="select-41"]').trigger('click')
    await wrapper.get('[data-test="select-42"]').trigger('click')
    await wrapper.get('[data-test="bulk-delete-users"]').trigger('click')
    await wrapper.get('[data-test="confirm"]').trigger('click')
    if (change === 'unmount') wrapper.unmount()
    else replaceAuthSession({ accessToken: 'synthetic-next-session', user: { id: 999 } })
    pending.resolve({})
    await flushPromises()
    // The real client also checks request credentials; the obsolete UI must stop scheduling.
    expect(remove).toHaveBeenCalledOnce()
    expect(showSuccess).not.toHaveBeenCalled()
  })
})
