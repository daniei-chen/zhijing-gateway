import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import CreateAccountModal from '../CreateAccountModal.vue'

const { create, checkRisk, probe, sync, generate, token, sso, sessionImport, patImport, showError, showWarning, showSuccess } = vi.hoisted(() => ({
  create: vi.fn(), checkRisk: vi.fn(), probe: vi.fn(), sync: vi.fn(), generate: vi.fn(), token: vi.fn(), sso: vi.fn(), sessionImport: vi.fn(), patImport: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { create, checkMixedChannelRisk: checkRisk, probeUpstreamBilling: probe, syncUpstreamModels: sync, generateAuthUrl: generate, exchangeCode: token, refreshOpenAIToken: token, importCodexSession: sessionImport, createOpenAICodexPAT: patImport },
  gemini: { generateAuthUrl: generate, exchangeCode: token, getCapabilities: vi.fn().mockResolvedValue({ ai_studio_oauth_enabled: false }) },
  antigravity: { generateAuthUrl: generate, exchangeCode: token, refreshAntigravityToken: token },
  grok: { generateAuthUrl: generate, exchangeCode: token, refreshGrokToken: token, createFromSSO: sso },
  settings: { getSettings: vi.fn().mockResolvedValue({}), getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }) },
  tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([]) }
} }))
vi.mock('@/api/admin/accounts', () => ({ getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess, showWarning, showInfo: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

const Dialog = defineComponent({ props: ['show'], emits: ['close'], template: '<div v-if="show"><button data-testid="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>' })
const Confirm = defineComponent({ props: ['show'], emits: ['confirm', 'cancel'], template: '<div v-if="show" data-testid="risk-dialog"><button data-testid="confirm" @click="$emit(\'confirm\')">confirm</button><button data-testid="cancel-risk" @click="$emit(\'cancel\')">cancel</button></div>' })
const OAuth = defineComponent({
  name: 'OAuthAuthorizationFlow', props: ['loading', 'error', 'showRefreshTokenOption', 'showMobileRefreshTokenOption', 'showSsoOption', 'showCodexSessionImportOption', 'showCodexPatOption', 'showCookieOption'],
  emits: ['generate-url', 'validate-refresh-token', 'validate-mobile-refresh-token', 'import-sso', 'import-codex-session', 'import-codex-pat', 'cookie-auth'],
  data: () => ({ authCode: '', oauthState: 'synthetic-state', inputMethod: 'manual' }), methods: { reset() { this.authCode = '' } },
  template: `<div data-testid="oauth-step"><textarea data-testid="oauth-input" v-model="authCode"/><span data-testid="oauth-error">{{ error }}</span>
    <button data-testid="generate-url" :disabled="loading" @click="$emit('generate-url')">url</button>
    <button v-if="showRefreshTokenOption" data-testid="validate-rt" :disabled="loading" @click="$emit('validate-refresh-token', authCode)">rt</button>
    <button v-if="showMobileRefreshTokenOption" data-testid="validate-mobile-rt" :disabled="loading" @click="$emit('validate-mobile-refresh-token', authCode)">mobile rt</button>
    <button v-if="showSsoOption" data-testid="import-sso" :disabled="loading" @click="$emit('import-sso', authCode)">sso</button>
    <button v-if="showCodexSessionImportOption" data-testid="import-session" :disabled="loading" @click="$emit('import-codex-session', authCode)">session</button>
    <button v-if="showCodexPatOption" data-testid="import-pat" :disabled="loading" @click="$emit('import-codex-pat', authCode)">pat</button>
    <button v-if="showCookieOption" data-testid="cookie-auth" :disabled="loading" @click="$emit('cookie-auth', authCode)">cookie</button>
  </div>`
})

async function oauthForm(platform: string, realChildren = false) {
  const wrapper = modal(realChildren)
  if (platform !== 'anthropic') await clickText(wrapper, platform === 'antigravity' ? 'Antigravity' : platform === 'gemini' ? 'Gemini' : platform === 'grok' ? 'Grok' : 'OpenAI')
  await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic OAuth')
  await submit(wrapper)
  expect(wrapper.find(realChildren ? 'textarea' : '[data-testid="oauth-step"]').exists()).toBe(true)
  return wrapper
}

describe('CreateAccountModal OAuth workflow', () => {
  it('does not start another authorization URL from an obsolete login view', async () => {
    const sessions = await import('@/api/authSession')
    sessions.replaceAuthSession({ accessToken: 'synthetic-first-login', user: { id: 7 } })
    const wrapper = await oauthForm('openai')
    sessions.replaceAuthSession({ accessToken: 'synthetic-next-login', user: { id: 7 } })
    await wrapper.get('[data-testid="generate-url"]').trigger('click')
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
  })
  it('stops the refresh-token batch when the original login is replaced for the same user', async () => {
    const sessions = await import('@/api/authSession')
    sessions.replaceAuthSession({ accessToken: 'synthetic-original-login', user: { id: 7 } })
    const pending = deferred<any>()
    token.mockReturnValueOnce(pending.promise)
    const wrapper = await oauthForm('openai')
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-first-rt\nsynthetic-second-rt')
    await wrapper.get('[data-testid="validate-rt"]').trigger('click')
    sessions.replaceAuthSession({ accessToken: 'synthetic-replacement-login', user: { id: 7 } })
    pending.reject(new sessions.AuthSessionChangedError())
    await flushPromises()
    // These are scheduling assertions; the real client independently rejects old-session requests.
    expect(token).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).not.toHaveBeenCalled()
  })
  it.each(['openai', 'grok', 'antigravity'])('creates %s refresh-token batches with numbered names', async (platform) => {
    const wrapper = await oauthForm(platform)
    await wrapper.get('[data-testid="oauth-input"]').setValue('  synthetic-rt-1  \n\n synthetic-rt-2 ')
    await wrapper.get('[data-testid="validate-rt"]').trigger('click')
    await flushPromises()
    expect(token).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls.map(call => call[0].name)).toEqual(['Synthetic OAuth #1', 'Synthetic OAuth #2'])
    expect(create.mock.calls[0][0]).toMatchObject({ platform, type: 'oauth', credentials: { access_token: 'synthetic-access' } })
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.oauth.batchSuccess')
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each(['openai', 'grok', 'antigravity'])('retains %s token input when only part of a batch succeeds', async (platform) => {
    token.mockRejectedValueOnce({ message: 'synthetic token rejected' })
    const wrapper = await oauthForm(platform)
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-bad\nsynthetic-good')
    await wrapper.get('[data-testid="validate-rt"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].name).toBe('Synthetic OAuth #2')
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.oauth.batchPartialSuccess')
    expect(wrapper.emitted('created')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('[data-testid="oauth-error"]').text()).toContain('#1:')
  })

  it('uses the mobile OAuth client id for the explicit mobile refresh token option', async () => {
    const wrapper = await oauthForm('openai')
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-mobile-rt')
    await wrapper.get('[data-testid="validate-mobile-rt"]').trigger('click')
    await flushPromises()
    expect(token).toHaveBeenCalledWith('synthetic-mobile-rt', null, '/admin/openai/refresh-token', 'app_LlGpXReQgckcGGUo2JrYvtJK')
    expect(create.mock.calls[0][0].credentials.client_id).toBe('app_LlGpXReQgckcGGUo2JrYvtJK')
  })

  it.each(['openai', 'gemini', 'antigravity', 'grok', 'anthropic'])('exchanges a %s authorization code into its own account type', async (platform) => {
    const wrapper = await oauthForm(platform)
    await wrapper.get('[data-testid="generate-url"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="oauth-input"]').setValue(' synthetic-code ')
    await clickText(wrapper, 'admin.accounts.oauth.completeAuth')
    await flushPromises()
    expect(token).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ platform, type: 'oauth', name: 'Synthetic OAuth', credentials: { access_token: 'synthetic-access' } })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each(['openai', 'gemini', 'antigravity', 'grok', 'anthropic'])('does not create from a %s code exchange completed after navigating back', async (platform) => {
    const request = deferred<any>()
    token.mockReturnValueOnce(request.promise)
    const wrapper = await oauthForm(platform)
    await wrapper.get('[data-testid="generate-url"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-code')
    await clickText(wrapper, 'admin.accounts.oauth.completeAuth')
    await clickText(wrapper, 'common.back')
    request.resolve({ access_token: 'old-access', refresh_token: 'old-refresh' })
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it.each(['openai', 'grok', 'antigravity'])('stops the %s token batch before creating with a reopened draft', async (platform) => {
    const request = deferred<any>()
    token.mockReturnValueOnce(request.promise)
    const wrapper = await oauthForm(platform)
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-old-rt\nsynthetic-next-rt')
    await wrapper.get('[data-testid="validate-rt"]').trigger('click')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    request.resolve({ access_token: 'old-access', refresh_token: 'old-refresh' })
    await flushPromises()
    expect(token).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['import-sso', 'import-session', 'import-pat'])('does not close a new draft when %s completes late', async (action) => {
    const request = deferred<any>()
    const endpoint = action === 'import-sso' ? sso : action === 'import-session' ? sessionImport : patImport
    endpoint.mockReturnValueOnce(request.promise)
    const wrapper = await oauthForm(action === 'import-sso' ? 'grok' : 'openai')
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-import')
    await wrapper.get(`[data-testid="${action}"]`).trigger('click')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    request.resolve(action === 'import-sso' ? { created: [{ id: 42 }], failed: [] } : { created: 1, updated: 0, skipped: 0, failed: 0 })
    await flushPromises()
    expect(endpoint).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('stops a cookie batch when the previous authorization view has closed', async () => {
    const request = deferred<any>()
    token.mockReturnValueOnce(request.promise)
    const wrapper = await oauthForm('anthropic')
    await wrapper.get('[data-testid="oauth-input"]').setValue('synthetic-key-1\nsynthetic-key-2')
    await wrapper.get('[data-testid="cookie-auth"]').trigger('click')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    request.resolve({ access_token: 'old-access' })
    await flushPromises()
    expect(token).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
  })
})
const Models = defineComponent({ emits: ['update:modelValue', 'upstream-synced'], template: '<button data-testid="preview-models" @click="$emit(\'update:modelValue\', [\'synthetic-model\']); $emit(\'upstream-synced\')">models</button>' })
const wrappers: VueWrapper[] = []
function modal(realChildren = false) {
  const wrapper = mount(CreateAccountModal, { props: { show: true, groups: [], proxies: [] }, global: { mocks: { $t: (key: string) => key }, stubs: {
    BaseDialog: Dialog, ConfirmDialog: Confirm, OAuthAuthorizationFlow: realChildren ? false : OAuth, Select: realChildren ? false : true, Icon: true, PlatformIcon: true,
    GroupSelector: true, ProxySelector: true, ProxyAdBanner: true, QuotaLimitCard: true, ModelWhitelistSelector: Models
  } } })
  wrappers.push(wrapper)
  return wrapper
}
async function clickText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text().includes(text))
  expect(button, text).toBeDefined()
  await button!.trigger('click')
}
function field(wrapper: VueWrapper, labelText: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === labelText)
  expect(label, labelText).toBeDefined()
  const element = label!.element.parentElement!.querySelector('input, select, textarea')
  expect(element, labelText).not.toBeNull()
  return new DOMWrapper(element!)
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
async function apiKeyForm() {
  const wrapper = modal()
  await clickText(wrapper, 'OpenAI')
  await clickText(wrapper, 'API Key')
  await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic key')
  await wrapper.get('input[type="password"]').setValue('synthetic-key')
  return wrapper
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  create.mockReset().mockResolvedValue({ id: 42, type: 'apikey', platform: 'openai' })
  checkRisk.mockReset().mockResolvedValue({ has_risk: false })
  probe.mockReset().mockResolvedValue({})
  sync.mockReset().mockResolvedValue({ models: [], warnings: [] })
  generate.mockReset().mockResolvedValue({ auth_url: 'https://synthetic.example/oauth?state=synthetic-state', session_id: 'synthetic-session', state: 'synthetic-state' })
  token.mockReset().mockResolvedValue({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', email: 'synthetic@example.invalid' })
  sso.mockReset().mockResolvedValue({ created: [{ id: 42 }], failed: [] })
  sessionImport.mockReset().mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, errors: [], warnings: [] })
  patImport.mockReset().mockResolvedValue({ id: 42 })
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('CreateAccountModal with the real OAuth authorization controls', () => {
  it.each(['openai', 'gemini', 'antigravity', 'grok'])('submits the decoded callback code and PKCE state through %s', async (platform) => {
    const wrapper = await oauthForm(platform, true)
    const generateButton = wrapper.findAll('button').find(button => button.text().includes('generateAuthUrl'))!
    await generateButton.trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('http://localhost/callback?code=synthetic%2Bcode&state=synthetic%2Fstate')
    await clickText(wrapper, 'admin.accounts.oauth.completeAuth')
    await flushPromises()
    expect(token).toHaveBeenCalledOnce()
    const exchangePayload = token.mock.calls[0].find(arg => arg && typeof arg === 'object' && 'code' in arg)
    expect(exchangePayload).toMatchObject({ code: 'synthetic+code', state: 'synthetic/state', session_id: 'synthetic-session' })
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({ platform, type: 'oauth', credentials: { access_token: 'synthetic-access' } })
  })

  it('uses the new generated state after the old callback has been cleared', async () => {
    const wrapper = await oauthForm('openai', true)
    await clickText(wrapper, 'admin.accounts.oauth.openai.generateAuthUrl')
    await flushPromises()
    await wrapper.get('textarea').setValue('http://localhost/callback?code=old-code&state=old-state')
    generate.mockResolvedValueOnce({ auth_url: 'https://synthetic.example/oauth?state=new-state', session_id: 'new-session', state: 'new-state' })
    await clickText(wrapper, 'admin.accounts.oauth.regenerate')
    await flushPromises()
    await wrapper.get('textarea').setValue('new-code')
    await clickText(wrapper, 'admin.accounts.oauth.completeAuth')
    await flushPromises()
    expect(token).toHaveBeenCalledWith('/admin/openai/exchange-code', { code: 'new-code', state: 'new-state', session_id: 'new-session' })
    expect(create).toHaveBeenCalledOnce()
  })

  it.each(['refresh_token', 'mobile_refresh_token', 'codex_session', 'agent_identity', 'codex_pat'])('hides manual completion when the real %s form is selected', async (method) => {
    const wrapper = await oauthForm('openai', true)
    expect(wrapper.findAll('button').some(button => button.text() === 'admin.accounts.oauth.completeAuth')).toBe(true)
    await wrapper.get(`input[value="${method}"]`).setValue(true)
    expect(wrapper.findAll('button').some(button => button.text() === 'admin.accounts.oauth.completeAuth')).toBe(false)
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    await wrapper.get('input[value="manual"]').setValue(true)
    expect(wrapper.findAll('button').some(button => button.text() === 'admin.accounts.oauth.completeAuth')).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it('imports a real SSO input without generating a manual authorization URL', async () => {
    const wrapper = await oauthForm('grok', true)
    await wrapper.get('input[value="sso_cookie"]').setValue(true)
    await wrapper.get('textarea').setValue(' synthetic-sso ')
    await clickText(wrapper, 'admin.accounts.oauth.grok.convertSSOAndCreate')
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
    expect(sso).toHaveBeenCalledOnce()
    expect(sso.mock.calls[0][0]).toMatchObject({ sso_tokens: ['synthetic-sso'] })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('associates the Vertex file label and lets the visible select button open the native picker', async () => {
    const wrapper = modal(true)
    await clickText(wrapper, 'admin.accounts.vertexLabel')
    const file = wrapper.get('input[type="file"]')
    expect(file.attributes('id')).toBeTruthy()
    expect(wrapper.get(`label[for="${file.attributes('id')}"]`).text()).toBe('Service Account JSON')
    const picker = vi.spyOn(file.element as HTMLInputElement, 'click')
    await clickText(wrapper, 'admin.accounts.vertexSaJsonSelectBtn')
    expect(picker).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it('names the real Select trigger through the visible compact mode label and supports keyboard choice', async () => {
    const wrapper = modal(true)
    await clickText(wrapper, 'OpenAI')
    await clickText(wrapper, 'API Key')
    const label = wrapper.findAll('label').find(label => label.text() === 'admin.accounts.openai.compactMode')!
    expect(label.attributes('for')).toBeTruthy()
    const trigger = wrapper.get(`button[id="${label.attributes('for')}"]`)
    expect(trigger.attributes('aria-label')).toBeUndefined()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    expect(trigger.attributes('aria-expanded')).toBe('true')
    await flushPromises()
    const listbox = new DOMWrapper(document.getElementById(trigger.attributes('aria-controls'))!)
    expect(listbox.attributes('aria-activedescendant')).toBeTruthy()
    await listbox.trigger('keydown', { key: 'Enter' })
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(create).not.toHaveBeenCalled()
  })
})

describe('CreateAccountModal creation workflow', () => {
  it('connects the account name, notes, concurrency and expiry labels to their controls', () => {
    const wrapper = modal()
    for (const key of ['admin.accounts.accountName', 'admin.accounts.notes', 'admin.accounts.concurrency', 'admin.accounts.expiresAt']) {
      const label = wrapper.findAll('label').find(label => label.text() === key)!
      const control = field(wrapper, key)
      expect(control.attributes('id'), key).toBeTruthy()
      expect(label.attributes('for'), key).toBe(control.attributes('id'))
    }
  })
  it('requires an OAuth account name before entering authorization', async () => {
    const wrapper = modal()
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.accounts.pleaseEnterAccountName')
    expect(wrapper.find('[data-testid="oauth-step"]').exists()).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an empty API key before sending a request', async () => {
    const wrapper = await apiKeyForm()
    await wrapper.get('input[type="password"]').setValue('   ')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('admin.accounts.pleaseEnterApiKey')
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps draft values on a create failure and allows correcting and retrying', async () => {
    create.mockRejectedValueOnce({ response: { data: { detail: 'synthetic unavailable' } } })
    const wrapper = await apiKeyForm()
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic unavailable')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Corrected name')
    await submit(wrapper)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0]).toMatchObject({ name: 'Corrected name', credentials: { api_key: 'synthetic-key' } })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each(['probe', 'sync'])('completes creation and warns when the post-create %s fails', async (kind) => {
    const wrapper = await apiKeyForm()
    if (kind === 'probe') probe.mockRejectedValueOnce(new Error('probe unavailable'))
    else { await wrapper.get('[data-testid="preview-models"]').trigger('click'); sync.mockRejectedValueOnce(new Error('sync unavailable')) }
    await submit(wrapper)
    expect(create).toHaveBeenCalledTimes(1)
    expect(showWarning).toHaveBeenCalledWith(kind === 'probe' ? 'admin.accounts.upstreamBilling.probeFailed' : 'admin.accounts.syncUpstreamModelsFailed')
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.accountCreated')
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('does not start a billing probe after the model-sync await loses its original login', async () => {
    const sessions = await import('@/api/authSession')
    sessions.replaceAuthSession({ accessToken: 'synthetic-create-owner-a', user: { id: 7 } })
    const pendingSync = deferred<any>()
    sync.mockReturnValueOnce(pendingSync.promise)
    const wrapper = await apiKeyForm()
    await wrapper.get('[data-testid="preview-models"]').trigger('click')
    await submit(wrapper)
    expect(create).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledOnce()
    expect(probe).not.toHaveBeenCalled()
    sessions.replaceAuthSession({ accessToken: 'synthetic-create-owner-b', user: { id: 7 } })
    pendingSync.reject(new sessions.AuthSessionChangedError())
    await flushPromises()
    expect(probe).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('asks for mixed-channel consent before advancing and cancellation keeps basic information', async () => {
    checkRisk.mockResolvedValue({ has_risk: true, message: 'synthetic risk' })
    const wrapper = modal()
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic OAuth')
    await submit(wrapper)
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="oauth-step"]').exists()).toBe(false)
    await wrapper.get('[data-testid="cancel-risk"]').trigger('click')
    expect(wrapper.get<HTMLInputElement>('input[placeholder="admin.accounts.enterAccountName"]').element.value).toBe('Synthetic OAuth')
    await submit(wrapper)
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="oauth-step"]').exists()).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps basic information open when the mixed-channel precheck fails', async () => {
    checkRisk.mockRejectedValueOnce({ response: { data: { message: 'synthetic precheck failure' } } })
    const wrapper = modal()
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic OAuth')
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic precheck failure')
    expect(wrapper.find('[data-testid="oauth-step"]').exists()).toBe(false)
    await submit(wrapper)
    expect(wrapper.find('[data-testid="oauth-step"]').exists()).toBe(true)
  })

  it('validates SigV4 credentials and submits trimmed Bedrock credentials', async () => {
    const wrapper = modal()
    await clickText(wrapper, 'admin.accounts.bedrockLabel')
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic Bedrock')
    await submit(wrapper)
    expect(showError).toHaveBeenLastCalledWith('admin.accounts.bedrockAccessKeyIdRequired')
    await field(wrapper, 'admin.accounts.bedrockAccessKeyId').setValue(' SYNTHETIC_ACCESS ')
    await submit(wrapper)
    expect(showError).toHaveBeenLastCalledWith('admin.accounts.bedrockSecretAccessKeyRequired')
    await field(wrapper, 'admin.accounts.bedrockSecretAccessKey').setValue(' synthetic-secret ')
    await field(wrapper, 'admin.accounts.bedrockSessionToken').setValue(' synthetic-session ')
    await field(wrapper, 'admin.accounts.bedrockRegion').setValue('eu-west-1')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await submit(wrapper)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ platform: 'anthropic', type: 'bedrock', credentials: {
      auth_mode: 'sigv4', aws_access_key_id: 'SYNTHETIC_ACCESS', aws_secret_access_key: 'synthetic-secret', aws_session_token: 'synthetic-session', aws_region: 'eu-west-1', aws_force_global: 'true'
    } })
    expect(probe).not.toHaveBeenCalled()
  })

  it('supports Bedrock API key authentication without including SigV4 secrets', async () => {
    const wrapper = modal()
    await clickText(wrapper, 'admin.accounts.bedrockLabel')
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic Bedrock key')
    await wrapper.get('input[type="radio"][value="apikey"]').setValue(true)
    await submit(wrapper)
    expect(showError).toHaveBeenLastCalledWith('admin.accounts.bedrockApiKeyRequired')
    await field(wrapper, 'admin.accounts.bedrockApiKeyInput').setValue(' synthetic-bedrock-key ')
    await submit(wrapper)
    expect(create.mock.calls[0][0]).toMatchObject({ type: 'bedrock', credentials: { auth_mode: 'apikey', api_key: 'synthetic-bedrock-key' } })
    expect(create.mock.calls[0][0].credentials).not.toHaveProperty('aws_access_key_id')
  })

  it.each([
    ['{broken', 'admin.accounts.vertexSaJsonInvalid'],
    [JSON.stringify({ project_id: 'synthetic-project' }), 'admin.accounts.vertexSaJsonMissingFields']
  ])('rejects invalid uploaded Vertex JSON and permits a valid replacement', async (content, error) => {
    const wrapper = modal()
    await clickText(wrapper, 'admin.accounts.vertexLabel')
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic Vertex')
    const input = wrapper.get('input[type="file"]')
    const upload = async (text: string) => {
      Object.defineProperty(input.element, 'files', { configurable: true, value: [{ text: () => Promise.resolve(text) }] })
      await input.trigger('change'); await flushPromises()
    }
    await upload(content)
    expect(showError).toHaveBeenCalledWith(error)
    expect(create).not.toHaveBeenCalled()
    const valid = JSON.stringify({ project_id: 'synthetic-project', client_email: 'synthetic@example.invalid', private_key: 'synthetic-private-key' })
    await upload(valid)
    await submit(wrapper)
    expect(create.mock.calls[0][0]).toMatchObject({ platform: 'anthropic', type: 'service_account', credentials: { service_account_json: valid, project_id: 'synthetic-project', client_email: 'synthetic@example.invalid', location: 'global', tier_id: 'vertex' } })
  })

  it('prevents duplicate create requests while the original write is pending', async () => {
    const request = deferred<any>()
    create.mockReturnValueOnce(request.promise)
    const wrapper = await apiKeyForm()
    await submit(wrapper)
    await submit(wrapper)
    expect(create).toHaveBeenCalledTimes(1)
    request.resolve({ id: 42 })
    await flushPromises()
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each(['close', 'provider', 'unmount'])('ignores an OAuth precheck that arrives after %s', async (change) => {
    const request = deferred<any>()
    checkRisk.mockReturnValueOnce(request.promise)
    const wrapper = modal()
    await wrapper.get('input[placeholder="admin.accounts.enterAccountName"]').setValue('Synthetic OAuth')
    await submit(wrapper)
    if (change === 'close') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'provider') await clickText(wrapper, 'OpenAI')
    if (change === 'unmount') wrapper.unmount()
    request.resolve({ has_risk: true })
    await flushPromises()
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'])('does not let an old create %s close or notify the reopened form', async (outcome) => {
    const request = deferred<any>()
    create.mockReturnValueOnce(request.promise)
    const wrapper = await apiKeyForm()
    await submit(wrapper)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    if (outcome === 'success') request.resolve({ id: 42 })
    else request.reject({ response: { data: { message: 'old failure' } } })
    await flushPromises()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it('does not let a prior post-create probe close a new creation form', async () => {
    const request = deferred<any>()
    probe.mockReturnValueOnce(request.promise)
    const wrapper = await apiKeyForm()
    await submit(wrapper)
    expect(create).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    request.resolve({})
    await flushPromises()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('does not apply an uploaded service account file after changing providers', async () => {
    const request = deferred<string>()
    const wrapper = modal()
    await clickText(wrapper, 'admin.accounts.vertexLabel')
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [{ text: () => request.promise }] })
    await input.trigger('change')
    await clickText(wrapper, 'OpenAI')
    request.resolve('{broken')
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })
})
