import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import OAuthAuthorizationFlow from '../OAuthAuthorizationFlow.vue'
import type { AuthInputMethod } from '@/composables/useAccountOAuth'

const { getCapabilities, copyToClipboard } = vi.hoisted(() => ({ getCapabilities: vi.fn(), copyToClipboard: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { grok: { getCapabilities } } }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copied: ref(false), copyToClipboard }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }) }))

const wrappers: VueWrapper[] = []
function flow(props: Record<string, unknown> = {}) {
  const wrapper = mount(OAuthAuthorizationFlow, { props: { addMethod: 'oauth', ...props }, global: { mocks: { $t: (key: string) => key }, stubs: { Icon: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function action(wrapper: VueWrapper) { return wrapper.get('button.btn-primary') }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function choose(wrapper: VueWrapper, method: AuthInputMethod) { await wrapper.get(`input[type="radio"][value="${method}"]`).setValue() }
// Exercise the public parent/ref contract through an actual parent button.
const Parent = defineComponent({
  components: { OAuthAuthorizationFlow },
  setup() { return { flowRef: ref<{ authCode: string; oauthState: string; projectId: string; reset: () => void }>(), snapshot: ref('') } },
  template: `<div><OAuthAuthorizationFlow ref="flowRef" add-method="oauth" platform="openai" auth-url="https://synthetic.example/authorize"/>
    <button data-test="complete" @click="snapshot = JSON.stringify({ code: flowRef.authCode, state: flowRef.oauthState, project: flowRef.projectId })">complete</button>
    <button data-test="reset" @click="flowRef.reset()">reset</button><output>{{ snapshot }}</output></div>`
})
function publicFlow() {
  const wrapper = mount(Parent, { global: { mocks: { $t: (key: string) => key }, stubs: { Icon: true } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => { getCapabilities.mockReset().mockResolvedValue({ password_auth_enabled: true }); copyToClipboard.mockReset() })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('OAuthAuthorizationFlow method and credential contracts', () => {
  it.each([
    ['cookie', {}, 'cookie-auth', 'admin.accounts.oauth.sessionKeyPlaceholderSingle', '  synthetic-cookie  ', '  synthetic-cookie  '],
    ['refresh_token', { platform: 'openai', showRefreshTokenOption: true }, 'validate-refresh-token', 'admin.accounts.oauth.openai.refreshTokenPlaceholder', '  synthetic-rt\n synthetic-rt-2  ', 'synthetic-rt\n synthetic-rt-2'],
    ['mobile_refresh_token', { platform: 'openai', showMobileRefreshTokenOption: true }, 'validate-mobile-refresh-token', 'admin.accounts.oauth.openai.refreshTokenPlaceholder', '  synthetic-mobile-rt  ', 'synthetic-mobile-rt'],
    ['sso_cookie', { platform: 'grok', showSsoOption: true }, 'import-sso', 'admin.accounts.oauth.grok.ssoCookiePlaceholder', '  synthetic-sso\nsynthetic-sso-2 ', 'synthetic-sso\nsynthetic-sso-2'],
    ['codex_session', { platform: 'openai', showCodexSessionImportOption: true }, 'import-codex-session', 'admin.accounts.oauth.openai.codexSessionPlaceholder', '  {"tokens":{"access_token":"synthetic-access"}}  ', '{"tokens":{"access_token":"synthetic-access"}}'],
    ['agent_identity', { platform: 'openai', showAgentIdentityOption: true }, 'import-codex-session', 'admin.accounts.oauth.openai.agentIdentityPlaceholder', '  {"agent_identity":{"id":"synthetic-agent"}}  ', '{"agent_identity":{"id":"synthetic-agent"}}'],
    ['codex_pat', { platform: 'openai', showCodexPatOption: true }, 'import-codex-pat', 'admin.accounts.oauth.openai.codexPatPlaceholder', '  synthetic-pat  ', 'synthetic-pat']
  ] as const)('selects %s exclusively and emits the exact parent payload', async (method, props, event, placeholder, content, expected) => {
    const wrapper = flow(props)
    await choose(wrapper, method)
    expect(wrapper.emitted('update:inputMethod')).toEqual([[method]])
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    const input = wrapper.get('textarea')
    expect(input.attributes('placeholder')).toBe(placeholder)
    expect(action(wrapper).attributes('disabled')).toBeDefined()
    await action(wrapper).trigger('click')
    expect(wrapper.emitted(event)).toBeUndefined()
    await input.setValue(content)
    expect(action(wrapper).attributes('disabled')).toBeUndefined()
    await action(wrapper).trigger('click')
    expect(wrapper.emitted(event)).toEqual([[expected]])
    await wrapper.setProps({ loading: true, error: 'synthetic retryable error' })
    expect(action(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('synthetic retryable error')
    await action(wrapper).trigger('click')
    expect(wrapper.emitted(event)).toHaveLength(1)
    await wrapper.setProps({ loading: false, error: '' })
    await action(wrapper).trigger('click')
    expect(wrapper.emitted(event)).toHaveLength(2)
  })

  it.each([
    ['refresh_token', { platform: 'openai', showRefreshTokenOption: true }, 'synthetic-one\n\nsynthetic-two'],
    ['sso_cookie', { platform: 'grok', showSsoOption: true }, 'synthetic-one\n\nsynthetic-two'],
    ['codex_session', { platform: 'openai', showCodexSessionImportOption: true }, 'synthetic-one\n\nsynthetic-two'],
    ['cookie', { allowMultiple: true }, 'synthetic-one\n\nsynthetic-two']
  ] as const)('counts nonblank batch lines for %s', async (method, props, content) => {
    const wrapper = flow(props)
    await choose(wrapper, method)
    await wrapper.get('textarea').setValue(content)
    expect(wrapper.text()).toContain('admin.accounts.oauth.keysCount {"count":2}')
  })

  it('treats a pretty-printed Codex JSON object as one import', async () => {
    const wrapper = flow({ showCodexSessionImportOption: true })
    await choose(wrapper, 'codex_session')
    await wrapper.get('textarea').setValue('{\n "tokens": {\n "access_token": "synthetic"\n }\n}')
    expect(wrapper.text()).not.toContain('admin.accounts.oauth.keysCount')
    expect(action(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('preserves cookie draft while switching, and keeps the help panel keyboard reachable', async () => {
    const wrapper = flow({ allowMultiple: true })
    await choose(wrapper, 'cookie')
    await wrapper.get('textarea').setValue('synthetic-cookie')
    const help = wrapper.get('label button')
    expect(help.attributes('type')).toBe('button')
    await help.trigger('click')
    expect(wrapper.text()).toContain('admin.accounts.oauth.howToGetSessionKey')
    await choose(wrapper, 'manual')
    expect(wrapper.find('textarea').attributes('placeholder')).not.toContain('sessionKey')
    await choose(wrapper, 'cookie')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('synthetic-cookie')
    await help.trigger('click')
    expect(wrapper.text()).not.toContain('admin.accounts.oauth.howToGetSessionKey')
  })

  it('uses a unique native radio group and links every editable input to its visible label', async () => {
    const pair = mount(defineComponent({ components: { OAuthAuthorizationFlow }, template: '<div><OAuthAuthorizationFlow add-method="oauth" show-refresh-token-option/><OAuthAuthorizationFlow add-method="oauth" show-refresh-token-option/></div>' }), { global: { stubs: { Icon: true } } })
    wrappers.push(pair)
    const [first, second] = pair.findAllComponents(OAuthAuthorizationFlow)
    const names = first.findAll('input[type="radio"]').map(input => input.attributes('name'))
    expect(names.every(Boolean)).toBe(true)
    expect(new Set(names).size).toBe(1)
    expect(second.get('input[type="radio"]').attributes('name')).not.toBe(names[0])
    await choose(first, 'refresh_token')
    const input = first.get('textarea')
    expect(input.attributes('id')).toBeTruthy()
    expect(first.find(`label[for="${input.attributes('id')}"]`).text()).toContain('Refresh Token')
    expect(first.get('[role="radiogroup"]').attributes('aria-labelledby')).toBeTruthy()
  })

  it('selects the only enabled method even when manual is hidden', () => {
    const wrapper = flow({ showManualOption: false, showCookieOption: false, showSsoOption: true, platform: 'grok' })
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('admin.accounts.oauth.grok.ssoCookiePlaceholder')
    expect(wrapper.find('button.btn-primary').text()).toContain('admin.accounts.oauth.grok.convertSSOAndCreate')
  })

  it('returns to an available method when the selected option is disabled', async () => {
    const wrapper = flow({ showRefreshTokenOption: true, platform: 'openai' })
    await choose(wrapper, 'refresh_token')
    await wrapper.setProps({ showRefreshTokenOption: false })
    expect(wrapper.get('input[value="manual"]').element).toHaveProperty('checked', true)
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('admin.accounts.oauth.openai.authCodePlaceholder')
    expect(wrapper.emitted('update:inputMethod')?.at(-1)).toEqual(['manual'])
  })
})

describe('OAuthAuthorizationFlow manual and PKCE parent contract', () => {
  it.each(['anthropic', 'openai', 'gemini', 'antigravity', 'grok'])('shows %s instructions and generates/copies/regenerates its URL', async (platform) => {
    const wrapper = flow({ platform })
    const prefix = platform === 'anthropic' ? 'admin.accounts.oauth' : `admin.accounts.oauth.${platform}`
    expect(wrapper.text()).toContain(`${prefix}.title`)
    await action(wrapper).trigger('click')
    expect(wrapper.emitted('generate-url')).toEqual([[]])
    const authUrl = `https://synthetic.example/${platform}/authorize`
    await wrapper.setProps({ authUrl })
    expect((wrapper.get('input[readonly]').element as HTMLInputElement).value).toBe(authUrl)
    await wrapper.get('button[title="Copy URL"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith(authUrl, 'URL copied to clipboard')
    await wrapper.get('textarea').setValue('synthetic-code')
    const regenerate = wrapper.findAll('button').find(button => button.text().includes('admin.accounts.oauth.regenerate'))!
    await regenerate.trigger('click')
    expect(wrapper.emitted('generate-url')).toHaveLength(2)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.text().includes('admin.accounts.oauth.proxyWarning')).toBe(platform !== 'openai' && platform !== 'grok')
  })

  it.each([
    ['http://localhost:1455/auth/callback?code=synthetic%2Bcode&state=synthetic%2Fstate', 'synthetic+code', 'synthetic/state'],
    ['code=synthetic-code&state=synthetic-state', 'synthetic-code', 'synthetic-state'],
    ['?code=synthetic%2Bcode&state=synthetic%2Fstate', 'synthetic+code', 'synthetic/state']
  ])('extracts the exact code and state for the parent from %s', async (content, code, state) => {
    const wrapper = publicFlow()
    await wrapper.get('textarea').setValue(content)
    await wrapper.get('[data-test="complete"]').trigger('click')
    expect(JSON.parse(wrapper.get('output').text())).toEqual({ code, state, project: '' })
  })

  it('clears the previous callback state when requesting a new PKCE session', async () => {
    const wrapper = publicFlow()
    await wrapper.get('textarea').setValue('http://localhost:1455/auth/callback?code=synthetic-code&state=previous-state')
    await wrapper.findAll('button').find(button => button.text().includes('admin.accounts.oauth.regenerate'))!.trigger('click')
    await wrapper.get('[data-test="complete"]').trigger('click')
    expect(JSON.parse(wrapper.get('output').text())).toEqual({ code: '', state: '', project: '' })
  })

  it('clears all public authorization data through the parent reset action', async () => {
    const wrapper = publicFlow()
    await wrapper.get('textarea').setValue('http://localhost:1455/auth/callback?code=synthetic-code&state=synthetic-state')
    await wrapper.get('[data-test="reset"]').trigger('click')
    await wrapper.get('[data-test="complete"]').trigger('click')
    expect(JSON.parse(wrapper.get('output').text())).toEqual({ code: '', state: '', project: '' })
  })

  it('shows Gemini project input only for the requested authorization mode', async () => {
    const wrapper = flow({ platform: 'gemini' })
    const project = wrapper.get('input[type="text"]')
    expect(project.attributes('placeholder')).toBe('admin.accounts.oauth.gemini.projectIdPlaceholder')
    await project.setValue('synthetic-project')
    await wrapper.setProps({ showProjectId: false })
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    await wrapper.setProps({ showProjectId: true })
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('synthetic-project')
  })

  it('locks method changes and regeneration while a request is pending', async () => {
    const wrapper = flow({ loading: true, authUrl: 'https://synthetic.example/authorize' })
    expect(wrapper.findAll('input[type="radio"]').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    const regenerate = wrapper.findAll('button').find(button => button.text().includes('admin.accounts.oauth.regenerate'))!
    expect(regenerate.attributes('disabled')).toBeDefined()
    await regenerate.trigger('click')
    expect(wrapper.emitted('generate-url')).toBeUndefined()
  })
})

describe('OAuthAuthorizationFlow password capability', () => {
  it('keeps password mode hidden until the capability succeeds, preserving password bytes in the emit', async () => {
    const pending = deferred<{ password_auth_enabled: boolean }>()
    getCapabilities.mockReturnValueOnce(pending.promise)
    const wrapper = flow({ platform: 'grok', showEmailPasswordOption: true })
    expect(wrapper.find('input[value="email_password"]').exists()).toBe(false)
    pending.resolve({ password_auth_enabled: true })
    await flushPromises()
    await choose(wrapper, 'email_password')
    const content = ' synthetic@example.invalid----  pass with spaces  \nsecond@example.invalid----synthetic '
    await wrapper.get('textarea').setValue(content)
    expect(wrapper.text()).toContain('admin.accounts.oauth.keysCount {"count":2}')
    await action(wrapper).trigger('click')
    expect(wrapper.emitted('authorize-password')).toEqual([[content]])
    expect(wrapper.get('textarea').attributes('autocomplete')).toBe('off')
  })

  it.each([false, 'error'])('fails closed for password capability %s', async (capability) => {
    if (capability === 'error') getCapabilities.mockRejectedValueOnce(new Error('synthetic capability failure'))
    else getCapabilities.mockResolvedValueOnce({ password_auth_enabled: false })
    const wrapper = flow({ platform: 'grok', showEmailPasswordOption: true })
    await flushPromises()
    expect(wrapper.find('input[value="email_password"]').exists()).toBe(false)
    expect(wrapper.get('input[value="manual"]').element).toHaveProperty('checked', true)
  })

  it('does not let an earlier capability lookup enable a later disabled flow', async () => {
    const old = deferred<{ password_auth_enabled: boolean }>()
    getCapabilities.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ password_auth_enabled: false })
    const wrapper = flow({ platform: 'grok', showEmailPasswordOption: true })
    await wrapper.setProps({ showEmailPasswordOption: false })
    await wrapper.setProps({ showEmailPasswordOption: true })
    await flushPromises()
    old.resolve({ password_auth_enabled: true })
    await flushPromises()
    expect(wrapper.find('input[value="email_password"]').exists()).toBe(false)
  })

  it('prefills email only while empty and never overwrites typed credentials', async () => {
    const wrapper = flow({ platform: 'grok', showEmailPasswordOption: true, initialEmailPassword: 'first@example.invalid----' })
    await flushPromises()
    await choose(wrapper, 'email_password')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('first@example.invalid----')
    await wrapper.get('textarea').setValue('typed@example.invalid----synthetic-password')
    await wrapper.setProps({ initialEmailPassword: 'next@example.invalid----' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('typed@example.invalid----synthetic-password')
    await wrapper.get('textarea').setValue('')
    await wrapper.setProps({ initialEmailPassword: 'empty@example.invalid----' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('empty@example.invalid----')
  })
})
