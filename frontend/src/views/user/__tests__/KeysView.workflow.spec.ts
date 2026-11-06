import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import KeysView from '../KeysView.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Select from '@/components/common/Select.vue'
import UseKeyModal from '@/components/keys/UseKeyModal.vue'
import { replaceAuthSession, AuthSessionChangedError } from '@/api/authSession'
import type { ApiKey, Group } from '@/types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), toggle: vi.fn(),
  groups: vi.fn(), rates: vi.fn(), settings: vi.fn(), usage: vi.fn(),
  error: vi.fn(), success: vi.fn(), copy: vi.fn(), isCurrentStep: vi.fn(), nextStep: vi.fn()
}))
vi.mock('@/api', () => ({
  keysAPI: { list: mocks.list, create: mocks.create, update: mocks.update, delete: mocks.remove, toggleStatus: mocks.toggle },
  userGroupsAPI: { getAvailable: mocks.groups, getUserGroupRates: mocks.rates },
  authAPI: { getPublicSettings: mocks.settings }, usageAPI: { getDashboardApiKeysUsage: mocks.usage }
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.error, showSuccess: mocks.success }) }))
vi.mock('@/stores/onboarding', () => ({ useOnboardingStore: () => ({ isCurrentStep: mocks.isCurrentStep, nextStep: mocks.nextStep }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: mocks.copy }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))

const Table = defineComponent({
  props: ['data', 'columns', 'selectedKeys'], emits: ['sort', 'update:selectedKeys'],
  template: '<div><article v-for="row in data" :key="row.id" :data-row="row.id"><template v-for="column in columns" :key="column.key"><slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]"/></template></article></div>'
})
const Layout = defineComponent({ template: '<div><slot name="overview"/><slot name="filters"/><slot name="actions"/><slot name="table"/><slot name="pagination"/></div>' })
const Pagination = defineComponent({ emits: ['update:page'], template: '<button data-test="next-page" @click="$emit(\'update:page\', 2)">next page</button>' })
const wrappers: VueWrapper[] = []
const groups = [
  { id: 11, name: 'Synthetic Claude group', platform: 'anthropic', rate_multiplier: 2, subscription_type: 'standard' },
  { id: 22, name: 'Synthetic OpenAI group', platform: 'openai', rate_multiplier: 1.5, subscription_type: 'standard' }
] as Group[]
let rows: ApiKey[] = []
function key(id: number, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id, user_id: 7, name: `Synthetic key ${id}`, key: `SYNTHETIC-ONLY-KEY-${id}`, group_id: 11, group: groups[0],
    status: 'active', ip_whitelist: [], ip_blacklist: [], quota: 100, quota_used: 25, expires_at: null,
    rate_limit_5h: 10, rate_limit_1d: 0, rate_limit_7d: 0, usage_5h: 6, usage_1d: 0, usage_7d: 0,
    reset_5h_at: null, reset_1d_at: null, reset_7d_at: null, window_5h_start: null, window_1d_start: null, window_7d_start: null,
    current_concurrency: 0, last_used_at: null, last_used_ip: null,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...overrides
  } as ApiKey
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function render() {
  const view = mount(KeysView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<div><slot/></div>' }, TablePageLayout: Layout, DataTable: Table, Pagination,
    Icon: true, Teleport: true, UseKeyModal: true, BulkEditKeysModal: true, EndpointPopover: true
  } } })
  wrappers.push(view)
  await flushPromises()
  return view
}
function button(view: VueWrapper, text: string) {
  const result = view.findAll('button').find(node => node.text().trim() === text)
  expect(result, text).toBeDefined()
  return result!
}
function rowButton(view: VueWrapper, id: number, text: string) {
  const result = view.get(`[data-row="${id}"]`).findAll('button').find(node => node.text().trim() === text)
  expect(result, `${id}: ${text}`).toBeDefined()
  return result!
}
function field(view: VueWrapper, text: string) {
  const label = view.findAll('label').find(node => node.text().trim() === text)
  expect(label, text).toBeDefined()
  const forID = label!.attributes('for')
  const control = forID ? document.getElementById(forID) : label!.element.parentElement!.querySelector('input, textarea')
  expect(control, text).not.toBeNull()
  return new DOMWrapper(control!)
}
function sectionSwitch(view: VueWrapper, text: string) {
  const label = view.findAll('label').find(node => node.text().trim() === text)
  expect(label, text).toBeDefined()
  return new DOMWrapper(label!.element.parentElement!.querySelector('button')!)
}
function confirmation(view: VueWrapper, title: string) {
  return view.findAllComponents(ConfirmDialog).find(dialog => dialog.props('show') && dialog.props('title') === title)!
}
async function edit(view: VueWrapper, id = 1) { await rowButton(view, id, 'common.edit').trigger('click') }
async function submit(view: VueWrapper) { await view.get('form').trigger('submit'); await flushPromises() }
async function chooseGroup(view: VueWrapper, name: string) {
  const select = view.findAllComponents(Select).find(node => node.attributes('data-tour') === 'key-form-group')!
  await select.get('.select-trigger').trigger('click')
  await flushPromises()
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.includes(name))!
  expect(option, name).toBeDefined()
  option.click()
  await flushPromises()
}
async function usingRealClipboard(writeText: (text: string) => Promise<void>, run: (fallback: ReturnType<typeof vi.fn>) => Promise<void>) {
  const realClipboard = await vi.importActual<typeof import('@/composables/useClipboard')>('@/composables/useClipboard')
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
  const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
  const fallback = vi.fn(() => true)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback })
  mocks.copy.mockImplementation(realClipboard.useClipboard().copyToClipboard)
  try {
    await run(fallback)
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (secureDescriptor) Object.defineProperty(window, 'isSecureContext', secureDescriptor)
    else Reflect.deleteProperty(window, 'isSecureContext')
    if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor)
    else Reflect.deleteProperty(document, 'execCommand')
  }
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'SYNTHETIC-LOGIN-A', user: { id: 7 } })
  Object.values(mocks).forEach(mock => mock.mockReset())
  rows = [key(1), key(2, { group_id: 22, group: groups[1], quota: 0, quota_used: 0, rate_limit_5h: 0, usage_5h: 0 })]
  mocks.list.mockResolvedValue({ items: rows, total: 2, pages: 1, page: 1, page_size: 20 })
  mocks.groups.mockResolvedValue(groups)
  mocks.rates.mockResolvedValue({ 11: 1.1 })
  mocks.settings.mockResolvedValue({ hide_ccs_import_button: true })
  mocks.usage.mockResolvedValue({ stats: {} })
  mocks.create.mockResolvedValue(key(3))
  mocks.update.mockImplementation((id, changes) => Promise.resolve({ ...rows.find(row => row.id === id), ...changes }))
  mocks.remove.mockResolvedValue({ message: 'deleted' })
  mocks.toggle.mockResolvedValue(key(1, { status: 'inactive' }))
  mocks.copy.mockResolvedValue(true)
  mocks.isCurrentStep.mockReturnValue(false)
})
afterEach(() => {
  wrappers.splice(0).forEach(view => view.unmount())
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('KeysView request ownership', () => {
  it.each(['success', 'error'])('preserves a replacement draft and its pending save after the old save %s', async outcome => {
    const first = deferred<ApiKey>()
    const second = deferred<ApiKey>()
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = await render()
    await edit(view)
    await field(view, 'keys.nameLabel').setValue('First saved draft')
    await submit(view)
    await button(view, 'common.cancel').trigger('click')
    await edit(view, 2)
    await field(view, 'keys.nameLabel').setValue('Second pending draft')
    await submit(view)
    if (outcome === 'success') first.resolve(key(1))
    else first.reject({ response: { data: { detail: 'obsolete save error' } } })
    await flushPromises()
    expect.soft(view.find('form').exists()).toBe(true)
    expect.soft(mocks.success).not.toHaveBeenCalled()
    expect.soft(mocks.error).not.toHaveBeenCalled()
    expect(view.get('[data-tour="key-form-submit"]').attributes('disabled')).toBeDefined()
    expect((field(view, 'keys.nameLabel').element as HTMLInputElement).value).toBe('Second pending draft')
    second.resolve(key(2))
    await flushPromises()
    expect(view.find('form').exists()).toBe(false)
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('keys.keyUpdatedSuccess')
  })

  it.each(['success', 'error'])('does not issue usage work or notifications after unmount during list %s', async outcome => {
    const pending = deferred<{ items: ApiKey[]; total: number; pages: number }>()
    mocks.list.mockReturnValueOnce(pending.promise)
    const view = await render()
    view.unmount()
    wrappers.splice(wrappers.indexOf(view), 1)
    if (outcome === 'success') pending.resolve({ items: rows, total: 2, pages: 1 })
    else pending.reject(new Error('late list failure'))
    await flushPromises()
    expect(mocks.usage).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('ignores an old delete completion after another delete confirmation opens', async () => {
    const pending = deferred<{ message: string }>()
    mocks.remove.mockReturnValueOnce(pending.promise)
    const view = await render()
    await rowButton(view, 1, 'common.delete').trigger('click')
    await button(confirmation(view, 'keys.deleteKey'), 'common.delete').trigger('click')
    await button(confirmation(view, 'keys.deleteKey'), 'common.cancel').trigger('click')
    await rowButton(view, 2, 'common.delete').trigger('click')
    pending.resolve({ message: 'deleted' })
    await flushPromises()
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(1)
    expect(confirmation(view, 'keys.deleteKey')).toBeDefined()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('does not reinterpret an old rate reset as a failure after closing its editor', async () => {
    const pending = deferred<ApiKey>()
    mocks.update.mockReturnValueOnce(pending.promise)
    const view = await render()
    await edit(view)
    await button(view, 'keys.resetRateLimitUsage').trigger('click')
    await button(confirmation(view, 'keys.resetRateLimitTitle'), 'keys.reset').trigger('click')
    await button(view, 'common.cancel').trigger('click')
    pending.resolve(key(1, { usage_5h: 0 }))
    await flushPromises()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(1, { reset_rate_limit_usage: true })
    expect(mocks.error).not.toHaveBeenCalled()
    expect(view.find('form').exists()).toBe(false)
  })

  it('does not close or reload from a save belonging to the previous login', async () => {
    const pending = deferred<ApiKey>()
    mocks.update.mockReturnValueOnce(pending.promise)
    const view = await render()
    await edit(view)
    await submit(view)
    replaceAuthSession({ accessToken: 'SYNTHETIC-LOGIN-B', user: { id: 7 } })
    pending.reject(new AuthSessionChangedError())
    await flushPromises()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('sends one update when the same pending form is submitted again', async () => {
    const pending = deferred<ApiKey>()
    mocks.update.mockReturnValueOnce(pending.promise)
    const view = await render()
    await edit(view)
    await submit(view)
    await submit(view)
    expect(mocks.update).toHaveBeenCalledOnce()
    pending.resolve(key(1))
    await flushPromises()
  })

  it('sends one delete while the confirmation request is pending and allows retry after failure', async () => {
    const pending = deferred<{ message: string }>()
    mocks.remove.mockReturnValueOnce(pending.promise)
    const view = await render()
    await rowButton(view, 1, 'common.delete').trigger('click')
    const confirm = confirmation(view, 'keys.deleteKey')
    await button(confirm, 'common.delete').trigger('click')
    await button(confirm, 'common.delete').trigger('click')
    expect(mocks.remove).toHaveBeenCalledOnce()
    pending.reject({ message: 'Synthetic delete rejected' })
    await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('Synthetic delete rejected')
    expect(confirmation(view, 'keys.deleteKey')).toBeDefined()
    await button(confirm, 'common.delete').trigger('click')
    await flushPromises()
    expect(mocks.remove).toHaveBeenCalledTimes(2)
    expect(confirmation(view, 'keys.deleteKey')).toBeUndefined()
  })

  it('ignores a failed obsolete list after a newer filter has loaded successfully', async () => {
    const pending = deferred<{ items: ApiKey[]; total: number; pages: number }>()
    mocks.list.mockReturnValueOnce(pending.promise)
    const view = await render()
    const status = view.findAllComponents(Select)[1]
    await status.get('.select-trigger').trigger('click')
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.includes('keys.status.inactive'))!
    option.click()
    await flushPromises()
    expect(mocks.list).toHaveBeenLastCalledWith(1, expect.any(Number), expect.objectContaining({ status: 'inactive' }), expect.any(Object))
    pending.reject(new Error('obsolete list error'))
    await flushPromises()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(view.text()).toContain('Synthetic key 2')
  })

  it('keeps quota-reset results from changing a replacement editor status or draft', async () => {
    const pending = deferred<ApiKey>()
    mocks.update.mockReturnValueOnce(pending.promise)
    const view = await render()
    await edit(view)
    await view.get('button[title="keys.resetQuotaUsed"]').trigger('click')
    await button(confirmation(view, 'keys.resetQuotaTitle'), 'keys.reset').trigger('click')
    await button(view, 'common.cancel').trigger('click')
    await edit(view, 2)
    await field(view, 'keys.nameLabel').setValue('Replacement quota draft')
    pending.resolve(key(1, { status: 'inactive', quota_used: 0 }))
    await flushPromises()
    expect(mocks.success).not.toHaveBeenCalled()
    expect((field(view, 'keys.nameLabel').element as HTMLInputElement).value).toBe('Replacement quota draft')
    expect(field(view, 'keys.statusLabel').text()).toContain('common.active')
  })
})

describe('KeysView form contracts', () => {
  it('applies the selected default thirty-day expiration when enabling it for a new key', async () => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Synthetic expiring key')
    await chooseGroup(view, 'Synthetic Claude group')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    expect.soft((field(view, 'keys.expirationDate').element as HTMLInputElement).value).not.toBe('')
    await submit(view)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0][6]).toBe(30)
  })

  it('submits the actual create HTTP payload for custom key, IP lists, quota, rate windows and expiration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-06T02:00:00Z')
    const realKeys = await vi.importActual<typeof import('@/api/keys')>('@/api/keys')
    const { apiClient } = await import('@/api/client')
    const previousAdapter = apiClient.defaults.adapter
    let payload: Record<string, unknown> | undefined
    apiClient.defaults.adapter = async config => {
      expect(config.method).toBe('post')
      expect(config.url).toBe('/keys')
      payload = JSON.parse(config.data)
      return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: key(3) } }
    }
    mocks.create.mockImplementation(realKeys.create)
    try {
      const view = await render()
      await view.get('[data-tour="keys-create-btn"]').trigger('click')
      await field(view, 'keys.nameLabel').setValue('Synthetic HTTP key')
      await chooseGroup(view, 'Synthetic Claude group')
      await sectionSwitch(view, 'keys.customKeyLabel').trigger('click')
      await view.get('input[aria-label="keys.customKeyLabel"]').setValue('ZJ_SYNTHETIC_12345678')
      await sectionSwitch(view, 'keys.ipRestriction').trigger('click')
      await field(view, 'keys.ipWhitelist').setValue(' 192.0.2.1 \n\n 198.51.100.0/24 ')
      await field(view, 'keys.ipBlacklist').setValue(' 203.0.113.5 ')
      await field(view, 'keys.quotaLimit').setValue('12.5')
      await sectionSwitch(view, 'keys.rateLimitSection').trigger('click')
      await field(view, 'keys.rateLimit5h').setValue('1.5')
      await field(view, 'keys.rateLimit1d').setValue('0')
      await field(view, 'keys.rateLimit7d').setValue('30')
      await sectionSwitch(view, 'keys.expiration').trigger('click')
      await view.findAll('button').find(node => node.text().trim() === 'keys.expiresInDays')!.trigger('click')
      await submit(view)
      expect(payload).toEqual({ name: 'Synthetic HTTP key', group_id: 11, custom_key: 'ZJ_SYNTHETIC_12345678',
        ip_whitelist: ['192.0.2.1', '198.51.100.0/24'], ip_blacklist: ['203.0.113.5'], quota: 12.5,
        expires_in_days: 7, rate_limit_5h: 1.5, rate_limit_7d: 30 })
      expect(view.find('form').exists()).toBe(false)
      expect(mocks.success).toHaveBeenCalledWith('keys.keyCreatedSuccess')
    } finally {
      apiClient.defaults.adapter = previousAdapter
    }
  })

  it('submits the actual edit HTTP payload with explicit resets and the newly chosen group', async () => {
    rows[0] = key(1, { ip_whitelist: ['192.0.2.1'], expires_at: '2030-01-01T00:00:00Z' })
    const realKeys = await vi.importActual<typeof import('@/api/keys')>('@/api/keys')
    const { apiClient } = await import('@/api/client')
    const previousAdapter = apiClient.defaults.adapter
    let payload: Record<string, unknown> | undefined
    apiClient.defaults.adapter = async config => {
      expect(config.method).toBe('put')
      expect(config.url).toBe('/keys/1')
      payload = JSON.parse(config.data)
      return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: key(1) } }
    }
    mocks.update.mockImplementation(realKeys.update)
    try {
      const view = await render()
      await edit(view)
      await field(view, 'keys.nameLabel').setValue('Edited synthetic key')
      await chooseGroup(view, 'Synthetic OpenAI group')
      await sectionSwitch(view, 'keys.ipRestriction').trigger('click')
      await sectionSwitch(view, 'keys.rateLimitSection').trigger('click')
      await sectionSwitch(view, 'keys.expiration').trigger('click')
      await field(view, 'keys.quotaLimit').setValue('')
      await submit(view)
      expect(payload).toEqual({ name: 'Edited synthetic key', group_id: 22, status: 'active', ip_whitelist: [], ip_blacklist: [],
        quota: 0, expires_at: '', rate_limit_5h: 0, rate_limit_1d: 0, rate_limit_7d: 0 })
    } finally {
      apiClient.defaults.adapter = previousAdapter
    }
  })

  it.each([
    ['', 'keys.customKeyRequired'], ['short', 'keys.customKeyTooShort'], ['INVALID+SYNTHETIC_KEY', 'keys.customKeyInvalidChars']
  ])('rejects invalid custom-key input %s without sending a create', async (value, error) => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Synthetic custom key')
    await chooseGroup(view, 'Synthetic Claude group')
    await sectionSwitch(view, 'keys.customKeyLabel').trigger('click')
    await view.get('input[aria-label="keys.customKeyLabel"]').setValue(value)
    await submit(view)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(error)
    expect(view.find('form').exists()).toBe(true)
  })

  it.each(['expired', 'quota_exhausted'] as const)('preserves derived %s until the operator explicitly reactivates it', async status => {
    rows[0] = key(1, { status })
    const view = await render()
    await edit(view)
    expect(field(view, 'keys.statusLabel').text()).toContain('common.inactive')
    await submit(view)
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('status')
    await edit(view)
    await field(view, 'keys.statusLabel').trigger('click')
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.includes('common.active'))!
    option.click()
    await submit(view)
    expect(mocks.update.mock.calls[1][1]).toMatchObject({ status: 'active' })
  })

  it('retains a failed create draft for correction and advances onboarding only after success', async () => {
    mocks.create.mockRejectedValueOnce({ response: { data: { detail: 'Synthetic create rejected' } } })
    mocks.isCurrentStep.mockReturnValue(true)
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Failed draft')
    await chooseGroup(view, 'Synthetic Claude group')
    await submit(view)
    expect(mocks.error).toHaveBeenCalledWith('Synthetic create rejected')
    expect((field(view, 'keys.nameLabel').element as HTMLInputElement).value).toBe('Failed draft')
    expect(mocks.nextStep).not.toHaveBeenCalled()
    await field(view, 'keys.nameLabel').setValue('Corrected draft')
    await submit(view)
    expect(mocks.create.mock.calls.map(call => call[0])).toEqual(['Failed draft', 'Corrected draft'])
    expect(mocks.nextStep).toHaveBeenCalledExactlyOnceWith(500)
  })

  it('names each real editable field and exposes every switch state to keyboard users', async () => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    for (const name of ['keys.customKeyLabel', 'keys.ipRestriction', 'keys.rateLimitSection', 'keys.expiration']) {
      const control = sectionSwitch(view, name)
      expect(control.attributes('role')).toBe('switch')
      expect(control.attributes('aria-label')).toBe(name)
      expect(control.attributes('aria-checked')).toBe('false')
      ;(control.element as HTMLButtonElement).focus()
      expect(document.activeElement).toBe(control.element)
      ;(control.element as HTMLButtonElement).click()
      await flushPromises()
      expect(control.attributes('aria-checked')).toBe('true')
    }
    for (const name of ['keys.nameLabel', 'keys.groupLabel', 'keys.ipWhitelist', 'keys.ipBlacklist', 'keys.quotaLimit',
      'keys.rateLimit5h', 'keys.rateLimit1d', 'keys.rateLimit7d', 'keys.expirationDate']) {
      const control = field(view, name).element as HTMLInputElement | HTMLButtonElement
      expect(control.id, name).toBeTruthy()
      expect(Array.from(control.labels || []).some(label => label.textContent?.trim() === name), name).toBe(true)
    }
    const form = view.get('form').element as HTMLFormElement
    expect((view.get('[data-tour="key-form-submit"]').element as HTMLButtonElement).form).toBe(form)
  })

  it('preserves a custom expiration draft when disabled and reenabled', async () => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await field(view, 'keys.expirationDate').setValue('2030-06-01T12:34')
    expect(button(view, 'keys.customDate').attributes('aria-pressed')).toBe('true')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    expect((field(view, 'keys.expirationDate').element as HTMLInputElement).value).toBe('2030-06-01T12:34')
  })

  it('hands the chosen key and its actual group platform to the connection instructions', async () => {
    const view = await render()
    await rowButton(view, 2, 'keys.useKey').trigger('click')
    expect(view.findComponent(UseKeyModal).props()).toMatchObject({ show: true, apiKey: rows[1].key, platform: 'openai' })
  })
})

describe('KeysView row actions and focus', () => {
  it('opens row group choices from the keyboard and returns focus on Escape or selection', async () => {
    const view = await render()
    const trigger = view.get('[data-row="1"] button[title="keys.clickToChangeGroup"]')
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('keys.searchGroup')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    const popup = view.get('[role="dialog"][aria-label="keys.groupLabel"]')
    await popup.get('input').setValue('OpenAI')
    const option = popup.findAll('button').find(node => node.text().includes('Synthetic OpenAI group'))!
    await option.trigger('click')
    await flushPromises()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(1, { group_id: 22 })
    expect(document.activeElement).toBe(trigger.element)
    expect(mocks.success).toHaveBeenCalledWith('keys.groupChangedSuccess')
  })

  it('deduplicates pending row status changes and makes a failed change retryable', async () => {
    const pending = deferred<ApiKey>()
    mocks.toggle.mockReturnValueOnce(pending.promise)
    const view = await render()
    const toggle = rowButton(view, 1, 'keys.disable')
    await toggle.trigger('click')
    expect(toggle.attributes('disabled')).toBeDefined()
    await toggle.trigger('click')
    expect(mocks.toggle).toHaveBeenCalledExactlyOnceWith(1, 'inactive')
    pending.reject(new Error('synthetic status error'))
    await flushPromises()
    expect(mocks.error).toHaveBeenCalledWith('keys.failedToUpdateStatus')
    expect(toggle.attributes('disabled')).toBeUndefined()
    mocks.list.mockResolvedValueOnce({ items: [key(1, { status: 'inactive' }), rows[1]], total: 2, pages: 1 })
    await toggle.trigger('click')
    await flushPromises()
    expect(mocks.toggle).toHaveBeenCalledTimes(2)
    expect(rowButton(view, 1, 'keys.enable')).toBeDefined()
  })

  it('does not let an earlier copied indicator clear the newer copied row', async () => {
    vi.useFakeTimers()
    const view = await render()
    await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click')
    await flushPromises()
    expect(view.find('[data-row="1"] button[title="keys.copied"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    await view.get('[data-row="2"] button[title="keys.copyToClipboard"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(500)
    expect(view.find('[data-row="2"] button[title="keys.copied"]').exists()).toBe(true)
    expect(mocks.copy.mock.calls.map(call => call[0])).toEqual([rows[0].key, rows[1].key])
    await vi.advanceTimersByTimeAsync(300)
    expect(view.find('[data-row="2"] button[title="keys.copied"]').exists()).toBe(false)
  })

  it('does not mark a failed copy as copied', async () => {
    mocks.copy.mockResolvedValue(false)
    const view = await render()
    await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click')
    await flushPromises()
    expect(view.find('button[title="keys.copied"]').exists()).toBe(false)
  })

  it('does not show delayed CC Switch fallback errors after the page unmounts', async () => {
    vi.useFakeTimers()
    mocks.settings.mockResolvedValue({ hide_ccs_import_button: false, api_base_url: 'https://synthetic.invalid', site_name: 'Synthetic gateway' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const view = await render()
    await rowButton(view, 1, 'keys.importToCcSwitch').trigger('click')
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][1]).toBe('_self')
    view.unmount()
    wrappers.splice(wrappers.indexOf(view), 1)
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('keeps the real clipboard helper from notifying an obsolete login after its write resolves', async () => {
    vi.useFakeTimers()
    const realClipboard = await vi.importActual<typeof import('@/composables/useClipboard')>('@/composables/useClipboard')
    const pending = deferred<void>()
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const secureDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => pending.promise) } })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    mocks.copy.mockImplementation(realClipboard.useClipboard().copyToClipboard)
    try {
      const view = await render()
      await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click')
      replaceAuthSession({ accessToken: 'SYNTHETIC-COPY-LOGIN-B', user: { id: 7 } })
      pending.resolve()
      await flushPromises()
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
      if (secureDescriptor) Object.defineProperty(window, 'isSecureContext', secureDescriptor)
      else Reflect.deleteProperty(window, 'isSecureContext')
    }
  })

  it('does not fall back to copying a key removed by a newer page while the native write was pending', async () => {
    vi.useFakeTimers()
    const pending = deferred<void>()
    mocks.list.mockResolvedValueOnce({ items: rows, total: 40, pages: 2 })
      .mockResolvedValueOnce({ items: [key(3)], total: 40, pages: 2 })
    await usingRealClipboard(vi.fn(() => pending.promise), async fallback => {
      const view = await render()
      await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click')
      await view.get('[data-test="next-page"]').trigger('click')
      await flushPromises()
      expect(view.find('[data-row="1"]').exists()).toBe(false)
      expect(view.find('[data-row="3"]').exists()).toBe(true)
      pending.reject(new Error('synthetic native clipboard rejection'))
      await flushPromises()
      expect.soft(fallback).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    })
  })

  it.each(['success', 'error'])('does not let an older real clipboard %s override the later key copy', async outcome => {
    vi.useFakeTimers()
    const first = deferred<void>()
    const writeText = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined)
    await usingRealClipboard(writeText, async fallback => {
      const view = await render()
      await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click')
      await view.get('[data-row="2"] button[title="keys.copyToClipboard"]').trigger('click')
      await flushPromises()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith('keys.copied')
      if (outcome === 'success') first.resolve()
      else first.reject(new Error('synthetic obsolete native copy failure'))
      await flushPromises()
      expect(fallback).not.toHaveBeenCalled()
      expect(mocks.success).toHaveBeenCalledOnce()
      expect(mocks.error).not.toHaveBeenCalled()
      expect(view.find('[data-row="2"] button[title="keys.copied"]').exists()).toBe(true)
    })
  })
})

async function nativeSubmit(view: VueWrapper) {
  const submitButton = view.get('[data-tour="key-form-submit"]').element as HTMLButtonElement
  submitButton.click()
  await flushPromises()
}

describe('Independent Keys DOM contract boundaries', () => {
  it('does not shorten the original expiry when saving only a key name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-06T02:00:30Z')
    const expires = '2026-11-06T02:00:45.321Z'
    rows[0] = key(1, { expires_at: expires })
    const view = await render()
    await edit(view)
    await field(view, 'keys.nameLabel').setValue('Renamed without expiry change')
    await nativeSubmit(view)
    expect(mocks.update).toHaveBeenCalledOnce()
    const payload = mocks.update.mock.calls[0][1]
    expect(new Date(payload.expires_at ?? expires).getTime()).toBe(new Date(expires).getTime())
  })

  it('does not create an unlimited-lifetime key while the expiration switch is still on', async () => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Expiry required')
    await chooseGroup(view, 'Synthetic Claude group')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await field(view, 'keys.expirationDate').setValue('')
    expect(sectionSwitch(view, 'keys.expiration').attributes('aria-checked')).toBe('true')
    await nativeSubmit(view)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(view.find('form').exists()).toBe(true)
  })

  it('does not clear an existing expiry while its expiration switch is still on', async () => {
    rows[0] = key(1, { expires_at: '2030-01-01T00:00:45Z' })
    const view = await render()
    await edit(view)
    await field(view, 'keys.expirationDate').setValue('')
    expect(sectionSwitch(view, 'keys.expiration').attributes('aria-checked')).toBe('true')
    await nativeSubmit(view)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(view.find('form').exists()).toBe(true)
  })

  it('does not turn a requested past expiry into a new active key with a day of validity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-06T02:00:30Z')
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Past expiry must not become future')
    await chooseGroup(view, 'Synthetic Claude group')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await field(view, 'keys.expirationDate').setValue('2020-01-01T00:00')
    await nativeSubmit(view)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('updates the current table row after quota reset overlaps a pending status refresh', async () => {
    const status = deferred<ApiKey>()
    const quota = deferred<ApiKey>()
    mocks.toggle.mockReturnValueOnce(status.promise)
    mocks.update.mockReturnValueOnce(quota.promise)
    const view = await render()
    await rowButton(view, 1, 'keys.disable').trigger('click')
    await edit(view)
    await button(view, 'keys.reset').trigger('click')
    await button(confirmation(view, 'keys.resetQuotaTitle'), 'keys.reset').trigger('click')
    mocks.list.mockResolvedValueOnce({ items: [key(1, { status: 'inactive', quota_used: 25 }), key(2)], total: 2, pages: 1 })
    status.resolve(key(1, { status: 'inactive' }))
    await flushPromises()
    quota.resolve(key(1, { status: 'inactive', quota_used: 0 }))
    await flushPromises()
    await button(view, 'common.cancel').trigger('click')
    expect(view.get('[data-row="1"]').text()).toMatch(/\$0\.00\s*\/\s*\$100\.00/)
  })

  it('preserves an already expired timestamp when only its name changes', async () => {
    const expires = '2020-01-01T12:34:56.789+08:00'
    rows[0] = key(1, { expires_at: expires, status: 'expired' })
    const view = await render()
    await edit(view)
    await field(view, 'keys.nameLabel').setValue('Renamed expired key')
    await nativeSubmit(view)
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ name: 'Renamed expired key', expires_at: expires })
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('status')
  })

  it('normalizes a deliberately edited expiration instead of restoring its old seconds', async () => {
    rows[0] = key(1, { expires_at: '2030-01-01T00:00:45.321Z' })
    const view = await render()
    await edit(view)
    const next = '2031-06-01T12:34'
    await field(view, 'keys.expirationDate').setValue(next)
    await submit(view)
    expect(mocks.update.mock.calls[0][1].expires_at).toBe(new Date(next).toISOString())
  })

  it('keeps the original expiration precision when toggled off and back on without editing the date', async () => {
    const expires = '2030-01-01T00:00:45.321Z'
    rows[0] = key(1, { expires_at: expires })
    const view = await render()
    await edit(view)
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await nativeSubmit(view)
    expect(mocks.update.mock.calls[0][1].expires_at).toBe(expires)
  })

  it.each(['create', 'edit'] as const)('guards an empty enabled expiration even when %s submit bypasses native validation', async mode => {
    rows[0] = key(1, { expires_at: '2030-01-01T00:00:45Z' })
    const view = await render()
    if (mode === 'edit') await edit(view)
    else {
      await view.get('[data-tour="keys-create-btn"]').trigger('click')
      await field(view, 'keys.nameLabel').setValue('Missing expiry')
      await chooseGroup(view, 'Synthetic Claude group')
      await sectionSwitch(view, 'keys.expiration').trigger('click')
    }
    await field(view, 'keys.expirationDate').setValue('')
    await submit(view)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
    expect(view.find('form').exists()).toBe(true)
  })

  it('guards a past create expiration when submit bypasses native validation', async () => {
    const view = await render()
    await view.get('[data-tour="keys-create-btn"]').trigger('click')
    await field(view, 'keys.nameLabel').setValue('Past expiry')
    await chooseGroup(view, 'Synthetic Claude group')
    await sectionSwitch(view, 'keys.expiration').trigger('click')
    await field(view, 'keys.expirationDate').setValue('2020-01-01T00:00')
    await submit(view)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
    expect(view.find('form').exists()).toBe(true)
  })

  it('does not reinstall a list snapshot read before a successful quota reset', async () => {
    const status = deferred<ApiKey>()
    const quota = deferred<ApiKey>()
    const oldList = deferred<{ items: ApiKey[], total: number, pages: number }>()
    mocks.toggle.mockReturnValueOnce(status.promise)
    mocks.update.mockReturnValueOnce(quota.promise)
    const view = await render()
    await rowButton(view, 1, 'keys.disable').trigger('click')
    await edit(view)
    await button(view, 'keys.reset').trigger('click')
    await button(confirmation(view, 'keys.resetQuotaTitle'), 'keys.reset').trigger('click')
    mocks.list.mockReturnValueOnce(oldList.promise)
    status.resolve(key(1, { status: 'inactive' }))
    await flushPromises()
    quota.resolve(key(1, { status: 'inactive', quota_used: 0 }))
    await flushPromises()
    mocks.list.mockResolvedValueOnce({ items: [key(1, { status: 'inactive', quota_used: 0 }), key(2)], total: 2, pages: 1 })
    oldList.resolve({ items: [key(1, { status: 'inactive', quota_used: 25 }), key(2)], total: 2, pages: 1 })
    await flushPromises()
    await button(view, 'common.cancel').trigger('click')
    expect(view.get('[data-row="1"]').text()).toMatch(/\$0\.00\s*\/\s*\$100\.00/)
    expect(rowButton(view, 1, 'keys.enable')).toBeDefined()
    expect(mocks.list).toHaveBeenCalledTimes(3)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('does not let an older quota-reset status reactivate a freshly disabled row', async () => {
    const status = deferred<ApiKey>()
    const quota = deferred<ApiKey>()
    mocks.toggle.mockReturnValueOnce(status.promise)
    mocks.update.mockReturnValueOnce(quota.promise)
    const view = await render()
    await rowButton(view, 1, 'keys.disable').trigger('click')
    await edit(view)
    await button(view, 'keys.reset').trigger('click')
    await button(confirmation(view, 'keys.resetQuotaTitle'), 'keys.reset').trigger('click')
    mocks.list.mockResolvedValueOnce({ items: [key(1, { status: 'inactive' }), key(2)], total: 2, pages: 1 })
    status.resolve(key(1, { status: 'inactive' }))
    await flushPromises()
    quota.resolve(key(1, { status: 'active', quota_used: 0 }))
    await flushPromises()
    expect(field(view, 'keys.statusLabel').text()).toContain('common.inactive')
    await button(view, 'common.cancel').trigger('click')
    expect(rowButton(view, 1, 'keys.enable')).toBeDefined()
    expect(view.get('[data-row="1"]').text()).toMatch(/\$0\.00\s*\/\s*\$100\.00/)
  })
})

