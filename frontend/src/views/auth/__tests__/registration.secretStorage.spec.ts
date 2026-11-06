import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterView from '@/views/auth/RegisterView.vue'
import EmailVerifyView from '@/views/auth/EmailVerifyView.vue'

const { register, push, sendVerifyCode } = vi.hoisted(() => ({
  register: vi.fn(), push: vi.fn(), sendVerifyCode: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }))
vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { t: (key: string) => key } }),
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } })
}))
vi.mock('@/stores', () => ({
  useAuthStore: () => ({ register, pendingAuthSession: null }),
  useAppStore: () => ({ cachedPublicSettings: null, showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() })
}))
vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }))
vi.mock('@/api/auth', () => ({
  getPublicSettings: vi.fn().mockResolvedValue({
    registration_enabled: true, email_verify_enabled: true, promo_code_enabled: false,
    invitation_code_enabled: false, turnstile_enabled: false, registration_email_suffix_whitelist: []
  }),
  sendVerifyCode, sendPendingOAuthVerifyCode: vi.fn(),
  validatePromoCode: vi.fn(), validateInvitationCode: vi.fn(), isWeChatWebOAuthEnabled: () => false,
  buildOAuthLoginStartURL: vi.fn(), startOAuthLogin: vi.fn(), persistOAuthTokenContext: vi.fn(), isOAuthLoginCompletion: vi.fn()
}))
const stubs = {
  AuthLayout: { template: '<div><slot /><slot name="footer" /></div>' },
  Icon: true, RouterLink: true, TurnstileWidget: true, LoginAgreementPrompt: true,
  EmailOAuthButtons: true, LinuxDoOAuthSection: true, OidcOAuthSection: true, WechatOAuthSection: true,
  transition: false
}
const password = 'SYNTHETIC-never-write-to-storage'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  register.mockResolvedValue({})
  sendVerifyCode.mockResolvedValue({ countdown: 60 })
})

async function startRegistration() {
  const wrapper = mount(RegisterView, { global: { stubs } })
  await flushPromises()
  await wrapper.get('#email').setValue('new@example.test')
  await wrapper.get('#password').setValue(password)
  await wrapper.get('#confirmPassword').setValue(password)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(push).toHaveBeenCalledWith('/email-verify')
  return wrapper
}

describe('registration password lifetime', () => {
  it('preserves the registration API payload without persisting the password between pages', async () => {
    const first = await startRegistration()
    expect(sessionStorage.getItem('register_data')).toBeNull()
    first.unmount()
    const verification = mount(EmailVerifyView, { global: { stubs } })
    await flushPromises()
    expect(sendVerifyCode).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.test' }))
    await verification.get('#code').setValue('123456')
    await verification.get('form').trigger('submit')
    await flushPromises()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.test', password, verify_code: '123456' }))
    expect(sessionStorage.getItem('register_data')).toBeNull()
    verification.unmount()
  })

  it('discards a legacy stored password and shows the explicit return-to-registration path', async () => {
    sessionStorage.setItem('register_data', JSON.stringify({ email: 'old@example.test', password }))
    const verification = mount(EmailVerifyView, { global: { stubs } })
    await flushPromises()
    expect(sessionStorage.getItem('register_data')).toBeNull()
    expect(verification.find('form').exists()).toBe(false)
    expect(verification.text()).toContain('auth.sessionExpired')
    expect(sendVerifyCode).not.toHaveBeenCalled()
    await verification.get('button').trigger('click')
    expect(push).toHaveBeenCalledWith('/register')
    verification.unmount()
  })

  it('requires a new registration draft after the verification page is recreated', async () => {
    const first = await startRegistration()
    first.unmount()
    const verification = mount(EmailVerifyView, { global: { stubs } })
    await flushPromises()
    expect(verification.find('form').exists()).toBe(true)
    verification.unmount()
    const recreated = mount(EmailVerifyView, { global: { stubs } })
    await flushPromises()
    expect(recreated.find('form').exists()).toBe(false)
    expect(recreated.text()).toContain('auth.sessionExpired')
    recreated.unmount()
  })
})
