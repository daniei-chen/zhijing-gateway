import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

vi.mock('@/api/admin', () => ({ adminAPI: { accounts: { getAvailableModels: vi.fn().mockResolvedValue([{ id: 'probe-model' }]) } } }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: vi.fn() }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<object>('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function response(text = '') {
  return { ok: true, body: new ReadableStream<Uint8Array>({ start(controller) {
    if (text) controller.enqueue(new TextEncoder().encode(text))
    controller.close()
  } }) } as Response
}

let wrapper: VueWrapper | undefined
beforeEach(() => { vi.resetModules(); localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function setup(admin: boolean) {
  const sessions = await import('@/api/authSession')
  sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-A', user: { id: 101 } })
  sessions.adoptDocumentAuthSession()
  const component = admin
    ? (await import('@/components/admin/account/AccountTestModal.vue')).default
    : (await import('../AccountTestModal.vue')).default
  wrapper = mount(component, {
    props: { show: true, account: { id: 42, name: 'Synthetic', type: 'apikey', platform: 'openai' } as any },
    global: { stubs: { BaseDialog: { template: '<div><slot/><slot name="footer"/></div>' }, Select: true, TextArea: true, Icon: true } },
  })
  await flushPromises()
  const vm = wrapper.vm as any
  vm.selectedModelId = 'probe-model'
  return { sessions, vm }
}

describe.each([false, true])('account probe stream session isolation (admin=%s)', admin => {
  it('aborts replaced sessions, rejects late data and refuses actions from the old page', async () => {
    const pending = deferred<Response>()
    const fetch = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetch)
    const { sessions, vm } = await setup(admin)
    const running = vm.startTest()
    expect(fetch).toHaveBeenCalledTimes(1)
    const signal = fetch.mock.calls[0][1].signal as AbortSignal
    sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-B', user: { id: 202 } })
    const abortedAtReplacement = signal.aborted
    pending.resolve(response('data: {"type":"content","text":"OLD-SESSION-DATA"}\n\n'))
    await running
    expect(abortedAtReplacement).toBe(true)
    expect(wrapper!.text()).not.toContain('OLD-SESSION-DATA')
    await vm.startTest()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight probe when its component is unmounted', async () => {
    const pending = deferred<Response>()
    const fetch = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetch)
    const { vm } = await setup(admin)
    const running = vm.startTest()
    const signal = fetch.mock.calls[0][1].signal as AbortSignal
    wrapper!.unmount()
    wrapper = undefined
    const abortedOnUnmount = signal.aborted
    pending.resolve(response())
    await running
    expect(abortedOnUnmount).toBe(true)
  })

  it('does not let an old aborted probe reset the status of its replacement', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetch)
    const { vm } = await setup(admin)
    const old = vm.startTest()
    await wrapper!.setProps({ show: false })
    await wrapper!.setProps({ show: true })
    await flushPromises()
    vm.selectedModelId = 'probe-model'
    const current = vm.startTest()
    first.reject(new DOMException('cancelled', 'AbortError'))
    await old
    const statusAfterOldRequest = vm.status
    second.resolve(response('data: {"type":"test_complete","success":true}\n'))
    await current
    expect(statusAfterOldRequest).toBe('connecting')
    expect(vm.status).toBe('success')
  })

  it('reports a truncated stream instead of remaining in the connecting state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const { vm } = await setup(admin)
    await vm.startTest()
    expect(vm.status).toBe('error')
    expect(vm.errorMessage).toContain('before completion')
  })

  it('accepts a final data record at EOF and cancels/releases the response reader', async () => {
    const fetch = vi.fn().mockResolvedValue(response('data:{"type":"test_complete","success":true}'))
    vi.stubGlobal('fetch', fetch)
    const { vm } = await setup(admin)
    await vm.startTest()
    expect(vm.status).toBe('success')
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  })

  it('finishes and cancels at the terminal event even when the upstream keeps its stream open', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"test_complete","success":true}\n' +
          'data: {"type":"content","text":"AFTER-TERMINAL"}\n',
        ))
      },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body } as Response))
    const { vm } = await setup(admin)
    await vm.startTest()
    expect(vm.status).toBe('success')
    expect(wrapper!.text()).not.toContain('AFTER-TERMINAL')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })
})
