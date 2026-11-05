import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiClient: { post } }))

function deferred() {
  let resolve!: (value: { data: { id: number } }) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<{ data: { id: number } }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const cases = [
  { name: 'account', prefix: 'account-duplicate', load: () => import('@/api/admin/accounts') },
  { name: 'group', prefix: 'group-duplicate', load: () => import('@/api/admin/groups') },
  { name: 'monitor', prefix: 'channel-monitor-duplicate', load: () => import('@/api/admin/channelMonitor') },
]

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
  post.mockReset().mockResolvedValue({ data: { id: 999 } })
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
})
afterEach(() => vi.restoreAllMocks())

describe.each(cases)('$name duplicate operation ownership', ({ prefix, load }) => {
  it('keeps each administrator\'s failed operation available for that administrator only', async () => {
    const { duplicate } = await load()
    post.mockRejectedValueOnce(new Error('first admin timeout'))
    await expect(duplicate(55)).rejects.toThrow('first admin timeout')
    const first = post.mock.calls[0][2].headers['Idempotency-Key']

    localStorage.setItem('auth_user', JSON.stringify({ id: 8 }))
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    await duplicate(55)
    expect(post.mock.calls[1][2].headers['Idempotency-Key']).not.toBe(first)
    expect(sessionStorage.getItem(`sub2api:admin:${prefix}:7:55`)).toBe(first)
    expect(sessionStorage.getItem(`sub2api:admin:${prefix}:8:55`)).toBeNull()

    localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
    await duplicate(55)
    expect(post.mock.calls[2][2].headers['Idempotency-Key']).toBe(first)
  })

  it('does not let an older concurrent completion erase a newer ambiguous operation', async () => {
    const { duplicate } = await load()
    const first = deferred()
    const late = deferred()
    const newer = deferred()
    post.mockReturnValueOnce(first.promise).mockReturnValueOnce(late.promise).mockReturnValueOnce(newer.promise)
    const a = duplicate(61)
    const b = duplicate(61)
    expect(post.mock.calls[0][2].headers).toEqual(post.mock.calls[1][2].headers)
    first.resolve({ data: { id: 62 } })
    await a

    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const c = duplicate(61)
    const newerKey = post.mock.calls[2][2].headers['Idempotency-Key']
    expect(newerKey).not.toBe(post.mock.calls[0][2].headers['Idempotency-Key'])
    late.resolve({ data: { id: 62 } })
    await b
    const rejection = expect(c).rejects.toThrow('newer timeout')
    newer.reject(new Error('newer timeout'))
    await rejection
    expect(sessionStorage.getItem(`sub2api:admin:${prefix}:7:61`)).toBe(newerKey)

    await duplicate(61)
    expect(post.mock.calls[3][2].headers['Idempotency-Key']).toBe(newerKey)
    expect(sessionStorage.getItem(`sub2api:admin:${prefix}:7:61`)).toBeNull()
  })
})
