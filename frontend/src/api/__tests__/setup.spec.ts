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

    expect(setupApi.hasSetupToken()).toBe(true)
    expect(setupApi.getSetupToken()).toBe('from-query')
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBe('from-query')
  })

  it('keeps the token for the browser session so a refresh still has it', async () => {
    const first = await loadSetupApi()
    first.setSetupToken('typed-by-operator')

    const second = await loadSetupApi()

    expect(second.getSetupToken()).toBe('typed-by-operator')
  })

  it('reports no token when neither the query nor the session has one', async () => {
    const setupApi = await loadSetupApi()

    expect(setupApi.hasSetupToken()).toBe(false)
    expect(setupApi.getSetupToken()).toBe('')
  })

  it('drops a token the server rejected so the wizard can ask again', async () => {
    const setupApi = await loadSetupApi()
    setupApi.setSetupToken('typo-token')

    const cleared = setupApi.clearRejectedSetupToken({ response: { status: 401 } })

    expect(cleared).toBe(true)
    expect(setupApi.hasSetupToken()).toBe(false)
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBeNull()
  })

  it('keeps the token when the request failed for another reason', async () => {
    const setupApi = await loadSetupApi()
    setupApi.setSetupToken('good-token')

    expect(setupApi.clearRejectedSetupToken({ response: { status: 500 } })).toBe(false)
    expect(setupApi.clearRejectedSetupToken(new Error('network'))).toBe(false)
    expect(setupApi.getSetupToken()).toBe('good-token')
  })

  it('does not resurrect a rejected token that came from the setup link', async () => {
    window.history.replaceState({}, '', '/setup?setup_token=stale-link')

    const setupApi = await loadSetupApi()
    expect(setupApi.getSetupToken()).toBe('stale-link')
    expect(window.location.search).not.toContain('setup_token')

    expect(setupApi.clearRejectedSetupToken({ response: { status: 401 } })).toBe(true)
    expect(setupApi.hasSetupToken()).toBe(false)
    expect(setupApi.getSetupToken()).toBe('')
  })

  it('keeps other query parameters when it drops the token', async () => {
    window.history.replaceState({}, '', '/setup?lang=zh&setup_token=from-link')

    const setupApi = await loadSetupApi()
    setupApi.getSetupToken()

    expect(window.location.search).toContain('lang=zh')
    expect(window.location.search).not.toContain('setup_token')
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

    setupApi.setSetupToken('  padded-token  ')
    expect(setupApi.getSetupToken()).toBe('padded-token')

    setupApi.setSetupToken('   ')
    expect(setupApi.hasSetupToken()).toBe(false)
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBeNull()
  })
})
