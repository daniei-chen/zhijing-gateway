import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionPreviewCache } from '../sessionPreviewCache'
import { captureAuthSession, replaceAuthSession, clearStoredAuthSession } from '@/api/authSession'

describe('session thumbnail cache', () => {
  let cache: ReturnType<typeof createSessionPreviewCache>
  const login = (id=101) => replaceAuthSession({accessToken:'synthetic-'+id,user:{id}})
  beforeEach(() => { localStorage.clear(); login(); cache=createSessionPreviewCache({maxEntries:2,maxBytes:6,maxAgeMs:1000}) })
  afterEach(() => { cache.dispose(); vi.restoreAllMocks() })
  it('never shares matching batch/image identifiers between users or logins', () => {
    const a=captureAuthSession();cache.put('same',new Blob(['a']),a)
    login(102);expect(cache.get('same')).toBeNull()
    cache.put('same',new Blob(['late']),a);expect(cache.get('same')).toBeNull()
    cache.put('same',new Blob(['b']));login(102);expect(cache.get('same')).toBeNull()
  })
  it('clears on logout and refuses anonymous and disposed writes', () => {
    cache.put('a',new Blob(['a']));clearStoredAuthSession();expect(cache.get('a')).toBeNull()
    cache.put('b',new Blob(['b']));expect(cache.get('b')).toBeNull()
    login();cache.dispose();cache.put('c',new Blob(['c']));expect(cache.get('c')).toBeNull()
  })
  it('bounds bytes and evicts least recently used thumbnails', () => {
    cache.put('a',new Blob(['aa']));cache.put('b',new Blob(['bb']));expect(cache.get('a')).not.toBeNull()
    cache.put('c',new Blob(['cc']));expect(cache.get('b')).toBeNull()
    cache.put('huge',new Blob(['1234567']));expect(cache.get('a')).not.toBeNull()
    cache.put('d',new Blob(['12345']));expect(cache.get('a')).toBeNull();expect(cache.get('c')).toBeNull()
  })
  it('expires on time and clock rollback and rejects unbounded keys', () => {
    const clock=vi.spyOn(Date,'now').mockReturnValue(2000)
    cache.put('a',new Blob(['a']));clock.mockReturnValue(3000);expect(cache.get('a')).toBeNull()
    cache.put('b',new Blob(['b']));clock.mockReturnValue(2999);expect(cache.get('b')).toBeNull()
    cache.put('x'.repeat(1025),new Blob(['a']));expect(cache.get('x'.repeat(1025))).toBeNull()
  })
})
