import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { replaceAuthSession } from '@/api/authSession'
import { useOnboardingStore } from '@/stores/onboarding'
import { useOnboardingTour } from '../useOnboardingTour'

const fixtures = vi.hoisted(() => ({
  user: { id: 7, role: 'admin' },
  driver: vi.fn(),
  steps: [
    { element: '#older-anchor', popover: { showButtons: ['next', 'previous', 'close'] } },
    { element: '#newer-anchor', popover: { showButtons: ['next', 'previous', 'close'] } }
  ]
}))
vi.mock('driver.js', () => ({ driver: fixtures.driver }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ get user() { return fixtures.user }, isSimpleMode: false }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/Guide/steps', () => ({ getAdminSteps: () => fixtures.steps, getUserSteps: () => fixtures.steps }))

type TourDriver = {
  config: Record<string, any>
  isActive: () => boolean
  drive: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  moveNext: ReturnType<typeof vi.fn>
  movePrevious: ReturnType<typeof vi.fn>
  getActiveIndex: () => number
  getActiveElement: () => Element | null
}
let drivers: TourDriver[] = []
let wrappers: Array<ReturnType<typeof host>> = []
function host() {
  const wrapper = mount(defineComponent({ setup() { return { tour: useOnboardingTour({ autoStart: false }) } }, template: '<div />' }))
  wrappers.push(wrapper)
  return wrapper
}
function anchor(id: string) {
  const element = document.createElement('button')
  element.id = id
  document.body.append(element)
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers()
  setActivePinia(createPinia())
  fixtures.user = { id: 7, role: 'admin' }
  replaceAuthSession({ accessToken: 'SYNTHETIC-OWNER-A', user: fixtures.user })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) })
  fixtures.driver.mockImplementation(config => {
    let active = true
    let index = 0
    const instance: TourDriver = {
      config, isActive: () => active, getActiveIndex: () => index,
      getActiveElement: () => document.querySelector(fixtures.steps[index]?.element || 'missing-element'),
      drive: vi.fn((at = 0) => { index = at }),
      moveNext: vi.fn(() => { index++ }), movePrevious: vi.fn(() => { index-- }),
      destroy: vi.fn(() => { active = false; config.onDestroyed?.() })
    }
    drivers.push(instance)
    return instance
  })
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers = []
  drivers.forEach(instance => instance.destroy())
  drivers = []
  fixtures.driver.mockReset()
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('does not let an older component waiting for an anchor replace a newer component tour', async () => {
  const older = host()
  const newer = host()
  const pendingOlder = older.vm.tour.startTour()
  await flushPromises()
  anchor('newer-anchor')
  await newer.vm.tour.startTour(1)
  const activeNewer = useOnboardingStore().getDriverInstance()
  expect(activeNewer?.getActiveIndex()).toBe(1)
  anchor('older-anchor')
  await vi.advanceTimersByTimeAsync(200)
  await pendingOlder
  expect(useOnboardingStore().getDriverInstance()?.getActiveIndex()).toBe(1)
})

it('does not adopt and advance an earlier administrator tour after another user signs in', async () => {
  anchor('older-anchor')
  const older = host()
  await older.vm.tour.startTour()
  const oldDriver = drivers[0]
  older.unmount()
  wrappers = wrappers.filter(wrapper => wrapper !== older)
  fixtures.user = { id: 8, role: 'user' }
  replaceAuthSession({ accessToken: 'SYNTHETIC-OWNER-B', user: fixtures.user })
  host()
  await flushPromises()
  await useOnboardingStore().nextStep(0)
  expect.soft(oldDriver.moveNext).not.toHaveBeenCalled()
  expect(useOnboardingStore().isDriverActive()).toBe(false)
})

it('inherits a same-login active tour after the creating page has unmounted', async () => {
  anchor('older-anchor')
  anchor('newer-anchor')
  const older = host()
  await older.vm.tour.startTour()
  const active = drivers[0]
  older.unmount()
  wrappers = wrappers.filter(wrapper => wrapper !== older)
  host()
  expect(useOnboardingStore().isCurrentStep('#older-anchor')).toBe(true)
  await useOnboardingStore().nextStep(0)
  expect(active.moveNext).toHaveBeenCalledOnce()
  expect(useOnboardingStore().isCurrentStep('#newer-anchor')).toBe(true)
  expect(fixtures.driver).toHaveBeenCalledOnce()
})

it('keeps the live page tour controls when a later overlapping page unmounts first', async () => {
  anchor('older-anchor')
  const older = host()
  await older.vm.tour.startTour()
  const active = drivers[0]
  const newer = host()
  expect(useOnboardingStore().isCurrentStep('#older-anchor')).toBe(true)
  newer.unmount()
  wrappers = wrappers.filter(wrapper => wrapper !== newer)
  expect.soft(useOnboardingStore().isCurrentStep('#older-anchor')).toBe(true)
  await useOnboardingStore().nextStep(0)
  expect(active.moveNext).toHaveBeenCalledOnce()
})

it('ignores a delayed advance from an unmounted control owner after restoring the live page', async () => {
  anchor('older-anchor')
  const older = host()
  await older.vm.tour.startTour()
  const active = drivers[0]
  const newer = host()
  const pending = useOnboardingStore().nextStep(300)
  newer.unmount()
  wrappers = wrappers.filter(wrapper => wrapper !== newer)
  await vi.advanceTimersByTimeAsync(300)
  await pending
  expect(active.moveNext).not.toHaveBeenCalled()
  expect(useOnboardingStore().isCurrentStep('#older-anchor')).toBe(true)
  await useOnboardingStore().nextStep(0)
  expect(active.moveNext).toHaveBeenCalledOnce()
})

it('lets current page controls operate a same-login tour started by another mounted instance', async () => {
  anchor('older-anchor')
  const older = host()
  host()
  await older.vm.tour.startTour()
  expect.soft(useOnboardingStore().isCurrentStep('#older-anchor')).toBe(true)
  await useOnboardingStore().nextStep(0)
  expect(drivers[0].moveNext).toHaveBeenCalledOnce()
})

it('ignores previous driver callbacks after the next page replays the tour', async () => {
  anchor('older-anchor')
  anchor('newer-anchor')
  const older = host()
  await older.vm.tour.startTour()
  const retired = drivers[0]
  const newer = host()
  await newer.vm.tour.startTour(1)
  const active = drivers[1]
  retired.config.onDestroyed()
  retired.config.onCloseClick()
  retired.config.onPrevClick()
  expect(useOnboardingStore().getDriverInstance()).toBe(active)
  expect(active.destroy).not.toHaveBeenCalled()
  expect(active.movePrevious).not.toHaveBeenCalled()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
  expect(active.movePrevious).toHaveBeenCalledOnce()
  expect(newer.vm.tour.hasSeen()).toBe(false)
})
