import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { RouterView, type Router } from 'vue-router'

const fixtures = vi.hoisted(() => ({
  auth: {} as Record<string, any>, app: {} as Record<string, any>, compliance: {} as Record<string, any>,
  setup: vi.fn(), start: vi.fn(), end: vi.fn(), prefetch: vi.fn(),
}))
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: () => actual.createMemoryHistory() }
})
vi.mock('@/stores/auth', () => ({ useAuthStore: () => fixtures.auth }))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixtures.app }))
vi.mock('@/stores/adminCompliance', () => ({ useAdminComplianceStore: () => fixtures.compliance }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ customMenuItems: [] }) }))
vi.mock('@/api/setup', () => ({ getSetupStatus: fixtures.setup }))
vi.mock('@/composables/useNavigationLoading', () => ({ useNavigationLoadingState: () => ({ startNavigation: fixtures.start, endNavigation: fixtures.end }) }))
vi.mock('@/composables/useRoutePrefetch', () => ({ useRoutePrefetch: () => ({ triggerPrefetch: fixtures.prefetch }) }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
// These tests exercise the real configured router and route guards. Page bodies
// are boundaries, so route acceptance is observable without running their APIs.
vi.mock('@/views/HomeView.vue', () => ({ default: { template: '<main>Public home</main>' } }))
vi.mock('@/views/auth/LoginView.vue', () => ({ default: { template: '<main>Login screen</main>' } }))
vi.mock('@/views/auth/RegisterView.vue', () => ({ default: { template: '<main>Registration screen</main>' } }))
vi.mock('@/views/auth/EmailVerifyView.vue', () => ({ default: { template: '<main>Email verification</main>' } }))
vi.mock('@/views/user/DashboardView.vue', () => ({ default: { template: '<main>Member dashboard</main>' } }))
vi.mock('@/views/admin/DashboardView.vue', () => ({ default: { template: '<main>Admin dashboard</main>' } }))
vi.mock('@/views/admin/SettingsView.vue', () => ({ default: { template: '<main>Admin settings</main>' } }))
vi.mock('@/views/admin/RiskControlView.vue', () => ({ default: { template: '<main>Admin risk controls</main>' } }))
vi.mock('@/views/admin/ops/OpsDashboard.vue', () => ({ default: { template: '<main>Admin operations</main>' } }))
vi.mock('@/views/user/PaymentView.vue', () => ({ default: { template: '<main>Payment options</main>' } }))
vi.mock('@/views/user/SubscriptionsView.vue', () => ({ default: { template: '<main>Member subscriptions</main>' } }))
vi.mock('@/views/ModelPlazaView.vue', () => ({ default: { template: '<main>Public model plaza</main>' } }))
vi.mock('@/views/setup/SetupWizardView.vue', () => ({ default: { template: '<main>Setup wizard</main>' } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
let wrapper: VueWrapper | undefined
let router: Router
async function start() {
  router = (await import('@/router')).default
  // Establish a settled route before installing the router into the viewer.
  await router.push('/home')
  wrapper = mount({ components: { RouterView }, template: '<RouterView />' }, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
async function visit(path: string) { await router.push(path); await flushPromises(); return wrapper!.text() }
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  fixtures.auth = reactive({ isAuthenticated: true, isAdmin: true, isSimpleMode: false, hasPendingAuthSession: false, checkAuth: vi.fn() })
  fixtures.app = reactive({ siteName: '智境测试站', publicSettingsLoaded: true, backendModeEnabled: false,
    cachedPublicSettings: { payment_enabled: true, risk_control_enabled: true, subscription_enabled: true, model_plaza_enabled: true },
    fetchPublicSettings: vi.fn().mockResolvedValue(null),
  })
  fixtures.compliance = reactive({ initialized: true, fetchStatus: vi.fn().mockResolvedValue(null), requireAcknowledgement: vi.fn() })
  fixtures.setup.mockResolvedValue({ needs_setup: true })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('configured router navigation contract', () => {
  it('restores auth only once and redirects an anonymous protected deep link with its query', async () => {
    fixtures.auth.isAuthenticated = false
    fixtures.auth.isAdmin = false
    await start()
    expect(await visit('/purchase?plan=synthetic')).toBe('Login screen')
    expect(router.currentRoute.value.query.redirect).toBe('/purchase?plan=synthetic')
    expect(fixtures.auth.checkAuth).toHaveBeenCalledOnce()
    expect(fixtures.end).toHaveBeenCalled()
    expect(fixtures.prefetch).toHaveBeenCalledWith(expect.objectContaining({ path: '/login' }))
  })
  it.each([
    [false, '/admin/ops', '/dashboard', 'Member dashboard'],
    [true, '/login', '/admin/dashboard', 'Admin dashboard'],
    [false, '/register', '/dashboard', 'Member dashboard'],
  ] as const)('routes the current role admin=%s from %s to %s', async (admin, path, target, body) => {
    fixtures.auth.isAdmin = admin
    await start()
    expect(await visit(path)).toBe(body)
    expect(router.currentRoute.value.path).toBe(target)
  })
  it.each([
    ['/purchase', 'payment_enabled', false, 'Member dashboard'],
    ['/subscriptions', 'subscription_enabled', false, 'Member dashboard'],
    ['/admin/risk-control', 'risk_control_enabled', true, 'Admin settings'],
  ] as const)('honors an explicitly disabled feature %s', async (path, key, admin, body) => {
    fixtures.auth.isAdmin = admin
    fixtures.app.cachedPublicSettings[key] = false
    await start()
    expect(await visit(path)).toBe(body)
  })
  it('keeps a feature available when settings are temporarily unknown', async () => {
    fixtures.auth.isAdmin = false
    fixtures.app.publicSettingsLoaded = false
    fixtures.app.cachedPublicSettings = null
    await start()
    expect(await visit('/purchase')).toBe('Payment options')
    expect(fixtures.app.fetchPublicSettings).toHaveBeenCalledOnce()
  })
  it('does not loop a backend-only member away from login', async () => {
    fixtures.auth.isAdmin = false
    fixtures.app.backendModeEnabled = true
    await start()
    expect(await visit('/login')).toBe('Login screen')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('permits pending signup verification while backend mode blocks ordinary registration', async () => {
    fixtures.auth.isAuthenticated = false
    fixtures.auth.isAdmin = false
    fixtures.app.backendModeEnabled = true
    await start()
    expect(await visit('/register')).toBe('Login screen')
    fixtures.auth.hasPendingAuthSession = true
    expect(await visit('/email-verify')).toBe('Email verification')
  })
  it.each([
    [false, false, 'Login screen'], [true, false, 'Member dashboard'], [true, true, 'Admin dashboard'],
  ] as const)('redirects completed setup using the current login=%s admin=%s', async (authenticated, admin, body) => {
    fixtures.auth.isAuthenticated = authenticated
    fixtures.auth.isAdmin = admin
    fixtures.setup.mockResolvedValue({ needs_setup: false })
    await start()
    expect(await visit('/setup')).toBe(body)
  })
  it('keeps setup reachable when the status endpoint is temporarily unavailable', async () => {
    fixtures.setup.mockRejectedValueOnce(new Error('synthetic setup unavailable'))
    await start()
    expect(await visit('/setup')).toBe('Setup wizard')
  })
  it('waits for and applies an explicit model plaza login requirement', async () => {
    fixtures.auth.isAuthenticated = false
    fixtures.auth.isAdmin = false
    fixtures.app.publicSettingsLoaded = false
    fixtures.app.cachedPublicSettings = null
    const pending = deferred<void>()
    fixtures.app.fetchPublicSettings.mockImplementation(async () => {
      await pending.promise
      fixtures.app.publicSettingsLoaded = true
      fixtures.app.cachedPublicSettings = { model_plaza_enabled: true, model_plaza_require_auth: true }
    })
    await start()
    const navigation = router.push('/model-plaza?model=synthetic')
    await vi.waitFor(() => expect(fixtures.app.fetchPublicSettings).toHaveBeenCalledOnce())
    expect(wrapper!.text()).toBe('Public home')
    pending.resolve()
    await navigation
    await flushPromises()
    expect(wrapper!.text()).toBe('Login screen')
    expect(router.currentRoute.value.query.redirect).toBe('/model-plaza?model=synthetic')
  })
})

describe('navigation permission revalidation after awaited checks', () => {
  it.each(['logout', 'demotion'] as const)('does not enter an admin page after %s during compliance loading', async boundary => {
    const pending = deferred<void>()
    fixtures.compliance.initialized = false
    fixtures.compliance.fetchStatus.mockReturnValue(pending.promise)
    await start()
    const navigation = router.push('/admin/ops')
    await vi.waitFor(() => expect(fixtures.compliance.fetchStatus).toHaveBeenCalledOnce())
    fixtures.auth.isAdmin = false
    if (boundary === 'logout') fixtures.auth.isAuthenticated = false
    pending.resolve()
    await navigation
    await flushPromises()
    expect(wrapper!.text()).toBe(boundary === 'logout' ? 'Login screen' : 'Member dashboard')
    expect(wrapper!.text()).not.toContain('Admin operations')
  })
  it('does not enter a protected member page after logout during settings loading', async () => {
    fixtures.auth.isAdmin = false
    fixtures.app.publicSettingsLoaded = false
    const pending = deferred<void>()
    fixtures.app.fetchPublicSettings.mockReturnValue(pending.promise)
    await start()
    const navigation = router.push('/purchase')
    await vi.waitFor(() => expect(fixtures.app.fetchPublicSettings).toHaveBeenCalledOnce())
    fixtures.auth.isAuthenticated = false
    pending.resolve()
    await navigation
    await flushPromises()
    expect(wrapper!.text()).toBe('Login screen')
    expect(router.currentRoute.value.query.redirect).toBe('/purchase')
  })
})
