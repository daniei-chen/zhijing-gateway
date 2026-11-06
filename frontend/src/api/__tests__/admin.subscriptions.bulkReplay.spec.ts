import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bulkAction } from '@/api/admin/subscriptions'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiClient: { post } }))

const request = { subscription_ids: [3, 5], action: 'extend' as const, days: 7 }
const result = { success_count: 1, failed_count: 1, results: [
  { subscription_id: 3, success: true }, { subscription_id: 5, success: false, error: 'Synthetic missing subscription' }
] }

beforeEach(() => { post.mockReset() })

describe('admin subscription bulk read-only replay protocol', () => {
  it.each(['x-idempotency-replayed', 'X-Idempotency-Replayed'])('queries the retained original body/key and accepts the explicit %s acknowledgement', async header => {
    post.mockResolvedValue({ data: result, headers: { [header]: 'true' } })
    await expect(bulkAction(request, 'synthetic-original-key', true)).resolves.toEqual(result)
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/subscriptions/bulk-action/replay', request, {
      headers: { 'Idempotency-Key': 'synthetic-original-key' }
    })
  })

  it.each([undefined, '', 'false'])('keeps a result unconfirmed when the replay acknowledgement is %s', async marker => {
    post.mockResolvedValue({ data: result, headers: { 'x-idempotency-replayed': marker } })
    await expect(bulkAction(request, 'synthetic-original-key', true)).rejects.toMatchObject({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0]).toBe('/admin/subscriptions/bulk-action/replay')
  })

  it.each([{ status: 404 }, { response: { status: 404 } }])('fails safely on a backend without the replay endpoint (%j)', async error => {
    post.mockRejectedValue(error)
    await expect(bulkAction(request, 'synthetic-original-key', true)).rejects.toMatchObject({ status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED' })
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0]).toBe('/admin/subscriptions/bulk-action/replay')
  })

  it('preserves an expired or missing result and never falls back to the business write', async () => {
    const error = { status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED', message: 'Synthetic record expired' }
    post.mockRejectedValue(error)
    await expect(bulkAction(request, 'synthetic-original-key', true)).rejects.toBe(error)
    await expect(bulkAction(request, 'synthetic-original-key', true)).rejects.toBe(error)
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/subscriptions/bulk-action/replay', '/admin/subscriptions/bulk-action/replay'])
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0])
  })
})
