import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiClient: { post } }))
const load = () => import('@/api/admin/subscriptions')
const key = (index: number) => post.mock.calls[index]?.[2]?.headers?.['Idempotency-Key'] as string | undefined
const ok = () => ({ data: { id: 41 }, headers: {} })
const replay = () => ({ data: { id: 41 }, headers: { 'x-idempotency-replayed': 'true' } })
function deferred() {
  let resolve!: (value: ReturnType<typeof ok>) => void
  const promise = new Promise<ReturnType<typeof ok>>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
  post.mockReset().mockResolvedValue(ok())
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('admin subscription adjustment retry safety', () => {
  it('keeps the two-argument contract and includes a fresh key for the first write', async () => {
    const { extend } = await load()
    await expect(extend(41, { days: -7 })).resolves.toEqual({ id: 41 })
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/subscriptions/41/extend', { days: -7 }, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(key(0)).toBeTruthy()
  })

  it('reads a retained result through the separate replay endpoint and only then permits a new operation', async () => {
    const { extend } = await load()
    post.mockRejectedValueOnce({ status: 0, message: 'synthetic lost acknowledgement' }).mockResolvedValueOnce(replay())
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    const originalKey = key(0); expect(originalKey).toBeTruthy()
    await extend(41, { days: 7 })
    expect(post.mock.calls[1]).toEqual(['/admin/subscriptions/41/extend/replay', { days: 7 }, { headers: { 'Idempotency-Key': originalKey } }])
    await extend(41, { days: 7 })
    expect(post.mock.calls[2][0]).toBe('/admin/subscriptions/41/extend')
    expect(key(2)).toBeTruthy(); expect(key(2)).not.toBe(originalKey)
  })

  it('never repeats an accepted adjustment after the server retention window expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let expiresAt = 0
    let acceptedWrites = 0
    post.mockImplementation(async (url: string) => {
      if (url.endsWith('/replay')) {
        if (Date.now() >= expiresAt) throw { status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' }
        return replay()
      }
      acceptedWrites++; expiresAt = Date.now() + 1000
      throw { status: 0, message: 'synthetic accepted response lost' }
    })
    const { extend } = await load()
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    const originalKey = key(0); expect(originalKey).toBeTruthy()
    vi.setSystemTime(Date.now() + 1001)
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(acceptedWrites).toBe(1)
    expect(post.mock.calls.slice(1).map(call => call[0])).toEqual(['/admin/subscriptions/41/extend/replay', '/admin/subscriptions/41/extend/replay'])
    expect(key(1)).toBe(originalKey); expect(key(2)).toBe(originalKey)
  })

  it('fails safely on an old backend without replay support and keeps the unresolved identity', async () => {
    const { extend } = await load()
    post.mockRejectedValueOnce({ status: 0 }).mockRejectedValueOnce({ status: 404 }).mockRejectedValueOnce({ status: 404 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    vi.resetModules()
    await expect((await load()).extend(41, { days: 7 })).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post.mock.calls.slice(1).every(call => call[0].endsWith('/extend/replay'))).toBe(true)
    expect(key(1)).toBe(key(0)); expect(key(2)).toBe(key(0))
  })

  it('requires an explicit replay acknowledgement before treating a result as confirmed', async () => {
    const { extend } = await load()
    post.mockRejectedValueOnce({ status: 0 }).mockResolvedValueOnce(ok()).mockResolvedValueOnce(replay())
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    await expect(extend(41, { days: 7 })).resolves.toEqual({ id: 41 })
    expect(post.mock.calls[1][0]).toBe('/admin/subscriptions/41/extend/replay')
    expect(post.mock.calls[2][0]).toBe('/admin/subscriptions/41/extend/replay')
    expect(key(2)).toBe(key(0))
  })

  it('keeps uncertain operations isolated between administrators and resumes each through replay', async () => {
    const { extend } = await load()
    post.mockRejectedValueOnce({ status: 0 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    const originalKey = key(0); expect(originalKey).toBeTruthy()
    localStorage.setItem('auth_user', JSON.stringify({ id: 8 }))
    await extend(41, { days: 7 })
    expect(post.mock.calls[1][0]).toBe('/admin/subscriptions/41/extend'); expect(key(1)).not.toBe(originalKey)
    localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
    post.mockResolvedValueOnce(replay())
    await extend(41, { days: 7 })
    expect(post.mock.calls[2][0]).toBe('/admin/subscriptions/41/extend/replay'); expect(key(2)).toBe(originalKey)
  })

  it.each([[42, 7], [41, -7]])('uses a new write identity for changed target/days %s/%s', async (id, days) => {
    const { extend } = await load()
    post.mockRejectedValueOnce({ status: 0 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    const originalKey = key(0); expect(originalKey).toBeTruthy()
    await extend(id, { days })
    expect(post.mock.calls[1][0]).toBe(`/admin/subscriptions/${id}/extend`)
    expect(key(1)).not.toBe(originalKey)
  })

  it('does not clear a newer unresolved identity when an older replay finishes late', async () => {
    const { extend } = await load()
    const first = deferred(); const oldReplay = deferred()
    post.mockReturnValueOnce(first.promise).mockReturnValueOnce(oldReplay.promise)
    const a = extend(41, { days: 7 }); const b = extend(41, { days: 7 })
    const originalKey = key(0); expect(originalKey).toBeTruthy(); expect(key(1)).toBe(originalKey)
    first.resolve(ok()); await a
    post.mockRejectedValueOnce({ status: 0 })
    await expect(extend(41, { days: 7 })).rejects.toMatchObject({ status: 0 })
    const newerKey = key(2); expect(newerKey).toBeTruthy(); expect(newerKey).not.toBe(originalKey)
    oldReplay.resolve(replay()); await b
    vi.resetModules(); post.mockResolvedValueOnce(replay())
    await (await load()).extend(41, { days: 7 })
    expect(post.mock.calls[3][0]).toBe('/admin/subscriptions/41/extend/replay'); expect(key(3)).toBe(newerKey)
  })
})
