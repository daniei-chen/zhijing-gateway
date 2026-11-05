import { buildApiUrl } from './url'
import { ADMIN_UI_REQUEST_HEADER } from './adminUIRequest'
import { assertAuthSession, captureRequestAuthSession, trackAuthRequest } from './authSession'
import { browserSessionHeaders } from './browserSession'

export interface AccountTestEvent {
  type: string
  text?: string
  model?: string
  success?: boolean
  error?: string
  image_url?: string
  audio_url?: string
  video_url?: string
  mime_type?: string
}

// Account probes may contain inline images. Bound a single wire record while
// allowing ordinary image responses; never retain an unbounded unfinished line.
const MAX_EVENT_LENGTH = 16 * 1024 * 1024

/** Consume the gateway's one-JSON-record-per-data-line account probe protocol. */
export async function streamAccountTest(
  accountId: number,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onEvent: (event: AccountTestEvent) => void,
): Promise<void> {
  const session = captureRequestAuthSession()
  const controller = new AbortController()
  const abort = () => controller.abort()
  const untrack = trackAuthRequest(session, abort)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  const assertCurrent = () => {
    assertAuthSession(session)
    if (controller.signal.aborted) throw new DOMException('Account test cancelled', 'AbortError')
  }

  try {
    assertCurrent()
    const token = localStorage.getItem('auth_token')
    assertCurrent()
    const response = await fetch(buildApiUrl(`/admin/accounts/${accountId}/test`), {
      method: 'POST',
      headers: {
        ...browserSessionHeaders(token, session, buildApiUrl(`/admin/accounts/${accountId}/test`)),
        'Content-Type': 'application/json',
        [ADMIN_UI_REQUEST_HEADER]: '1',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    assertCurrent()
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let scannedLength = 0
    let receivedTerminalEvent = false
    const consumeLine = (line: string) => {
      if (line.length > MAX_EVENT_LENGTH) throw new Error('Account test event exceeds the size limit')
      if (!line.startsWith('data:')) return
      const json = line.slice(5).trim()
      if (!json || json === '[DONE]') return
      let event: unknown
      try { event = JSON.parse(json) } catch { return }
      if (!event || typeof event !== 'object' || typeof (event as AccountTestEvent).type !== 'string') return
      assertCurrent()
      onEvent(event as AccountTestEvent)
      if ((event as AccountTestEvent).type === 'test_complete' || (event as AccountTestEvent).type === 'error') {
        receivedTerminalEvent = true
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      assertCurrent()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let start = 0
      let newline: number
      while ((newline = buffer.indexOf('\n', scannedLength)) !== -1) {
        consumeLine(buffer.slice(start, newline))
        // The gateway may keep the connection open after its final event. Stop
        // immediately, including any later records already in the same chunk.
        if (receivedTerminalEvent) return
        start = newline + 1
        scannedLength = start
      }
      buffer = buffer.slice(start)
      // Only search newly decoded text on the next read, so a long record
      // delivered in tiny chunks does not repeatedly scan its entire prefix.
      scannedLength = buffer.length
      if (buffer.length > MAX_EVENT_LENGTH) throw new Error('Account test event exceeds the size limit')
      if (done) {
        if (buffer) consumeLine(buffer)
        if (!receivedTerminalEvent) throw new Error('Account test stream ended before completion')
        break
      }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    untrack()
    // Release both the network request and reader on completion, cancellation,
    // session replacement, malformed input, and failures in the event consumer.
    controller.abort()
    if (reader) {
      try { await reader.cancel() } catch { /* already closed or aborted */ }
      reader.releaseLock()
    }
  }
}
