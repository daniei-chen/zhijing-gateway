import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBatchImageRecovery, listBatchImageItems } from '../batchImage'
import { replaceAuthSession } from '../authSession'

vi.mock('@/api/client', () => ({ buildGatewayUrl: (path: string) => `https://gateway.example.test${path}` }))
const complete = () => ({ object: 'image.batch.recovery', complete: true, batch_id: 'root', root_batch_id: 'root', root_custom_ids: ['scene'], target_items: [{ custom_id: 'scene', status: 'failed', prompt_preview: 'Original prompt' }], successful_items: [], pending_items: [], input_mode: 'prompt_only' })
beforeEach(() => { localStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-recovery-session', user: { id: 91 } }) })
afterEach(() => { vi.unstubAllGlobals() })
describe('owner-scoped complete batch recovery contract', () => {
  it('reads history through authenticated GET with no inference body or command fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(complete()))); vi.stubGlobal('fetch', fetch)
    await expect(getBatchImageRecovery('synthetic-key', 'root')).resolves.toEqual(complete())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe('https://gateway.example.test/v1/images/batches/root/recovery')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-key' } })
    expect(fetch.mock.calls[0]![1].body).toBeUndefined(); expect(fetch.mock.calls[0]![1].method).toBeUndefined()
  })
  it.each([
    { complete: false }, { complete: undefined }, { object: 'image.batch' }, { batch_id: 'other-root' }, { root_batch_id: '' }, { root_batch_id: 42 },
    { root_custom_ids: ['scene', 'scene'] }, { target_items: [{}] }, { successful_items: [{ batch_id: 'child', custom_id: 'scene', image_count: 0 }] },
    { pending_items: null }, { input_mode: 'full_request' },
    { target_items: [{ custom_id: 'scene', status: 'failed', prompt_preview: { text: 'not the original string' } }] },
    { successful_items: [{ batch_id: 'child', custom_id: 'scene', image_count: 0.5 }] },
  ])('refuses an incomplete or incompatible saved-history response: %j', async change => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...complete(), ...change }))); vi.stubGlobal('fetch', fetch)
    await expect(getBatchImageRecovery('synthetic-key', 'root')).rejects.toMatchObject({ code: 'BATCH_IMAGE_HISTORY_UNCONFIRMED', status: 409 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps an old backend 404 read-only and reports that history is unconfirmed', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'old backend' } }), { status: 404 })); vi.stubGlobal('fetch', fetch)
    await expect(getBatchImageRecovery('synthetic-key', 'root')).rejects.toMatchObject({ code: 'BATCH_IMAGE_HISTORY_UNCONFIRMED', status: 409 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('adds optional item pagination without changing the original four-argument call', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [], has_more: false }))); vi.stubGlobal('fetch', fetch)
    await listBatchImageItems('synthetic-key', 'job/a', '')
    expect(fetch.mock.calls[0]![0]).toBe('https://gateway.example.test/v1/images/batches/job%2Fa/items')
    await listBatchImageItems('synthetic-key', 'job/a', 'failed', undefined, { limit: 100, cursor: '100' })
    const url = new URL(fetch.mock.calls[1]![0]); expect(url.searchParams.get('status')).toBe('failed'); expect(url.searchParams.get('cursor')).toBe('100'); expect(url.searchParams.get('limit')).toBe('100')
  })
})
