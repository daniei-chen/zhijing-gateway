import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppSidebar from '../AppSidebar.vue'

const fixtures = vi.hoisted(() => ({ app: null as any, auth: null as any, admin: null as any, tour: null as any, mobile: null as any, batch: null as any, locale: null as any, refreshBatch: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => fixtures.app, useAuthStore: () => fixtures.auth, useAdminSettingsStore: () => fixtures.admin, useOnboardingStore: () => fixtures.tour }))
vi.mock('@/stores/app', () => ({ useAppStore: () => fixtures.app }))
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => fixtures.mobile }))
vi.mock('vue-i18n', async importOriginal => ({ ...await importOriginal<typeof import('vue-i18n')>(), useI18n: () => ({ t: (key: string) => key, locale: fixtures.locale }) }))
vi.mock('@/composables/useBatchImageAccess', () => ({ useBatchImageAccess: () => ({ canUseBatchImage: fixtures.batch, refreshBatchImageAccess: fixtures.refreshBatch }) }))
vi.mock('../workspaceMotion', () => ({ startWorkspaceTransition: vi.fn(() => false) }))

let wrapper: ReturnType<typeof mount> | undefined
async function renderDrawerHost(olderFirst = true) {
  const shown = reactive({ older: olderFirst, newer: !olderFirst })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push('/dashboard')
  await router.isReady()
  const view = mount(defineComponent({
    components: { AppSidebar }, setup: () => ({ shown }),
    template: '<div><AppSidebar v-if="shown.older"/><AppSidebar v-if="shown.newer"/></div>'
  }), { attachTo: document.body, global: { plugins: [router], stubs: { VersionBadge: true, AdminNavigationMarker: true } } })
  wrapper = view
  await flushPromises()
  return { shown, view }
}

async function renderOverlappingDrawers() {
  const { shown, view } = await renderDrawerHost()
  shown.newer = true
  await flushPromises()
  shown.older = false
  await flushPromises()
  return view.findComponent(AppSidebar)
}

beforeEach(() => {
  fixtures.mobile = ref(true)
  fixtures.batch = ref(false)
  fixtures.locale = ref('zh')
  fixtures.app = reactive({
    sidebarCollapsed: false, mobileOpen: true, sidebarScrollTop: 0, backendModeEnabled: false,
    siteName: 'Sub2API', siteLogo: '', siteVersion: '0.0.3', publicSettingsLoaded: true, cachedPublicSettings: {},
    toggleSidebar: vi.fn(), setMobileOpen: vi.fn((open: boolean) => { fixtures.app.mobileOpen = open })
  })
  fixtures.auth = reactive({ isAdmin: false, isSimpleMode: false })
  fixtures.admin = reactive({ opsMonitoringEnabled: true, paymentEnabled: true, customMenuItems: [], fetch: vi.fn() })
  fixtures.tour = { isCurrentStep: vi.fn(() => false), nextStep: vi.fn() }
  fixtures.refreshBatch.mockResolvedValue(undefined)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  document.body.classList.remove('z-mobile-nav-open')
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('keeps page scrolling locked while the replacement mobile drawer remains open', async () => {
  const drawer = await renderOverlappingDrawers()
  expect(drawer.get('aside').attributes('inert')).toBeUndefined()
  expect(document.activeElement).toBe(drawer.get('.z-mobile-close').element)
  expect(document.body.classList.contains('z-mobile-nav-open')).toBe(true)
})

it('restores the connected external opener after overlapping mobile drawers close', async () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const drawer = await renderOverlappingDrawers()
  await drawer.get('.z-mobile-close').trigger('click')
  await flushPromises()
  expect(fixtures.app.mobileOpen).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it.each([true, false])('returns focus to the remaining open drawer when its top peer unmounts (older first=%s)', async olderFirst => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const { shown, view } = await renderDrawerHost(olderFirst)
  if (olderFirst) shown.newer = true
  else shown.older = true
  await flushPromises()
  const [older, newer] = view.findAllComponents(AppSidebar)
  const top = olderFirst ? newer : older
  const remaining = olderFirst ? older : newer
  expect(document.activeElement).toBe(top.get('.z-mobile-close').element)
  if (olderFirst) shown.newer = false
  else shown.older = false
  await flushPromises()
  expect(document.activeElement).toBe(remaining.get('.z-mobile-close').element)
  expect(document.body.classList.contains('z-mobile-nav-open')).toBe(true)
  fixtures.app.mobileOpen = false
  await flushPromises()
  expect(document.body.classList.contains('z-mobile-nav-open')).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('wraps native Tab and Shift+Tab only inside the top mobile drawer', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as any)
  const { shown, view } = await renderDrawerHost()
  shown.newer = true
  await flushPromises()
  const [older, newer] = view.findAllComponents(AppSidebar)
  const controls = newer.get('aside').element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), summary, [tabindex="0"]')
  const first = controls[0], last = controls[controls.length - 1]
  last.focus()
  const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  last.dispatchEvent(forward)
  expect(forward.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(first)
  const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
  first.dispatchEvent(backward)
  expect(backward.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(last)
  expect(older.get('aside').element.contains(document.activeElement)).toBe(false)
})

it('does not let a still-mounted older route-close timer close the newer drawer', async () => {
  vi.useFakeTimers()
  const { shown, view } = await renderDrawerHost()
  await view.findComponent(AppSidebar).get('a[href="/keys"]').trigger('click')
  shown.newer = true
  await flushPromises()
  const newer = view.findAllComponents(AppSidebar)[1]
  expect(document.activeElement).toBe(newer.get('.z-mobile-close').element)
  await vi.advanceTimersByTimeAsync(150)
  expect(fixtures.app.mobileOpen).toBe(true)
  expect(document.body.classList.contains('z-mobile-nav-open')).toBe(true)
})

it('keeps deliberate focus on the new page when the last older drawer unmounts', async () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const { shown } = await renderDrawerHost()
  const destination = document.createElement('input')
  document.body.append(destination)
  destination.focus()
  shown.older = false
  await flushPromises()
  expect(document.body.classList.contains('z-mobile-nav-open')).toBe(false)
  expect(document.activeElement).toBe(destination)
})
