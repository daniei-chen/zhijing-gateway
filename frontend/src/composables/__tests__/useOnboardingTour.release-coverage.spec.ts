import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Config, DriveStep, Driver, PopoverDOM } from 'driver.js'
import { replaceAuthSession } from '@/api/authSession'
import { useOnboardingTour } from '../useOnboardingTour'

const fixture = vi.hoisted(() => ({ driver: vi.fn(), user: { id: 7, role: 'admin' }, steps: [] as DriveStep[] }))
vi.mock('driver.js', () => ({ driver: fixture.driver }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ get user() { return fixture.user }, isSimpleMode: false }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/Guide/steps', () => ({ getAdminSteps: () => fixture.steps, getUserSteps: () => fixture.steps }))
type Controller = ReturnType<typeof useOnboardingTour>
type CallbackMock = ReturnType<typeof vi.fn<() => void>>
type SDK = { config: Config; driver: Driver; index: number; active: boolean; next: CallbackMock; previous: CallbackMock; destroy: CallbackMock }
const viewers: Array<ReturnType<typeof mount>> = []
let instances: SDK[] = []
function target(tag = 'div', id = 'interactive') {
  const element = document.createElement(tag); element.id = id; document.body.appendChild(element); return element
}
async function host(startIndex = 0) {
  let controller!: Controller
  const viewer = mount(defineComponent({ setup() { controller = useOnboardingTour({ storageKey: 'release-tour', autoStart: false }); return () => h('div') } }))
  viewers.push(viewer); await controller.startTour(startIndex)
  return { controller, sdk: instances.at(-1)! }
}
const opts = (sdk: SDK) => ({ config: sdk.config, state: { activeIndex: sdk.index }, driver: sdk.driver })
async function highlight(sdk: SDK, element: Element | undefined, step = fixture.steps[sdk.index]) { await sdk.config.onHighlightStarted?.(element, step, opts(sdk)) }
function keyboard(element: Element | Document, key: string) { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); element.dispatchEvent(event); return event }
function popover(): PopoverDOM {
  const wrapper = target('div', 'tour-popover')
  const result = { wrapper, arrow: document.createElement('div'), title: document.createElement('h2'), description: document.createElement('div'), footer: document.createElement('footer'), progress: document.createElement('span'), previousButton: document.createElement('button'), nextButton: document.createElement('button'), closeButton: document.createElement('button'), footerButtons: document.createElement('div') }
  result.progress.className = 'driver-popover-progress-text'; result.previousButton.className = 'driver-popover-prev-btn'; result.nextButton.className = 'driver-popover-next-btn'
  result.footer.append(result.progress, result.previousButton, result.nextButton)
  wrapper.append(result.title, result.description, result.footer)
  return result
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.useFakeTimers(); setActivePinia(createPinia())
  fixture.user = { id: 7, role: 'admin' }; fixture.steps = [{ element: '#interactive', popover: { showButtons: ['close'] } }, { element: '#next', popover: { showButtons: ['next', 'previous', 'close'] } }]
  instances = []
  replaceAuthSession({ accessToken: 'synthetic-tour-release', user: fixture.user })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, toJSON: () => ({}) })
  fixture.driver.mockImplementation((config: Config) => {
    const sdk = { config, index: 0, active: true } as SDK
    sdk.next = vi.fn(() => { sdk.index++ }); sdk.previous = vi.fn(() => { sdk.index-- })
    sdk.destroy = vi.fn(() => { sdk.active = false; config.onDestroyed?.(undefined, fixture.steps[sdk.index] ?? {}, opts(sdk)) })
    sdk.driver = { drive: vi.fn((index = 0) => { sdk.index = index }), isActive: () => sdk.active, getActiveIndex: () => sdk.index, getActiveElement: () => {
      const element = fixture.steps[sdk.index]?.element
      return typeof element === 'string' ? document.querySelector(element) ?? undefined : element instanceof Element ? element : undefined
    }, destroy: sdk.destroy, moveNext: sdk.next, movePrevious: sdk.previous } as unknown as Driver
    instances.push(sdk); return sdk.driver
  })
})
afterEach(() => {
  viewers.splice(0).forEach(viewer => viewer.unmount()); instances.forEach(sdk => sdk.destroy())
  document.body.innerHTML = ''; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); fixture.driver.mockReset()
})

describe('interactive tour SDK integration and accessible controls', () => {
  it('reorganizes the real footer once, retains navigation buttons and adds one interactive hint', async () => {
    target(); const { sdk } = await host(); const dom = popover()
    sdk.config.onPopoverRender?.(dom, opts(sdk)); sdk.config.onPopoverRender?.(dom, opts(sdk))
    expect(dom.footer.querySelectorAll('.footer-left')).toHaveLength(1)
    expect(dom.footer.querySelector('.footer-left .driver-popover-progress-text')).toBe(dom.progress)
    expect(dom.footer.querySelector('.footer-right .driver-popover-next-btn')).toBe(dom.nextButton)
    expect(dom.description.querySelectorAll('.driver-popover-description-hint')).toHaveLength(1)
    expect(dom.footer.textContent).toContain('ESC'); expect(dom.description.textContent).toContain('onboarding.interactiveHint')
    sdk.index = 1; sdk.config.onPopoverRender?.(dom, opts(sdk))
    expect(dom.nextButton.classList.contains('driver-popover-done-btn')).toBe(true)
    sdk.index = 0; sdk.config.onPopoverRender?.(dom, opts(sdk))
    expect(dom.nextButton.classList.contains('driver-popover-done-btn')).toBe(false)
  })

  it('handles missing third-party footer elements without crashing the active tour', async () => {
    target(); const { sdk } = await host(); const dom = popover()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sdk.config.onPopoverRender?.({ ...dom, title: undefined } as unknown as PopoverDOM, opts(sdk))
    expect(warn).toHaveBeenCalledWith('Onboarding: Missing popover elements')
    expect(sdk.active).toBe(true)
  })

  it.each(['input', 'textarea', 'select'])('advances an interactive %s once after input/change, then removes its listeners', async tag => {
    const element = target(tag); target('div', 'next'); const { sdk } = await host()
    await highlight(sdk, element)
    element.dispatchEvent(new Event('input')); element.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(799); expect(sdk.next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(sdk.next).toHaveBeenCalledTimes(1)
    element.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(800)
    expect(sdk.next).toHaveBeenCalledTimes(1)
  })

  it.each(['Enter', ' ', 'click'])('advances a focusable interactive target with %s, preserving its original tab index', async action => {
    const element = target(); target('div', 'next'); const { sdk } = await host()
    await highlight(sdk, element); expect(element.getAttribute('tabindex')).toBe('0')
    if (action === 'click') element.click(); else keyboard(element, action)
    await vi.advanceTimersByTimeAsync(800); expect(sdk.next).toHaveBeenCalledTimes(1)
    await highlight(sdk, document.querySelector('#next')!, fixture.steps[1])
    expect(element.hasAttribute('tabindex')).toBe(false)
    keyboard(element, ' '); element.click(); await vi.advanceTimersByTimeAsync(800)
    expect(sdk.next).toHaveBeenCalledTimes(1)
  })

  it('restores an explicit previous tab index when the tour is destroyed', async () => {
    const element = target(); element.setAttribute('tabindex', '-1')
    const { sdk } = await host(); await highlight(sdk, element)
    expect(element.getAttribute('tabindex')).toBe('0')
    sdk.destroy(); expect(element.getAttribute('tabindex')).toBe('-1')
  })

  it.each(['submit', 'form-button', 'select-root', 'select-child'])('does not auto-advance a %s control whose business action owns continuation', async kind => {
    const element = target(kind.includes('button') || kind === 'submit' ? 'button' : 'div')
    if (kind === 'submit') element.setAttribute('type', 'submit')
    if (kind === 'form-button') { const form = target('form', 'synthetic-form'); form.appendChild(element) }
    if (kind === 'select-root') element.classList.add('select-trigger')
    if (kind === 'select-child') { const child = document.createElement('button'); child.className = 'select-trigger'; element.appendChild(child) }
    const { sdk } = await host(); await highlight(sdk, element)
    element.dispatchEvent(new Event('input')); element.dispatchEvent(new Event('click')); await vi.advanceTimersByTimeAsync(1000)
    expect(sdk.next).not.toHaveBeenCalled()
  })

  it('waits for the next target to appear, then advances only the still-active step', async () => {
    const element = target('input'); const { sdk } = await host(); await highlight(sdk, element)
    element.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(950)
    expect(sdk.next).not.toHaveBeenCalled()
    target('div', 'next'); await vi.advanceTimersByTimeAsync(150)
    expect(sdk.next).toHaveBeenCalledTimes(1)
  })

  it('does not advance when the next target never appears', async () => {
    const element = target('input'); const { sdk } = await host(); await highlight(sdk, element)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    element.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(9000)
    expect(sdk.next).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledWith('Onboarding: Next step element not found: #next')
  })

  it('ignores delayed input continuation after the SDK moved to another step', async () => {
    const element = target('input'); target('div', 'next'); const { sdk } = await host(); await highlight(sdk, element)
    element.dispatchEvent(new Event('input')); sdk.index = 1
    await vi.advanceTimersByTimeAsync(800); expect(sdk.next).not.toHaveBeenCalled()
  })

  it('does not bind or advance an interactive step whose target remains missing', async () => {
    target(); const { sdk } = await host()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = highlight(sdk, undefined, { element: '#absent', popover: { showButtons: ['close'] } })
    await vi.advanceTimersByTimeAsync(8100); await pending
    expect(sdk.next).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledWith('Tour element not found after 8s: #absent')
  })

  it('keeps keyboard arrows on a clickable step until its action actually completes', async () => {
    const element = target('button'); element.setAttribute('type', 'button'); target('div', 'next')
    const { sdk } = await host(); await highlight(sdk, element)
    keyboard(document, 'ArrowRight'); expect(sdk.next).not.toHaveBeenCalled()
    keyboard(document, 'Enter'); await vi.advanceTimersByTimeAsync(800)
    expect(sdk.next).toHaveBeenCalledTimes(1)
    sdk.config.onPrevClick?.(element, fixture.steps[1], opts(sdk))
    expect(sdk.previous).toHaveBeenCalledTimes(1)
  })

  it('lets input editing consume Enter and both arrow directions, while other keys do nothing', async () => {
    const element = target('input'); const { sdk } = await host()
    for (const key of ['ArrowRight', 'ArrowLeft', 'Enter', 'Tab']) keyboard(element, key)
    expect(sdk.next).not.toHaveBeenCalled(); expect(sdk.previous).not.toHaveBeenCalled()
    keyboard(document, 'Tab'); expect(sdk.active).toBe(true)
  })

  it('uses the SDK next button to perform an interactive action and marks only final completion as seen', async () => {
    const element = target('button'); element.setAttribute('type', 'button'); target('div', 'next')
    const { sdk, controller } = await host(); await highlight(sdk, element)
    sdk.config.onNextClick?.(element, fixture.steps[0], opts(sdk)); await vi.advanceTimersByTimeAsync(800)
    expect(sdk.next).toHaveBeenCalledTimes(1); expect(controller.hasSeen()).toBe(false)
    sdk.config.onNextClick?.(undefined, fixture.steps[1], opts(sdk))
    expect(controller.hasSeen()).toBe(true); expect(sdk.destroy).toHaveBeenCalledTimes(1)
    controller.clearSeen(); expect(controller.hasSeen()).toBe(false)
  })

  it('resolves an Element-valued step and the public current-step query without a CSS-only assumption', async () => {
    const element = target('input'); fixture.steps[0].element = element
    const { sdk, controller } = await host()
    expect(controller.isCurrentStep('#interactive')).toBe(true)
    expect(controller.isCurrentStep('#missing')).toBe(false)
    keyboard(document, 'Enter'); expect(sdk.next).toHaveBeenCalledTimes(1)
    sdk.destroy(); expect(controller.isCurrentStep('#interactive')).toBe(false)
  })

  it('replays through its public controller, clearing completion and replacing the old driver', async () => {
    target(); const { sdk, controller } = await host(); controller.markAsSeen(); expect(controller.hasSeen()).toBe(true)
    controller.replayTour(); await flushPromises()
    expect(controller.hasSeen()).toBe(false); expect(sdk.destroy).toHaveBeenCalledTimes(1); expect(instances).toHaveLength(2)
    await controller.nextStep(0); expect(instances[1].next).toHaveBeenCalledTimes(1)
  })
})
