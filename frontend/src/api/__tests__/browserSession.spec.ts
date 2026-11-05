import { describe, expect, it } from 'vitest'
import { browserSessionHeaders, isBrowserSessionHandle } from '../browserSession'

const session = { generation: '12345678-1234-4234-8234-123456789abc', subject: '7' }
const handle = `zjs.${session.generation}.${'a'.repeat(32)}`

describe('browser cookie session selectors', () => {
  it('sends an opt-in marker with legacy bearer credentials for migration', () => {
    expect(browserSessionHeaders('legacy-jwt', session, '/api/v1/auth/me')).toEqual({
      Authorization: 'Bearer legacy-jwt', 'X-Zhijing-Session': `init.${session.generation}`,
    })
  })
  it('uses a public selector without exposing credentials or adding a bearer', () => {
    expect(browserSessionHeaders(handle, session, '/api/v1/auth/me')).toEqual({ 'X-Zhijing-Session': handle })
    expect(isBrowserSessionHandle(handle)).toBe(true)
    expect(isBrowserSessionHandle(`zjs.${'b'.repeat(32)}.${'a'.repeat(32)}`)).toBe(true)
    expect(isBrowserSessionHandle(`${handle}.extra`)).toBe(false)
  })
  it('refuses to send a cookie selector to a different origin', () => {
    expect(() => browserSessionHeaders(handle, session, 'https://other.example/api/v1')).toThrow('same origin')
    expect(browserSessionHeaders('legacy-jwt', session, 'https://other.example/api/v1')).toEqual({ Authorization: 'Bearer legacy-jwt' })
  })
  it('allows anonymous authentication to establish a fresh isolated cookie scope', () => {
    expect(browserSessionHeaders(null, { ...session, subject: null }, '/api/v1/auth/login')).toEqual({ 'X-Zhijing-Session': `init.${session.generation}` })
  })
})
