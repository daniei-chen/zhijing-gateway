import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UserEditModal from '../UserEditModal.vue'
import type { AdminUser } from '@/types'
const showSuccess = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin', () => ({ adminAPI: {} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess, showError: vi.fn() }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.restoreAllMocks())

it('keeps the real clipboard helper from publishing the previous user password feedback', async () => {
  let finish!: () => void
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) } })
  const wrapper = mount(UserEditModal, { props: { show: true, user: { id: 41, email: 'synthetic-41@example.invalid', concurrency: 1, role: 'user' } as AdminUser }, global: { stubs: {
    BaseDialog: { props: ['show'], template: '<div v-if="show"><slot/><slot name="footer"/></div>' }, Select: true, UserAttributeForm: true, TotpStepUpDialog: true, Icon: true
  } } })
  try {
    await wrapper.get('input[placeholder="admin.users.enterNewPassword"]').setValue('synthetic-password')
    await wrapper.get('button.absolute').trigger('click')
    await wrapper.setProps({ user: { id: 42, email: 'synthetic-42@example.invalid', concurrency: 1, role: 'user' } as AdminUser })
    finish()
    await flushPromises()
    // The platform write may have been accepted; only stale application feedback is suppressed.
    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
    expect(showSuccess).not.toHaveBeenCalled()
  } finally { wrapper.unmount() }
})
