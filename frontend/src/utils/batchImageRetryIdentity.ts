const currentRetryId = /^zjretry_v1_([0-9a-f]{64})_[a-z0-9-]+_[a-z0-9]+$/
const legacyRetrySuffix = /^(.*)_retry_[a-z0-9]+$/i

function unknownSource() {
  return Object.assign(new Error('The original retry item cannot be identified unambiguously.'), { code: 'BATCH_IMAGE_RETRY_SOURCE_UNCONFIRMED', status: 409 })
}

function legacyBase(value: string) { return String(value || 'item').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'item' }

export async function createBatchRetryIdentity(rootIds: string[]) {
  if (!globalThis.crypto?.subtle || !rootIds.length || new Set(rootIds).size !== rootIds.length) throw unknownSource()
  const entries = await Promise.all(rootIds.map(async id => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
    return [id, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')] as const
  }))
  const byId = new Map(entries)
  const rootHashes = new Set(entries.map(([, hash]) => hash))
  if (rootHashes.size !== entries.length) throw unknownSource()
  const legacyByBase = new Map<string, Set<string>>()
  for (const [original, hash] of entries) {
    const base = legacyBase(original)
    const hashes = legacyByBase.get(base) ?? new Set<string>()
    hashes.add(hash)
    legacyByBase.set(base, hashes)
  }
  return {
    root(id: string) {
      const hash = byId.get(id)
      if (!hash) throw unknownSource()
      return hash
    },
    child(id: string) {
      const matches = new Set<string>()
      const current = currentRetryId.exec(id)
      if (current && rootHashes.has(current[1]!)) matches.add(current[1]!)
      const exact = byId.get(id)
      if (exact) matches.add(exact)
      let candidate = id
      for (;;) {
        const legacy = legacyRetrySuffix.exec(candidate)
        if (!legacy) break
        candidate = legacy[1]!
        for (const hash of legacyByBase.get(candidate) ?? []) matches.add(hash)
      }
      if (matches.size !== 1) throw unknownSource()
      return matches.values().next().value!
    },
    next(hash: string, nonce: string, ordinal: number) {
      if (!rootHashes.has(hash) || !/^[a-z0-9-]+$/.test(nonce) || !Number.isInteger(ordinal) || ordinal < 0) throw unknownSource()
      return `zjretry_v1_${hash}_${nonce}_${ordinal.toString(36)}`
    },
  }
}
