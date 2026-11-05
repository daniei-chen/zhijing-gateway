import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { authSessionDigest } from '../authSessionDigest'

describe('session storage fingerprints', () => {
  it.each(['', 'abc', '智境🔐', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(10000)])('matches SHA-256 for a complete UTF-8 input (%#)', value => {
    expect(authSessionDigest(value)).toBe(createHash('sha256').update(value).digest('hex'))
  })
})
