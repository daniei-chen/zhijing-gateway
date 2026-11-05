import { describe, expect, it } from 'vitest'
import { serializePublicSettings } from '../../build/serializePublicSettings'

describe('development public settings injection', () => {
  it('preserves settings without allowing an HTML script breakout', () => {
    const settings = {
      site_name: '</script><script>window.injected=true</script>',
      value: '<!-- & > \u2028\u2029',
      nested: { url: 'https://example.test/?one=1&two=2', label: '智境' },
    }
    const serialized = serializePublicSettings(settings)
    const parsed = new DOMParser().parseFromString(
      `<html><head><script>window.__APP_CONFIG__=${serialized};</script></head><body></body></html>`,
      'text/html',
    )
    expect(parsed.querySelectorAll('script')).toHaveLength(1)
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(serialized)).toEqual(settings)
  })
})
