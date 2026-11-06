import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppSidebar from '../AppSidebar.vue'

const fixtures = vi.hoisted(() => ({ app: null as any, auth: null as any, admin: null as any, tour: null as any, mobile: null as any, batch: null as any, locale: null as any, transition: vi.fn(), refreshBatch: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => fixtures.app, useAuthStore: () => fixtures.auth, useAdminSettingsStore: () => fixtures.admin, useOnboardingStore: () => fixtures.tour }))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixtures.app }))
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => fixtures.mobile }))
vi.mock('vue-i18n', async importOriginal => ({ ...await importOriginal<typeof import('vue-i18n')>(), useI18n: () => ({ t: (key: string) => key, locale: fixtures.locale }) }))
vi.mock('@/composables/useBatchImageAccess', () => ({ useBatchImageAccess: () => ({ canUseBatchImage: fixtures.batch, refreshBatchImageAccess: fixtures.refreshBatch }) }))
vi.mock('../workspaceMotion', () => ({ startWorkspaceTransition: fixtures.transition }))

let wrappers: Array<ReturnType<typeof mount>> = []
async function render(path = '/dashboard') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(AppSidebar, { attachTo: document.body, global: { plugins: [router], stubs: { VersionBadge: { template: '<span class="version-badge" />' }, AdminNavigationMarker: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
function allLinks(wrapper: ReturnType<typeof mount>) { return wrapper.findAll('nav a').map(link => link.attributes('href')) }
function button(wrapper: ReturnType<typeof mount>, text: string) { return wrapper.findAll('button').find(node => node.text().includes(text) || node.attributes('title') === text)! }
function key(key: string, shiftKey = false) { const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  fixtures.mobile = ref(false)
  fixtures.batch = ref(false)
  fixtures.locale = ref('zh')
  fixtures.app = reactive({
    sidebarCollapsed: false, mobileOpen: false, sidebarScrollTop: 0, backendModeEnabled: false,
    siteName: 'Sub2API', siteLogo: '', siteVersion: '0.0.3', publicSettingsLoaded: true, cachedPublicSettings: {} as any,
    toggleSidebar: vi.fn(() => { fixtures.app.sidebarCollapsed = !fixtures.app.sidebarCollapsed }),
    setMobileOpen: vi.fn((open: boolean) => { fixtures.app.mobileOpen = open })
  })
  fixtures.auth = reactive({ isAdmin: false, isSimpleMode: false })
  fixtures.admin = reactive({ opsMonitoringEnabled: true, paymentEnabled: true, customMenuItems: [] as any[], fetch: vi.fn() })
  fixtures.tour = { isCurrentStep: vi.fn(() => false), nextStep: vi.fn() }
  fixtures.refreshBatch.mockReset().mockResolvedValue(undefined)
  fixtures.transition.mockReset().mockReturnValue(false)
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers = []
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.body.classList.remove('z-mobile-nav-open')
})

describe('workspace navigation and configuration', () => {
  it('renders branded member sections, active descendants, and no user channel-notice menu', async () => {
    const { wrapper } = await render('/keys/42')
    expect(wrapper.get('.sidebar-brand-title').text()).toBe('智境')
    expect(wrapper.get('.sidebar-logo').attributes('href')).toBe('/dashboard')
    expect(wrapper.get('img').attributes('src')).toBe('/app-assets/zhijing-z.png')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('工作台导航')
    expect(wrapper.get('a[href="/keys"]').classes()).toContain('sidebar-link-active')
    expect(wrapper.findAll('.z-nav-island-title').map(node => node.text())).toEqual(['工作空间', '账户与权益'])
    expect(wrapper.find('nav a[href="/monitor"]').exists()).toBe(false)
    expect(fixtures.refreshBatch).toHaveBeenCalledOnce()
    expect(fixtures.admin.fetch).not.toHaveBeenCalled()
  })

  it('uses feature-specific fallback before settings arrive and updates loaded opt-in/out entries', async () => {
    fixtures.app.cachedPublicSettings = null
    const { wrapper } = await render()
    expect(allLinks(wrapper)).toContain('/subscriptions')
    expect(allLinks(wrapper)).not.toContain('/available-channels')
    expect(allLinks(wrapper)).not.toContain('/settings/mcp')
    fixtures.app.cachedPublicSettings = { available_channels_enabled: true, subscription_enabled: false, payment_enabled: false, affiliate_enabled: true, mcp_enabled: true }
    fixtures.batch.value = true
    await nextTick()
    expect(allLinks(wrapper)).toEqual(expect.arrayContaining(['/available-channels', '/batch-image', '/affiliate', '/settings/mcp']))
    expect(allLinks(wrapper)).not.toContain('/subscriptions')
    expect(allLinks(wrapper)).not.toContain('/purchase')
    expect(allLinks(wrapper)).not.toContain('/orders')
  })

  it.each([
    [{ subscription_enabled: false }, 'nav.recharge'],
    [{ subscription_enabled: true, payment_balance_disabled: true }, 'nav.subscribe'],
    [{ subscription_enabled: true, payment_balance_disabled: false }, 'nav.buySubscription']
  ])('labels the purchase route according to backend billing switches %j', async (settings, label) => {
    fixtures.app.cachedPublicSettings = settings
    const { wrapper } = await render()
    expect(wrapper.get('a[href="/purchase"]').text()).toBe(label)
  })

  it('keeps secondary services open on their active descendant', async () => {
    const { wrapper } = await render('/orders/123')
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    expect(wrapper.get('a[href="/orders"]').classes()).toContain('sidebar-link-active')
    expect(wrapper.get('.z-nav-more .z-nav-slider').attributes('style')).toContain('translateY(0px)')
  })

  it('filters simple-mode member actions and hides member navigation in backend-only mode', async () => {
    fixtures.auth.isSimpleMode = true
    const { wrapper } = await render()
    expect(allLinks(wrapper)).toEqual(['/dashboard', '/keys', '/profile'])
    fixtures.app.backendModeEnabled = true
    await nextTick()
    expect(allLinks(wrapper)).toEqual([])
  })

  it('renders sorted user custom menus and sanitizes uploaded SVG and site URLs', async () => {
    fixtures.app.siteName = '智境 Studio'
    fixtures.app.siteLogo = 'javascript:alert(1)'
    fixtures.app.cachedPublicSettings = { custom_menu_items: [
      { id: 'later', label: 'Later', visibility: 'user', sort_order: 20, icon_svg: '<svg><script>alert(1)</script><path fill="#287cff" d="M0 0" onclick="alert(1)" /></svg>' },
      { id: 'admin-only', label: 'Hidden', visibility: 'admin', sort_order: 0, icon_svg: '<svg />' },
      { id: 'first', label: 'First', visibility: 'user', sort_order: 10, icon_svg: '<svg><path d="M0 0" /></svg>' }
    ] }
    const { wrapper } = await render('/custom/later')
    expect(wrapper.get('.sidebar-brand-title').text()).toBe('智境 Studio')
    expect(wrapper.get('img').attributes('src')).toBe('/app-assets/zhijing-z.png')
    expect(allLinks(wrapper).filter(href => href?.startsWith('/custom/'))).toEqual(['/custom/first', '/custom/later'])
    const menu = wrapper.get('a[href="/custom/later"]')
    expect(menu.find('script').exists()).toBe(false)
    expect(menu.get('path').attributes('onclick')).toBeUndefined()
    expect(menu.get('path').attributes('fill')).toBe('#287cff')
  })

  it('renders admin islands, gated children and personal actions without mixing custom visibility', async () => {
    fixtures.auth.isAdmin = true
    fixtures.app.cachedPublicSettings = { risk_control_enabled: true, affiliate_enabled: true, plugin_management_enabled: true, channel_monitor_enabled: true }
    fixtures.admin.customMenuItems = [{ id: 'tool', label: 'Admin tool', sort_order: 2, visibility: 'admin', icon_svg: '<svg />' }, { id: 'member', label: 'Not admin', sort_order: 1, visibility: 'user', icon_svg: '<svg />' }]
    const { wrapper } = await render('/admin/orders/plans')
    expect(wrapper.findAll('.z-admin-nav-title').map(node => node.text())).toEqual(['运行与分析', '成员与业务', '接入与资源', '系统与安全'])
    expect(allLinks(wrapper)).toEqual(expect.arrayContaining(['/admin/ops', '/admin/users', '/admin/accounts', '/admin/groups', '/admin/plugins', '/admin/proxies', '/admin/settings', '/admin/announcements', '/admin/redeem', '/admin/promo-codes', '/admin/usage', '/admin/audit-logs', '/custom/tool', '/keys']))
    expect(allLinks(wrapper)).not.toContain('/custom/member')
    expect(wrapper.get('.sidebar-logo').attributes('href')).toBe('/admin/dashboard')
    expect(wrapper.get('a[href="/admin/orders/plans"]').classes()).toContain('sidebar-link-active')
    fixtures.admin.opsMonitoringEnabled = false
    fixtures.admin.paymentEnabled = false
    await nextTick()
    expect(allLinks(wrapper)).not.toContain('/admin/ops')
    expect(button(wrapper, 'nav.orderManagement')).toBeUndefined()
  })

  it('automatically expands the active admin group but lets its chevron collapse without navigation', async () => {
    fixtures.auth.isAdmin = true
    const { wrapper, router } = await render('/admin/channels/pricing')
    const group = button(wrapper, 'nav.channelManagement')
    expect(wrapper.find('a[href="/admin/channels/pricing"]').exists()).toBe(true)
    await group.trigger('click')
    expect(wrapper.find('a[href="/admin/channels/pricing"]').exists()).toBe(false)
    expect(group.classes()).toContain('sidebar-link-active')
    expect(router.currentRoute.value.path).toBe('/admin/channels/pricing')
    await group.trigger('click')
    expect(wrapper.find('a[href="/admin/channels/pricing"]').exists()).toBe(true)
  })

  it('announces admin group expansion and connects the button to its child region', async () => {
    fixtures.auth.isAdmin = true
    const { wrapper } = await render('/admin/channels/pricing')
    const group = button(wrapper, 'nav.channelManagement')
    expect(group.attributes('aria-expanded')).toBe('true')
    expect(group.attributes('aria-controls')).toBeTruthy()
    expect(document.getElementById(group.attributes('aria-controls')!)?.querySelector('a[href="/admin/channels/pricing"]')).not.toBeNull()
    await group.trigger('click')
    expect(group.attributes('aria-expanded')).toBe('false')
  })

  it('preserves accessible collapsed labels, expansion controls, and simple-mode admin capabilities', async () => {
    fixtures.auth.isAdmin = true
    fixtures.auth.isSimpleMode = true
    fixtures.app.sidebarCollapsed = true
    fixtures.app.cachedPublicSettings = { mcp_enabled: true }
    const { wrapper } = await render('/admin/dashboard')
    expect(allLinks(wrapper)).toContain('/keys')
    expect(allLinks(wrapper)).toContain('/settings/mcp')
    expect(allLinks(wrapper)).not.toContain('/admin/users')
    expect(wrapper.get('#sidebar-channel-manage').attributes('title')).toBe('nav.accounts')
    expect(wrapper.get('#sidebar-channel-manage .sidebar-label').attributes('aria-hidden')).toBe('true')
    await button(wrapper, 'nav.expand').trigger('click')
    expect(fixtures.app.toggleSidebar).toHaveBeenCalledOnce()
    expect(wrapper.get('.sidebar').classes()).toContain('w-64')
  })

  it('does not open a child group while the desktop sidebar is collapsed', async () => {
    fixtures.auth.isAdmin = true
    fixtures.app.sidebarCollapsed = true
    const { wrapper, router } = await render('/admin/dashboard')
    await button(wrapper, 'nav.channelManagement').trigger('click')
    expect(wrapper.find('a[href="/admin/channels/pricing"]').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/admin/dashboard')
  })

  it('loads administrator settings on a role transition and supports English group labels', async () => {
    fixtures.locale.value = 'en'
    const { wrapper } = await render()
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Workspace navigation')
    expect(wrapper.get('.z-nav-island-title').text()).toBe('WORKSPACE')
    fixtures.auth.isAdmin = true
    await nextTick()
    expect(fixtures.admin.fetch).toHaveBeenCalledOnce()
    expect(wrapper.get('.z-admin-nav-title').text()).toBe('OBSERVE')
  })

  it('initializes saved dark mode and toggles the actual root class and saved preference', async () => {
    localStorage.setItem('theme', 'dark')
    const { wrapper } = await render()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await button(wrapper, 'nav.lightMode').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
    await button(wrapper, 'nav.darkMode').trigger('click')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('restores and preserves scroll position across sidebar mounts', async () => {
    fixtures.app.sidebarScrollTop = 135
    const { wrapper } = await render()
    const nav = wrapper.get('nav').element
    expect(nav.scrollTop).toBe(135)
    nav.scrollTop = 277
    wrapper.unmount()
    wrappers = wrappers.filter(item => item !== wrapper)
    expect(fixtures.app.sidebarScrollTop).toBe(277)
    const newer = await render('/usage')
    expect(newer.wrapper.get('nav').element.scrollTop).toBe(277)
  })

  it.each([['/keys', '[data-tour="sidebar-my-keys"]', false], ['/admin/groups', '#sidebar-group-manage', true], ['/admin/accounts', '#sidebar-channel-manage', true]])('advances only the active onboarding step after clicking %s', async (path, selector, admin) => {
    fixtures.auth.isAdmin = admin
    fixtures.tour.isCurrentStep.mockReturnValue(true)
    const { wrapper } = await render(admin ? '/admin/dashboard' : '/dashboard')
    await wrapper.get(`nav a[href="${path}"]`).trigger('click')
    expect(fixtures.tour.isCurrentStep).toHaveBeenCalledWith(selector)
    expect(fixtures.tour.nextStep).toHaveBeenCalledWith(500)
  })
})

describe('mobile navigation lifecycle and keyboard', () => {
  it('makes a closed drawer inert and restores the opener after Escape', async () => {
    fixtures.mobile.value = true
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    const { wrapper } = await render()
    expect(wrapper.get('aside').attributes('inert')).toBeDefined()
    expect(wrapper.get('aside').attributes('aria-hidden')).toBe('true')
    fixtures.app.mobileOpen = true
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('.z-mobile-close').element)
    expect(document.body.classList.contains('z-mobile-nav-open')).toBe(true)
    expect(wrapper.get('aside').attributes('inert')).toBeUndefined()
    expect(key('Escape').defaultPrevented).toBe(true)
    await nextTick()
    expect(fixtures.app.mobileOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(document.body.classList.contains('z-mobile-nav-open')).toBe(false)
  })

  it('initializes focus and scroll locking when mounted with an already-open mobile drawer', async () => {
    fixtures.mobile.value = true
    fixtures.app.mobileOpen = true
    const { wrapper } = await render()
    expect(document.body.classList.contains('z-mobile-nav-open')).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.z-mobile-close').element)
  })

  it('wraps visible focusable controls in both directions and ignores desktop keyboard events', async () => {
    fixtures.mobile.value = true
    const { wrapper } = await render()
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as any)
    fixtures.app.mobileOpen = true
    await flushPromises()
    const controls = wrapper.get('aside').element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), summary, [tabindex="0"]')
    const first = controls[0], last = controls[controls.length - 1]
    first.focus(); expect(key('Tab', true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
    last.focus(); expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
    expect(key('ArrowDown').defaultPrevented).toBe(false)
    fixtures.mobile.value = false
    await nextTick()
    expect(key('Escape').defaultPrevented).toBe(false)
  })

  it('closes by overlay and after a chosen route, with the intended transition delay', async () => {
    fixtures.mobile.value = true
    const { wrapper } = await render()
    fixtures.app.mobileOpen = true; await nextTick()
    await wrapper.get('.z-mobile-overlay').trigger('click')
    expect(fixtures.app.mobileOpen).toBe(false)
    fixtures.app.mobileOpen = true; await nextTick()
    await wrapper.get('a[href="/usage"]').trigger('click')
    expect(fixtures.app.mobileOpen).toBe(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(fixtures.app.mobileOpen).toBe(false)
  })

  it('does not let a route-close timer from an unmounted drawer close a new drawer', async () => {
    fixtures.mobile.value = true
    const { wrapper } = await render()
    fixtures.app.mobileOpen = true; await nextTick()
    await wrapper.get('a[href="/keys"]').trigger('click')
    wrapper.unmount(); wrappers = wrappers.filter(item => item !== wrapper)
    await render('/keys')
    fixtures.app.setMobileOpen.mockClear()
    await vi.advanceTimersByTimeAsync(150)
    expect(fixtures.app.setMobileOpen).not.toHaveBeenCalled()
    expect(fixtures.app.mobileOpen).toBe(true)
  })

  it('cancels a pending route-close when the user closes and reopens the drawer', async () => {
    fixtures.mobile.value = true
    const { wrapper } = await render()
    fixtures.app.mobileOpen = true; await nextTick()
    await wrapper.get('a[href="/keys"]').trigger('click')
    await wrapper.get('.z-mobile-close').trigger('click')
    fixtures.app.mobileOpen = true; await nextTick()
    await vi.advanceTimersByTimeAsync(150)
    expect(fixtures.app.mobileOpen).toBe(true)
  })
})

describe('member route motion respects navigation semantics', () => {
  it('transitions an ordinary same-origin member link and lets router guards own the result', async () => {
    const workspace = document.createElement('div'); workspace.className = 'z-member-workspace'; workspace.dataset.motion = 'full'; document.body.append(workspace)
    const { wrapper, router } = await render('/usage')
    let update: (() => Promise<void>) | undefined
    fixtures.transition.mockImplementation((_document, callback, direction) => { update = callback; expect(direction).toBe(-1); return true })
    vi.spyOn(wrapper.get('a[href="/usage"]').element, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(wrapper.get('a[href="/keys"]').element, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect)
    await wrapper.get('a[href="/keys"]').trigger('click')
    expect(fixtures.transition).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/usage')
    await update!()
    expect(router.currentRoute.value.path).toBe('/keys')
  })

  it('keeps modifier, same-route, download, external-target and reduced-motion links native', async () => {
    const workspace = document.createElement('div'); workspace.className = 'z-member-workspace'; workspace.dataset.motion = 'full'; document.body.append(workspace)
    const { wrapper } = await render('/dashboard')
    await wrapper.get('nav a[href="/dashboard"]').trigger('click')
    await wrapper.get('a[href="/keys"]').trigger('click', { ctrlKey: true })
    const usage = wrapper.get('a[href="/usage"]')
    usage.element.setAttribute('target', '_blank'); await usage.trigger('click'); usage.element.removeAttribute('target')
    usage.element.setAttribute('download', ''); await usage.trigger('click'); usage.element.removeAttribute('download')
    workspace.dataset.motion = 'reduced'; await usage.trigger('click')
    expect(fixtures.transition).not.toHaveBeenCalled()
  })
})
