import { captureAuthSession, isAuthSessionCurrent, subscribeAuthSession, type AuthSessionSnapshot } from '@/api/authSession'

/** Thumbnails are derived data: keep a bounded session cache, never images on disk. */
export function createSessionPreviewCache(options: { maxEntries?: number; maxBytes?: number; maxAgeMs?: number } = {}) {
  const maxEntries = options.maxEntries ?? 120
  const maxBytes = options.maxBytes ?? 24 * 1024 * 1024
  const maxAgeMs = options.maxAgeMs ?? 30 * 60 * 1000
  const entries = new Map<string, { blob: Blob; created: number }>()
  let bytes = 0
  let owner: AuthSessionSnapshot | null = null
  let disposed = false
  function clear() { entries.clear(); bytes = 0; owner = null }
  const unsubscribe = subscribeAuthSession(() => { if (owner && !isAuthSessionCurrent(owner)) clear() })
  function belongs(session: AuthSessionSnapshot) {
    if (disposed || !session.subject || !isAuthSessionCurrent(session)) return false
    if (owner && (owner.generation !== session.generation || owner.subject !== session.subject)) clear()
    owner = session
    return true
  }
  function remove(key: string) {
    const value = entries.get(key)
    if (value) bytes -= value.blob.size
    entries.delete(key)
  }
  function prune() {
    for (const [key, item] of entries) {
      const age = Date.now() - item.created
      if (age < 0 || age >= maxAgeMs) remove(key)
    }
  }
  return {
    get(key: string, session = captureAuthSession()): Blob | null {
      if (!belongs(session) || key.length > 1024) return null
      prune()
      const item = entries.get(key)
      if (!item) return null
      entries.delete(key); entries.set(key, item)
      return item.blob
    },
    put(key: string, blob: Blob, session = captureAuthSession()) {
      if (!belongs(session) || key.length > 1024 || blob.size > maxBytes) return
      prune(); remove(key)
      while (entries.size && (entries.size >= maxEntries || bytes + blob.size > maxBytes)) remove(entries.keys().next().value!)
      if (maxEntries < 1) return
      entries.set(key, { blob, created: Date.now() }); bytes += blob.size
    },
    prune, clear,
    dispose() { disposed = true; clear(); unsubscribe() }
  }
}

export const sessionPreviewCache = createSessionPreviewCache()

// Legacy thumbnails had no user namespace. Do not read or migrate those blobs.
// Deletion waits for old tabs to close their old connections if necessary.
if (typeof indexedDB !== 'undefined') {
  try { indexedDB.deleteDatabase('sub2api-batch-image-preview-cache') } catch { /* Cache cleanup is best effort. */ }
}
