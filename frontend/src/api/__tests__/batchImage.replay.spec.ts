import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replayBatchImageSubmission, submitBatchImageJob } from '../batchImage'
import { replaceAuthSession } from '../authSession'
import { createSessionTasks } from '@/utils/sessionTasks'

vi.mock('@/api/client', () => ({ buildGatewayUrl: (path: string) => `https://gateway.example.test${path}` }))
const payload = { model: 'gemini-2.5-flash-image', task_name: 'Synthetic studio', image_size: '1K', items: [{ custom_id: 'scene', prompt: 'Synthetic image' }] }
const saved = { id: 'synthetic-job-a', status: 'queued', object: 'image.batch' }
function response(body: unknown = saved, acknowledgement: string | null = 'true', status = 200) {
  const headers = new Headers()
  if (acknowledgement !== null) headers.set('X-Idempotency-Replayed', acknowledgement)
  return new Response(JSON.stringify(body), { status, headers })
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
beforeEach(() => { localStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-batch-replay', user: { id: 81 } }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('batch submission result recovery uses the read-only wire contract', () => {
  it('preserves the original four-argument first-submit contract', async () => {
    const fetch = vi.fn().mockResolvedValue(response(saved, null)); vi.stubGlobal('fetch', fetch)
    await expect(submitBatchImageJob('synthetic-key', payload, 'synthetic-operation')).resolves.toEqual(saved)
    expect(fetch.mock.calls[0]![0]).toBe('https://gateway.example.test/v1/images/batches')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer synthetic-key', 'Idempotency-Key': 'synthetic-operation' }, body: JSON.stringify(payload) })
  })
  it('reads the original identity and body from a distinct route and requires acknowledgement', async () => {
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'synthetic-operation')).resolves.toEqual(saved)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe('https://gateway.example.test/v1/images/batches/replay')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer synthetic-key', 'Idempotency-Key': 'synthetic-operation' }, body: JSON.stringify(payload) })
  })
  it.each([null, 'false', '1'])('rejects an unacknowledged success (%s) without posting a new submission', async acknowledgement => {
    const fetch = vi.fn().mockResolvedValue(response(saved, acknowledgement)); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'same-operation')).rejects.toMatchObject({ status: 409, code: 'BATCH_IMAGE_RESULT_UNCONFIRMED' })
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![0]).toMatch(/\/batches\/replay$/)
  })
  it.each([{}, null, { id: '' }, { id: 1 }])('rejects malformed acknowledged job metadata: %j', async body => {
    const fetch = vi.fn().mockResolvedValue(response(body)); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'same-operation')).rejects.toMatchObject({ status: 409, code: 'BATCH_IMAGE_RESULT_UNCONFIRMED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('treats an older backend 404 as unconfirmed and never falls back to the write route', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: { code: 'NOT_FOUND', message: 'not supported' } }, null, 404)); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'same-operation')).rejects.toMatchObject({ status: 409, code: 'BATCH_IMAGE_RESULT_UNCONFIRMED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([409, 503])('preserves a read-only refusal (%s) without executing a new job', async status => {
    const code = status === 409 ? 'BATCH_IMAGE_RESULT_UNCONFIRMED' : 'BATCH_IMAGE_REPLAY_UNAVAILABLE'
    const fetch = vi.fn().mockResolvedValue(response({ error: { code, message: 'synthetic refusal' } }, null, status)); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'same-operation')).rejects.toMatchObject({ status, code })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('leaves a transport failure unresolved without issuing a second request', async () => {
    const error = new TypeError('synthetic network failure'); const fetch = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', fetch)
    await expect(replayBatchImageSubmission('synthetic-key', payload, 'same-operation')).rejects.toBe(error)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects a delayed result after the initiating login changes', async () => {
    const body = deferred<unknown>(); const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'X-Idempotency-Replayed': 'true' }), json: () => body.promise }); vi.stubGlobal('fetch', fetch)
    const pending = replayBatchImageSubmission('synthetic-old-key', payload, 'same-operation')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    await Promise.resolve(); replaceAuthSession({ accessToken: 'synthetic-other-login', user: { id: 82 } }); body.resolve(saved)
    await rejected; expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true)
  })
  it('does not send a captured old key when the signal belongs to a revoked session', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const tasks = createSessionTasks(); const task = tasks.begin('replay')
    replaceAuthSession({ accessToken: 'synthetic-other-login', user: { id: 82 } })
    await expect(replayBatchImageSubmission('synthetic-old-key', payload, 'same-operation', task.signal)).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(fetch).not.toHaveBeenCalled(); tasks.dispose()
  })
  it('reports cancellation before interpreting a delayed unacknowledged response', async () => {
    const headers = deferred<Response>(); const fetch = vi.fn().mockReturnValue(headers.promise); vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const pending = replayBatchImageSubmission('synthetic-key', payload, 'same-operation', controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); headers.resolve(response(saved, null)); await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
