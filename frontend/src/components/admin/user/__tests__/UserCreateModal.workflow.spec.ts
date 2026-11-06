import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UserCreateModal from '@/components/admin/user/UserCreateModal.vue'
import { replaceAuthSession } from '@/api/authSession'

const { create, showError, showSuccess } = vi.hoisted(() => ({ create: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { users: { create } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const Dialog = { props: ['show'], emits: ['close'], template: '<div v-if="show"><button data-test="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>' }
const StepUp = { props: ['controller'], template: '<div v-if="controller.visible.value" data-test="step-up"><button data-test="grant" @click="controller.onVerified()">grant</button><button data-test="cancel-grant" @click="controller.onCancel()">cancel grant</button></div>' }
const wrappers: VueWrapper[] = []
function modal() {
  const wrapper = mount(UserCreateModal, { props: { show: true }, global: { stubs: { BaseDialog: Dialog, TotpStepUpDialog: StepUp, Icon: true } } })
  wrappers.push(wrapper)
  return wrapper
}
async function fill(wrapper: VueWrapper) {
  await wrapper.get('input[type="email"]').setValue('synthetic@example.invalid')
  await wrapper.get('input[placeholder="admin.users.enterPassword"]').setValue('synthetic-password')
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(() => { vi.clearAllMocks(); create.mockReset().mockResolvedValue({ id: 41 }) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('UserCreateModal delayed step-up ownership', () => {
  it('does not open an old create prompt inside a newly opened draft', async () => {
    const pending = deferred<{ id: number }>()
    create.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await wrapper.get('input[type="email"]').setValue('new-draft@example.invalid')
    pending.reject({ code: 'STEP_UP_REQUIRED' })
    await flushPromises()
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('new-draft@example.invalid')
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(false)
    expect(create).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
  })
})

describe('UserCreateModal API contract and request ownership', () => {
  it('generates an editable password through a named button without submitting the form', async () => {
    const wrapper = modal()
    await wrapper.get('input[type="email"]').setValue('synthetic@example.invalid')
    await wrapper.get('button[aria-label="common.refresh admin.users.password"]').trigger('click')
    const password = (wrapper.get('input[placeholder="admin.users.enterPassword"]').element as HTMLInputElement).value
    expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*]{16}$/)
    expect(create).not.toHaveBeenCalled()
    await submit(wrapper)
    expect(create.mock.calls[0][0].password).toBe(password)
  })
  it('connects each visible native field to its label', () => {
    const wrapper = modal()
    const fields = wrapper.findAll('form input, form select')
    expect(fields).toHaveLength(7)
    for (const field of fields) {
      expect(field.attributes('id')).toBeTruthy()
      expect((field.element as HTMLInputElement).labels?.[0].textContent?.trim()).toBeTruthy()
    }
  })
  it.each([['', undefined], ['0', 0], ['0.125', 0.125], ['25', 25]])('creates with initial balance %s and preserves its omit/zero distinction', async (value, expected) => {
    const wrapper = modal()
    await fill(wrapper)
    await wrapper.get('input[type="number"]').setValue(value)
    await submit(wrapper)
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({ email: 'synthetic@example.invalid', password: 'synthetic-password', role: 'user', concurrency: 1, rpm_limit: 0 })
    if (expected === undefined) expect(create.mock.calls[0][0]).not.toHaveProperty('balance')
    else expect(create.mock.calls[0][0].balance).toBe(expected)
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps a rejected create draft editable and retries corrected data once', async () => {
    create.mockRejectedValueOnce(new Error('synthetic email already registered'))
    const wrapper = modal()
    await fill(wrapper)
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic email already registered')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('input[type="email"]').setValue('corrected@example.invalid')
    await submit(wrapper)
    expect(create.mock.calls[1][0].email).toBe('corrected@example.invalid')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('blocks another create while its first write is pending', async () => {
    const pending = deferred<{ id: number }>()
    create.mockReturnValueOnce(pending.promise)
    const wrapper = modal()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(create).toHaveBeenCalledOnce()
    pending.resolve({ id: 41 })
    await flushPromises()
  })

  it.each(['reopen', 'dismiss', 'unmount', 'login'])('suppresses completion belonging to the prior %s view', async (change) => {
    const pending = deferred<{ id: number }>()
    create.mockReturnValueOnce(pending.promise)
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const wrapper = modal()
    await wrapper.setProps({ onSuccess, onClose } as never)
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    if (change === 'reopen') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'dismiss') await wrapper.get('[data-test="dismiss"]').trigger('click')
    if (change === 'unmount') wrapper.unmount()
    if (change === 'login') replaceAuthSession({ accessToken: 'synthetic-new-login', user: { id: 70001 } })
    const closeCount = onClose.mock.calls.length
    pending.resolve({ id: 41 })
    await flushPromises()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(closeCount)
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it('retries the original payload after successful step-up, then emits one completion', async () => {
    create.mockRejectedValueOnce({ code: 'STEP_UP_REQUIRED' })
    const wrapper = modal()
    await fill(wrapper)
    await submit(wrapper)
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(true)
    await wrapper.get('input[type="email"]').setValue('edited-during-prompt@example.invalid')
    await wrapper.get('[data-test="grant"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].email).toBe('synthetic@example.invalid')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('cancels the step-up prompt when the surrounding create view is closed', async () => {
    create.mockRejectedValueOnce({ code: 'STEP_UP_REQUIRED' })
    const wrapper = modal()
    await fill(wrapper)
    await submit(wrapper)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(wrapper.find('[data-test="step-up"]').exists()).toBe(false)
    expect(create).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.emitted('success')).toBeUndefined()
  })

  it.each(['STEP_UP_TOTP_NOT_ENABLED', 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'])('keeps the form open after a blocked sensitive action: %s', async (code) => {
    create.mockRejectedValueOnce({ code })
    const wrapper = modal()
    await fill(wrapper)
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith(code === 'STEP_UP_TOTP_NOT_ENABLED' ? 'stepUp.notEnabled' : 'stepUp.adminApiKeyForbidden')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(create).toHaveBeenCalledOnce()
  })
})
