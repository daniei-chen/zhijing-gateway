import { afterEach, describe, expect, it, vi } from 'vitest'
import { startWorkspaceTransition } from '../workspaceMotion'

const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
function setTransition(value: unknown) {
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value })
}
function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
afterEach(() => {
  if (original) Object.defineProperty(document, 'startViewTransition', original)
  else Reflect.deleteProperty(document, 'startViewTransition')
  document.documentElement.classList.remove('z-route-transition')
  document.documentElement.style.removeProperty('--z-route-distance')
})

describe('workspace view transition boundary', () => {
  it('leaves the native link intact when capture is unavailable', () => {
    setTransition(undefined)
    const update = vi.fn(async () => {})
    expect(startWorkspaceTransition(document, update)).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(false)
  })

  it('marks capture before the native router callback and cleans up after completion', async () => {
    const end = deferred()
    const update = vi.fn(async () => {
      expect(document.documentElement.classList.contains('z-route-transition')).toBe(true)
    })
    setTransition((callback: () => Promise<void>) => {
      void callback()
      return { finished: end.promise }
    })
    expect(startWorkspaceTransition(document, update, -1)).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--z-route-distance')).toBe('-7px')
    end.resolve()
    await end.promise
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(false)
  })

  it('keeps native navigation available if starting a capture throws', () => {
    const update = vi.fn(async () => {})
    setTransition(() => { throw new Error('capture unavailable') })
    expect(startWorkspaceTransition(document, update)).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(false)
  })

  it('cleans up interrupted captures', async () => {
    const end = deferred()
    setTransition(() => ({ finished: end.promise, ready: Promise.reject(new Error('skipped')) }))
    expect(startWorkspaceTransition(document, async () => {})).toBe(true)
    end.reject(new Error('interrupted'))
    await Promise.resolve()
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--z-route-distance')).toBe('')
  })

  it('does not let an older capture clear the latest navigation state', async () => {
    const first = deferred(), second = deferred()
    setTransition(vi.fn().mockReturnValueOnce({ finished: first.promise }).mockReturnValueOnce({ finished: second.promise }))
    startWorkspaceTransition(document, async () => {})
    startWorkspaceTransition(document, async () => {}, -1)
    first.resolve()
    await first.promise
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--z-route-distance')).toBe('-7px')
    second.resolve()
    await second.promise
    expect(document.documentElement.classList.contains('z-route-transition')).toBe(false)
  })
})
