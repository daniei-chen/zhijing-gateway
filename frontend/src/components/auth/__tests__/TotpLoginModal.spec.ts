import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TotpLoginModal from '@/components/auth/TotpLoginModal.vue'

const { showErrorMock } = vi.hoisted(() => ({
  showErrorMock: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/stores', () => ({
  useAppStore: () => ({
    showError: (...args: any[]) => showErrorMock(...args),
  }),
}))

describe('TotpLoginModal', () => {
  beforeEach(() => {
    showErrorMock.mockReset()
  })

  it('sends verification errors to toast and does not render inline red text', async () => {
    const wrapper = mount(TotpLoginModal, {
      props: {
        tempToken: 'temp-token',
        userEmailMasked: 'u***@example.com',
      },
    })

    ;(wrapper.vm as unknown as { setError: (message: string) => void }).setError('Invalid code')
    await wrapper.vm.$nextTick()

    expect(showErrorMock).toHaveBeenCalledWith('Invalid code')
    expect(wrapper.text()).not.toContain('Invalid code')
    expect(wrapper.find('.bg-red-50').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps Tab focus in the dialog and restores the login control on close', async () => {
    const trigger = document.createElement('button')
    trigger.id = 'zhijing-login-submit'
    document.body.append(trigger)
    trigger.focus()
    const wrapper = mount(TotpLoginModal, { props: { tempToken: 'preview' }, attachTo: document.body })
    try {
      await wrapper.vm.$nextTick()
      const inputs = wrapper.findAll('input:not([aria-hidden="true"])')
      expect(document.activeElement).toBe(inputs[0].element)
      await inputs[0].trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(wrapper.get('button').element)
      await wrapper.get('button').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(inputs[0].element)
      ;(wrapper.vm as unknown as { setVerifying: (value: boolean) => void }).setVerifying(true)
      await wrapper.vm.$nextTick()
      expect(document.activeElement).toBe(wrapper.get('[role="dialog"]').element)
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(wrapper.get('[role="dialog"]').element)
    } finally {
      wrapper.unmount()
    }
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('allows Escape cancellation while idle and preserves the native busy guard', async () => {
    const wrapper = mount(TotpLoginModal, { props: { tempToken: 'preview' } })
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    ;(wrapper.vm as unknown as { setVerifying: (value: boolean) => void }).setVerifying(true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('still emits the native verification event once all six digits are entered', async () => {
    const wrapper = mount(TotpLoginModal, { props: { tempToken: 'preview' } })
    const inputs = wrapper.findAll('input:not([aria-hidden="true"])')
    for (let index = 0; index < 6; index++) await inputs[index].setValue(String(index + 1))
    expect(wrapper.emitted('verify')).toEqual([['123456']])
    wrapper.unmount()
  })
})
