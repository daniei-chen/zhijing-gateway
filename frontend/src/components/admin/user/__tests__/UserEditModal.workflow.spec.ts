import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UserEditModal from '../UserEditModal.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { AdminUser } from '@/types'

const { update, updateAttributes, copyToClipboard, showError, showSuccess } = vi.hoisted(() => ({
  update: vi.fn(), updateAttributes: vi.fn(), copyToClipboard: vi.fn(), showError: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: { users: { update }, userAttributes: { updateUserAttributeValues: updateAttributes } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const Dialog = { props: ['show'], emits: ['close'], template: '<div v-if="show"><button data-test="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>' }
const StepUp = { props: ['controller'], template: '<div v-if="controller.visible.value" data-test="step-up"><button data-test="grant" @click="controller.onVerified()">grant</button><button data-test="cancel-grant" @click="controller.onCancel()">cancel grant</button></div>' }
const Attributes = { props: ['modelValue'], emits: ['update:modelValue'], template: '<input data-test="attribute" :value="modelValue[1] || \'\'" @input="$emit(\'update:modelValue\', {1: $event.target.value})" />' }
const wrappers: VueWrapper[] = []
function user(id = 41) { return { id, email: `synthetic-${id}@example.invalid`, username: 'Synthetic', notes: '', role: 'user', concurrency: 1, rpm_limit: 0 } as AdminUser }
function modal() {
  const wrapper = mount(UserEditModal, { props: { show: true, user: user() }, global: { stubs: { BaseDialog: Dialog, TotpStepUpDialog: StepUp, UserAttributeForm: Attributes, Icon: true } } })
  wrappers.push(wrapper)
  return wrapper
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(() => { vi.clearAllMocks(); update.mockReset().mockResolvedValue(user()); updateAttributes.mockReset().mockResolvedValue({}); copyToClipboard.mockReset().mockResolvedValue(true) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('UserEditModal delayed feedback ownership', () => {
  it('does not open the old user step-up prompt after switching users', async () => {
    const pending = deferred<AdminUser>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ user: user(42) })
    pending.reject({ code: 'STEP_UP_REQUIRED' })
    await flushPromises()
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('synthetic-42@example.invalid')
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(false)
    expect(update).toHaveBeenCalledExactlyOnceWith(41, expect.any(Object))
    expect(showError).not.toHaveBeenCalled()
  })

  it('removes copied feedback after the copied password is edited in the same user draft', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = modal()
    const password = wrapper.get('input[placeholder="admin.users.enterNewPassword"]')
    await password.setValue('synthetic-copied-password')
    await wrapper.get('button.absolute').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.absolute').classes()).toContain('text-green-500')
    await password.setValue('synthetic-uncopied-replacement')
    expect(wrapper.get('button.absolute').classes()).not.toContain('text-green-500')
    await vi.advanceTimersByTimeAsync(2001)
    expect(wrapper.get('button.absolute').classes()).not.toContain('text-green-500')
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith('synthetic-copied-password', 'admin.users.passwordCopied', expect.any(Function))
  })
})

describe('UserEditModal payload and transaction ownership', () => {
  it('generates a replacement password through the visible named action and sends it only on save', async () => {
    const wrapper = modal()
    await wrapper.get('button[aria-label="common.refresh admin.users.password"]').trigger('click')
    const password = (wrapper.get('input[placeholder="admin.users.enterNewPassword"]').element as HTMLInputElement).value
    expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*]{16}$/)
    expect(update).not.toHaveBeenCalled()
    await submit(wrapper)
    expect(update.mock.calls[0]).toEqual([41, expect.objectContaining({ password })])
  })
  it('does not mark the next user password as copied when the previous clipboard write completes', async () => {
    const pending = deferred<boolean>()
    copyToClipboard.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('synthetic-first-password')
    await wrapper.get('button.absolute').trigger('click')
    await wrapper.setProps({ user: user(42) })
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('synthetic-next-password')
    pending.resolve(true)
    await flushPromises()
    expect(wrapper.get('button.absolute').classes()).not.toContain('text-green-500')
  })

  it('clears the previous password copied timer before a new user copies another password', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = modal()
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('synthetic-first-password')
    await wrapper.get('button.absolute').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.setProps({ user: user(42) })
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('synthetic-next-password')
    await wrapper.get('button.absolute').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1001)
    expect(wrapper.get('button.absolute').classes()).toContain('text-green-500')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('button.absolute').classes()).not.toContain('text-green-500')
  })
  it('connects editable native fields and the real role Select to their labels', () => {
    const wrapper = modal()
    const fields = wrapper.findAll('form input:not([data-test="attribute"]), form textarea, form .select-trigger')
    expect(fields).toHaveLength(7)
    for (const field of fields) {
      expect(field.attributes('id')).toBeTruthy()
      expect((field.element as HTMLInputElement).labels?.[0].textContent?.trim()).toBeTruthy()
    }
  })
  it('submits trimmed replacement password, unlimited concurrency and the captured attributes', async () => {
    const wrapper = modal()
    await wrapper.get('input[type="email"]').setValue('edited@example.invalid')
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('  synthetic-new-password  ')
    await wrapper.get('[data-test="concurrency-input"]').setValue('0')
    await wrapper.get('[data-test="attribute"]').setValue('synthetic attribute')
    await submit(wrapper)
    expect(update).toHaveBeenCalledExactlyOnceWith(41, { email: 'edited@example.invalid', username: 'Synthetic', notes: '', role: 'user', concurrency: 0, rpm_limit: 0, password: 'synthetic-new-password' })
    expect(updateAttributes).toHaveBeenCalledExactlyOnceWith(41, { 1: 'synthetic attribute' })
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('omits an unchanged password and does not send an empty custom attribute update', async () => {
    const wrapper = modal()
    await submit(wrapper)
    expect(update.mock.calls[0][1]).not.toHaveProperty('password')
    expect(updateAttributes).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('validates the email before sending the user update', async () => {
    const wrapper = modal()
    await wrapper.get('input[type="email"]').setValue('  ')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.users.emailRequired')
    expect(update).not.toHaveBeenCalled()
  })

  it('locks a duplicate submit before any update request finishes', async () => {
    const pending = deferred<AdminUser>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(update).toHaveBeenCalledOnce()
    pending.resolve(user())
    await flushPromises()
  })

  it('uses the attribute snapshot from transaction start even when its input changes while awaiting the user update', async () => {
    const pending = deferred<AdminUser>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('[data-test="attribute"]').setValue('original attribute')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[data-test="attribute"]').setValue('changed after submit')
    pending.resolve(user())
    await flushPromises()
    expect(updateAttributes).toHaveBeenCalledExactlyOnceWith(41, { 1: 'original attribute' })
  })

  it('never writes the next user attributes through an older user update', async () => {
    const pending = deferred<AdminUser>()
    update.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, user: user(42) })
    await wrapper.get('[data-test="attribute"]').setValue('new user attribute')
    pending.resolve(user())
    await flushPromises()
    expect(update).toHaveBeenCalledExactlyOnceWith(41, expect.any(Object))
    expect(updateAttributes).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it.each(['user', 'reopen', 'dismiss', 'unmount', 'login'])('ignores a completed custom attribute stage after changing %s', async (change) => {
    const pending = deferred<{}>()
    updateAttributes.mockReturnValueOnce(pending.promise)
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const wrapper = modal()
    await wrapper.setProps({ onSuccess, onClose } as never)
    await wrapper.get('[data-test="attribute"]').setValue('original attribute')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(updateAttributes).toHaveBeenCalledExactlyOnceWith(41, { 1: 'original attribute' })
    if (change === 'user') await wrapper.setProps({ user: user(42) })
    if (change === 'reopen') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'dismiss') await wrapper.get('[data-test="dismiss"]').trigger('click')
    if (change === 'unmount') wrapper.unmount()
    if (change === 'login') replaceAuthSession({ accessToken: 'synthetic-next-session', user: { id: 70002 } })
    const closeCount = onClose.mock.calls.length
    pending.resolve({})
    await flushPromises()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(closeCount)
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('keeps a rejected attribute stage open for an explicit retry', async () => {
    updateAttributes.mockRejectedValueOnce(new Error('synthetic attribute write failure'))
    const wrapper = modal()
    await wrapper.get('[data-test="attribute"]').setValue('attribute retained')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic attribute write failure')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await submit(wrapper)
    expect(updateAttributes).toHaveBeenCalledTimes(2)
    expect(updateAttributes.mock.calls[1]).toEqual([41, { 1: 'attribute retained' }])
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('cancels a pending role step-up when switching to another user', async () => {
    update.mockRejectedValueOnce({ code: 'STEP_UP_REQUIRED' })
    const wrapper = modal()
    await submit(wrapper)
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(true)
    await wrapper.setProps({ user: user(42) })
    await flushPromises()
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(false)
    expect(update).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
  })
})
