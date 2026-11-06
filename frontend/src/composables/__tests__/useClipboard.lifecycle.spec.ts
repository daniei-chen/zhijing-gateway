import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { useClipboard } from '../useClipboard'
import { captureAuthSession, replaceAuthSession } from '@/api/authSession'

const { showError, showSuccess } = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess }) }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
const Harness = defineComponent({
  props: { withOwner: Boolean }, emits: ['done'],
  setup(props, { emit }) {
    const { copied, copyToClipboard } = useClipboard()
    const text = ref('synthetic clipboard text')
    const owner = ref(1)
    const allowed = ref(true)
    const copy = async () => {
      const generation = owner.value
      const isCurrent = props.withOwner ? () => allowed.value && generation === owner.value : undefined
      if (await copyToClipboard(text.value, 'Synthetic copied', isCurrent)) emit('done')
    }
    return { copied, text, owner, allowed, copy }
  },
  template: '<div><input aria-label="Synthetic copy text" v-model="text"/><button data-test="copy" @click="copy">copy</button><button data-test="owner" @click="owner++">next owner</button><button data-test="deny" @click="allowed=false">deny owner</button><output>{{copied}}</output></div>'
})
const wrappers: VueWrapper[] = []
function harness(withOwner = false) { const wrapper = mount(Harness, { props: { withOwner } }); wrappers.push(wrapper); return wrapper }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(true) })
  captureAuthSession()
  // jsdom schedules storage events at 0ms; they are unrelated to copy reset timers.
  await vi.advanceTimersByTimeAsync(0)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })

describe('useClipboard completed-feedback ownership', () => {
  it('expires copied feedback even when its caller owner changed after success', async () => {
    const wrapper = harness(true)
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('output').text()).toBe('true')
    await wrapper.get('[data-test="owner"]').trigger('click')
    await vi.advanceTimersByTimeAsync(2001)
    expect(wrapper.get('output').text()).toBe('false')
    expect(showSuccess).toHaveBeenCalledOnce()
  })
})

describe('useClipboard real component lifecycle', () => {
  it('preserves two-argument success, feedback and the normal reset timer', async () => {
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('synthetic clipboard text')
    expect(wrapper.get('output').text()).toBe('true')
    expect(showSuccess).toHaveBeenCalledExactlyOnceWith('Synthetic copied')
    expect(wrapper.emitted('done')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.get('output').text()).toBe('false')
  })

  it.each([true, false])('uses and removes the fallback textarea when secure=%s', async (secure) => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure })
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('synthetic denied'))
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
    expect(showSuccess).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.get('output').text()).toBe('true')
  })

  it.each(['false', 'throw'])('preserves fallback failure feedback when the fallback returns %s', async (result) => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('synthetic denied'))
    vi.mocked(document.execCommand).mockImplementation(() => { if (result === 'throw') throw new Error('synthetic fallback error'); return false })
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledExactlyOnceWith('common.copyFailed')
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.get('output').text()).toBe('false')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it.each(['success', 'failure'])('does not publish late %s after the component scope is destroyed', async (outcome) => {
    const pending = deferred<void>()
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(pending.promise)
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    wrapper.unmount()
    if (outcome === 'success') pending.resolve()
    else pending.reject(new Error('synthetic old denial'))
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('suppresses old login feedback even when the replacement login has the same user ID', async () => {
    replaceAuthSession({ accessToken: 'synthetic-first-login', user: { id: 7 } })
    const pending = deferred<void>()
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(pending.promise)
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    replaceAuthSession({ accessToken: 'synthetic-second-login', user: { id: 7 } })
    pending.resolve()
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.get('output').text()).toBe('false')
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it.each(['success', 'failure'])('keeps the latest copy when the older copy ends with %s', async (outcome) => {
    const pending = deferred<void>()
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(pending.promise)
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await wrapper.get('input').setValue('synthetic newer text')
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    if (outcome === 'success') pending.resolve()
    else pending.reject(new Error('synthetic old denial'))
    await flushPromises()
    expect(showSuccess).toHaveBeenCalledOnce()
    expect(showError).not.toHaveBeenCalled()
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.get('output').text()).toBe('true')
  })

  it('does not let an old reset timer clear feedback from a newer copy', async () => {
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1001)
    expect(wrapper.get('output').text()).toBe('true')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('output').text()).toBe('false')
  })

  it.each(['scope', 'login'])('clears its pending reset timer when the %s ends', async (change) => {
    const wrapper = harness()
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(vi.getTimerCount()).toBe(1)
    if (change === 'scope') wrapper.unmount()
    else replaceAuthSession({ accessToken: 'synthetic-next-login', user: { id: 8 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the optional owner callback to isolate two drafts in the same login', async () => {
    const pending = deferred<void>()
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(pending.promise)
    const wrapper = harness(true)
    await wrapper.get('[data-test="copy"]').trigger('click')
    await wrapper.get('[data-test="owner"]').trigger('click')
    pending.resolve()
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.get('output').text()).toBe('false')
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('does not start copying when the supplied operation owner is already invalid', async () => {
    const wrapper = harness(true)
    await wrapper.get('[data-test="deny"]').trigger('click')
    await wrapper.get('[data-test="copy"]').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.get('output').text()).toBe('false')
  })
})
