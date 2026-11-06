import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView.vue'

const getPublicSettingsMock = vi.fn()
const forgotPasswordMock = vi.fn()
const verifyActionMock = vi.fn()
const captchaResetMock = vi.fn()

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key })
  }
})

vi.mock('@/stores', () => ({
  useAppStore: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn()
  })
}))

vi.mock('@/api/auth', () => ({
  getPublicSettings: (...args: unknown[]) => getPublicSettingsMock(...args),
  forgotPassword: (...args: unknown[]) => forgotPasswordMock(...args)
}))

const CaptchaChallengeStub = defineComponent({
  props: {
    tencentEnabled: Boolean,
    tencentAppId: String,
    tencentRegion: String
  },
  setup(_, { expose }) {
    expose({
      verifyAction: verifyActionMock,
      reset: captchaResetMock
    })
    return () => h('div', { 'data-testid': 'captcha-challenge' })
  }
})

function mountForgotPassword() {
  return mount(ForgotPasswordView, {
    global: {
      stubs: {
        AuthLayout: { template: '<div><slot /><slot name="footer" /></div>' },
        Icon: true,
        RouterLink: true,
        TurnstileWidget: CaptchaChallengeStub
      }
    }
  })
}

describe('忘记密码腾讯验证码门禁', () => {
  it('locks submission before awaiting captcha and keeps the original email', async () => {
    let finish!: (value: { token: string; randstr: string }) => void
    verifyActionMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountForgotPassword()
    await flushPromises()
    await wrapper.get('#email').setValue('first@example.test')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('#email').setValue('changed@example.test')
    await wrapper.get('form').trigger('submit')
    expect(verifyActionMock).toHaveBeenCalledOnce()
    finish({ token: 'proof', randstr: 'random' })
    await flushPromises()
    expect(forgotPasswordMock).toHaveBeenCalledOnce()
    expect(forgotPasswordMock.mock.calls[0][0].email).toBe('first@example.test')
    wrapper.unmount()
  })

  it('does not send email after leaving during captcha', async () => {
    let finish!: (value: { token: string; randstr: string }) => void
    verifyActionMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountForgotPassword()
    await flushPromises()
    await wrapper.get('#email').setValue('member@example.test')
    await wrapper.get('form').trigger('submit')
    wrapper.unmount()
    finish({ token: 'proof', randstr: 'random' })
    await flushPromises()
    expect(forgotPasswordMock).not.toHaveBeenCalled()
  })

  it('allows another submission after cancelled captcha', async () => {
    verifyActionMock.mockResolvedValueOnce(null)
    const wrapper = mountForgotPassword()
    await flushPromises()
    await wrapper.get('#email').setValue('member@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(forgotPasswordMock).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(forgotPasswordMock).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  beforeEach(() => {
    getPublicSettingsMock.mockReset()
    forgotPasswordMock.mockReset()
    verifyActionMock.mockReset()
    captchaResetMock.mockReset()
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: '123456789',
      tencent_captcha_region: 'intl',
      aliyun_captcha_enabled: false
    })
    verifyActionMock.mockResolvedValue({ token: 'ticket-value', randstr: '@rand-value' })
    forgotPasswordMock.mockResolvedValue({ message: 'ok' })
  })

  it('把公开设置中的站点传给验证码组件', async () => {
    const wrapper = mountForgotPassword()
    await flushPromises()

    const captcha = wrapper.findComponent(CaptchaChallengeStub)
    expect(captcha.props('tencentEnabled')).toBe(true)
    expect(captcha.props('tencentAppId')).toBe('123456789')
    expect(captcha.props('tencentRegion')).toBe('intl')
  })

  it('提交前获取新票据并原样发送到忘记密码接口', async () => {
    const wrapper = mountForgotPassword()
    await flushPromises()
    await wrapper.get('#email').setValue('user@example.com')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(verifyActionMock).toHaveBeenCalledOnce()
    expect(forgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      turnstile_token: undefined,
      tencent_captcha_ticket: 'ticket-value',
      tencent_captcha_randstr: '@rand-value'
    })
    expect(captchaResetMock).toHaveBeenCalledOnce()
  })
})
