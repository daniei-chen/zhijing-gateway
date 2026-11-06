import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import CreateAccountModal from '../CreateAccountModal.vue'
import EditAccountModal from '../EditAccountModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { Account, AdminGroup, Proxy } from '@/types'

const notices = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()
}))
const profileApi = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  accounts: (await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')).accountsAPI,
  gemini: { getCapabilities: vi.fn().mockResolvedValue({ ai_studio_oauth_enabled: false }) },
  settings: {
    getSettings: vi.fn().mockResolvedValue({}),
    getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] })
  },
  tlsFingerprintProfiles: profileApi
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({
  showSuccess: notices.success, showError: notices.error,
  showWarning: notices.warning, showInfo: notices.info
}) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key })
}))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

type Kind = 'create' | 'edit'
type Wire = {
  method: string
  path: string
  body: Record<string, any>
  config: InternalAxiosRequestConfig
}
const originalAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let requests: Wire[] = []
let unexpected: string[] = []
let route: (request: Wire) => Promise<unknown>
const dom = () => new DOMWrapper(document.body)

function account(patch: Record<string, unknown> = {}): Account {
  return {
    id: 84, name: 'Synthetic release account', platform: 'openai', type: 'apikey',
    credentials: { base_url: 'https://synthetic.example.test/v1', preserved_credential: 'keep' },
    credentials_status: { has_api_key: true }, extra: { preserved_extra: { release: 4 } },
    status: 'active', notes: '', concurrency: 2, priority: 1, rate_multiplier: 1,
    proxy_id: null, load_factor: null, group_ids: [], expires_at: null,
    auto_pause_on_expired: true, created_at: '2026-11-06T00:00:00Z',
    updated_at: '2026-11-06T00:00:00Z', ...patch
  } as unknown as Account
}
const normal = async (request: Wire): Promise<unknown> => {
  if (request.path === '/admin/accounts' && request.method === 'post') return account(request.body)
  if (request.path === '/admin/accounts/84' && request.method === 'put') return account(request.body)
  if (request.path === '/admin/accounts/check-mixed-channel') return { has_risk: false }
  if (request.path === '/admin/accounts/antigravity/default-model-mapping') return {}
  if (request.path === '/admin/accounts/84/models/sync-upstream') return { models: [] }
  if (request.path === '/admin/accounts/84/upstream-billing-probe') return { success: true }
  if (request.path === '/admin/accounts/cookie-auth' || request.path === '/admin/accounts/setup-token-cookie-auth') {
    return { access_token: 'synthetic-cookie-access', refresh_token: 'synthetic-cookie-refresh', expires_at: 1900000000 }
  }
  if (request.path === '/admin/accounts/import/codex-session') {
    return { created: 1, updated: 0, skipped: 0, failed: 0 }
  }
  unexpected.push(`${request.method} ${request.path}`)
  throw new Error('Unexpected synthetic release endpoint')
}
function reject(request: Wire, message = 'Synthetic upstream unavailable') {
  return new AxiosError(message, 'ERR_BAD_RESPONSE', request.config, undefined, {
    status: 503, statusText: 'Synthetic', headers: {}, config: request.config, data: { message }
  })
}
async function render(kind: Kind, value = account(), initiallyShown = true) {
  const groups = [
    { id: 841, name: 'Synthetic OpenAI group', platform: 'openai', status: 'active', rate_multiplier: 1 },
    { id: 842, name: 'Synthetic Anthropic group', platform: 'anthropic', status: 'active', rate_multiplier: 1 }
  ] as unknown as AdminGroup[]
  const proxies = [
    { id: 843, name: 'Synthetic Tokyo relay', protocol: 'socks5', host: 'proxy.example.test', port: 1080, status: 'active' }
  ] as Proxy[]
  const common = {
    attachTo: document.body,
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { Transition: true, Icon: true, PlatformIcon: true, ProxyAdBanner: true }
    }
  }
  const view = kind === 'create'
    ? mount(CreateAccountModal, { ...common, props: { show: initiallyShown, groups, proxies } })
    : mount(EditAccountModal, { ...common, props: { show: true, account: value, groups, proxies } })
  views.push(view)
  if (kind === 'create' && !initiallyShown) await view.setProps({ show: true })
  await flushPromises()
  return view
}
function field(label: string) {
  const found = dom().findAll('label').find(node => node.text() === label && node.attributes('for'))
  expect(found, `visible associated label ${label}`).toBeDefined()
  const element = document.getElementById(found!.attributes('for')!)
  expect(element, `control for ${label}`).not.toBeNull()
  return new DOMWrapper(element!)
}
function button(label: string) {
  const buttons = dom().findAll('button')
  const found = buttons.find(node => node.text() === label)
    ?? buttons.find(node => node.text().includes(label))
  expect(found, `visible button ${label}`).toBeDefined()
  return found!
}
async function click(label: string) {
  (button(label).element as HTMLButtonElement).click()
  await flushPromises()
}
async function toggle(label: string) {
  (dom().get(`button[role="switch"][aria-label="${label}"]`).element as HTMLButtonElement).click()
  await flushPromises()
}
async function submit() {
  const form = dom().get('form').element as HTMLFormElement
  expect(form.checkValidity(), 'native form validity before submit').toBe(true)
  ;(dom().get('button[type="submit"]').element as HTMLButtonElement).click()
  await flushPromises()
}
function writes(kind: Kind) {
  return requests.filter(request => request.method === (kind === 'create' ? 'post' : 'put')
    && request.path === (kind === 'create' ? '/admin/accounts' : '/admin/accounts/84'))
}
async function prepare(kind: Kind, platform = 'OpenAI', patch: Record<string, unknown> = {}) {
  const view = await render(kind, account({ platform: platform.toLowerCase(), ...patch }))
  if (kind === 'create') {
    await click(platform)
    if (['OpenAI', 'Anthropic', 'Gemini', 'Grok'].includes(platform)) {
      await click(platform === 'Anthropic' ? 'admin.accounts.claudeConsole'
        : platform === 'Gemini' ? 'admin.accounts.gemini.accountType.apiKeyTitle' : 'API Key')
    }
    await field('admin.accounts.accountName').setValue('Synthetic release account')
    await field('admin.accounts.apiKeyRequired').setValue('synthetic-release-key')
  }
  return view
}
async function choose(label: string, option: string) {
  const control = field(label)
  if (control.element instanceof HTMLSelectElement || control.element instanceof HTMLInputElement) {
    await control.setValue(option)
  } else {
    await control.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const found = dom().findAll('[role="option"]').find(node => node.text().includes(option))
    expect(found, `Select option ${option}`).toBeDefined()
    ;(found!.element as HTMLElement).click()
  }
  await flushPromises()
}

beforeEach(() => {
  requests = []
  unexpected = []
  route = normal
  profileApi.list.mockReset().mockResolvedValue([{ id: 84, name: 'Synthetic release TLS' }])
  Object.values(notices).forEach(mock => mock.mockReset())
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-release-admin', user: { id: 84, role: 'admin' } })
  apiClient.defaults.adapter = async config => {
    const request: Wire = {
      method: config.method ?? 'get', path: String(config.url),
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {}, config
    }
    requests.push(request)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: await route(request) } }
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe.each(['create', 'edit'] as const)('%s account: native upstream failure policy', kind => {
  it.each([429, 529])('requires confirmation before selecting common status %s and permits removal', async code => {
    await prepare(kind)
    await toggle('admin.accounts.customErrorCodes')
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await click(`${code} `)
    expect(window.confirm).toHaveBeenCalledWith(`admin.accounts.customErrorCodes${code}Warning`)
    expect(dom().find(`button[aria-label="common.delete ${code}"]`).exists()).toBe(false)
    await click(`${code} `)
    expect(dom().find(`button[aria-label="common.delete ${code}"]`).exists()).toBe(true)
    await click(`${code} `)
    expect(dom().find(`button[aria-label="common.delete ${code}"]`).exists()).toBe(false)
    await click('500 ')
    await submit()
    expect(writes(kind)).toHaveLength(1)
    expect(writes(kind)[0]!.body.credentials).toMatchObject({ custom_error_codes_enabled: true, custom_error_codes: [500] })
  })
  it('rejects invalid and duplicate manual codes, then deletes the selected custom code without losing another', async () => {
    await prepare(kind)
    await toggle('admin.accounts.customErrorCodes')
    await field('admin.accounts.customErrorCodes').setValue('99')
    await dom().get('button[aria-label="common.add"]').trigger('click')
    expect(notices.error).toHaveBeenCalledWith('admin.accounts.invalidErrorCode')
    await field('admin.accounts.customErrorCodes').setValue('418')
    await field('admin.accounts.customErrorCodes').trigger('keyup', { key: 'Enter' })
    await field('admin.accounts.customErrorCodes').setValue('418')
    await field('admin.accounts.customErrorCodes').trigger('keyup', { key: 'Enter' })
    expect(notices.info).toHaveBeenCalledWith('admin.accounts.errorCodeExists')
    expect(dom().findAll('button[aria-label="common.delete 418"]')).toHaveLength(1)
    await click('502 ')
    await dom().get('button[aria-label="common.delete 418"]').trigger('click')
    await field('admin.accounts.customErrorCodes').setValue('')
    await submit()
    expect(writes(kind)[0]!.body.credentials.custom_error_codes).toEqual([502])
  })
  it.each([429, 529])('applies the same confirmation to a manually entered %s before committing JSON', async code => {
    await prepare(kind)
    await toggle('admin.accounts.customErrorCodes')
    await field('admin.accounts.customErrorCodes').setValue(String(code))
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await dom().get('button[aria-label="common.add"]').trigger('click')
    expect(dom().find(`button[aria-label="common.delete ${code}"]`).exists()).toBe(false)
    await dom().get('button[aria-label="common.add"]').trigger('click')
    expect(dom().find(`button[aria-label="common.delete ${code}"]`).exists()).toBe(true)
    expect((field('admin.accounts.customErrorCodes').element as HTMLInputElement).value).toBe('')
    await submit()
    expect(writes(kind)[0]!.body.credentials.custom_error_codes).toEqual([code])
  })
})

describe.each(['create', 'edit'] as const)('%s account: deliberate mapping and routing changes', kind => {
  it('adds two request mappings, removes one, and sends only the retained request-to-upstream pair', async () => {
    await prepare(kind)
    await click('admin.accounts.modelMapping')
    await click('admin.accounts.addMapping')
    await dom().get('input[aria-label="admin.accounts.requestModel"]').setValue('temporary-request')
    await dom().get('input[aria-label="admin.accounts.actualModel"]').setValue('temporary-upstream')
    await click('admin.accounts.addMapping')
    await dom().findAll('input[aria-label="admin.accounts.requestModel"]')[1]!.setValue('kept-request')
    await dom().findAll('input[aria-label="admin.accounts.actualModel"]')[1]!.setValue('kept-upstream')
    const removeLabel = kind === 'edit' ? 'common.delete' : 'admin.accounts.grokModelDiagnostics.removeMappingAria'
    await dom().findAll(`button[aria-label="${removeLabel}"]`)[0]!.trigger('click')
    expect(dom().findAll('input[aria-label="admin.accounts.requestModel"]')).toHaveLength(1)
    await submit()
    expect(writes(kind)[0]!.body.credentials.model_mapping).toEqual({ 'kept-request': 'kept-upstream' })
  })
  it('keeps compact endpoint mapping separate from ordinary model restriction and removes an abandoned row', async () => {
    await prepare(kind)
    await click('admin.accounts.addMapping')
    await dom().get('input[aria-label="admin.accounts.fromModel"]').setValue('compact-request')
    await dom().get('input[aria-label="admin.accounts.toModel"]').setValue('compact-upstream')
    await click('admin.accounts.addMapping')
    await dom().findAll('input[aria-label="admin.accounts.fromModel"]')[1]!.setValue('discarded')
    await dom().findAll('input[aria-label="admin.accounts.toModel"]')[1]!.setValue('discarded-upstream')
    await dom().findAll('button[aria-label="admin.accounts.grokModelDiagnostics.removeMappingAria"]')[1]!.trigger('click')
    await submit()
    expect(writes(kind)[0]!.body.credentials.compact_model_mapping).toEqual({ 'compact-request': 'compact-upstream' })
    expect(writes(kind)[0]!.body.credentials.model_mapping ?? {}).not.toHaveProperty('compact-request')
  })
  it('selects a real proxy and same-platform group through public controls', async () => {
    await prepare(kind)
    await field('admin.accounts.proxy').trigger('keydown', { key: 'ArrowDown' })
    await click('Synthetic Tokyo relay')
    const group = dom().findAll('label').find(node => node.text().includes('Synthetic OpenAI group'))
    expect(group).toBeDefined()
    await group!.get('input[type="checkbox"]').setValue(true)
    expect(dom().text()).not.toContain('Synthetic Anthropic group')
    await submit()
    expect(writes(kind)[0]!.body).toMatchObject({ proxy_id: 843, group_ids: [841] })
  })
  it.each([
    ['Kimi', 'kimi', 'Kimi Coding Anthropic', 'https://api.kimi.com/coding'],
    ['Zhipu GLM', 'zhipu', 'GLM Coding Anthropic', 'https://open.bigmodel.cn/api/anthropic'],
    ['MiniMax', 'minimax', 'MiniMax Coding Intl Anthropic', 'https://api.minimax.io/anthropic'],
    ['MiniMax', 'minimax', 'MiniMax Coding CN Anthropic', 'https://api.minimaxi.com/anthropic'],
    ['DeepSeek', 'deepseek', 'DeepSeek Anthropic', 'https://api.deepseek.com/anthropic']
  ])('uses the native %s preset to select its endpoint and compatible billing mode', async (label, platform, preset, url) => {
    await prepare(kind, label!, { platform, credentials: { api_protocol: 'anthropic', account_mode: 'payg', base_url: 'https://old.example.test' } })
    if (kind === 'create') await click('admin.accounts.cnProviders.apiProtocol.anthropic')
    const found = dom().findAll('[data-testid="cn-base-url-preset"]').find(node => node.text().startsWith(`${preset} (`))
    expect(found, `preset ${preset}`).toBeDefined()
    await found!.trigger('click')
    expect((field('admin.accounts.baseUrl').element as HTMLInputElement).value).toBe(url)
    await submit()
    expect(writes(kind)[0]!.body.credentials).toMatchObject({
      api_protocol: 'anthropic', account_mode: platform === 'deepseek' ? 'payg' : 'coding', base_url: url
    })
  })
  it('retains the existing domestic default when pay-as-you-go changes to coding using the mode control', async () => {
    await prepare(kind, 'MiniMax', { platform: 'minimax', credentials: {
      api_protocol: 'anthropic', account_mode: 'payg', base_url: 'https://api.minimaxi.com/anthropic'
    } })
    if (kind === 'create') await click('admin.accounts.cnProviders.apiProtocol.anthropic')
    await click('admin.accounts.cnProviders.accountMode.coding')
    expect((field('admin.accounts.baseUrl').element as HTMLInputElement).value).toBe('https://api.minimaxi.com/anthropic')
    await submit()
    expect(writes(kind)[0]!.body.credentials).toMatchObject({
      api_protocol: 'anthropic', account_mode: 'coding', base_url: 'https://api.minimaxi.com/anthropic'
    })
  })
})

it('does not let a native preset selected just before cancellation overwrite the next edited account', async () => {
  const view = await prepare('edit', 'MiniMax', { platform: 'minimax', credentials: {
    api_protocol: 'anthropic', account_mode: 'payg', base_url: 'https://api.minimaxi.com/anthropic'
  } })
  const preset = dom().findAll('[data-testid="cn-base-url-preset"]').find(node => node.text().startsWith('MiniMax Coding Intl Anthropic ('))!
  ;(preset.element as HTMLButtonElement).click()
  ;(button('common.cancel').element as HTMLButtonElement).click()
  expect(view.emitted('close')).toHaveLength(1)
  await view.setProps({ show: false })
  await view.setProps({ show: true, account: account({ id: 85, platform: 'minimax', credentials: {
    api_protocol: 'anthropic', account_mode: 'payg', base_url: 'https://next-account.example.test/anthropic'
  } }) })
  await flushPromises()
  expect((field('admin.accounts.baseUrl').element as HTMLInputElement).value).toBe('https://next-account.example.test/anthropic')
  expect(requests.filter(request => request.method === 'put')).toEqual([])
})

describe('create account: native Codex import with actionable partial results', () => {
  async function importer(method = 'codex_session') {
    const view = await render('create')
    await click('OpenAI')
    await field('admin.accounts.accountName').setValue('Synthetic imported account')
    await submit()
    await dom().get(`input[type="radio"][value="${method}"]`).setValue(true)
    return view
  }
  const imports = () => requests.filter(request => request.path === '/admin/accounts/import/codex-session')
  const importButton = 'admin.accounts.oauth.openai.codexSessionImportAndCreate'
  it('submits a trimmed credential document with the edited account options and closes on complete success', async () => {
    const view = await importer()
    const content = JSON.stringify({ tokens: { access_token: 'synthetic-document-token' } })
    await dom().get('textarea').setValue(`  ${content}\n`)
    await click(importButton)
    expect(imports()).toHaveLength(1)
    expect(imports()[0]!.body).toMatchObject({ content, name: 'Synthetic imported account', update_existing: true, group_ids: [] })
    expect(notices.success).toHaveBeenCalledWith('admin.accounts.oauth.openai.codexSessionImportSuccess')
    expect(view.emitted('created')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })
  it.each([
    ['partial', { created: 1, updated: 0, skipped: 0, failed: 1 }, 'warning', 'admin.accounts.oauth.openai.codexSessionImportPartial', true],
    ['skipped', { created: 0, updated: 0, skipped: 2, failed: 0 }, 'warning', 'admin.accounts.oauth.openai.codexSessionImportSuccess', false],
    ['failed', { created: 0, updated: 0, skipped: 0, failed: 2 }, 'error', 'admin.accounts.oauth.openai.codexSessionImportFailed', false]
  ] as const)('retains the native %s import document with named and unnamed per-row diagnostics', async (_label, result, severity, notice, created) => {
    route = async request => request.path === '/admin/accounts/import/codex-session'
      ? { ...result, errors: [{ index: 2, name: 'Synthetic row', message: 'synthetic-invalid' }], warnings: [{ index: 1, message: 'synthetic-warning' }] }
      : normal(request)
    const view = await importer()
    await dom().get('textarea').setValue('{"synthetic":"batch"}')
    await click(importButton)
    expect(notices[severity]).toHaveBeenCalledWith(notice)
    expect(dom().text()).toContain('#2 Synthetic row: synthetic-invalid')
    expect(dom().text()).toContain('#1: synthetic-warning')
    expect((dom().get('textarea').element as HTMLTextAreaElement).value).toBe('{"synthetic":"batch"}')
    expect(view.emitted('close')).toBeUndefined()
    expect(Boolean(view.emitted('created'))).toBe(created)
  })
  it('keeps a rejected import editable and retries the corrected document through the same actual client', async () => {
    let attempts = 0
    route = async request => {
      if (request.path === '/admin/accounts/import/codex-session' && attempts++ === 0) throw reject(request, 'Synthetic import rejected')
      return normal(request)
    }
    const view = await importer()
    await dom().get('textarea').setValue('{"synthetic":"first"}')
    await click(importButton)
    expect(notices.error).toHaveBeenCalledWith('Synthetic import rejected')
    expect(view.emitted('created')).toBeUndefined()
    await dom().get('textarea').setValue('{"synthetic":"corrected"}')
    await click(importButton)
    expect(imports().map(request => request.body.content)).toEqual(['{"synthetic":"first"}', '{"synthetic":"corrected"}'])
    expect(view.emitted('created')).toHaveLength(1)
  })
  it.each([
    '{"auth_mode":"AgentIdentity"}',
    '{"authMode":"agentidentity"}',
    '{"agent_identity":{"id":"synthetic"}}',
    '[{"agentIdentity":{"id":"synthetic"}}]',
    '{"auth_mode":"agentidentity"}\n{"agent_identity":{"id":"second"}}'
  ])('accepts a supported AgentIdentity document through the explicitly selected import mode: %s', async content => {
    const view = await importer('agent_identity')
    await dom().get('textarea').setValue(content)
    await click(importButton)
    expect(imports()).toHaveLength(1)
    expect(imports()[0]!.body.content).toBe(content)
    expect(view.emitted('created')).toHaveLength(1)
  })
  it.each(['[]', 'null', '17', '{"auth_mode":"oauth"}', '{invalid', '{"auth_mode":"agentidentity"}\nnull'])('rejects an incompatible AgentIdentity document locally: %s', async content => {
    const view = await importer('agent_identity')
    await dom().get('textarea').setValue(content)
    await click(importButton)
    expect(imports()).toEqual([])
    expect(dom().text()).toContain('admin.accounts.oauth.openai.agentIdentityInvalid')
    expect(view.emitted('created')).toBeUndefined()
    expect((button(importButton).element as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('create account: the Anthropic configuration survives native cookie authorization', () => {
  it('loads TLS choices when the actual AccountsView conditional owner mounts its first visible create dialog', async () => {
    await render('create')
    await toggle('admin.accounts.quotaControl.tlsFingerprint.label')
    expect(profileApi.list).toHaveBeenCalledTimes(1)
    const options = field('admin.accounts.quotaControl.tlsFingerprint.label').findAll('option')
    expect(options.map(option => option.text())).toEqual([
      'admin.accounts.quotaControl.tlsFingerprint.defaultProfile',
      'admin.accounts.quotaControl.tlsFingerprint.randomProfile',
      'Synthetic release TLS'
    ])
    await choose('admin.accounts.quotaControl.tlsFingerprint.label', '84')
    expect((field('admin.accounts.quotaControl.tlsFingerprint.label').element as HTMLSelectElement).value).toBe('84')
  })
  it.each(['resolve', 'reject'] as const)('does not let a TLS profile %s from a cancelled opening replace the next opening options', async outcome => {
    let resolve!: (value: Array<{ id: number; name: string }>) => void
    let reject!: (error: unknown) => void
    profileApi.list.mockReturnValueOnce(new Promise((a, b) => { resolve = a; reject = b }))
    // A still-mounted modal is another supported public-props lifecycle; the first test above
    // separately exercises the parent's actual conditional first mount with show=true.
    const view = await render('create', undefined, false)
    await click('common.cancel')
    await view.setProps({ show: false })
    await view.setProps({ show: true })
    await flushPromises()
    await toggle('admin.accounts.quotaControl.tlsFingerprint.label')
    const select = field('admin.accounts.quotaControl.tlsFingerprint.label')
    expect(select.findAll('option').map(option => option.text())).toContain('Synthetic release TLS')
    if (outcome === 'resolve') resolve([{ id: 999, name: 'Synthetic obsolete TLS' }])
    else reject(new Error('Synthetic obsolete profile error'))
    await flushPromises()
    expect(select.findAll('option').map(option => option.text())).toContain('Synthetic release TLS')
    expect(select.findAll('option').map(option => option.text())).not.toContain('Synthetic obsolete TLS')
  })
  it.each(['session', 'unmount'] as const)('discards first-open profile results after its owner loses %s', async boundary => {
    let resolve!: (value: Array<{ id: number; name: string }>) => void
    profileApi.list.mockReturnValueOnce(new Promise(a => { resolve = a }))
    const view = await render('create')
    await toggle('admin.accounts.quotaControl.tlsFingerprint.label')
    expect(profileApi.list).toHaveBeenCalledTimes(1)
    if (boundary === 'session') replaceAuthSession({ accessToken: 'synthetic-next-release-admin', user: { id: 84, role: 'admin' } })
    else {
      views.splice(views.indexOf(view), 1)
      view.unmount()
    }
    resolve([{ id: 999, name: 'Synthetic obsolete TLS' }])
    await flushPromises()
    expect(dom().text()).not.toContain('Synthetic obsolete TLS')
    expect(notices.error).not.toHaveBeenCalled()
    expect(notices.success).not.toHaveBeenCalled()
  })
  it.each(['oauth', 'setup-token'])('sends the %s privacy, scheduling and relay settings with the actual token exchange', async method => {
    const view = await render('create')
    await field('admin.accounts.accountName').setValue('Synthetic configured cookie account')
    await dom().get(`input[type="radio"][value="${method}"]`).setValue(true)
    await toggle('admin.accounts.quotaControl.windowCost.label')
    await field('admin.accounts.quotaControl.windowCost.limit').setValue('120')
    await field('admin.accounts.quotaControl.windowCost.stickyReserve').setValue('14')
    await toggle('admin.accounts.quotaControl.sessionLimit.label')
    await field('admin.accounts.quotaControl.sessionLimit.maxSessions').setValue('5')
    await field('admin.accounts.quotaControl.sessionLimit.idleTimeout').setValue('8')
    await toggle('admin.accounts.quotaControl.rpmLimit.label')
    await field('admin.accounts.quotaControl.rpmLimit.baseRpm').setValue('35')
    await click('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt')
    await click('admin.accounts.quotaControl.rpmLimit.strategyTiered')
    await field('admin.accounts.quotaControl.rpmLimit.stickyBuffer').setValue('9')
    await click('admin.accounts.quotaControl.rpmLimit.umqModeSerialize')
    await toggle('admin.accounts.quotaControl.tlsFingerprint.label')
    await choose('admin.accounts.quotaControl.tlsFingerprint.label', '84')
    await toggle('admin.accounts.quotaControl.sessionIdMasking.label')
    await toggle('admin.accounts.quotaControl.cacheTTLOverride.label')
    await choose('admin.accounts.quotaControl.cacheTTLOverride.target', '1h')
    await toggle('admin.accounts.quotaControl.customBaseUrl.label')
    await field('admin.accounts.quotaControl.customBaseUrl.label').setValue(' https://relay.example.test/anthropic ')
    await toggle('admin.accounts.interceptWarmupRequests')
    await submit()
    await dom().get('input[type="radio"][value="cookie"]').setValue(true)
    await dom().get('textarea').setValue('sk-ant-sid01-synthetic-release-cookie')
    await click('admin.accounts.oauth.startAutoAuth')
    const exchange = requests.filter(request => request.path.endsWith('cookie-auth'))
    expect(exchange).toHaveLength(1)
    expect(exchange[0]!.path).toBe(method === 'oauth' ? '/admin/accounts/cookie-auth' : '/admin/accounts/setup-token-cookie-auth')
    expect(exchange[0]!.body.code).toBe('sk-ant-sid01-synthetic-release-cookie')
    expect(writes('create')).toHaveLength(1)
    expect(writes('create')[0]!.body).toMatchObject({
      type: method,
      credentials: { access_token: 'synthetic-cookie-access', intercept_warmup_requests: true },
      extra: {
        window_cost_limit: 120, window_cost_sticky_reserve: 14,
        max_sessions: 5, session_idle_timeout_minutes: 8,
        base_rpm: 35, rpm_strategy: 'tiered', rpm_sticky_buffer: 9,
        user_msg_queue_mode: 'serialize', enable_tls_fingerprint: true,
        tls_fingerprint_profile_id: 84, session_id_masking_enabled: true,
        cache_ttl_override_enabled: true, cache_ttl_override_target: '1h',
        custom_base_url_enabled: true, custom_base_url: 'https://relay.example.test/anthropic'
      }
    })
    expect(view.emitted('created')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })
  it('keeps a partially rejected cookie batch open while numbering the successful account and showing the failed row', async () => {
    const view = await render('create')
    await field('admin.accounts.accountName').setValue('Synthetic cookie batch')
    await submit()
    await dom().get('input[type="radio"][value="cookie"]').setValue(true)
    route = async request => {
      if (request.path === '/admin/accounts/cookie-auth' && request.body.code.includes('rejected')) throw reject(request)
      return normal(request)
    }
    await dom().get('textarea').setValue('sk-ant-sid01-synthetic-accepted\nsk-ant-sid01-synthetic-rejected')
    await click('admin.accounts.oauth.startAutoAuth')
    expect(requests.filter(request => request.path === '/admin/accounts/cookie-auth')).toHaveLength(2)
    expect(writes('create')).toHaveLength(1)
    expect(writes('create')[0]!.body.name).toBe('Synthetic cookie batch #1')
    expect(dom().text()).toContain('admin.accounts.oauth.keyAuthFailed')
    expect(view.emitted('created')).toHaveLength(1)
    expect(view.emitted('close')).toBeUndefined()
    expect((button('admin.accounts.oauth.startAutoAuth').element as HTMLButtonElement).disabled).toBe(false)
  })
})

describe.each(['create', 'edit'] as const)('%s account: Bedrock and Antigravity model configuration', kind => {
  it('combines a Bedrock preset and a custom mapping, removes the custom row, and retains its regional credentials', async () => {
    await render(kind, account({
      platform: 'anthropic', type: 'bedrock',
      credentials: { auth_mode: 'sigv4', aws_access_key_id: 'SYNTHETIC_SAVED_ACCESS', aws_region: 'us-east-1' },
      credentials_status: { has_aws_secret_access_key: true }
    }))
    if (kind === 'create') {
      await click('admin.accounts.bedrockLabel')
      await field('admin.accounts.accountName').setValue('Synthetic Bedrock mapping')
      await field('admin.accounts.bedrockAccessKeyId').setValue('SYNTHETIC_NEW_ACCESS')
      await field('admin.accounts.bedrockSecretAccessKey').setValue('synthetic-new-secret')
    }
    await field('admin.accounts.bedrockSessionToken').setValue(' synthetic-session-token ')
    await choose('admin.accounts.bedrockRegion', 'ap-northeast-1')
    const forceGlobal = dom().findAll('label').find(node => node.text() === 'admin.accounts.bedrockForceGlobal')
    expect(forceGlobal).toBeDefined()
    await forceGlobal!.get('input').setValue(true)
    await click('admin.accounts.modelMapping')
    await click('+ Fable 5.1')
    if (kind === 'create') {
      await click('+ Fable 5.1')
      expect(notices.info).toHaveBeenCalledWith('admin.accounts.mappingExists')
    }
    await click('admin.accounts.addMapping')
    await dom().findAll('input[aria-label="admin.accounts.fromModel"]')[1]!.setValue('discard-bedrock')
    await dom().findAll('input[aria-label="admin.accounts.toModel"]')[1]!.setValue('anthropic.discard')
    await dom().findAll('button[aria-label="admin.accounts.grokModelDiagnostics.removeMappingAria"]')[1]!.trigger('click')
    await submit()
    expect(writes(kind)).toHaveLength(1)
    expect(writes(kind)[0]!.body.credentials).toMatchObject({
      aws_region: 'ap-northeast-1', aws_session_token: 'synthetic-session-token', aws_force_global: 'true',
      model_mapping: { 'claude-fable-5-1': 'anthropic.claude-fable-5-1' }
    })
    if (kind === 'edit') expect(writes(kind)[0]!.body.credentials).not.toHaveProperty('aws_secret_access_key')
  })
  it('shows invalid wildcard diagnostics, permits correction, and removes an abandoned Antigravity mapping', async () => {
    const view = await render(kind, account({
      platform: 'antigravity', type: 'upstream', credentials: { base_url: 'https://upstream.example.test', api_key: 'synthetic-stored-upstream' }
    }))
    if (kind === 'create') {
      await click('Antigravity')
      await click('API Key')
      await field('admin.accounts.accountName').setValue('Synthetic Antigravity mapping')
      await field('admin.accounts.upstream.baseUrl').setValue('https://upstream.example.test')
      await field('admin.accounts.upstream.apiKey').setValue('synthetic-new-upstream')
    }
    await click('admin.accounts.addMapping')
    await dom().get('input[aria-label="admin.accounts.requestModel"]').setValue('claude-*-invalid')
    await dom().get('input[aria-label="admin.accounts.actualModel"]').setValue('invalid-*')
    expect(dom().text()).toContain('admin.accounts.wildcardOnlyAtEnd')
    expect(dom().text()).toContain('admin.accounts.targetNoWildcard')
    await dom().get('input[aria-label="admin.accounts.requestModel"]').setValue('claude-release-*')
    await dom().get('input[aria-label="admin.accounts.actualModel"]').setValue('upstream-release-model')
    expect(dom().text()).not.toContain('admin.accounts.wildcardOnlyAtEnd')
    expect(dom().text()).not.toContain('admin.accounts.targetNoWildcard')
    await click('admin.accounts.addMapping')
    await dom().findAll('input[aria-label="admin.accounts.requestModel"]')[1]!.setValue('discard-ag')
    await dom().findAll('input[aria-label="admin.accounts.actualModel"]')[1]!.setValue('discard-upstream')
    await dom().findAll('button[aria-label="admin.accounts.grokModelDiagnostics.removeMappingAria"]')[1]!.trigger('click')
    await submit()
    expect(writes(kind)).toHaveLength(1)
    expect(writes(kind)[0]!.body.credentials.model_mapping).toEqual({ 'claude-release-*': 'upstream-release-model' })
    expect(view.emitted(kind === 'create' ? 'created' : 'updated')).toHaveLength(1)
  })
})

describe('edit Antigravity upstream model discovery leaves a deliberate mapping intact', () => {
  it.each([
    ['empty', [], [], 'info', 'admin.accounts.syncUpstreamModelsEmpty'],
    ['unchanged', [' known-model ', ''], [], 'info', 'admin.accounts.syncUpstreamModelsNoChanges'],
    ['partial metadata', ['known-model', ' new-model '], [{ code: 'upstream_model_metadata_partial' }], 'warning', 'admin.accounts.syncUpstreamModelsMetadataPartial'],
    ['incomplete metadata', ['known-model', 'new-model'], [{ code: 'upstream_model_metadata_incomplete' }], 'warning', 'admin.accounts.syncUpstreamModelsMetadataIncomplete']
  ] as const)('handles %s using the actual model-sync API and preserves existing routing', async (_label, models, warnings, severity, message) => {
    route = async request => request.path === '/admin/accounts/84/models/sync-upstream'
      ? { models, warnings } : normal(request)
    await render('edit', account({ platform: 'antigravity', type: 'upstream', credentials: {
      base_url: 'https://upstream.example.test', model_mapping: { 'known-model': 'operator-chosen-upstream' }
    } }))
    await click('admin.accounts.syncUpstreamModels')
    expect(notices[severity]).toHaveBeenCalledWith(message)
    await submit()
    expect(writes('edit')[0]!.body.credentials.model_mapping).toEqual(models.some(model => model.trim() === 'new-model')
      ? { 'known-model': 'operator-chosen-upstream', 'new-model': 'new-model' }
      : { 'known-model': 'operator-chosen-upstream' })
  })
  it('shows a rejected model discovery error and permits a successful retry without replacing an edited target', async () => {
    let attempts = 0
    route = async request => {
      if (request.path === '/admin/accounts/84/models/sync-upstream') {
        if (attempts++ === 0) throw reject(request)
        return { models: ['new-model'] }
      }
      return normal(request)
    }
    await render('edit', account({ platform: 'antigravity', type: 'upstream', credentials: {
      base_url: 'https://upstream.example.test', model_mapping: { 'known-model': 'old-target' }
    } }))
    await dom().get('input[aria-label="admin.accounts.actualModel"]').setValue('edited-before-sync')
    await click('admin.accounts.syncUpstreamModels')
    expect(notices.error).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsError')
    expect((button('admin.accounts.syncUpstreamModels').element as HTMLButtonElement).disabled).toBe(false)
    await click('admin.accounts.syncUpstreamModels')
    await submit()
    expect(writes('edit')[0]!.body.credentials.model_mapping).toEqual({ 'known-model': 'edited-before-sync', 'new-model': 'new-model' })
  })
})

describe('release matrix: normal account configuration choices that survive the actual JSON client', () => {
  it.each(['device', 'session', 'full'])('sends the explicitly selected OpenAI OAuth %s fingerprint and CLI restrictions with an actual Codex import', async fingerprint => {
    const view = await render('create')
    await click('OpenAI')
    await field('admin.accounts.accountName').setValue('Synthetic configured OAuth import')
    await toggle('admin.accounts.openai.flattenNamespaces')
    await toggle('admin.accounts.openai.codexCLIOnly')
    await toggle('admin.accounts.openai.codexCLIOnlyAppServer')
    await choose('admin.accounts.openai.wsMode', 'admin.accounts.openai.wsModeHttpBridge')
    await choose('admin.accounts.openai.codexFingerprintMode', `admin.accounts.openai.codexFingerprint${fingerprint[0]!.toUpperCase()}${fingerprint.slice(1)}`)
    await field('admin.accounts.upstreamRequestIdHeader').setValue(' X-Synthetic-Trace ')
    await submit()
    await dom().get('input[type="radio"][value="codex_session"]').setValue(true)
    await dom().get('textarea').setValue('{"synthetic":"configured-import"}')
    await click('admin.accounts.oauth.openai.codexSessionImportAndCreate')
    const imported = requests.find(request => request.path === '/admin/accounts/import/codex-session')!
    expect(imported.body.extra).toMatchObject({
      openai_responses_flatten_namespaces: true, codex_cli_only: true,
      codex_cli_only_allow_app_server: true, codex_fingerprint_mode: fingerprint,
      openai_oauth_responses_websockets_v2_mode: 'http_bridge',
      openai_oauth_responses_websockets_v2_enabled: true, upstream_request_id_header: 'X-Synthetic-Trace'
    })
    expect(view.emitted('created')).toHaveLength(1)
  })
  it('keeps the API-key WebSocket policy in its own field when selected through the real menu', async () => {
    await prepare('create')
    await choose('admin.accounts.openai.wsMode', 'admin.accounts.openai.wsModeCtxPool')
    await submit()
    expect(writes('create')[0]!.body.extra).toMatchObject({ openai_apikey_responses_websockets_v2_mode: 'ctx_pool', openai_apikey_responses_websockets_v2_enabled: true })
    expect(writes('create')[0]!.body.extra).not.toHaveProperty('openai_oauth_responses_websockets_v2_mode')
  })
  it('keeps the final enabled OpenAI endpoint checked when the administrator tries to deselect every capability', async () => {
    await prepare('create')
    await dom().get('[data-testid="openai-endpoint-capability-chat_completions"]').setValue(false)
    await dom().get('[data-testid="openai-endpoint-capability-embeddings"]').setValue(false)
    expect((dom().get('[data-testid="openai-endpoint-capability-embeddings"]').element as HTMLInputElement).checked).toBe(true)
    await submit()
    expect(writes('create')[0]!.body.credentials.openai_capabilities).toEqual(['embeddings'])
  })
  it.each(['create', 'edit'] as const)('saves an explicit Anthropic web-search override through the %s native select', async kind => {
    const { adminAPI } = await import('@/api/admin')
    vi.mocked(adminAPI.settings.getWebSearchEmulationConfig).mockResolvedValueOnce({ enabled: true, providers: [{}] } as never)
    await prepare(kind, 'Anthropic')
    await field('admin.accounts.anthropic.webSearchEmulation').setValue('disabled')
    await submit()
    expect(writes(kind)[0]!.body.extra.web_search_emulation).toBe('disabled')
  })
  it.each(['create', 'edit'] as const)('submits an actual Gemini Vertex API key, project and location in the %s flow without a service-account JSON', async kind => {
    await render(kind, account({ platform: 'gemini', type: 'service_account', credentials: { auth_mode: 'apikey', api_key: 'synthetic-saved-vertex', tier_id: 'vertex', project_id: 'old-project', location: 'global' } }))
    if (kind === 'create') {
      await click('Gemini')
      await click('admin.accounts.vertexLabel')
      await dom().get('[data-testid="vertex-auth-mode-apikey"]').setValue(true)
      await field('admin.accounts.accountName').setValue('Synthetic Vertex API key')
      await field('API Key').setValue(' synthetic-new-vertex ')
      await field('Project ID').setValue(' synthetic-vertex-project ')
      await field('Location').setValue('us-central1')
    } else {
      await field('API Key').setValue(' synthetic-new-vertex ')
      await field('Project ID').setValue(' synthetic-vertex-project ')
      await field('Location').setValue('us-central1')
    }
    await submit()
    expect(writes(kind)[0]!.body.credentials).toMatchObject({ auth_mode: 'apikey', api_key: 'synthetic-new-vertex', project_id: 'synthetic-vertex-project', location: 'us-central1', tier_id: 'vertex' })
    expect(writes(kind)[0]!.body.credentials).not.toHaveProperty('service_account_json')
  })
  it.each(['create', 'edit'] as const)('saves all three notification choices from the real %s Bedrock quota card', async kind => {
    const { adminAPI } = await import('@/api/admin')
    vi.mocked(adminAPI.settings.getSettings).mockResolvedValueOnce({ account_quota_notify_enabled: true } as never)
    const view = await render(kind, account({ platform: 'anthropic', type: 'bedrock', credentials: { auth_mode: 'apikey', api_key: 'synthetic-saved-bedrock', aws_region: 'us-east-1' } }))
    if (kind === 'create') {
      await click('admin.accounts.bedrockLabel')
      await field('admin.accounts.accountName').setValue('Synthetic notified Bedrock')
      await dom().get('input[type="radio"][value="apikey"]').setValue(true)
      await field('admin.accounts.bedrockApiKeyInput').setValue('synthetic-bedrock')
    }
    const card = view.findComponent((await import('../QuotaLimitCard.vue')).default)
    await card.get('button').trigger('click')
    const Dimension = (await import('../QuotaDimensionRow.vue')).default
    const Notify = (await import('../QuotaNotifyToggle.vue')).default
    for (const [dimension, limit, threshold, type] of [['daily', '20', '70', 'percentage'], ['weekly', '80', '12', 'fixed'], ['total', '250', '40', 'fixed']] as const) {
      const current = card.findAllComponents(Dimension).find(node => node.props('dim') === dimension)!
      await current.get('input[type="number"]').setValue(limit)
      const notify = current.findComponent(Notify)
      await notify.get('button').trigger('click')
      await notify.get('input').setValue(threshold)
      await notify.get('select').setValue(type)
    }
    await submit()
    expect(writes(kind)[0]!.body.extra).toMatchObject({
      quota_daily_limit: 20, quota_weekly_limit: 80, quota_limit: 250,
      quota_notify_daily_enabled: true, quota_notify_daily_threshold: 70, quota_notify_daily_threshold_type: 'percentage',
      quota_notify_weekly_enabled: true, quota_notify_weekly_threshold: 12, quota_notify_weekly_threshold_type: 'fixed',
      quota_notify_total_enabled: true, quota_notify_total_threshold: 40, quota_notify_total_threshold_type: 'fixed'
    })
  })
  it.each(['create', 'edit'] as const)('reorders an edited cooling rule with a preset and removes the obsolete rule in the %s form', async kind => {
    await prepare(kind, 'Anthropic')
    await toggle('admin.accounts.tempUnschedulable.title')
    await click('admin.accounts.tempUnschedulable.addRule')
    await field('admin.accounts.tempUnschedulable.errorCode').setValue('503')
    await field('admin.accounts.tempUnschedulable.durationMinutes').setValue('6')
    await field('admin.accounts.tempUnschedulable.keywords').setValue('timeout,overloaded')
    await field('admin.accounts.tempUnschedulable.description').setValue('Synthetic retained rule')
    await click('admin.accounts.tempUnschedulable.addRule')
    await dom().findAll('button[aria-label="admin.settings.customMenu.moveDown"]')[0]!.trigger('click')
    await dom().findAll('button[aria-label="admin.settings.customMenu.moveUp"]')[1]!.trigger('click')
    await dom().get('button[aria-label="common.delete 2"]').trigger('click')
    await toggle('admin.accounts.interceptWarmupRequests')
    await submit()
    expect(writes(kind)[0]!.body.credentials).toMatchObject({ intercept_warmup_requests: true, temp_unschedulable_enabled: true,
      temp_unschedulable_rules: [{ error_code: 503, duration_minutes: 6, keywords: ['timeout', 'overloaded'], description: 'Synthetic retained rule' }] })
  })
  it('loads a legacy OpenAI capability map and preserves only the native checkbox selections in the update', async () => {
    await render('edit', account({ credentials: { openai_capabilities: { chat_completions: true, embeddings: false, seedance: false } } }))
    expect((dom().get('[data-testid="openai-endpoint-capability-chat_completions"]').element as HTMLInputElement).checked).toBe(true)
    expect((dom().get('[data-testid="openai-endpoint-capability-embeddings"]').element as HTMLInputElement).checked).toBe(false)
    await dom().get('[data-testid="openai-endpoint-capability-seedance"]').setValue(true)
    await submit()
    expect(writes('edit')[0]!.body.credentials.openai_capabilities).toEqual(['chat_completions', 'seedance'])
  })
})

describe('Gemini OAuth: administrator-selected channel and tier are carried through both real API requests', () => {
  it.each([
    ['google_one', 'google_one_free'], ['google_one', 'google_ai_pro'], ['google_one', 'google_ai_ultra'],
    ['code_assist', 'gcp_standard'], ['code_assist', 'gcp_enterprise'],
    ['ai_studio', 'aistudio_free'], ['ai_studio', 'aistudio_paid']
  ] as const)('creates a %s account with the selected %s fallback tier', async (oauthType, tier) => {
    const { adminAPI } = await import('@/api/admin')
    const geminiClient = await import('@/api/admin/gemini')
    Object.assign(adminAPI.gemini, { generateAuthUrl: geminiClient.generateAuthUrl, exchangeCode: geminiClient.exchangeCode })
    vi.mocked(adminAPI.gemini.getCapabilities).mockResolvedValueOnce({ ai_studio_oauth_enabled: true, required_redirect_uris: [] })
    route = async request => {
      if (request.path === '/admin/gemini/oauth/auth-url') return { auth_url: 'https://auth.example.test/synthetic', session_id: 'synthetic-gemini-session', state: 'synthetic-gemini-state' }
      if (request.path === '/admin/gemini/oauth/exchange-code') return {
        access_token: 'synthetic-gemini-access', refresh_token: 'synthetic-gemini-refresh', token_type: 'Bearer',
        expires_at: 1900000000, project_id: oauthType === 'code_assist' ? 'synthetic-project' : '', oauth_type: oauthType, tier_id: tier,
        extra: { synthetic_operator_metadata: 'preserved' }
      }
      return normal(request)
    }
    try {
      const view = await render('create')
      await click('Gemini')
      await field('admin.accounts.accountName').setValue(`Synthetic ${tier}`)
      if (oauthType === 'ai_studio') {
        await click('admin.accounts.gemini.oauthType.showAdvanced')
        await click('admin.accounts.gemini.oauthType.customTitle')
      } else await click(oauthType === 'code_assist' ? 'GCP Code Assist' : 'Google One')
      await field('admin.accounts.gemini.tier.label').setValue(tier)
      await submit()
      if (oauthType === 'code_assist') await dom().get('input[placeholder="admin.accounts.oauth.gemini.projectIdPlaceholder"]').setValue(' synthetic-project ')
      await click('admin.accounts.oauth.gemini.generateAuthUrl')
      const generated = requests.find(request => request.path === '/admin/gemini/oauth/auth-url')!
      expect(generated.body).toEqual({ oauth_type: oauthType, tier_id: tier, ...(oauthType === 'code_assist' ? { project_id: 'synthetic-project' } : {}) })
      expect((dom().get('input[aria-label="admin.accounts.oauth.gemini.step1GenerateUrl"]').element as HTMLInputElement).value).toBe('https://auth.example.test/synthetic')
      await field('admin.accounts.oauth.gemini.authCode').setValue('http://localhost/callback?code=synthetic-code&state=synthetic-gemini-state')
      await click('admin.accounts.oauth.completeAuth')
      expect(requests.find(request => request.path === '/admin/gemini/oauth/exchange-code')!.body).toEqual({
        session_id: 'synthetic-gemini-session', state: 'synthetic-gemini-state', code: 'synthetic-code', oauth_type: oauthType, tier_id: tier
      })
      expect(writes('create')).toHaveLength(1)
      expect(writes('create')[0]!.body).toMatchObject({ platform: 'gemini', type: 'oauth', credentials: {
        access_token: 'synthetic-gemini-access', refresh_token: 'synthetic-gemini-refresh', token_type: 'Bearer', expires_at: '1900000000', oauth_type: oauthType, tier_id: tier
      }, extra: { synthetic_operator_metadata: 'preserved' } })
      expect(view.emitted('created')).toHaveLength(1)
    } finally {
      Reflect.deleteProperty(adminAPI.gemini, 'generateAuthUrl')
      Reflect.deleteProperty(adminAPI.gemini, 'exchangeCode')
    }
  })
  it('keeps an unavailable custom OAuth client disabled and permits returning from the actual setup help without losing the account name', async () => {
    await render('create')
    await click('Gemini')
    await field('admin.accounts.accountName').setValue('Synthetic help draft')
    await click('admin.accounts.gemini.helpButton')
    expect(dom().text()).toContain('admin.accounts.gemini.setupGuide.checklistTitle')
    expect(dom().get('a[href="https://console.cloud.google.com/welcome/new"]').attributes('rel')).toBe('noreferrer')
    await click('common.close')
    expect((field('admin.accounts.accountName').element as HTMLInputElement).value).toBe('Synthetic help draft')
    await click('admin.accounts.gemini.oauthType.showAdvanced')
    expect((button('admin.accounts.gemini.oauthType.customTitle').element as HTMLButtonElement).disabled).toBe(true)
    ;(button('admin.accounts.gemini.oauthType.customTitle').element as HTMLButtonElement).click()
    await flushPromises()
    expect((field('admin.accounts.gemini.tier.label').element as HTMLSelectElement).value).toBe('google_one_free')
    await click('admin.accounts.gemini.oauthType.hideAdvanced')
    expect(dom().findAll('button').some(node => node.text().includes('admin.accounts.gemini.oauthType.customTitle'))).toBe(false)
    expect(writes('create')).toHaveLength(0)
  })
})

describe('Grok OAuth imports: actual native input and actual provider/account clients', () => {
  async function installGrokClient() {
    const { adminAPI } = await import('@/api/admin')
    Object.assign(adminAPI, { grok: (await import('@/api/admin/grok')).default })
    return () => Reflect.deleteProperty(adminAPI, 'grok')
  }
  async function configuredGrok() {
    const view = await render('create')
    await click('Grok')
    await field('admin.accounts.accountName').setValue('Synthetic configured Grok')
    await toggle('admin.accounts.grokCustomBaseUrl.title')
    await field('admin.accounts.grokCustomBaseUrl.title').setValue(' https://synthetic-relay.example.test/grok ')
    await toggle('admin.accounts.headerOverride.title')
    await click('admin.accounts.headerOverride.addRow')
    await dom().get('input[placeholder="admin.accounts.headerOverride.namePlaceholder"]').setValue('X-Synthetic-Operator')
    await dom().get('input[placeholder="admin.accounts.headerOverride.valuePlaceholder"]').setValue('release-4')
    return view
  }
  it.each(['complete', 'validation-partial', 'create-partial'] as const)('retains the correct user outcome for a %s two-token refresh import', async outcome => {
    const restore = await installGrokClient()
    route = async request => {
      if (request.path === '/admin/grok/oauth/refresh-token') {
        if (outcome === 'validation-partial' && request.body.refresh_token === 'synthetic-rt-two') throw reject(request, 'Synthetic second token invalid')
        return { access_token: `synthetic-access-${request.body.refresh_token}`, refresh_token: request.body.refresh_token,
          token_type: 'Bearer', expires_at: 1900000000, email: 'synthetic-grok@example.test', subscription_tier: 'SuperGrok',
          sso_token: 'synthetic-never-store-sso', password: 'synthetic-never-store-password' }
      }
      if (outcome === 'create-partial' && request.path === '/admin/accounts' && request.body.name.endsWith('#2')) throw reject(request, 'Synthetic second account rejected')
      return normal(request)
    }
    try {
      const view = await configuredGrok()
      await submit()
      await dom().get('input[type="radio"][value="refresh_token"]').setValue(true)
      await dom().get('textarea').setValue(' synthetic-rt-one \n\n synthetic-rt-two ')
      await click('admin.accounts.oauth.grok.validateAndCreate')
      expect(requests.filter(request => request.path === '/admin/grok/oauth/refresh-token').map(request => request.body)).toEqual([
        { refresh_token: 'synthetic-rt-one' }, { refresh_token: 'synthetic-rt-two' }
      ])
      expect(writes('create')).toHaveLength(outcome === 'validation-partial' ? 1 : 2)
      for (const request of writes('create')) {
        expect(request.body).toMatchObject({ platform: 'grok', type: 'oauth', credentials: {
          base_url: 'https://synthetic-relay.example.test/grok', header_override_enabled: true, header_overrides: { 'x-synthetic-operator': 'release-4' }
        }, extra: { email: 'synthetic-grok@example.test', subscription_tier: 'SuperGrok' } })
        expect(request.body.credentials).not.toHaveProperty('sso_token')
        expect(request.body.credentials).not.toHaveProperty('password')
      }
      expect(writes('create')[0]!.body.name).toBe('Synthetic configured Grok #1')
      expect(view.emitted('created')).toHaveLength(1)
      if (outcome === 'complete') {
        expect(notices.success).toHaveBeenCalledWith('admin.accounts.oauth.batchSuccess')
        expect(view.emitted('close')).toHaveLength(1)
      } else {
        expect(notices.warning).toHaveBeenCalledWith('admin.accounts.oauth.batchPartialSuccess')
        expect(view.emitted('close')).toBeUndefined()
        expect(dom().text()).toContain('#2:')
        expect((button('admin.accounts.oauth.grok.validateAndCreate').element as HTMLButtonElement).disabled).toBe(false)
      }
    } finally { restore() }
  })
  it.each(['complete', 'partial', 'failed'] as const)('shows a %s SSO conversion response while sending configuration only to the import endpoint', async outcome => {
    const restore = await installGrokClient()
    route = async request => request.path === '/admin/grok/sso-to-oauth' ? {
      created: outcome === 'failed' ? [] : [{ index: 1, account: { id: 85 } }],
      failed: outcome === 'complete' ? [] : [{ index: 2, error: 'Synthetic conversion rejected' }]
    } : normal(request)
    try {
      const view = await configuredGrok()
      await submit()
      await dom().get('input[type="radio"][value="sso_cookie"]').setValue(true)
      await dom().get('textarea').setValue(' synthetic-sso-one \n synthetic-sso-two ')
      await click('admin.accounts.oauth.grok.convertSSOAndCreate')
      const imported = requests.filter(request => request.path === '/admin/grok/sso-to-oauth')
      expect(imported).toHaveLength(1)
      expect(imported[0]!.body).toMatchObject({ sso_tokens: ['synthetic-sso-one', 'synthetic-sso-two'], name: 'Synthetic configured Grok',
        credentials: { base_url: 'https://synthetic-relay.example.test/grok', header_override_enabled: true, header_overrides: { 'x-synthetic-operator': 'release-4' } } })
      expect(writes('create')).toHaveLength(0)
      if (outcome === 'complete') {
        expect(notices.success).toHaveBeenCalledWith('admin.accounts.oauth.batchSuccess')
        expect(view.emitted('close')).toHaveLength(1)
      } else {
        expect(dom().text()).toContain('#2: Synthetic conversion rejected')
        expect(view.emitted('close')).toBeUndefined()
        expect((button('admin.accounts.oauth.grok.convertSSOAndCreate').element as HTMLButtonElement).disabled).toBe(false)
      }
      if (outcome === 'failed') {
        expect(notices.error).toHaveBeenCalledWith('admin.accounts.oauth.batchFailed')
        expect(view.emitted('created')).toBeUndefined()
      } else expect(view.emitted('created')).toHaveLength(1)
    } finally { restore() }
  })
})

describe('editing OAuth configuration keeps selected wire values and deliberate clearing semantics', () => {
  it.each([
    ['device', 'Plus', 'plus'], ['session', 'Pro 200', 'pro'], ['full', 'Free', 'free']
  ] as const)('saves a %s fingerprint with the administrator-selected %s plan and native CLI/WebSocket options', async (fingerprint, label, plan) => {
    await render('edit', account({ type: 'oauth' }))
    await toggle('admin.accounts.openai.flattenNamespaces')
    await toggle('admin.accounts.openai.codexCLIOnly')
    await toggle('admin.accounts.openai.codexCLIOnlyAppServer')
    await choose('admin.accounts.openai.codexFingerprintMode', `admin.accounts.openai.codexFingerprint${fingerprint[0]!.toUpperCase()}${fingerprint.slice(1)}`)
    await choose('admin.accounts.openai.planType', label)
    await choose('admin.accounts.openai.wsMode', 'admin.accounts.openai.wsModeCtxPool')
    await toggle('admin.accounts.autoPause7dDisabled')
    await submit()
    expect(writes('edit')).toHaveLength(1)
    expect(writes('edit')[0]!.body.credentials).toMatchObject({ plan_type: plan, preserved_credential: 'keep' })
    expect(writes('edit')[0]!.body.extra).toMatchObject({ preserved_extra: { release: 4 },
      openai_responses_flatten_namespaces: true, codex_cli_only: true, codex_cli_only_allow_app_server: true,
      codex_fingerprint_mode: fingerprint, openai_oauth_responses_websockets_v2_mode: 'ctx_pool',
      openai_oauth_responses_websockets_v2_enabled: true, auto_pause_7d_disabled: true })
  })
  it('clears obsolete opt-ins while preserving unrelated extra and credentials in the actual account update', async () => {
    await render('edit', account({ type: 'oauth', credentials: { preserved_credential: 'keep', plan_type: 'plus' }, extra: {
      preserved_extra: { release: 4 }, openai_responses_flatten_namespaces: true, codex_cli_only: true,
      codex_cli_only_allow_app_server: true, codex_cli_only_allowed_clients: ['obsolete-shortcut'], codex_fingerprint_mode: 'full'
    } }))
    await toggle('admin.accounts.openai.flattenNamespaces')
    await toggle('admin.accounts.openai.codexCLIOnly')
    await choose('admin.accounts.openai.codexFingerprintMode', 'admin.accounts.openai.codexFingerprintOff')
    await choose('admin.accounts.openai.planType', 'admin.accounts.openai.planTypeClear')
    await submit()
    const payload = writes('edit')[0]!.body
    expect(payload.credentials).toMatchObject({ preserved_credential: 'keep' })
    expect(payload.credentials).not.toHaveProperty('plan_type')
    expect(payload.extra).toMatchObject({ codex_cli_only: false, preserved_extra: { release: 4 } })
    for (const removed of ['openai_responses_flatten_namespaces', 'codex_cli_only_allow_app_server', 'codex_cli_only_allowed_clients', 'codex_fingerprint_mode']) expect(payload.extra).not.toHaveProperty(removed)
  })
  it('edits Anthropic window cost, session and tiered RPM limits through their actual advanced controls', async () => {
    await render('edit', account({ platform: 'anthropic', type: 'oauth' }))
    await toggle('admin.accounts.quotaControl.windowCost.label')
    await field('admin.accounts.quotaControl.windowCost.limit').setValue('200')
    await field('admin.accounts.quotaControl.windowCost.stickyReserve').setValue('15')
    await toggle('admin.accounts.quotaControl.sessionLimit.label')
    await field('admin.accounts.quotaControl.sessionLimit.maxSessions').setValue('6')
    await field('admin.accounts.quotaControl.sessionLimit.idleTimeout').setValue('11')
    await toggle('admin.accounts.quotaControl.rpmLimit.label')
    await field('admin.accounts.quotaControl.rpmLimit.baseRpm').setValue('60')
    await click('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt')
    await click('admin.accounts.quotaControl.rpmLimit.strategyTiered')
    await field('admin.accounts.quotaControl.rpmLimit.stickyBuffer').setValue('12')
    await click('admin.accounts.quotaControl.rpmLimit.umqModeSerialize')
    await toggle('admin.accounts.quotaControl.tlsFingerprint.label')
    await choose('admin.accounts.quotaControl.tlsFingerprint.label', '84')
    await toggle('admin.accounts.quotaControl.sessionIdMasking.label')
    await toggle('admin.accounts.quotaControl.cacheTTLOverride.label')
    await choose('admin.accounts.quotaControl.cacheTTLOverride.target', '1h')
    await submit()
    expect(writes('edit')[0]!.body.extra).toMatchObject({ preserved_extra: { release: 4 },
      window_cost_limit: 200, window_cost_sticky_reserve: 15, max_sessions: 6, session_idle_timeout_minutes: 11,
      base_rpm: 60, rpm_strategy: 'tiered', rpm_sticky_buffer: 12, user_msg_queue_mode: 'serialize',
      enable_tls_fingerprint: true, tls_fingerprint_profile_id: 84, session_id_masking_enabled: true,
      cache_ttl_override_enabled: true, cache_ttl_override_target: '1h'
    })
  })
})
