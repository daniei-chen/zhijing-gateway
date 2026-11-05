import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEmbeddedUrl, detectTheme } from '../embedded-url'

describe('embedded-url', () => {
  const originalLocation = window.location

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://app.example.com',
        href: 'https://app.example.com/user/purchase',
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    document.documentElement.classList.remove('dark')
    vi.restoreAllMocks()
  })

  it('adds embedded query parameters including locale and source context', () => {
    const result = buildEmbeddedUrl(
      'https://pay.example.com/checkout?plan=pro',
      42,
      'token-123',
      'dark',
      'zh-CN',
    )

    const url = new URL(result)
    expect(url.searchParams.get('plan')).toBe('pro')
    expect(url.searchParams.get('user_id')).toBe('42')
    expect(url.searchParams.has('token')).toBe(false)
    expect(result).not.toContain('token-123')
    expect(url.searchParams.get('theme')).toBe('dark')
    expect(url.searchParams.get('lang')).toBe('zh-CN')
    expect(url.searchParams.get('ui_mode')).toBe('embedded')
    expect(url.searchParams.get('src_host')).toBe('https://app.example.com')
    expect(url.searchParams.get('src_url')).toBe('https://app.example.com/user/purchase')
  })

  it('omits optional params when they are empty', () => {
    const result = buildEmbeddedUrl('https://pay.example.com/checkout', undefined, '', 'light')

    const url = new URL(result)
    expect(url.searchParams.get('theme')).toBe('light')
    expect(url.searchParams.get('ui_mode')).toBe('embedded')
    expect(url.searchParams.has('user_id')).toBe(false)
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.has('lang')).toBe(false)
  })

  it.each(['https://app.example.com/docs', 'https://third-party.example.test/docs', 'https://app.example.com/redirect?next=https%3A%2F%2Fthird-party.example.test'])('never adds the login credential to %s', base => {
    const url = new URL(buildEmbeddedUrl(base, 42, 'SYNTHETIC-LOGIN-SECRET'))
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.toString()).not.toContain('SYNTHETIC-LOGIN-SECRET')
  })

  it('removes credential parameters and excludes callback queries/fragments from source tracking', () => {
    window.location.href = 'https://app.example.com/callback?access_token=SYNTHETIC-ACCESS&refresh_token=SYNTHETIC-REFRESH#token=SYNTHETIC-HASH'
    const url = new URL(buildEmbeddedUrl('https://example.test/docs?TOKEN=SYNTHETIC-OLD&access_token=SYNTHETIC-OLD2&plan=pro', 42, 'SYNTHETIC-LOGIN-SECRET'))
    expect(url.searchParams.get('src_url')).toBe('https://app.example.com/callback')
    expect(url.searchParams.get('plan')).toBe('pro')
    expect(url.toString()).not.toContain('SYNTHETIC')
    expect(buildEmbeddedUrl('https://example.test/docs#access_token=SYNTHETIC')).toBe('')
    expect(buildEmbeddedUrl('https://example.test/docs#guide')).toContain('#guide')
  })

  it.each([
    'not a url',
    '//example.test/embed?access_token=SYNTHETIC',
    '/embed?access_token=SYNTHETIC',
    'https://user:SYNTHETIC@example.test/embed',
    'https://example.test/embed#%61ccess_token=SYNTHETIC',
    'https://example.test/embed#access_token=SYNTHETIC?next=checkout',
    'https://example.test/embed#/checkout?%72efresh_token=SYNTHETIC',
  ])('rejects unvalidated or credential-bearing embedded URL %s', base => {
    expect(buildEmbeddedUrl(base, 1, 'SYNTHETIC-LOGIN')).toBe('')
  })

  it('detects dark mode from document root class', () => {
    document.documentElement.classList.add('dark')
    expect(detectTheme()).toBe('dark')
  })
})
