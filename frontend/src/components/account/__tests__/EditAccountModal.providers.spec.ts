import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import EditAccountModal from '../EditAccountModal.vue'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({ update: vi.fn(), risk: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { update: mocks.update, checkMixedChannelRisk: mocks.risk },
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
function account(patch: Record<string, unknown> = {}) {
  return { id: 17, name: 'Synthetic existing account', platform: 'openai', type: 'apikey',
    credentials: { base_url: 'https://synthetic.example/v1', synthetic_vendor_option: 'keep' }, credentials_status: { has_api_key: true },
    extra: { synthetic_metadata: 'preserve' }, status: 'active', notes: '', concurrency: 2, priority: 1, rate_multiplier: 1,
    proxy_id: null, load_factor: null, group_ids: [], expires_at: null, auto_pause_on_expired: false, ...patch } as any
}
function render(value = account()) {
  const wrapper = mount(EditAccountModal, { attachTo: document.body, props: { show: true, account: value, groups: [], proxies: [] }, global: {
    mocks: { $t: (key: string) => key }, stubs: { teleport: true, Icon: true, PlatformIcon: true, GroupSelector: true, ProxySelector: true, QuotaLimitCard: true, ModelWhitelistSelector: Models },
  } })
  wrappers.push(wrapper)
  return wrapper
}
function field(wrapper: VueWrapper, name: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === name && candidate.attributes('for'))
  expect(label, `label ${name}`).toBeDefined()
  const control = document.getElementById(label!.attributes('for'))
  expect(control, `control ${name}`).not.toBeNull()
  return new DOMWrapper(control!)
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function bedrock(mode: 'sigv4' | 'apikey', pool = true) {
  return account({ platform: 'anthropic', type: 'bedrock', credentials: {
    auth_mode: mode, aws_region: 'us-east-1', aws_access_key_id: 'SYNTHETIC_ACCESS',
    ...(pool ? { pool_mode: true, pool_mode_retry_count: 4, pool_mode_retry_status_codes: [401, 429] } : {}),
  }, credentials_status: { has_api_key: mode === 'apikey', has_aws_secret_access_key: mode === 'sigv4' } })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-edit-admin', user: { id: 7 } })
  mocks.update.mockReset().mockImplementation((id, payload) => Promise.resolve(account({ ...payload, id })))
  mocks.risk.mockReset().mockResolvedValue({ has_risk: false })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('EditAccountModal normal provider contracts through DOM', () => {
  it.each(['openai', 'anthropic', 'gemini'])('edits a %s API-key endpoint and rotates only the entered secret', async platform => {
    const wrapper = render(account({ platform }))
    await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://synthetic-relay.example/v1 ')
    await field(wrapper, 'admin.accounts.apiKey').setValue(' synthetic-rotated-key ')
    await submit(wrapper)
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(17, expect.objectContaining({
      credentials: expect.objectContaining({ base_url: 'https://synthetic-relay.example/v1', api_key: 'synthetic-rotated-key', synthetic_vendor_option: 'keep' }),
    }))
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it.each(['openai', 'anthropic'])('keeps the existing redacted %s Ollama key when only the endpoint is edited', async platform => {
    const wrapper = render(account({ platform, credentials: { base_url: 'https://ollama.com', synthetic_vendor_option: 'keep' } }))
    await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://www.ollama.com/v1 ')
    expect((field(wrapper, 'admin.accounts.apiKey').element as HTMLInputElement).value).toBe('')
    await submit(wrapper)
    expect(mocks.update.mock.calls[0][1].credentials).toMatchObject({ base_url: 'https://www.ollama.com/v1', synthetic_vendor_option: 'keep' })
    expect(mocks.update.mock.calls[0][1].credentials).not.toHaveProperty('api_key')
    expect(mocks.update.mock.calls[0][1].extra.synthetic_metadata).toBe('preserve')
  })

  it.each(['apikey', 'oauth', 'setup-token'])('preserves the %s mapping through passthrough failure and clears both legacy flags on corrected retry', async type => {
    const mapping = { 'synthetic-request': 'synthetic-upstream' }
    mocks.update.mockRejectedValueOnce({ status: 400, message: 'synthetic save rejected' })
    const wrapper = render(account({ type, credentials: { base_url: 'https://synthetic.example/v1', model_mapping: mapping },
      extra: { openai_oauth_passthrough: true, synthetic_metadata: 'preserve' } }))
    expect(wrapper.get('button[aria-label="admin.accounts.openai.oauthPassthrough"]').attributes('aria-checked')).toBe('true')
    await submit(wrapper)
    expect(mocks.error).toHaveBeenCalledWith('synthetic save rejected')
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(mocks.update.mock.calls[0][1].credentials.model_mapping).toEqual(mapping)
    expect(mocks.update.mock.calls[0][1].extra.openai_passthrough).toBe(true)
    await wrapper.get('button[aria-label="admin.accounts.openai.oauthPassthrough"]').trigger('click')
    expect(wrapper.text()).not.toContain('admin.accounts.openai.modelRestrictionDisabledByPassthrough')
    await submit(wrapper)
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.update.mock.calls[1][1].credentials.model_mapping).toEqual(mapping)
    expect(mocks.update.mock.calls[1][1].extra).not.toHaveProperty('openai_passthrough')
    expect(mocks.update.mock.calls[1][1].extra).not.toHaveProperty('openai_oauth_passthrough')
    expect(mocks.update.mock.calls[1][1].extra.synthetic_metadata).toBe('preserve')
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it.each(['sigv4', 'apikey'] as const)('removes disabled Bedrock %s pool settings while preserving redacted credentials', async mode => {
    const wrapper = render(bedrock(mode))
    expect((field(wrapper, 'admin.accounts.poolModeRetryCount').element as HTMLInputElement).value).toBe('4')
    await wrapper.get('button[aria-label="admin.accounts.poolMode"]').trigger('click')
    expect(wrapper.find('input[placeholder="401, 403, 429"]').exists()).toBe(false)
    await submit(wrapper)
    const credentials = mocks.update.mock.calls[0][1].credentials
    expect(credentials).toMatchObject({ auth_mode: mode, aws_region: 'us-east-1' })
    expect(credentials).not.toHaveProperty('pool_mode')
    expect(credentials).not.toHaveProperty('pool_mode_retry_count')
    expect(credentials).not.toHaveProperty('pool_mode_retry_status_codes')
    expect(credentials).not.toHaveProperty('api_key')
    expect(credentials).not.toHaveProperty('aws_secret_access_key')
  })

  it.each(['sigv4', 'apikey'] as const)('saves edited Bedrock %s pool retry status codes through visible fields', async mode => {
    const wrapper = render(bedrock(mode))
    await field(wrapper, 'admin.accounts.poolModeRetryCount').setValue('0')
    await field(wrapper, 'admin.accounts.poolModeRetryStatusCodes').setValue('503,429 429 100 99 600 invalid 401.5')
    await submit(wrapper)
    expect(mocks.update.mock.calls[0][1].credentials).toMatchObject({ pool_mode: true, pool_mode_retry_count: 0, pool_mode_retry_status_codes: [100, 429, 503] })
  })

  it('validates a header edit before saving and preserves the corrected normalized value', async () => {
    const wrapper = render(account({ credentials: { base_url: 'https://synthetic.example/v1', header_override_enabled: true, header_overrides: { 'x-synthetic-old': 'old' } } }))
    const name = wrapper.get('input[placeholder="admin.accounts.headerOverride.namePlaceholder"]')
    await name.setValue('Cookie')
    await wrapper.get('input[placeholder="admin.accounts.headerOverride.valuePlaceholder"]').setValue(' synthetic revised value ')
    await submit(wrapper)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('admin.accounts.headerOverride.blockedName')
    await name.setValue('X-Synthetic-New')
    await submit(wrapper)
    expect(mocks.update.mock.calls[0][1].credentials).toMatchObject({ header_override_enabled: true, header_overrides: { 'x-synthetic-new': 'synthetic revised value' } })
  })

  it('removes header override credentials when the visible override switch is disabled', async () => {
    const wrapper = render(account({ credentials: { base_url: 'https://synthetic.example/v1', header_override_enabled: true, header_overrides: { 'x-synthetic-old': 'old' } } }))
    await wrapper.get('button[aria-label="admin.accounts.headerOverride.title"]').trigger('click')
    await submit(wrapper)
    expect(mocks.update.mock.calls[0][1].credentials).not.toHaveProperty('header_override_enabled')
    expect(mocks.update.mock.calls[0][1].credentials).not.toHaveProperty('header_overrides')
  })

  it('requires a new API key when the backend reports no stored key and accepts a corrected retry', async () => {
    const wrapper = render(account({ credentials_status: { has_api_key: false } }))
    await submit(wrapper)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('admin.accounts.apiKeyIsRequired')
    await field(wrapper, 'admin.accounts.apiKey').setValue(' synthetic-new-key ')
    await submit(wrapper)
    expect(mocks.update.mock.calls[0][1].credentials.api_key).toBe('synthetic-new-key')
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it('sends an edited Ollama endpoint through the real HTTP client without sending an empty redacted key', async () => {
    const { apiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')
    const original = apiClient.defaults.adapter
    const wire: Array<{ method?: string; url?: string; body: any }> = []
    apiClient.defaults.adapter = async config => {
      const body = JSON.parse(config.data)
      wire.push({ method: config.method, url: config.url, body })
      return { data: { code: 0, data: account(body) }, status: 200, statusText: 'OK', headers: {}, config }
    }
    mocks.update.mockImplementation(actual.update)
    try {
      const wrapper = render(account({ credentials: { base_url: 'https://ollama.com' } }))
      await field(wrapper, 'admin.accounts.baseUrl').setValue(' https://ollama.com/v1 ')
      await submit(wrapper)
      expect(wire).toHaveLength(1)
      expect(wire[0]).toMatchObject({ method: 'put', url: '/admin/accounts/17', body: { credentials: { base_url: 'https://ollama.com/v1' } } })
      expect(wire[0].body.credentials).not.toHaveProperty('api_key')
      expect(wrapper.emitted('updated')).toHaveLength(1)
    } finally { apiClient.defaults.adapter = original }
  })
})
