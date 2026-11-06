import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import EditAccountModal from '../EditAccountModal.vue'

const { update, checkRisk, getUsage, refreshUsage, setAutoRefresh, syncModels, showError, showSuccess, showInfo, showWarning } = vi.hoisted(() => ({
  update: vi.fn(), checkRisk: vi.fn(), getUsage: vi.fn(), refreshUsage: vi.fn(), setAutoRefresh: vi.fn(), syncModels: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: {
  accounts: { update, checkMixedChannelRisk: checkRisk, getOpenCodeGoUsage: getUsage, refreshOpenCodeGoUsage: refreshUsage, setOpenCodeGoUsageAutoRefresh: setAutoRefresh, syncUpstreamModels: syncModels },
  settings: { getSettings: vi.fn().mockResolvedValue({}), getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }) },
  tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([]) }
} }))
vi.mock('@/api/admin/accounts', () => ({ getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError, showSuccess, showWarning, showInfo }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const Dialog = defineComponent({ props: ['show'], emits: ['close'], template: '<div v-if="show"><button data-testid="dismiss" @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></div>' })
const Confirm = defineComponent({ props: ['show'], emits: ['confirm', 'cancel'], template: '<div v-if="show" data-testid="risk-dialog"><button data-testid="confirm" @click="$emit(\'confirm\')">confirm</button><button data-testid="cancel-risk" @click="$emit(\'cancel\')">cancel</button></div>' })
const Select = defineComponent({ props: ['modelValue', 'options'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>' })
const Toggle = defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<button :disabled="disabled" :aria-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)">toggle</button>' })
const wrappers: VueWrapper[] = []
function account(patch: Record<string, unknown> = {}) {
  return { id: 1, name: 'Synthetic account', platform: 'openai', type: 'apikey', credentials: { base_url: 'https://synthetic.example/v1' }, credentials_status: { has_api_key: true },
    extra: {}, notes: '', proxy_id: null, concurrency: 2, load_factor: null, priority: 1, rate_multiplier: 1, status: 'active', group_ids: [], expires_at: null, auto_pause_on_expired: false, ...patch } as any
}
function modal(value = account(), realControls = false) {
  const wrapper = mount(EditAccountModal, { props: { show: true, account: value, groups: [], proxies: [] }, global: { stubs: {
    BaseDialog: Dialog, ConfirmDialog: Confirm, Select: realControls ? false : Select, Toggle: realControls ? false : Toggle, Icon: true, GroupSelector: true, ProxySelector: true, QuotaLimitCard: true, ModelWhitelistSelector: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
function field(wrapper: VueWrapper, text: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === text)
  expect(label, text).toBeDefined()
  const element = label!.element.parentElement!.querySelector('input, select, textarea')
  expect(element, text).not.toBeNull()
  return new DOMWrapper(element!)
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const usage = (patch: Record<string, unknown> = {}) => ({ eligible: true, auto_refresh_enabled: false, snapshot: { status: 'ok', fetched_at: '2026-01-01T00:00:00Z', data: { rolling: { percent: 12.5 }, weekly: { percent: 20 } } }, ...patch })
beforeEach(() => {
  vi.clearAllMocks()
  update.mockReset().mockImplementation((id, payload) => Promise.resolve(account({ ...payload, id })))
  checkRisk.mockReset().mockResolvedValue({ has_risk: false })
  getUsage.mockReset().mockResolvedValue(usage())
  refreshUsage.mockReset().mockResolvedValue(usage())
  setAutoRefresh.mockReset().mockImplementation((_id, enabled) => Promise.resolve(usage({ auto_refresh_enabled: enabled })))
  syncModels.mockReset().mockResolvedValue({ models: ['existing', 'new-model'], warnings: [] })
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('EditAccountModal save workflow', () => {
  it.each([
    ['openai', 'apikey', { base_url: 'https://synthetic.example/v1' }],
    ['openai', 'oauth', {}],
    ['anthropic', 'apikey', { base_url: 'https://synthetic.example/v1' }],
    ['anthropic', 'oauth', {}],
    ['anthropic', 'bedrock', { auth_mode: 'sigv4', aws_access_key_id: 'SYNTHETIC', aws_region: 'us-east-1' }],
    ['gemini', 'service_account', { project_id: 'synthetic-project', location: 'global' }],
    ['gemini', 'apikey', { base_url: 'https://generativelanguage.googleapis.com' }],
    ['grok', 'oauth', {}],
    ['antigravity', 'oauth', {}]
  ])('gives %s/%s editable native fields and switches visible accessible names', async (platform, type, credentials) => {
    const wrapper = modal(account({ platform, type, credentials }), true)
    await flushPromises()
    const fields = wrapper.findAll('input:not([type="hidden"]), textarea, select, button[role="switch"], button[aria-haspopup="true"]')
    expect(fields.length).toBeGreaterThan(5)
    for (const control of fields) {
      const el = control.element as HTMLInputElement
      const name = el.getAttribute('aria-label') || Array.from(el.labels || []).map(label => label.textContent).join(' ').trim()
      expect(name, `${platform}/${type}: ${el.outerHTML}`).toBeTruthy()
    }
    const ids = wrapper.findAll('[id]').map(control => control.attributes('id'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps mapping row IDs and entered values with the remaining row after removal', async () => {
    const wrapper = modal(account({ credentials: { base_url: 'https://synthetic.example', model_mapping: { 'synthetic-first': 'target-first', 'synthetic-second': 'target-second' } } }), true)
    const inputs = wrapper.findAll('input[placeholder="admin.accounts.requestModel"]')
    expect(inputs).toHaveLength(2)
    const remainingID = inputs[1].attributes('id')
    expect(remainingID).toBeTruthy()
    expect(remainingID).not.toBe(inputs[0].attributes('id'))
    expect(inputs[1].attributes('aria-label')).toBe('admin.accounts.requestModel')
    const firstRow = inputs[0].element.parentElement!
    const remove = new DOMWrapper(firstRow.querySelector('button')!)
    expect(remove.attributes('aria-label')).toBeTruthy()
    await remove.trigger('click')
    const remaining = wrapper.get('input[placeholder="admin.accounts.requestModel"]')
    expect(remaining.attributes('id')).toBe(remainingID)
    expect((remaining.element as HTMLInputElement).value).toBe('synthetic-second')
    await submit(wrapper)
    expect(update.mock.calls[0][1].credentials.model_mapping).toEqual({ 'synthetic-second': 'target-second' })
  })

  it.each([
    ['0', 100], ['-5', 1], ['30.8', 30], ['150', 100], ['', 100]
  ])('normalizes an explicitly enabled scheduling threshold %s to %s on submit', async (value, expected) => {
    const wrapper = modal()
    await wrapper.get('[data-testid="account-scheduling-threshold-override-enabled"]').setValue(true)
    await wrapper.get('[data-testid="account-scheduling-threshold-override-value"]').setValue(value)
    await submit(wrapper)
    expect(update.mock.calls[0][1].credentials.account_scheduling_threshold).toBe(expected)
  })

  it('adds a custom upstream status code from the keyboard without duplicates', async () => {
    const wrapper = modal(account({ platform: 'anthropic' }), true)
    await wrapper.get('button[role="switch"][aria-label="admin.accounts.customErrorCodes"]').trigger('click')
    const code = wrapper.get('input[placeholder="admin.accounts.enterErrorCode"]')
    await code.setValue('503')
    await code.trigger('keyup', { key: 'Enter' })
    await code.setValue('503')
    await code.trigger('keyup', { key: 'Enter' })
    await submit(wrapper)
    expect(update.mock.calls[0][1].credentials.custom_error_codes.filter((value: number) => value === 503)).toEqual([503])
    expect(update.mock.calls[0][1].credentials.custom_error_codes_enabled).toBe(true)
    expect(showInfo).toHaveBeenCalledWith('admin.accounts.errorCodeExists')
  })
  it('connects visible editable field labels to their controls', () => {
    const wrapper = modal()
    for (const key of ['common.name', 'admin.accounts.notes', 'admin.accounts.concurrency', 'admin.accounts.expiresAt']) {
      const label = wrapper.findAll('label').find(label => label.text() === key)!
      const control = field(wrapper, key)
      expect(control.attributes('id'), key).toBeTruthy()
      expect(label.attributes('for'), key).toBe(control.attributes('id'))
    }
  })
  it('preserves redacted secrets, clears nullable sentinels and emits the returned account', async () => {
    const wrapper = modal()
    await field(wrapper, 'common.name').setValue('Edited synthetic')
    await submit(wrapper)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toBe(1)
    expect(update.mock.calls[0][1]).toMatchObject({ name: 'Edited synthetic', proxy_id: 0, load_factor: 0, expires_at: 0, credentials: { base_url: 'https://synthetic.example/v1' } })
    expect(update.mock.calls[0][1].credentials).not.toHaveProperty('api_key')
    expect(wrapper.emitted('updated')?.[0][0]).toMatchObject({ id: 1, name: 'Edited synthetic' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('retains a failed update draft and retries the corrected values', async () => {
    update.mockRejectedValueOnce({ message: 'synthetic write failed' })
    const wrapper = modal()
    await submit(wrapper)
    expect(showError).toHaveBeenCalledWith('synthetic write failed')
    expect(wrapper.emitted('close')).toBeUndefined()
    await field(wrapper, 'common.name').setValue('Retry name')
    await submit(wrapper)
    expect(update.mock.calls[1][1].name).toBe('Retry name')
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it('normalizes an unknown backend status to active before saving', async () => {
    const wrapper = modal(account({ status: 'unknown' }))
    await submit(wrapper)
    expect(update.mock.calls[0][1].status).toBe('active')
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['sigv4', 'apikey'])('keeps redacted Bedrock %s secrets on an untouched save', async (mode) => {
    const credentials = mode === 'sigv4'
      ? { auth_mode: mode, aws_access_key_id: 'SYNTHETIC_ACCESS', aws_region: 'us-east-1', aws_force_global: 'true' }
      : { auth_mode: mode, aws_region: 'us-east-1' }
    const wrapper = modal(account({ platform: 'anthropic', type: 'bedrock', credentials }))
    await submit(wrapper)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][1].credentials).toMatchObject(credentials)
    expect(update.mock.calls[0][1].credentials).not.toHaveProperty('api_key')
    expect(update.mock.calls[0][1].credentials).not.toHaveProperty('aws_secret_access_key')
    expect(update.mock.calls[0][1].credentials).not.toHaveProperty('aws_session_token')
  })

  it('rotates Bedrock SigV4 secrets and disables forced global routing', async () => {
    const wrapper = modal(account({ platform: 'anthropic', type: 'bedrock', credentials: { auth_mode: 'sigv4', aws_access_key_id: 'OLD_ACCESS', aws_region: 'us-east-1', aws_force_global: 'true' } }))
    await field(wrapper, 'admin.accounts.bedrockAccessKeyId').setValue(' NEW_ACCESS ')
    await field(wrapper, 'admin.accounts.bedrockSecretAccessKey').setValue(' new-secret ')
    await field(wrapper, 'admin.accounts.bedrockSessionToken').setValue(' new-session ')
    const force = wrapper.findAll('input[type="checkbox"]').find(candidate => candidate.element.parentElement?.textContent?.includes('admin.accounts.bedrockForceGlobal'))
    expect(force).toBeDefined()
    await force!.setValue(false)
    await submit(wrapper)
    expect(update.mock.calls[0][1].credentials).toMatchObject({ aws_access_key_id: 'NEW_ACCESS', aws_secret_access_key: 'new-secret', aws_session_token: 'new-session' })
    expect(update.mock.calls[0][1].credentials).not.toHaveProperty('aws_force_global')
  })

  it('waits for mixed-channel consent and retries the captured account payload', async () => {
    checkRisk.mockResolvedValue({ has_risk: true, message: 'synthetic risk' })
    const wrapper = modal(account({ platform: 'anthropic', type: 'oauth', credentials: { access_token: 'synthetic-token' } }))
    await submit(wrapper)
    expect(update).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="cancel-risk"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    await submit(wrapper)
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()
    expect(checkRisk).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]).toEqual([1, expect.objectContaining({ confirm_mixed_channel_risk: true })])
  })

  it('uses server conflict fallback and permits cancelling without retrying', async () => {
    update.mockRejectedValueOnce({ status: 409, error: 'mixed_channel_warning', message: 'server risk' })
    const wrapper = modal(account({ platform: 'anthropic', type: 'oauth' }))
    await submit(wrapper)
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(true)
    await wrapper.get('[data-testid="cancel-risk"]').trigger('click')
    expect(update).toHaveBeenCalledTimes(1)
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('prevents duplicate save requests while the first update is pending', async () => {
    const request = deferred<any>()
    update.mockReturnValueOnce(request.promise)
    const wrapper = modal()
    await submit(wrapper)
    await submit(wrapper)
    expect(update).toHaveBeenCalledTimes(1)
    request.resolve(account())
    await flushPromises()
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it.each(['account', 'close', 'unmount'])('discards a mixed-channel precheck after changing %s', async (change) => {
    const request = deferred<any>()
    checkRisk.mockReturnValueOnce(request.promise)
    const wrapper = modal(account({ platform: 'anthropic', type: 'oauth' }))
    await submit(wrapper)
    if (change === 'account') await wrapper.setProps({ account: account({ id: 9 }) })
    if (change === 'close') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'unmount') wrapper.unmount()
    request.resolve({ has_risk: false })
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['success', 'error', 'risk'])('does not let a prior account %s affect the current editor', async (outcome) => {
    const request = deferred<any>()
    update.mockReturnValueOnce(request.promise)
    const wrapper = modal(account({ platform: 'anthropic', type: 'oauth' }))
    await submit(wrapper)
    await wrapper.setProps({ account: account({ id: 9, name: 'New synthetic account' }) })
    if (outcome === 'success') request.resolve(account({ platform: 'anthropic', type: 'oauth' }))
    else request.reject(outcome === 'risk' ? { status: 409, error: 'mixed_channel_warning' } : { message: 'old failure' })
    await flushPromises()
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="risk-dialog"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[data-tour="edit-account-form-name"]').element.value).toBe('New synthetic account')
    await submit(wrapper)
    expect(update.mock.calls[1][0]).toBe(9)
  })
})

describe('EditAccountModal OpenCode usage workflow', () => {
  it('loads a fresh usage request when a pending same-account editor is closed and reopened', async () => {
    const request = deferred<any>()
    getUsage.mockReturnValueOnce(request.promise)
    const wrapper = modal(account({ platform: 'opencode_go', opencode_go_usage: usage({ snapshot: null }) }))
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(getUsage).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="opencode-go-usage-details"]').text()).toContain('12.5%')
    request.resolve(usage({ snapshot: { status: 'unauthorized' } }))
    await flushPromises()
    expect(wrapper.get('[data-testid="opencode-go-usage-details"]').text()).toContain('12.5%')
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })
  it('loads an eligible account without a snapshot and displays its returned usage', async () => {
    const wrapper = modal(account({ platform: 'opencode_go', opencode_go_usage: usage({ snapshot: null }) }))
    await flushPromises()
    expect(getUsage).toHaveBeenCalledExactlyOnceWith(1)
    expect(wrapper.get('[data-testid="opencode-go-usage-details"]').text()).toContain('12.5%')
    expect(wrapper.emitted('updated')?.[0][0]).toMatchObject({ id: 1, opencode_go_usage: usage() })
  })

  it('refreshes usage and persists the auto-refresh choice through dedicated endpoints', async () => {
    const wrapper = modal(account({ platform: 'opencode_go', opencode_go_usage: usage() }))
    await wrapper.get('[data-testid="opencode-go-refresh"]').trigger('click')
    await flushPromises()
    expect(refreshUsage).toHaveBeenCalledExactlyOnceWith(1)
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.opencodeGo.refreshSuccess')
    await wrapper.get('[data-testid="opencode-go-auto-refresh"]').trigger('click')
    await flushPromises()
    expect(setAutoRefresh).toHaveBeenCalledExactlyOnceWith(1, true)
    expect(wrapper.get('[data-testid="opencode-go-auto-refresh"]').attributes('aria-checked')).toBe('true')
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['load', 'refresh', 'toggle'])('shows a usage %s failure while preserving the account draft', async (action) => {
    const error = { message: `synthetic ${action} failure` }
    const wrapper = action === 'load'
      ? (getUsage.mockRejectedValueOnce(error), modal(account({ platform: 'opencode_go', opencode_go_usage: usage({ snapshot: null }) })))
      : modal(account({ platform: 'opencode_go', opencode_go_usage: usage() }))
    if (action === 'refresh') { refreshUsage.mockRejectedValueOnce(error); await wrapper.get('[data-testid="opencode-go-refresh"]').trigger('click') }
    if (action === 'toggle') { setAutoRefresh.mockRejectedValueOnce(error); await wrapper.get('[data-testid="opencode-go-auto-refresh"]').trigger('click') }
    await flushPromises()
    expect(showError).toHaveBeenCalledWith(`synthetic ${action} failure`)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get<HTMLInputElement>('[data-tour="edit-account-form-name"]').element.value).toBe('Synthetic account')
  })

  it.each(['load', 'refresh', 'toggle'])('does not attribute a previous account usage %s to the new account', async (action) => {
    const request = deferred<any>()
    if (action === 'load') getUsage.mockReturnValueOnce(request.promise)
    const wrapper = modal(account({ platform: 'opencode_go', opencode_go_usage: usage(action === 'load' ? { snapshot: null } : {}) }))
    if (action === 'refresh') { refreshUsage.mockReturnValueOnce(request.promise); await wrapper.get('[data-testid="opencode-go-refresh"]').trigger('click') }
    if (action === 'toggle') { setAutoRefresh.mockReturnValueOnce(request.promise); await wrapper.get('[data-testid="opencode-go-auto-refresh"]').trigger('click') }
    await wrapper.setProps({ account: account({ id: 9 }) })
    request.resolve(usage({ auto_refresh_enabled: true }))
    await flushPromises()
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })
})

describe('EditAccountModal Antigravity catalog workflow', () => {
  const antigravity = () => account({ platform: 'antigravity', type: 'oauth', credentials: { access_token: 'synthetic-access', model_mapping: { existing: 'custom-target' } } })
  async function sync(wrapper: VueWrapper) {
    const button = wrapper.findAll('button').find(candidate => candidate.text() === 'admin.accounts.syncUpstreamModels')
    expect(button).toBeDefined()
    await button!.trigger('click')
    await flushPromises()
  }

  it('appends newly discovered models and preserves an existing mapped target', async () => {
    const wrapper = modal(antigravity())
    await sync(wrapper)
    expect(syncModels).toHaveBeenCalledExactlyOnceWith(1)
    await submit(wrapper)
    expect(update.mock.calls[0][1].credentials.model_mapping).toEqual({ existing: 'custom-target', 'new-model': 'new-model' })
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsSuccess')
  })

  it.each([
    [{ models: [] }, 'info', 'admin.accounts.syncUpstreamModelsEmpty'],
    [{ models: ['existing'] }, 'info', 'admin.accounts.syncUpstreamModelsNoChanges'],
    [{ models: ['new-model'], warnings: [{ code: 'upstream_model_metadata_incomplete' }] }, 'warning', 'admin.accounts.syncUpstreamModelsMetadataIncomplete'],
    [{ models: ['new-model'], warnings: [{ code: 'upstream_model_metadata_partial' }] }, 'warning', 'admin.accounts.syncUpstreamModelsMetadataPartial']
  ])('reports the upstream synchronization result', async (result, kind, message) => {
    syncModels.mockResolvedValueOnce(result)
    await sync(modal(antigravity()))
    expect(kind === 'info' ? showInfo : showWarning).toHaveBeenCalledWith(message)
  })

  it.each(['account', 'reopen', 'unmount'])('ignores a synchronization completed after changing %s', async (change) => {
    const request = deferred<any>()
    syncModels.mockReturnValueOnce(request.promise)
    const wrapper = modal(antigravity())
    await sync(wrapper)
    if (change === 'account') await wrapper.setProps({ account: account({ id: 9, platform: 'antigravity', type: 'oauth', credentials: { model_mapping: { fresh: 'fresh-target' } } }) })
    if (change === 'reopen') { await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }) }
    if (change === 'unmount') wrapper.unmount()
    request.resolve({ models: ['old-catalog-model'], warnings: [] })
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showWarning).not.toHaveBeenCalled()
    if (change === 'account') {
      await submit(wrapper)
      expect(update.mock.calls[0][1].credentials.model_mapping).toEqual({ fresh: 'fresh-target' })
    }
  })
})
