import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiClient: { post } }))

function deferred() {
  let resolve!: (value: { data: { id: number }; headers?: Record<string, string> }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ data: { id: number }; headers?: Record<string, string> }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const sentKey = (index: number) => post.mock.calls[index]?.[2]?.headers?.['Idempotency-Key'] as string | undefined
const load = () => import('@/api/admin/users')

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
  post.mockReset().mockResolvedValue({ data: { id: 41 }, headers: { 'x-idempotency-replayed': 'true' } })
})
afterEach(() => vi.restoreAllMocks())

describe('admin user balance idempotency through the public API', () => {
  it('keeps the four-argument payload contract and sends a nonempty operation key', async () => {
    const { updateBalance } = await load()
    expect(await updateBalance(41, 0.125, 'add', 'synthetic ledger note')).toEqual({ id: 41 })
    expect(post).toHaveBeenCalledWith('/admin/users/41/balance', {
      balance: 0.125, operation: 'add', notes: 'synthetic ledger note',
    }, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(sentKey(0)).toBeTruthy()
  })

  it('reuses a failed operation for the exact payload and releases it only after success', async () => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic response lost'))
    await expect(updateBalance(41, 1.25, 'add', 'synthetic note')).rejects.toThrow('synthetic response lost')
    const key = sentKey(0)
    expect(key).toBeTruthy()
    await updateBalance(41, 1.25, 'add', 'synthetic note')
    expect(sentKey(1)).toBe(key)
    expect(post.mock.calls[1][0]).toBe('/admin/users/41/balance/replay')
    await updateBalance(41, 1.25, 'add', 'synthetic note')
    expect(sentKey(2)).toBeTruthy()
    expect(sentKey(2)).not.toBe(key)
    expect(post.mock.calls[2][0]).toBe('/admin/users/41/balance')
  })

  it('resumes an ambiguous balance operation after reloading the API module', async () => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic timeout'))
    await expect(updateBalance(41, 1.25, 'subtract')).rejects.toThrow('synthetic timeout')
    const key = sentKey(0)
    expect(key).toBeTruthy()
    vi.resetModules()
    const reloaded = await load()
    await reloaded.updateBalance(41, 1.25, 'subtract', '')
    expect(sentKey(1)).toBe(key)
  })

  it('keeps each administrator\'s uncertain balance operation isolated', async () => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic admin A timeout'))
    await expect(updateBalance(41, 1.25, 'add')).rejects.toThrow('synthetic admin A timeout')
    const firstKey = sentKey(0)
    expect(firstKey).toBeTruthy()
    localStorage.setItem('auth_user', JSON.stringify({ id: 8 }))
    await updateBalance(41, 1.25, 'add')
    expect(sentKey(1)).not.toBe(firstKey)
    localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
    await updateBalance(41, 1.25, 'add')
    expect(sentKey(2)).toBe(firstKey)
  })

  it.each([
    ['target', 42, 1.25, 'add', 'synthetic note'],
    ['amount', 41, 2.5, 'add', 'synthetic note'],
    ['operation', 41, 1.25, 'subtract', 'synthetic note'],
    ['notes', 41, 1.25, 'add', 'synthetic revised note'],
  ] as const)('does not reuse an uncertain key after the %s changes', async (_field, id, amount, operation, notes) => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic original timeout'))
    await expect(updateBalance(41, 1.25, 'add', 'synthetic note')).rejects.toThrow('synthetic original timeout')
    const firstKey = sentKey(0)
    expect(firstKey).toBeTruthy()
    await updateBalance(id, amount, operation, notes)
    expect(sentKey(1)).toBeTruthy()
    expect(sentKey(1)).not.toBe(firstKey)
    await updateBalance(41, 1.25, 'add', 'synthetic note')
    expect(sentKey(2)).toBe(firstKey)
  })

  it('does not let an old concurrent success erase a newer ambiguous operation', async () => {
    const { updateBalance } = await load()
    const first = deferred()
    const late = deferred()
    const newer = deferred()
    post.mockReturnValueOnce(first.promise).mockReturnValueOnce(late.promise).mockReturnValueOnce(newer.promise)
    const a = updateBalance(41, 1.25, 'add')
    const b = updateBalance(41, 1.25, 'add')
    const firstKey = sentKey(0)
    expect(firstKey).toBeTruthy()
    expect(sentKey(1)).toBe(firstKey)
    first.resolve({ data: { id: 41 } })
    await a
    const c = updateBalance(41, 1.25, 'add')
    const newerKey = sentKey(2)
    expect(newerKey).toBeTruthy()
    expect(newerKey).not.toBe(firstKey)
    late.resolve({ data: { id: 41 }, headers: { 'x-idempotency-replayed': 'true' } })
    await b
    const rejection = expect(c).rejects.toThrow('synthetic newer timeout')
    newer.reject(new Error('synthetic newer timeout'))
    await rejection
    // A reload checks the durable retry identity as well as the in-memory one.
    vi.resetModules()
    const reloaded = await load()
    await reloaded.updateBalance(41, 1.25, 'add')
    expect(sentKey(3)).toBe(newerKey)
  })

  it('retains retry protection in memory when session storage is unavailable', async () => {
    const originalGet = Storage.prototype.getItem
    const originalSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (this === sessionStorage) throw new Error('synthetic storage denied')
      return originalGet.call(this, key)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === sessionStorage) throw new Error('synthetic storage denied')
      originalSet.call(this, key, value)
    })
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic timeout'))
    await expect(updateBalance(41, 1.25, 'add')).rejects.toThrow('synthetic timeout')
    const key = sentKey(0)
    expect(key).toBeTruthy()
    await updateBalance(41, 1.25, 'add')
    expect(sentKey(1)).toBe(key)
  })

  it('keeps the default set operation and empty-note wire shape compatible', async () => {
    const { updateBalance } = await load()
    await updateBalance(41, 0)
    expect(post).toHaveBeenCalledWith('/admin/users/41/balance', {
      balance: 0, operation: 'set', notes: '',
    }, { headers: { 'Idempotency-Key': expect.any(String) } })
  })

  it('only asks for a saved result after an ambiguous operation, including after 25 hours', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1793900000000)
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic lost acknowledgment'))
    await expect(updateBalance(41, 1.25, 'subtract')).rejects.toThrow('synthetic lost acknowledgment')
    const key = sentKey(0)
    vi.spyOn(Date, 'now').mockReturnValue(1793900000000 + 25 * 60 * 60 * 1000)
    post.mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    await expect(updateBalance(41, 1.25, 'subtract')).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post.mock.calls[1][0]).toBe('/admin/users/41/balance/replay')
    expect(sentKey(1)).toBe(key)
    // Missing/expired server records never release the unresolved identity.
    post.mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    await expect(updateBalance(41, 1.25, 'subtract')).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post.mock.calls[2][0]).toBe('/admin/users/41/balance/replay')
    expect(sentKey(2)).toBe(key)
  })

  it('fails safely if an older backend does not offer read-only balance replay', async () => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic lost acknowledgment'))
    await expect(updateBalance(41, 1.25, 'add')).rejects.toThrow('synthetic lost acknowledgment')
    const key = sentKey(0)
    post.mockRejectedValueOnce({ status: 404 })
    await expect(updateBalance(41, 1.25, 'add')).rejects.toMatchObject({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post.mock.calls[1][0]).toBe('/admin/users/41/balance/replay')
    expect(sentKey(1)).toBe(key)
    expect(post.mock.calls.filter(call => call[0] === '/admin/users/41/balance')).toHaveLength(1)
  })

  it('retains the pending identity when a replay response does not confirm a saved result', async () => {
    const { updateBalance } = await load()
    post.mockRejectedValueOnce(new Error('synthetic response lost'))
    await expect(updateBalance(41, 1.25, 'add')).rejects.toThrow('synthetic response lost')
    const key = sentKey(0)
    post.mockResolvedValueOnce({ data: { id: 41 } })
    await expect(updateBalance(41, 1.25, 'add')).rejects.toMatchObject({ reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    await updateBalance(41, 1.25, 'add')
    expect(sentKey(2)).toBe(key)
    expect(post.mock.calls[2][0]).toBe('/admin/users/41/balance/replay')
  })
})
