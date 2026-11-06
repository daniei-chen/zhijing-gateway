import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { AxiosError } from 'axios'
import CreateAccountModal from '../CreateAccountModal.vue'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({ create: vi.fn(), risk: vi.fn(), probe: vi.fn(), sync: vi.fn(), generate: vi.fn(), exchange: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { create: mocks.create, checkMixedChannelRisk: mocks.risk, probeUpstreamBilling: mocks.probe,
    syncUpstreamModels: mocks.sync, generateAuthUrl: mocks.generate, exchangeCode: mocks.exchange },
  gemini: { getCapabilities: vi.fn().mockResolvedValue({ ai_studio_oauth_enabled: false }) },
  settings: { getSettings: vi.fn().mockResolvedValue({}), getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }) },
  tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([]) },
} }))
vi.mock('@/api/admin/accounts', async () => ({
  ...await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts'),
  getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.error, showSuccess: mocks.success, showWarning: mocks.warning, showInfo: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const Models = defineComponent({ props: ['modelValue'], template: '<div data-testid="model-selector">{{ modelValue }}</div>' })
const wrappers: VueWrapper[] = []
function render(realGroups = false) {
  const groups = realGroups ? [{ id: 11, name: 'Synthetic shared group', platform: 'anthropic', status: 'active', rate_multiplier: 1 }] : []
  const wrapper = mount(CreateAccountModal, { attachTo: document.body, props: { show: true, groups: groups as any, proxies: [] }, global: {
    mocks: { $t: (key: string) => key }, stubs: { teleport: true, Icon: true, PlatformIcon: true, GroupSelector: realGroups ? false : true, ProxySelector: true, ProxyAdBanner: true, QuotaLimitCard: true, ModelWhitelistSelector: Models },
  } })
  wrappers.push(wrapper)
  return wrapper
}
const button = (wrapper: VueWrapper, text: string) => {
  const found = wrapper.findAll('button').find(candidate => candidate.text().includes(text))
  expect(found, `DOM button ${text}`).toBeDefined()
  return found!
}
function field(wrapper: VueWrapper, name: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === name && candidate.attributes('for'))
  expect(label, `label ${name}`).toBeDefined()
  const control = document.getElementById(label!.attributes('for'))
  expect(control, `control ${name}`).not.toBeNull()
  return new DOMWrapper(control!)
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
async function apiKeyForm(platform: string, realGroups = false) {
  const wrapper = render(realGroups)
  await button(wrapper, platform).trigger('click')
  if (platform !== 'TypeSafe') {
    const category = platform === 'Anthropic' ? 'admin.accounts.claudeConsole'
      : platform === 'Gemini' ? 'admin.accounts.gemini.accountType.apiKeyTitle' : 'API Key'
    await button(wrapper, category).trigger('click')
  }
  await field(wrapper, 'admin.accounts.accountName').setValue(`Synthetic ${platform}`)
  await field(wrapper, 'admin.accounts.apiKeyRequired').setValue('  synthetic-key  ')
  return wrapper
}
async function bedrockForm(mode: 'sigv4' | 'apikey' = 'sigv4') {
  const wrapper = render()
  await button(wrapper, 'admin.accounts.bedrockLabel').trigger('click')
  await field(wrapper, 'admin.accounts.accountName').setValue('Synthetic Bedrock')
  if (mode === 'apikey') {
    await wrapper.get('input[type="radio"][value="apikey"]').setValue(true)
    await field(wrapper, 'admin.accounts.bedrockApiKeyInput').setValue(' synthetic-bedrock-key ')
  } else {
    await field(wrapper, 'admin.accounts.bedrockAccessKeyId').setValue(' SYNTHETIC_ACCESS ')
    await field(wrapper, 'admin.accounts.bedrockSecretAccessKey').setValue(' synthetic-secret ')
  }
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-provider-admin', user: { id: 7 } })
  mocks.create.mockReset().mockImplementation(payload => Promise.resolve({ ...payload, id: 42 }))
  mocks.risk.mockReset().mockResolvedValue({ has_risk: false })
  mocks.probe.mockReset().mockResolvedValue({})
  mocks.sync.mockReset().mockResolvedValue({ models: [], warnings: [] })
  mocks.generate.mockReset().mockResolvedValue({ auth_url: 'https://example.invalid/oauth?state=synthetic-state', session_id: 'synthetic-session', state: 'synthetic-state' })
  mocks.exchange.mockReset().mockResolvedValue({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('CreateAccountModal normal provider contracts through DOM', () => {
  it.each([
    ['OpenAI', 'openai', 'https://api.openai.com'],
    ['Anthropic', 'anthropic', 'https://api.anthropic.com'],
    ['Gemini', 'gemini', 'https://generativelanguage.googleapis.com'],
    ['Grok', 'grok', 'https://api.x.ai/v1'],
    ['TypeSafe', 'typesafe', 'https://api.typesafe.ai'],
  ])('creates a normal %s API-key account with its supported endpoint', async (label, platform, baseUrl) => {
    const wrapper = await apiKeyForm(label)
    await submit(wrapper)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ platform, type: 'apikey', name: `Synthetic ${label}`,
      credentials: { api_key: 'synthetic-key', base_url: baseUrl } })
    if (platform === 'gemini') expect(mocks.create.mock.calls[0][0].credentials.tier_id).toBe('aistudio_free')
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each(['OpenAI', 'Anthropic'])('keeps the %s Ollama endpoint and corrected draft after a rejected create', async platform => {
    mocks.create.mockRejectedValueOnce({ message: 'synthetic create rejected' })
    const wrapper = await apiKeyForm(platform)
    const baseUrl = platform === 'OpenAI' ? 'https://ollama.com/v1' : 'https://ollama.com'
    await field(wrapper, 'admin.accounts.baseUrl').setValue(` ${baseUrl} `)
    await submit(wrapper)
    expect(mocks.error).toHaveBeenCalledWith('synthetic create rejected')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect((field(wrapper, 'admin.accounts.baseUrl').element as HTMLInputElement).value).toBe(` ${baseUrl} `)
    await field(wrapper, 'admin.accounts.accountName').setValue('Corrected synthetic Ollama')
    await submit(wrapper)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ name: 'Corrected synthetic Ollama', platform: platform.toLowerCase(), type: 'apikey', credentials: { base_url: baseUrl, api_key: 'synthetic-key' } })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('omits a configured model mapping while OpenAI passthrough is selected', async () => {
    const wrapper = await apiKeyForm('OpenAI')
    await button(wrapper, 'admin.accounts.modelMapping').trigger('click')
    await button(wrapper, 'admin.accounts.addMapping').trigger('click')
    await wrapper.get('input[placeholder="admin.accounts.requestModel"]').setValue('synthetic-request')
    await wrapper.get('input[placeholder="admin.accounts.actualModel"]').setValue('synthetic-upstream')
    await wrapper.get('button[aria-label="admin.accounts.openai.oauthPassthrough"]').trigger('click')
    expect(wrapper.text()).toContain('admin.accounts.openai.modelRestrictionDisabledByPassthrough')
    expect(wrapper.find('input[placeholder="admin.accounts.requestModel"]').exists()).toBe(false)
    await submit(wrapper)
    expect(mocks.create.mock.calls[0][0].extra.openai_passthrough).toBe(true)
    expect(mocks.create.mock.calls[0][0].credentials).not.toHaveProperty('model_mapping')
  })

  it('restores the administrator mapping when passthrough is turned back off before creating', async () => {
    const wrapper = await apiKeyForm('OpenAI')
    await button(wrapper, 'admin.accounts.modelMapping').trigger('click')
    await button(wrapper, 'admin.accounts.addMapping').trigger('click')
    await wrapper.get('input[placeholder="admin.accounts.requestModel"]').setValue('synthetic-request')
    await wrapper.get('input[placeholder="admin.accounts.actualModel"]').setValue('synthetic-upstream')
    const passthrough = wrapper.get('button[aria-label="admin.accounts.openai.oauthPassthrough"]')
    await passthrough.trigger('click')
    await passthrough.trigger('click')
    expect((wrapper.get('input[placeholder="admin.accounts.actualModel"]').element as HTMLInputElement).value).toBe('synthetic-upstream')
    await submit(wrapper)
    expect(mocks.create.mock.calls[0][0].credentials.model_mapping).toEqual({ 'synthetic-request': 'synthetic-upstream' })
    expect(mocks.create.mock.calls[0][0].extra).not.toHaveProperty('openai_passthrough')
  })

  it('carries OpenAI OAuth passthrough into the account created from the real authorization form', async () => {
    const wrapper = render()
    await button(wrapper, 'OpenAI').trigger('click')
    await field(wrapper, 'admin.accounts.accountName').setValue('Synthetic OAuth passthrough')
    await wrapper.get('button[aria-label="admin.accounts.openai.oauthPassthrough"]').trigger('click')
    await submit(wrapper)
    await button(wrapper, 'admin.accounts.oauth.openai.generateAuthUrl').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('synthetic-code')
    await button(wrapper, 'admin.accounts.oauth.completeAuth').trigger('click')
    await flushPromises()
    expect(mocks.exchange).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ platform: 'openai', type: 'oauth',
      credentials: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }, extra: { openai_passthrough: true } })
  })

  it('rejects a blocked header and submits its corrected name through the real header editor', async () => {
    const wrapper = await apiKeyForm('OpenAI')
    await wrapper.get('button[aria-label="admin.accounts.headerOverride.title"]').trigger('click')
    await button(wrapper, 'admin.accounts.headerOverride.addRow').trigger('click')
    const name = wrapper.get('input[placeholder="admin.accounts.headerOverride.namePlaceholder"]')
    await name.setValue('Authorization')
    await wrapper.get('input[placeholder="admin.accounts.headerOverride.valuePlaceholder"]').setValue(' synthetic header value ')
    await submit(wrapper)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('admin.accounts.headerOverride.blockedName')
    await name.setValue('X-Synthetic-Route')
    await submit(wrapper)
    expect(mocks.create.mock.calls[0][0].credentials).toMatchObject({ header_override_enabled: true, header_overrides: { 'x-synthetic-route': 'synthetic header value' } })
  })

  it.each(['apikey', 'bedrock'] as const)('serializes pool retry settings from the actual %s controls', async type => {
    const wrapper = type === 'apikey' ? await apiKeyForm('OpenAI') : await bedrockForm()
    await wrapper.get('button[aria-label="admin.accounts.poolMode"]').trigger('click')
    await field(wrapper, 'admin.accounts.poolModeRetryCount').setValue('2')
    await field(wrapper, 'admin.accounts.poolModeRetryStatusCodes').setValue('599, 400 400 99 600 nope 401.5 0 200')
    await submit(wrapper)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0][0].credentials).toMatchObject({ pool_mode: true, pool_mode_retry_count: 2, pool_mode_retry_status_codes: [200, 400, 599] })
  })

  it('uses Bedrock API-key authentication and the backend default retry statuses when the optional list is blank', async () => {
    const wrapper = await bedrockForm('apikey')
    await wrapper.get('button[aria-label="admin.accounts.poolMode"]').trigger('click')
    await submit(wrapper)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ platform: 'anthropic', type: 'bedrock', credentials: {
      auth_mode: 'apikey', api_key: 'synthetic-bedrock-key', aws_region: 'us-east-1', pool_mode: true, pool_mode_retry_count: 3,
    } })
    expect(mocks.create.mock.calls[0][0].credentials).not.toHaveProperty('pool_mode_retry_status_codes')
    expect(mocks.create.mock.calls[0][0].credentials).not.toHaveProperty('aws_secret_access_key')
  })

  it('sends the exact accepted API-key payload through the real HTTP client without contacting an upstream', async () => {
    const { apiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')
    const original = apiClient.defaults.adapter
    const wire: Array<{ method?: string; url?: string; body: any }> = []
    apiClient.defaults.adapter = async config => {
      const body = JSON.parse(config.data)
      wire.push({ method: config.method, url: config.url, body })
      return { data: { code: 0, data: { ...body, id: 42 } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    mocks.create.mockImplementation(actual.create)
    try {
      const wrapper = await apiKeyForm('OpenAI')
      await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://ollama.com/v1 ')
      await submit(wrapper)
      expect(wire).toHaveLength(1)
      expect(wire[0]).toMatchObject({ method: 'post', url: '/admin/accounts', body: { platform: 'openai', type: 'apikey', credentials: { api_key: 'synthetic-key', base_url: 'https://ollama.com/v1' } } })
      expect(wrapper.emitted('created')).toHaveLength(1)
    } finally { apiClient.defaults.adapter = original }
  })

  it('opens mixed-channel consent for a real HTTP 409 and retries only the captured accepted payload', async () => {
    const { apiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')
    const original = apiClient.defaults.adapter
    const wire: any[] = []
    apiClient.defaults.adapter = async config => {
      const body = JSON.parse(config.data)
      wire.push(body)
      if (wire.length === 1) throw new AxiosError('synthetic conflict', AxiosError.ERR_BAD_REQUEST, config, undefined, {
        status: 409, statusText: 'Conflict', headers: {}, config,
        data: { error: 'mixed_channel_warning', message: 'Synthetic mixed channel conflict' },
      })
      return { data: { code: 0, data: { ...body, id: 42 } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    mocks.create.mockImplementation(actual.create)
    try {
      const wrapper = await apiKeyForm('Anthropic', true)
      await wrapper.get('input[type="checkbox"][value="11"]').setValue(true)
      await submit(wrapper)
      expect(mocks.risk).toHaveBeenCalledOnce()
      expect(wire).toHaveLength(1)
      expect(wrapper.text()).toContain('admin.accounts.mixedChannelWarningTitle')
      expect(wrapper.text()).toContain('Synthetic mixed channel conflict')
      expect(mocks.error).not.toHaveBeenCalled()
      await button(wrapper, 'common.confirm').trigger('click')
      await flushPromises()
      expect(wire).toHaveLength(2)
      expect(wire[1]).toMatchObject({ ...wire[0], confirm_mixed_channel_risk: true })
      expect(wire[1].group_ids).toEqual([11])
      expect(wrapper.emitted('created')).toHaveLength(1)
    } finally { apiClient.defaults.adapter = original }
  })
})
