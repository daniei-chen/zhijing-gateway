import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ProfileBalanceNotifyCard from '../ProfileBalanceNotifyCard.vue'

const { sendNotifyEmailCode, verifyNotifyEmail, getProfile, updateProfile, toggleNotifyEmail } = vi.hoisted(() => ({
  sendNotifyEmailCode: vi.fn(),
  verifyNotifyEmail: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  toggleNotifyEmail: vi.fn()
}))

vi.mock('@/api', () => ({
  userAPI: { sendNotifyEmailCode, verifyNotifyEmail, getProfile, updateProfile, toggleNotifyEmail }
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: null }) }))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess: vi.fn(), showError: vi.fn() })
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'zh' }) }))

enableAutoUnmount(afterEach)

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const pendingRows = (wrapper: VueWrapper) => wrapper.findAll('.bg-yellow-50')
const pendingEmails = (wrapper: VueWrapper) => pendingRows(wrapper).map(row => row.get('span').text())

const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find(item => item.text() === text)!

describe('ProfileBalanceNotifyCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    sendNotifyEmailCode.mockResolvedValue({})
    getProfile.mockResolvedValue({ balance_notify_extra_emails: [] })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const compact = (overrides = {}) => mount(ProfileBalanceNotifyCard, {
    props: {
      compact: true, available: true, enabled: false, threshold: null,
      systemDefaultThreshold: 5, userEmail: 'member@example.com',
      extraEmails: [{ email: 'member@example.com', verified: true, disabled: false }],
      ...overrides
    }
  })

  it('saves the compact switch through the existing profile preference and blocks repeated changes while saving', async () => {
    const request = deferred()
    updateProfile.mockReturnValueOnce(request.promise)
    const wrapper = compact()
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    await toggle.setValue(true)
    expect(toggle.element.disabled).toBe(true)
    expect(updateProfile).toHaveBeenCalledTimes(1)
    expect(updateProfile).toHaveBeenCalledWith({ balance_notify_enabled: true })
    request.resolve()
    await flushPromises()
    expect(toggle.element.checked).toBe(true)
    expect(toggle.element.disabled).toBe(false)
    await wrapper.setProps({ enabled: true })

    updateProfile.mockResolvedValueOnce({ balance_notify_enabled: false })
    await toggle.setValue(false)
    await flushPromises()
    expect(updateProfile).toHaveBeenLastCalledWith({ balance_notify_enabled: false })
    expect(toggle.element.checked).toBe(false)
  })

  it('rolls the compact switch back when saving fails', async () => {
    updateProfile.mockRejectedValueOnce(new Error('offline'))
    const wrapper = compact()
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    await toggle.setValue(true)
    await flushPromises()
    expect(toggle.element.checked).toBe(false)
    expect(toggle.element.disabled).toBe(false)
  })

  it('requires native recipient verification before allowing the bound email to receive alerts', async () => {
    const wrapper = compact({ enabled: true, extraEmails: [] })
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    expect(toggle.element.disabled).toBe(true)
    expect(toggle.element.checked).toBe(false)
    expect(updateProfile).not.toHaveBeenCalled()
    await button(wrapper, '发送验证码').trigger('click')
    await flushPromises()
    expect(sendNotifyEmailCode).toHaveBeenCalledWith('member@example.com')

    getProfile.mockResolvedValueOnce({ balance_notify_extra_emails: [{ email: 'Member@Example.com', verified: true, disabled: false }] })
    verifyNotifyEmail.mockResolvedValueOnce({})
    await wrapper.get('input[inputmode="numeric"]').setValue('123456')
    await button(wrapper, 'profile.balanceNotify.verify').trigger('click')
    await flushPromises()
    expect(verifyNotifyEmail).toHaveBeenCalledWith('member@example.com', '123456')
    expect(toggle.element.disabled).toBe(false)
    expect(toggle.element.checked).toBe(true)
    expect(wrapper.find('.z-notification-verify').exists()).toBe(false)
  })

  it('re-enables a disabled verified recipient through the native email preference endpoint', async () => {
    const emails = [{ email: 'member@example.com', verified: true, disabled: false }]
    toggleNotifyEmail.mockResolvedValueOnce({ balance_notify_extra_emails: emails })
    updateProfile.mockResolvedValueOnce({ balance_notify_enabled: true, balance_notify_extra_emails: emails })
    const wrapper = compact({ enabled: true, extraEmails: [{ ...emails[0], disabled: true }] })
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    expect(toggle.element.checked).toBe(false)
    await toggle.setValue(true)
    await flushPromises()
    expect(toggleNotifyEmail).toHaveBeenCalledWith('member@example.com', false)
    expect(updateProfile).not.toHaveBeenCalled()
    expect(toggle.element.checked).toBe(true)
  })

  it('leaves the compact switch off when restoring a disabled recipient fails', async () => {
    toggleNotifyEmail.mockRejectedValueOnce(new Error('offline'))
    const wrapper = compact({ enabled: true, extraEmails: [{ email: 'member@example.com', verified: true, disabled: true }] })
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    await toggle.setValue(true)
    await flushPromises()
    expect(toggle.element.checked).toBe(false)
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('renders the preference returned by the backend instead of assuming the attempted value was accepted', async () => {
    updateProfile.mockResolvedValueOnce({ balance_notify_enabled: false })
    const wrapper = compact()
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    await toggle.setValue(true)
    await flushPromises()
    expect(toggle.element.checked).toBe(false)
  })

  it('keeps alerts unavailable when the site has disabled balance email notifications', () => {
    const wrapper = compact({ available: false, enabled: true })
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"]')
    expect(toggle.element.disabled).toBe(true)
    expect(toggle.element.checked).toBe(false)
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it.each(['remove', 'unmount'])('does not start a pending email timer after %s', async (action) => {
    const request = deferred()
    sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: { enabled: true, threshold: null, extraEmails: [], systemDefaultThreshold: 5, userEmail: '' }
    })
    await wrapper.get('input[type="email"]').setValue('new@example.com')
    await button(wrapper, 'common.add').trigger('click')
    await button(wrapper, 'profile.balanceNotify.sendCode').trigger('click')
    if (action === 'remove') await button(wrapper, 'profile.balanceNotify.removeEmail').trigger('click')
    else wrapper.unmount()

    request.resolve()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a saved email timer after unmount', async () => {
    const request = deferred()
    sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: {
        enabled: true, threshold: null, systemDefaultThreshold: 5, userEmail: '',
        extraEmails: [{ email: 'saved@example.com', disabled: false, verified: false }]
      }
    })
    await button(wrapper, 'profile.balanceNotify.verify').trigger('click')
    wrapper.unmount()
    request.resolve()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, 1])('removes only verified emails when request %i finishes first', async (first) => {
    const emails = ['first@example.com', 'second@example.com', 'third@example.com']
    const requests = [deferred(), deferred()]
    verifyNotifyEmail.mockImplementation((email: string) => requests[emails.indexOf(email)]!.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: { enabled: true, threshold: null, extraEmails: [], systemDefaultThreshold: 5, userEmail: '' }
    })

    for (const email of emails) {
      await wrapper.get('input[type="email"]').setValue(email)
      await button(wrapper, 'common.add').trigger('click')
    }
    for (const row of pendingRows(wrapper)) {
      await row.findAll('button').find(item => item.text() === 'profile.balanceNotify.sendCode')!.trigger('click')
    }
    await flushPromises()
    for (const row of pendingRows(wrapper)) {
      await row.get('input').setValue('123456')
    }
    for (const row of pendingRows(wrapper).slice(0, 2)) {
      await row.findAll('button').find(item => item.text() === 'profile.balanceNotify.verify')!.trigger('click')
    }
    expect(verifyNotifyEmail.mock.calls).toEqual(emails.slice(0, 2).map(email => [email, '123456']))

    requests[first]!.resolve()
    await flushPromises()
    expect(pendingEmails(wrapper)).toEqual(emails.filter((_, index) => index !== first))

    requests[1 - first]!.resolve()
    await flushPromises()
    expect(pendingEmails(wrapper)).toEqual([emails[2]])
    expect((pendingRows(wrapper)[0]!.get('input').element as HTMLInputElement).value).toBe('123456')
    expect(getProfile).toHaveBeenCalledTimes(2)
  })
})
