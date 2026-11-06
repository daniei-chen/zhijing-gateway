import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UserBalanceModal from '@/components/admin/user/UserBalanceModal.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { AdminUser } from '@/types'

const { updateBalance, showError, showSuccess } = vi.hoisted(() => ({ updateBalance: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { users: { updateBalance } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en' }))
const Dialog = { props: ['show'], emits: ['close'], template: '<div v-if="show"><button data-test="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>' }
const wrappers: VueWrapper[] = []
function user(id = 41) { return { id, email: `synthetic-${id}@example.invalid`, balance: 5.125 } as AdminUser }
function modal(operation: 'add' | 'subtract' = 'add') { const wrapper = mount(UserBalanceModal, { props: { show: true, user: user(), operation }, global: { stubs: { BaseDialog: Dialog } } }); wrappers.push(wrapper); return wrapper }
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(() => { vi.clearAllMocks(); updateBalance.mockReset().mockResolvedValue({}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

describe('UserBalanceModal wire retry identity', () => {
  it('retains a nonempty idempotency key after an ambiguous transport failure', async () => {
    replaceAuthSession({ accessToken: 'synthetic-balance-admin', user: { id: 7 } })
    const { apiClient } = await import('@/api/client')
    const actualUsers = await vi.importActual<typeof import('@/api/admin/users')>('@/api/admin/users')
    const requests: Array<{ url: string | undefined, body: unknown, key: unknown }> = []
    const originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = async config => {
      requests.push({ url: config.url, body: JSON.parse(config.data), key: config.headers.get('Idempotency-Key') })
      if (requests.length === 1) throw Object.assign(new Error('synthetic response lost after dispatch'), { code: 'ERR_NETWORK', config })
      return { data: { code: 0, data: user() }, status: 200, statusText: 'OK', headers: { 'x-idempotency-replayed': 'true' }, config }
    }
    updateBalance.mockImplementation(actualUsers.updateBalance)
    try {
      const wrapper = modal()
      await wrapper.get('input[type="number"]').setValue('1.25')
      await wrapper.get('textarea').setValue('synthetic retry note')
      await submit(wrapper)
      expect(wrapper.emitted('close')).toBeUndefined()
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
      await submit(wrapper)
      expect(requests).toHaveLength(2)
      expect(requests.map(request => [request.url, request.body])).toEqual([
        ['/admin/users/41/balance', { balance: 1.25, operation: 'add', notes: 'synthetic retry note' }],
        ['/admin/users/41/balance/replay', { balance: 1.25, operation: 'add', notes: 'synthetic retry note' }],
      ])
      expect(requests[0].key).toEqual(expect.any(String))
      expect(requests[0].key).not.toBe('')
      expect(requests[1].key).toBe(requests[0].key)
    } finally {
      apiClient.defaults.adapter = originalAdapter
    }
  })
})

describe('UserBalanceModal transaction and visible validation', () => {
  it('connects amount and notes to visible labels in either operation mode', async () => {
    const wrapper = modal()
    const amount = wrapper.get('input[type="number"]')
    expect(amount.attributes('id')).toBeTruthy()
    expect((amount.element as HTMLInputElement).labels?.[0].textContent).toBe('admin.users.depositAmount')
    const notes = wrapper.get('textarea')
    expect(notes.attributes('id')).toBeTruthy()
    expect((notes.element as HTMLTextAreaElement).labels?.[0].textContent).toBe('admin.users.notes')
    await wrapper.setProps({ operation: 'subtract' })
    expect((amount.element as HTMLInputElement).labels?.[0].textContent).toBe('admin.users.withdrawAmount')
  })
  it.each(['add', 'subtract'] as const)('submits the exact target, amount, notes and %s operation', async (operation) => {
    const wrapper = modal(operation)
    await wrapper.get('input[type="number"]').setValue('0.125')
    await wrapper.get('textarea').setValue('synthetic ledger note')
    expect(wrapper.text()).toContain(operation === 'add' ? '$5.25' : '$5.00')
    await submit(wrapper)
    expect(updateBalance).toHaveBeenCalledExactlyOnceWith(41, 0.125, operation, 'synthetic ledger note')
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it.each(['0', '-0.5', ''])('rejects amount %s before starting a financial request', async (amount) => {
    const wrapper = modal()
    await wrapper.get('input[type="number"]').setValue(amount)
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.users.amountRequired')
    expect(updateBalance).not.toHaveBeenCalled()
  })

  it('rejects excess withdrawal and lets the visible withdraw-all action use the exact balance', async () => {
    const wrapper = modal('subtract')
    await wrapper.get('input[type="number"]').setValue('6')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.users.insufficientBalance')
    expect(updateBalance).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === 'admin.users.withdrawAll')!.trigger('click')
    expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('5.125')
    expect(wrapper.text()).toContain('$0.00')
    await submit(wrapper)
    expect(updateBalance).toHaveBeenCalledExactlyOnceWith(41, 5.125, 'subtract', '')
  })

  it('keeps an error retryable without retrying the financial write automatically', async () => {
    updateBalance.mockRejectedValueOnce({ message: 'synthetic balance conflict' })
    const wrapper = modal()
    await wrapper.get('input[type="number"]').setValue('1.25')
    await wrapper.get('textarea').setValue('synthetic retry note')
    await submit(wrapper)
    expect(updateBalance).toHaveBeenCalledOnce()
    expect(showError).toHaveBeenCalledWith('synthetic balance conflict')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('1.25')
    await submit(wrapper)
    expect(updateBalance.mock.calls).toEqual([[41, 1.25, 'add', 'synthetic retry note'], [41, 1.25, 'add', 'synthetic retry note']])
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('asks for ledger reconciliation when the prior result is unconfirmed', async () => {
    updateBalance.mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED', message: 'synthetic expired result' })
    const wrapper = modal()
    await wrapper.get('input[type="number"]').setValue('1.25')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledExactlyOnceWith('admin.users.balanceResultUnconfirmed')
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(updateBalance).toHaveBeenCalledOnce()
  })

  it('blocks a duplicate submit before the financial request resolves', async () => {
    const pending = deferred<{}>()
    updateBalance.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('input[type="number"]').setValue('2')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(updateBalance).toHaveBeenCalledOnce()
    pending.resolve({})
    await flushPromises()
  })

  it.each(['user', 'operation', 'reopen', 'dismiss', 'unmount', 'login'])('suppresses a result after changing %s ownership', async (change) => {
    const pending = deferred<{}>()
    updateBalance.mockReturnValueOnce(pending.promise)
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const wrapper = modal()
    await wrapper.setProps({ onSuccess, onClose } as never)
    await wrapper.get('input[type="number"]').setValue('2')
    await wrapper.get('form').trigger('submit')
    if (change === 'user') await wrapper.setProps({ user: user(42) })
    if (change === 'operation') await wrapper.setProps({ operation: 'subtract' })
    if (change === 'reopen') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'dismiss') await wrapper.get('[data-test="dismiss"]').trigger('click')
    if (change === 'unmount') wrapper.unmount()
    if (change === 'login') replaceAuthSession({ accessToken: 'synthetic-next-login', user: { id: 70003 } })
    const closeCount = onClose.mock.calls.length
    pending.resolve({})
    await flushPromises()
    expect(updateBalance).toHaveBeenCalledExactlyOnceWith(41, 2, 'add', '')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(closeCount)
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('keeps the new user transaction locked when the old user transaction completes late', async () => {
    const old = deferred<{}>()
    const current = deferred<{}>()
    updateBalance.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = modal()
    await wrapper.get('input[type="number"]').setValue('1')
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, user: user(42) })
    await wrapper.get('input[type="number"]').setValue('2')
    await wrapper.get('form').trigger('submit')
    expect(updateBalance).toHaveBeenCalledTimes(2)
    old.resolve({})
    await flushPromises()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('success')).toBeUndefined()
    current.resolve({})
    await flushPromises()
    expect(updateBalance.mock.calls[1]).toEqual([42, 2, 'add', ''])
    expect(wrapper.emitted('success')).toHaveLength(1)
  })
})
