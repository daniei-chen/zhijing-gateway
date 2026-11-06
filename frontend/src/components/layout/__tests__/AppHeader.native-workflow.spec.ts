/**
 * Header workflows use the rendered DOM, real memory router, Pinia auth store,
 * auth session generations and authAPI/Axios. All HTTP responses are synthetic.
 * Locale persistence/reload and subscription fetching are presentation adapters;
 * their controls and membership children are real. AnnouncementBell is stubbed.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { nextTick, reactive, type Component } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import type { CustomMenuItem, Group, PublicSettings, User, UserSubscription } from '@/types'

const createLocalePlugin = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, zh } })
type LocalePlugin = ReturnType<typeof createLocalePlugin>
type AuthStore = ReturnType<typeof import('@/stores/auth').useAuthStore>
interface AppFixture {
  mobileOpen: boolean
  contactInfo: string
  docUrl: string
  siteName: string
  cachedPublicSettings: Partial<PublicSettings> | null
  toggleMobileSidebar: ReturnType<typeof vi.fn>
}
const fixture = vi.hoisted(() => ({
  auth: null as AuthStore | null,
  app: null as AppFixture | null,
  admin: null as { customMenuItems: CustomMenuItem[] } | null,
  sub: null as { activeSubscriptions: UserSubscription[]; readonly hasActiveSubscriptions: boolean; fetchActiveSubscriptions: ReturnType<typeof vi.fn> } | null,
  replay: vi.fn(), setLocale: vi.fn(), i18n: null as unknown,
  currentLocale: 'en', reload: vi.fn(),
}))
vi.mock('@/stores', () => ({
  useAuthStore: () => fixture.auth,
  useAppStore: () => fixture.app,
  useOnboardingStore: () => ({ replay: fixture.replay }),
  useSubscriptionStore: () => fixture.sub,
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixture.app }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => fixture.admin }))
vi.mock('@/i18n', () => ({
  get i18n() { return fixture.i18n },
  getLocale: () => fixture.currentLocale,
  setLocale: fixture.setLocale,
  availableLocales: [{ code: 'en', name: 'English', flag: '🇺🇸' }, { code: 'zh', name: '中文', flag: '🇨🇳' }],
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const sampleUser = (patch: Partial<User> = {}): User => ({
  id: 98, username: 'Aurora', email: 'aurora@example.test', role: 'user', balance: 1234.5,
  frozen_balance: 12.25, concurrency: 5, status: 'active', allowed_groups: [],
  balance_notify_enabled: false, balance_notify_threshold: null, balance_notify_extra_emails: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch,
})
const membership = (patch: Partial<UserSubscription> = {}): UserSubscription => ({
  id: 980, user_id: 98, group_id: 44, status: 'active', starts_at: '2026-01-01T00:00:00Z',
  expires_at: '2099-12-31T00:00:00Z', daily_usage_usd: 12, weekly_usage_usd: 45,
  monthly_usage_usd: 80, daily_window_start: null, weekly_window_start: null, monthly_window_start: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
  group: { id: 44, name: 'Aurora Flagship', daily_limit_usd: 100, weekly_limit_usd: 500, monthly_limit_usd: 1000 } as Group,
  ...patch,
})
const menuItem = (id: string, label: string): CustomMenuItem => ({ id, label, url: 'https://docs.example.test/', icon_svg: '', sort_order: 0, visibility: 'user' })

let pinia: Pinia
let router: Router
let Header: Component
let auth: AuthStore
let session: typeof import('@/api/authSession')
let apiClient: typeof import('@/api/client').apiClient
let wrapper: VueWrapper | undefined
let wire: { method?: string; url?: string; body: unknown }[]
let logoutReply: ReturnType<typeof deferred<{ status: number; data?: unknown }>> | undefined
let consoleError: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('lang')
  fixture.replay.mockReset()
  fixture.setLocale.mockReset()
  fixture.reload.mockReset()
  fixture.currentLocale = 'en'
  const localePlugin = createLocalePlugin()
  fixture.i18n = localePlugin
  fixture.setLocale.mockImplementation(async (code: 'en' | 'zh') => {
    localePlugin.global.locale.value = code
    fixture.currentLocale = code
  })
  vi.stubGlobal('location', { ...window.location, reload: fixture.reload })
  fixture.app = reactive({
    mobileOpen: false, contactInfo: '', docUrl: '', siteName: '智境',
    cachedPublicSettings: { subscription_enabled: false, model_plaza_enabled: false },
    toggleMobileSidebar: vi.fn(() => { fixture.app!.mobileOpen = !fixture.app!.mobileOpen }),
  })
  fixture.admin = reactive({ customMenuItems: [] as CustomMenuItem[] })
  fixture.sub = reactive({
    activeSubscriptions: [] as UserSubscription[],
    get hasActiveSubscriptions() { return this.activeSubscriptions.length > 0 },
    fetchActiveSubscriptions: vi.fn().mockResolvedValue(undefined),
  })
  pinia = createPinia()
  setActivePinia(pinia)
  session = await import('@/api/authSession')
  const { useAuthStore } = await import('@/stores/auth')
  auth = useAuthStore()
  fixture.auth = auth
  session.replaceAuthSession({ accessToken: 'synthetic-header-access', refreshToken: 'synthetic-header-refresh', user: sampleUser() })
  ;({ apiClient } = await import('@/api/client'))
  wire = []
  logoutReply = undefined
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    wire.push({ method: config.method, url: config.url, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data })
    if (config.url !== '/auth/logout') throw new Error(`Unexpected synthetic HTTP ${config.method} ${config.url}`)
    const reply = logoutReply ? await logoutReply.promise : { status: 200, data: null }
    const response = { status: reply.status, statusText: String(reply.status), data: { code: reply.status === 200 ? 0 : 500, data: reply.data ?? null, message: 'synthetic response' }, headers: {}, config }
    if (reply.status >= 400) throw new AxiosError('Synthetic logout failure', 'ERR_BAD_RESPONSE', config, undefined, response)
    return response
  }
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/dashboard', name: 'Dashboard', component: { template: '<main />' }, meta: { titleKey: 'dashboard.title', descriptionKey: 'dashboard.welcomeMessage' } },
    { path: '/profile', name: 'Profile', component: { template: '<main />' }, meta: { title: 'Profile title', description: 'Profile description' } },
    { path: '/keys', name: 'Keys', component: { template: '<main />' } },
    { path: '/subscriptions', name: 'Subscriptions', component: { template: '<main />' } },
    { path: '/model-plaza', name: 'ModelPlaza', component: { template: '<main />' } },
    { path: '/purchase', name: 'PurchaseSubscription', component: { template: '<main />' }, meta: { titleKey: 'nav.purchase', descriptionKey: 'purchase.description' } },
    { path: '/custom/:id', name: 'CustomPage', component: { template: '<main />' }, meta: { title: 'Custom fallback' } },
    { path: '/login', name: 'Login', component: { template: '<main />' } },
  ] })
  await router.push('/dashboard')
  await router.isReady()
  Header = (await import('../AppHeader.vue')).default
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  wrapper?.unmount()
  wrapper = undefined
  disposePinia(pinia)
  logoutReply?.resolve({ status: 200 })
  await flushPromises()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
async function render() {
  wrapper = mount(Header, { attachTo: document.body, global: { plugins: [pinia, router, fixture.i18n as LocalePlugin], stubs: { AnnouncementBell: true } } })
  await flushPromises()
  return wrapper
}
async function openMenu() {
  await wrapper!.get('button.z-header-user').trigger('click')
  expect(wrapper!.get('button.z-header-user').attributes('aria-expanded')).toBe('true')
}
function logoutButton() {
  const result = wrapper!.findAll('.dropdown button').find((button) => button.text().includes('Logout'))
  if (!result) throw new Error('No visible Logout control')
  return result
}
async function startLogout() {
  await openMenu()
  await logoutButton().trigger('click')
  await flushPromises()
  expect(wire).toEqual([{ method: 'post', url: '/auth/logout', body: { refresh_token: 'synthetic-header-refresh' } }])
}
function replaceAccount(patch: Partial<User> = {}) {
  session.replaceAuthSession({ accessToken: 'synthetic-header-replacement', refreshToken: 'synthetic-header-next-refresh', user: sampleUser({ username: 'Current account', ...patch }) })
}

describe('AppHeader native member workflows', () => {
  it('shows the actual account name, role, initials and unscaled available/frozen/total USD', async () => {
    await render()
    expect(wrapper!.get('h1').text()).toBe('Dashboard')
    expect(wrapper!.get('.z-header-user').text()).toContain('Aurora')
    expect(wrapper!.get('.z-header-user').text()).toContain('AU')
    const wallet = wrapper!.get('.z-header-wallet')
    expect(wallet.attributes('aria-label')).toContain('$1,234.50')
    expect(wallet.text()).toContain('$12.25')
    expect(wallet.text()).toContain('$1,246.75')
    expect(wrapper!.find('.z-top-membership').exists()).toBe(false)
    expect(consoleWarn).not.toHaveBeenCalled()
  })
  it('uses email initials and display name when username and avatar are missing', async () => {
    replaceAccount({ username: '', email: 'member@example.test', avatar_url: null, frozen_balance: 0 })
    await render()
    expect(wrapper!.get('.z-header-user').text()).toContain('member')
    expect(wrapper!.get('.z-header-user').text()).toContain('ME')
    expect(wrapper!.find('.z-header-user img').exists()).toBe(false)
    expect(wrapper!.get('.z-header-wallet').text()).not.toContain('Frozen $')
  })
  it('uses a supplied avatar and updates money in the same valid session', async () => {
    replaceAccount({ avatar_url: ' https://images.example.test/avatar.png ' })
    await render()
    expect(wrapper!.get('.z-header-user img').attributes()).toMatchObject({ src: 'https://images.example.test/avatar.png', alt: 'Current account' })
    session.updateAuthSessionUser(session.captureAuthSession(), sampleUser({ balance: 2.75, frozen_balance: 0 }))
    await nextTick()
    expect(wrapper!.get('.z-header-wallet').attributes('aria-label')).toContain('$2.75')
    expect(wrapper!.get('.z-header-wallet').text()).not.toContain('$12.25')
  })
  it('toggles the mobile sidebar from its accessible control without changing the theme', async () => {
    document.documentElement.classList.add('dark')
    await render()
    const mobile = wrapper!.get('button[aria-controls="zhijing-sidebar"]')
    expect(mobile.attributes('aria-expanded')).toBe('false')
    await mobile.trigger('click')
    expect(mobile.attributes('aria-expanded')).toBe('true')
    await mobile.trigger('click')
    expect(mobile.attributes('aria-expanded')).toBe('false')
    expect(fixture.app!.toggleMobileSidebar).toHaveBeenCalledTimes(2)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  it('closes the real user menu on Escape and outside clicks', async () => {
    await render()
    await openMenu()
    expect(wrapper!.get('.dropdown').text()).toContain('aurora@example.test')
    await wrapper!.get('.dropdown').trigger('keydown', { key: 'Escape' })
    await vi.waitFor(() => expect(wrapper!.find('.dropdown').exists()).toBe(false))
    await openMenu()
    document.body.click()
    await nextTick()
    await vi.waitFor(() => expect(wrapper!.find('.dropdown').exists()).toBe(false))
  })
  it.each(['/profile', '/keys'])('navigates through %s and closes the menu', async (path) => {
    await render()
    await openMenu()
    await wrapper!.get(`.dropdown a[href="${path}"]`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(path)
    await vi.waitFor(() => expect(wrapper!.find('.dropdown').exists()).toBe(false))
    if (path === '/profile') expect(wrapper!.get('h1').text()).toBe('Profile title')
  })
  it('shows configured support text and mobile available/frozen funds inside the menu', async () => {
    fixture.app!.contactInfo = 'support@example.test'
    await render()
    await openMenu()
    expect(wrapper!.get('.dropdown').text()).toContain('support@example.test')
    expect(wrapper!.get('.dropdown').text()).toContain('$1,234.50')
    expect(wrapper!.get('.dropdown').text()).toContain('$12.25')
    expect(wrapper!.find('.dropdown a[target="_blank"]').exists()).toBe(false)
    expect(wrapper!.findAll('.dropdown button')).toHaveLength(1)
  })
  it('lets a standard administrator replay onboarding and exposes the existing source link', async () => {
    replaceAccount({ role: 'admin' })
    await render()
    await openMenu()
    expect(wrapper!.get('.dropdown a[target="_blank"]').attributes('rel')).toBe('noopener noreferrer')
    const replay = wrapper!.findAll('.dropdown button').find((button) => button.text().includes('Tour'))!
    expect(replay.exists()).toBe(true)
    await replay.trigger('click')
    expect(fixture.replay).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(wrapper!.find('.dropdown').exists()).toBe(false))
  })
  it('renders safe documentation URLs and the website entry while rejecting javascript URLs', async () => {
    fixture.app!.docUrl = 'https://docs.example.test/guide'
    await render()
    expect(wrapper!.get('a[href="https://docs.example.test/guide"]').attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper!.get('a.z-website-link').attributes('href')).toBe('/')
    fixture.app!.docUrl = 'javascript:alert(1)'
    await nextTick()
    expect(wrapper!.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper!.findAll('a').some((link) => link.text() === 'Docs')).toBe(false)
  })
  it('uses actual feature flags for model plaza without adding authentication to its URL', async () => {
    await render()
    expect(wrapper!.find('a[href^="/model-plaza"]').exists()).toBe(false)
    fixture.app!.cachedPublicSettings!.model_plaza_enabled = true
    await nextTick()
    const plaza = wrapper!.get('a[href="/model-plaza?embedded=1"]')
    await plaza.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ embedded: '1' })
    expect(router.currentRoute.value.fullPath).not.toContain('synthetic')
  })
  it('displays actual subscription name, expiry and dollar quotas in the real mini menu', async () => {
    fixture.app!.cachedPublicSettings!.subscription_enabled = true
    fixture.sub!.activeSubscriptions = [membership()]
    await render()
    expect(fixture.sub!.fetchActiveSubscriptions).toHaveBeenCalledTimes(1)
    expect(wrapper!.get('.z-top-membership').text()).toContain('Aurora Flagship')
    expect(wrapper!.get('.z-top-membership').text()).toContain('2099')
    await wrapper!.get('button.z-top-membership').trigger('click')
    expect(wrapper!.get('.z-subscription-mini-popover').text()).toContain('$12.00/$100.00')
    expect(wrapper!.get('.z-subscription-mini-popover').text()).toContain('$45.00/$500.00')
    await wrapper!.get('.z-subscription-mini-popover a[href="/subscriptions"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/subscriptions')
    await vi.waitFor(() => expect(wrapper!.find('.z-subscription-mini-popover').exists()).toBe(false))
  })
  it('does not fetch or expose subscriptions when disabled, even with assigned memberships', async () => {
    fixture.sub!.activeSubscriptions = [membership()]
    await render()
    expect(fixture.sub!.fetchActiveSubscriptions).not.toHaveBeenCalled()
    expect(wrapper!.find('button.z-top-membership').exists()).toBe(false)
    expect(wrapper!.text()).not.toContain('Aurora Flagship')
  })
  it.each([
    [{ subscription_enabled: false }, 'nav.recharge', 'purchase.rechargeDescription'],
    [{ subscription_enabled: true, payment_balance_disabled: true }, 'nav.subscribe', 'purchase.subscriptionDescription'],
    [{ subscription_enabled: true, payment_balance_disabled: false }, 'nav.purchase', 'purchase.description'],
  ] as const)('uses billing-mode title and description from settings %j', async (settings, title, description) => {
    Object.assign(fixture.app!.cachedPublicSettings!, settings)
    await router.push('/purchase')
    await render()
    const plugin = fixture.i18n as LocalePlugin
    expect(wrapper!.get('h1').text()).toBe(plugin.global.t(title))
    expect(wrapper!.get('.z-header-description').text()).toBe(plugin.global.t(description))
  })
  it('uses public custom menu labels but does not expose administrator-only labels to members', async () => {
    fixture.app!.cachedPublicSettings!.custom_menu_items = [menuItem('public', 'Public workspace')]
    fixture.admin!.customMenuItems = [menuItem('private', 'Private operations')]
    await router.push('/custom/public')
    await render()
    expect(wrapper!.get('h1').text()).toBe('Public workspace')
    await router.push('/custom/private')
    expect(wrapper!.get('h1').text()).toBe('Custom fallback')
    expect(wrapper!.text()).not.toContain('Private operations')
  })
  it('resolves existing administrator custom menu labels for an administrator', async () => {
    replaceAccount({ role: 'admin' })
    fixture.admin!.customMenuItems = [menuItem('private', 'Private operations')]
    await router.push('/custom/private')
    await render()
    expect(wrapper!.get('h1').text()).toBe('Private operations')
  })
  it('switches language through the real locale dropdown, after completion reloads once', async () => {
    const changed = deferred<void>()
    fixture.setLocale.mockImplementationOnce(() => changed.promise)
    await render()
    await wrapper!.get('button[title="English"]').trigger('click')
    const chinese = wrapper!.findAll('button').find((button) => button.text().endsWith('中文'))!
    await chinese.trigger('click')
    expect(fixture.setLocale).toHaveBeenCalledWith('zh')
    expect(wrapper!.get('button[title="English"]').attributes('disabled')).toBeDefined()
    expect(fixture.reload).not.toHaveBeenCalled()
    changed.resolve()
    await flushPromises()
    expect(fixture.reload).toHaveBeenCalledTimes(1)
  })
  it('keeps the existing language unchanged when it is selected again', async () => {
    await render()
    await wrapper!.get('button[title="English"]').trigger('click')
    const english = wrapper!.findAll('button').find((button) => button.text().endsWith('English'))!
    await english.trigger('click')
    expect(fixture.setLocale).not.toHaveBeenCalled()
    expect(fixture.reload).not.toHaveBeenCalled()
  })
  it('navigates to login after the real store/API clears a successful logout', async () => {
    await render()
    await startLogout()
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(session.captureAuthSession().subject).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper!.find('.z-header-user').exists()).toBe(false)
  })
  it('still finishes local logout when the synthetic revocation endpoint fails', async () => {
    logoutReply = deferred()
    await render()
    await startLogout()
    logoutReply.resolve({ status: 500 })
    await flushPromises()
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
    expect(consoleError).not.toHaveBeenCalled()
  })
  it('closes an old account menu when a same-ID login replaces its generation', async () => {
    await render()
    await openMenu()
    replaceAccount()
    await nextTick()
    expect(wrapper!.get('.z-header-user').text()).toContain('Current account')
    expect(wrapper!.get('.z-header-user').attributes('aria-expanded')).toBe('false')
    await vi.waitFor(() => expect(wrapper!.find('.dropdown').exists()).toBe(false))
  })
  it('keeps the menu open for a normal same-session user refresh and token rotation', async () => {
    await render()
    await openMenu()
    const current = session.captureAuthSession()
    session.updateAuthSessionUser(current, sampleUser({ balance: 6 }))
    session.commitAuthTokenRotation(current, { access_token: 'synthetic-rotated', refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 })
    await nextTick()
    expect(wrapper!.get('.z-header-user').attributes('aria-expanded')).toBe('true')
    expect(wrapper!.get('.dropdown').text()).toContain('$6.00')
  })
  it('does not navigate a new same-ID login after an old logout resolves', async () => {
    logoutReply = deferred()
    await render()
    await startLogout()
    replaceAccount()
    await nextTick()
    logoutReply.resolve({ status: 200 })
    await flushPromises()
    expect(auth.user?.username).toBe('Current account')
    expect(localStorage.getItem('auth_token')).toBe('synthetic-header-replacement')
    expect(router.currentRoute.value.path).toBe('/dashboard')
    expect(consoleError).not.toHaveBeenCalled()
  })
  it('does not navigate a different account after an old logout fails', async () => {
    logoutReply = deferred()
    await render()
    await startLogout()
    replaceAccount({ id: 99, username: 'Replacement member' })
    await nextTick()
    logoutReply.resolve({ status: 500 })
    await flushPromises()
    expect(auth.user?.id).toBe(99)
    expect(router.currentRoute.value.path).toBe('/dashboard')
    expect(consoleError).not.toHaveBeenCalled()
  })
  it('does not navigate after the initiating Header has been unmounted', async () => {
    logoutReply = deferred()
    await render()
    await startLogout()
    wrapper!.unmount()
    wrapper = undefined
    await router.push('/profile')
    logoutReply.resolve({ status: 200 })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/profile')
    expect(auth.user).toBeNull()
  })
  it('admits only one logout from two synchronous native button clicks', async () => {
    logoutReply = deferred()
    await render()
    await openMenu()
    const button = logoutButton().element as HTMLButtonElement
    button.click()
    button.click()
    await flushPromises()
    expect(wire).toHaveLength(1)
    logoutReply.resolve({ status: 200 })
    await flushPromises()
  })
  it('blocks a repeated logout from a reopened menu while the original request is pending', async () => {
    logoutReply = deferred()
    await render()
    await startLogout()
    await openMenu()
    await logoutButton().trigger('click')
    await flushPromises()
    expect(wire).toHaveLength(1)
    logoutReply.resolve({ status: 200 })
    await flushPromises()
  })
  it('does not let an old menu DOM button log out a replacement session before Vue renders', async () => {
    logoutReply = deferred()
    await render()
    await openMenu()
    const staleLogout = logoutButton().element as HTMLButtonElement
    replaceAccount()
    staleLogout.click()
    await flushPromises()
    expect(wire).toHaveLength(0)
    expect(auth.user?.username).toBe('Current account')
  })
  it('does not replay an administrator guide from detached old-account menu DOM', async () => {
    replaceAccount({ role: 'admin' })
    await render()
    await openMenu()
    const staleReplay = wrapper!.findAll('.dropdown button').find((button) => button.text().includes('Tour'))!.element as HTMLButtonElement
    replaceAccount({ role: 'user' })
    staleReplay.click()
    await nextTick()
    expect(fixture.replay).not.toHaveBeenCalled()
  })
  it('allows a replacement account to log out without an older request clearing its pending lock', async () => {
    const oldReply = deferred<{ status: number; data?: unknown }>()
    logoutReply = oldReply
    await render()
    await startLogout()
    replaceAccount()
    await nextTick()
    const newReply = deferred<{ status: number; data?: unknown }>()
    logoutReply = newReply
    await openMenu()
    await logoutButton().trigger('click')
    await flushPromises()
    expect(wire).toEqual([
      { method: 'post', url: '/auth/logout', body: { refresh_token: 'synthetic-header-refresh' } },
      { method: 'post', url: '/auth/logout', body: { refresh_token: 'synthetic-header-next-refresh' } },
    ])
    oldReply.resolve({ status: 200 })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/dashboard')
    expect(auth.user?.username).toBe('Current account')
    await openMenu()
    expect(logoutButton().attributes('disabled')).toBeDefined()
    await logoutButton().trigger('click')
    expect(wire).toHaveLength(2)
    newReply.resolve({ status: 200 })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/login')
    expect(auth.user).toBeNull()
  })
  it('shows only public header entries after the authenticated session is cleared', async () => {
    session.clearStoredAuthSession()
    fixture.app!.cachedPublicSettings!.model_plaza_enabled = true
    fixture.app!.cachedPublicSettings!.subscription_enabled = true
    await render()
    expect(wrapper!.find('.z-header-user').exists()).toBe(false)
    expect(wrapper!.find('.z-header-wallet').exists()).toBe(false)
    expect(wrapper!.find('announcement-bell-stub').exists()).toBe(false)
    expect(wrapper!.find('a[href^="/model-plaza"]').exists()).toBe(false)
    expect(fixture.sub!.fetchActiveSubscriptions).not.toHaveBeenCalled()
    expect(wrapper!.get('a.z-website-link').attributes('href')).toBe('/')
  })
  it('removes its document listeners on unmount instead of retaining the old menu', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    await render()
    await openMenu()
    const handlers = add.mock.calls.filter(([event]) => event === 'click').map(([, callback]) => callback)
    wrapper!.unmount()
    wrapper = undefined
    expect(handlers.length).toBeGreaterThanOrEqual(2)
    for (const handler of handlers) expect(remove.mock.calls.some(([event, callback]) => event === 'click' && callback === handler)).toBe(true)
  })
})
