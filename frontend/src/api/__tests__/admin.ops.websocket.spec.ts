import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({ getLocale: () => 'zh-CN' }))

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(readonly url: string, readonly protocols: string[]) { FakeSocket.instances.push(this) }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(new Event('open')) }
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code: 1006 })) })
}

let dispose: (() => void) | undefined
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubGlobal('WebSocket', FakeSocket)
  FakeSocket.instances = []
  localStorage.clear()
})
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function setup() {
  const sessions = await import('../authSession')
  sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-A', user: { id: 101 } })
  sessions.adoptDocumentAuthSession()
  const { subscribeQPS } = await import('../admin/ops')
  return { sessions, subscribeQPS }
}

describe('admin QPS socket lifetime', () => {
  it.each([0, 1, 2])('honors a retry budget of %s even when no connection opens', async limit => {
    const { subscribeQPS } = await setup()
    dispose = subscribeQPS(vi.fn(), { maxReconnectAttempts: limit, reconnectBaseDelayMs: 10 })
    for (let attempt = 0; attempt <= limit; attempt++) {
      FakeSocket.instances.at(-1)!.close()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(FakeSocket.instances).toHaveLength(limit + 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops on account replacement and never reconnects with the replacement bearer', async () => {
    const { sessions, subscribeQPS } = await setup()
    const onMessage = vi.fn()
    dispose = subscribeQPS(onMessage, { reconnectBaseDelayMs: 10 })
    const socket = FakeSocket.instances[0]
    socket.open()
    const lateMessage = socket.onmessage!
    sessions.replaceAuthSession({ accessToken: 'SYNTHETIC-B', user: { id: 202 } })
    lateMessage(new MessageEvent('message', { data: '{"private":"old-account"}' }))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(onMessage).not.toHaveBeenCalled()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a rotated token within the original session and permits exactly one retry', async () => {
    const { sessions, subscribeQPS } = await setup()
    dispose = subscribeQPS(vi.fn(), { maxReconnectAttempts: 1, reconnectBaseDelayMs: 10 })
    FakeSocket.instances[0].open()
    sessions.commitAuthTokenRotation(sessions.captureAuthSession(), {
      access_token: 'SYNTHETIC-A-rotated', refresh_token: 'SYNTHETIC-refresh', expires_in: 3600,
    })
    FakeSocket.instances[0].close()
    await vi.advanceTimersByTimeAsync(10)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1].protocols).toContain('jwt.SYNTHETIC-A-rotated')
  })

  it('ignores late socket events after explicit disposal', async () => {
    const { subscribeQPS } = await setup()
    const onMessage = vi.fn()
    dispose = subscribeQPS(onMessage)
    const socket = FakeSocket.instances[0]
    const lateMessage = socket.onmessage!
    dispose()
    lateMessage(new MessageEvent('message', { data: '{"qps":10}' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(onMessage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
