import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadSetupApi() {
  vi.resetModules()
  return import('@/api/setup')
}

describe('setup api token', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/setup')
  })

  it('picks the token up from the setup link the server prints', async () => {
    window.history.replaceState({}, '', '/setup?setup_token=from-query')

    const setupApi = await loadSetupApi()

    expect(setupApi.getSetupToken()).toBe('from-query')
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBe('from-query')
    expect(window.location.search).not.toContain('setup_token')
  })

  it('keeps the other query parameters when it drops the token', async () => {
    window.history.replaceState({}, '', '/setup?lang=zh&setup_token=from-link')

    const setupApi = await loadSetupApi()
    setupApi.getSetupToken()

    expect(window.location.search).toContain('lang=zh')
    expect(window.location.search).not.toContain('setup_token')
  })

  it('keeps the token for the browser session so a refresh still has it', async () => {
    const first = await loadSetupApi()
    first.setSetupToken('typed-by-operator')

    const second = await loadSetupApi()

    expect(second.getSetupToken()).toBe('typed-by-operator')
  })

  it('reports no token when neither the query nor the session has one', async () => {
    const setupApi = await loadSetupApi()

    expect(setupApi.getSetupToken()).toBe('')
  })

  it('keeps the token in the link when the browser cannot persist it', async () => {
    window.history.replaceState({}, '', '/setup?setup_token=only-copy')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    try {
      const setupApi = await loadSetupApi()

      expect(setupApi.getSetupToken()).toBe('only-copy')
      expect(window.location.search).toContain('setup_token=only-copy')
    } finally {
      setItem.mockRestore()
    }
  })

  it('trims a pasted token and clears it when set to an empty value', async () => {
    const setupApi = await loadSetupApi()

    expect(setupApi.setSetupToken('  padded-token  ')).toBe(true)
    expect(setupApi.getSetupToken()).toBe('padded-token')

    setupApi.setSetupToken('   ')
    expect(setupApi.getSetupToken()).toBe('')
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBeNull()
  })
})
