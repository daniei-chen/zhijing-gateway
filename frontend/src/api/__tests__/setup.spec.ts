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

  it('trims a pasted token and clears it when set to an empty value', async () => {
    const setupApi = await loadSetupApi()

    setupApi.setSetupToken('  padded-token  ')
    expect(setupApi.getSetupToken()).toBe('padded-token')

    setupApi.setSetupToken('   ')
    expect(setupApi.hasSetupToken()).toBe(false)
    expect(window.sessionStorage.getItem('zhijing_setup_token')).toBeNull()
  })
})
