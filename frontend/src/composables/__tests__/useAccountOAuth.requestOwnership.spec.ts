import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountOAuth } from '../useAccountOAuth'
import { useOpenAIOAuth } from '../useOpenAIOAuth'
import { useGeminiOAuth } from '../useGeminiOAuth'
import { useAntigravityOAuth } from '../useAntigravityOAuth'
import { useGrokOAuth } from '../useGrokOAuth'

const { generate, token, showError } = vi.hoisted(() => ({ generate: vi.fn(), token: vi.fn(), showError: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { generateAuthUrl: generate, exchangeCode: token, refreshOpenAIToken: token },
  gemini: { generateAuthUrl: generate, exchangeCode: token },
  antigravity: { generateAuthUrl: generate, exchangeCode: token, refreshAntigravityToken: token },
  grok: { generateAuthUrl: generate, exchangeCode: token, refreshGrokToken: token }
} }))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const response = { auth_url: 'https://synthetic.example/oauth?state=synthetic', session_id: 'synthetic-session', state: 'synthetic' }
const providers = [
  { name: 'Anthropic', create: (owner?: () => unknown) => {
    const client = useAccountOAuth(owner)
    return { ...client, generate: () => client.generateAuthUrl('oauth'), requestToken: () => client.cookieAuth('oauth', 'synthetic-key') }
  } },
  { name: 'OpenAI', create: (owner?: () => unknown) => {
    const client = useOpenAIOAuth(owner)
    return { ...client, generate: () => client.generateAuthUrl(), requestToken: () => client.validateRefreshToken('synthetic-rt') }
  } },
  { name: 'Gemini', create: (owner?: () => unknown) => {
    const client = useGeminiOAuth(owner)
    return { ...client, generate: () => client.generateAuthUrl(null), requestToken: () => client.exchangeAuthCode({ code: 'synthetic-code', sessionId: 'synthetic-session', state: 'synthetic' }) }
  } },
  { name: 'Antigravity', create: (owner?: () => unknown) => {
    const client = useAntigravityOAuth(owner)
    return { ...client, generate: () => client.generateAuthUrl(null), requestToken: () => client.validateRefreshToken('synthetic-rt') }
  } },
  { name: 'Grok', create: (owner?: () => unknown) => {
    const client = useGrokOAuth(owner)
    return { ...client, generate: () => client.generateAuthUrl(null), requestToken: () => client.validateRefreshToken('synthetic-rt') }
  } }
]
beforeEach(() => {
  vi.clearAllMocks()
  generate.mockReset().mockResolvedValue(response)
  token.mockReset().mockResolvedValue({ access_token: 'synthetic-access' })
})

describe.each(providers)('$name OAuth request ownership', ({ create }) => {
  it('keeps the existing no-options API usable', async () => {
    const client = create()
    expect(await client.generate()).toBe(true)
    expect(client.sessionId.value).toBe('synthetic-session')
    expect(await client.requestToken()).toMatchObject({ access_token: 'synthetic-access' })
    expect(client.loading.value).toBe(false)
  })

  it('discards an authorization URL that arrives after reset', async () => {
    const request = deferred<any>()
    generate.mockReturnValueOnce(request.promise)
    const client = create()
    const pending = client.generate()
    client.resetState()
    request.resolve(response)
    expect(await pending).toBe(false)
    expect(client.authUrl.value).toBe('')
    expect(client.sessionId.value).toBe('')
    expect(client.loading.value).toBe(false)
  })

  it('does not toast or replace errors after the request owner changes', async () => {
    let owner = 1
    const request = deferred<any>()
    generate.mockReturnValueOnce(request.promise)
    const client = create(() => owner)
    const pending = client.generate()
    owner++
    client.resetState()
    request.reject({ response: { data: { detail: 'old failure' } }, message: 'old failure' })
    expect(await pending).toBe(false)
    expect(showError).not.toHaveBeenCalled()
    expect(client.error.value).toBe('')
  })

  it('does not let an older completion clear the loading state of a newer request', async () => {
    const old = deferred<any>()
    const current = deferred<any>()
    generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const client = create()
    const first = client.generate()
    const second = client.generate()
    old.resolve({ ...response, session_id: 'old-session' })
    expect(await first).toBe(false)
    expect(client.loading.value).toBe(true)
    expect(client.sessionId.value).toBe('')
    current.resolve(response)
    expect(await second).toBe(true)
    expect(client.loading.value).toBe(false)
    expect(client.sessionId.value).toBe('synthetic-session')
  })

  it.each(['success', 'failure'])('drops a token %s after owner invalidation', async (outcome) => {
    let owner = 1
    const request = deferred<any>()
    token.mockReturnValueOnce(request.promise)
    const client = create(() => owner)
    const pending = client.requestToken()
    owner++
    client.resetState()
    if (outcome === 'success') request.resolve({ access_token: 'old-access' })
    else request.reject({ response: { data: { detail: 'old failure' } }, message: 'old failure' })
    expect(await pending).toBeNull()
    expect(showError).not.toHaveBeenCalled()
    expect(client.error.value).toBe('')
    expect(client.loading.value).toBe(false)
  })
})
