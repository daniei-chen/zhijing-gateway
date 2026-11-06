import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatchRetryIdentity } from '../batchImageRetryIdentity'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.unstubAllGlobals() })
describe('batch retry item identities retain the exact original source', () => {
  it('keeps normalized-looking external IDs distinct and maps echoed opaque retries back to their own source', async () => {
    const original = ['scene/a', 'scene a', 'scene_a']
    const identities = await createBatchRetryIdentity(original)
    const generated = original.map((id, index) => identities.next(identities.root(id), 'synthetic-operation', index))
    expect(new Set(generated).size).toBe(3)
    for (let i = 0; i < original.length; i++) {
      expect(identities.child(generated[i]!)).toBe(identities.root(original[i]!))
      expect(identities.root(original[i]!)).toBe(createHash('sha256').update(original[i]!, 'utf8').digest('hex'))
    }
  })
  it.each(['a'.repeat(255), '图'.repeat(85), 'a.*[x](y)?$+^|\\'])('keeps a valid original source bounded in new API identifiers: %s', async original => {
    const identities = await createBatchRetryIdentity([original]); const id = identities.next(identities.root(original), 'synthetic-operation', 199)
    expect(new TextEncoder().encode(id).byteLength).toBeLessThanOrEqual(255)
    expect(id).toMatch(/^[a-z0-9_\-]+$/); expect(identities.child(id)).toBe(identities.root(original))
  })
  it('preserves a root source through a retry of a retry', async () => {
    const identities = await createBatchRetryIdentity(['original'])
    const first = identities.next(identities.root('original'), 'first', 0)
    const second = identities.next(identities.child(first), 'second', 0)
    expect(identities.child(second)).toBe(identities.root('original'))
    expect(second).not.toBe(first)
  })
  it('recognizes a uniquely attributable legacy retry', async () => {
    const identities = await createBatchRetryIdentity(['original', 'other'])
    expect(identities.child('original_retry_abc123')).toBe(identities.root('original'))
  })
  it('keeps case-sensitive original IDs distinct in legacy history', async () => {
    const identities = await createBatchRetryIdentity(['Cover', 'cover'])
    expect(identities.child('Cover_retry_abc123')).toBe(identities.root('Cover'))
    expect(identities.child('cover_retry_abc123')).toBe(identities.root('cover'))
  })
  it('refuses ambiguous legacy normalization instead of guessing which original recovered', async () => {
    const identities = await createBatchRetryIdentity(['scene/a', 'scene a'])
    expect(() => identities.child('scene_a_retry_abc123')).toThrow()
  })
  it('refuses natural legacy suffix collisions and unknown future sources', async () => {
    const identities = await createBatchRetryIdentity(['cover', 'cover_retry_abc123'])
    expect(() => identities.child('cover_retry_abc123_retry_def456')).toThrow()
    expect(() => identities.child('not-a-known-source')).toThrow()
  })
})
