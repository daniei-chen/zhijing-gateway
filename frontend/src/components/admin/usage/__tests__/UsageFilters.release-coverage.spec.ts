import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Filters from '../UsageFilters.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('@/api/admin', async () => ({ adminAPI: { usage: await import('@/api/admin/usage'), accounts: await import('@/api/admin/accounts'), groups: await import('@/api/admin/groups') } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
const wire: Array<{ path: string; query: Record<string, string> }> = []
let failures: Set<string>
const user = { id: 7, email: 'member@synthetic.invalid', deleted: false }
const key = { id: 8, name: 'Synthetic key' }
const account = { id: 41, name: 'Synthetic upstream' }
const inputs = { user: 'input[placeholder="admin.usage.searchUserPlaceholder"]', key: 'input[placeholder="admin.usage.searchApiKeyPlaceholder"]', account: 'input[placeholder="admin.usage.searchAccountPlaceholder"]' }
type Props = InstanceType<typeof Filters>['$props']
async function host(extra: Partial<Props> = {}) {
  const model = reactive<Record<string, unknown>>({ user_id: undefined, api_key_id: undefined, account_id: undefined, model: null, request_type: null, native_compaction_v2: null, billing_type: null, billing_mode: null, upstream_model_mismatch: null, group_id: null, phase: null, error_category: null, status_code: null })
  const view = mount(Filters, { attachTo: document.body, props: { modelValue: model, exporting: false, startDate: '2030-01-01', endDate: '2030-01-02', modelOptions: ['synthetic-model'], ...extra } })
  await flushPromises(); return { view, model }
}
async function choose(view: ReturnType<typeof mount>, title: string, option: string) {
  const label = view.findAll('label').find(item => item.text() === title)
  expect(label, title).toBeDefined()
  await new DOMWrapper(label!.element.parentElement!).get('button.select-trigger').trigger('click')
  await flushPromises()
  const selected = new DOMWrapper(document.body).findAll('[role="option"]').find(item => item.text() === option)
  expect(selected, option).toBeDefined(); await selected!.trigger('click'); await flushPromises()
}
async function tick() { await vi.advanceTimersByTimeAsync(300); await flushPromises() }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-filter-session', user: { id: 7, role: 'admin' } })
  wire.length = 0; failures = new Set()
  apiClient.defaults.adapter = async config => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid')
    const query = Object.fromEntries(url.searchParams); expect(query.timezone).toBeTruthy(); delete query.timezone
    wire.push({ path: url.pathname, query })
    let value: unknown
    switch (url.pathname) {
      case '/api/v1/admin/groups': value = { items: [{ id: 4, name: 'Synthetic group' }] }; break
      case '/api/v1/admin/usage/search-users': value = [user]; break
      case '/api/v1/admin/usage/search-api-keys': value = query.q === 'nameless' ? [{ id: 9, name: '' }] : [key]; break
      case '/api/v1/admin/accounts': value = { items: [account] }; break
      default: throw new Error(`Unexpected synthetic filter request ${url.pathname}`)
    }
    const response = { config, status: failures.has(url.pathname) ? 422 : 200, statusText: 'Synthetic filter result', headers: {}, data: failures.has(url.pathname) ? { code: 422, message: 'Synthetic lookup refused' } : { code: 0, data: value } }
    if (response.status >= 400) throw new AxiosError('Synthetic lookup refused', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('admin usage filtering through native controls and actual HTTP serialization', () => {
  it('chooses a user, clears an old key, then queries that user’s keys', async () => {
    const { view, model } = await host()
    model.api_key_id = 99
    const field = view.get<HTMLInputElement>(inputs.user)
    await field.trigger('focus'); await field.setValue(' member + '); await tick()
    expect(wire.find(item => item.path.endsWith('search-users'))?.query).toEqual({ q: 'member +' })
    await view.findAll('button').find(item => item.text().includes(user.email))!.trigger('click'); await flushPromises()
    expect(model).toMatchObject({ user_id: 7, api_key_id: undefined })
    expect(wire.at(-1)).toEqual({ path: '/api/v1/admin/usage/search-api-keys', query: { user_id: '7' } })
    await view.get(inputs.key).trigger('focus')
    await view.findAll('button').find(item => item.text().includes('Synthetic key'))!.trigger('click')
    expect(model.api_key_id).toBe(8)
    await view.get('button[aria-label="Clear API key filter"]').trigger('click')
    expect(model.api_key_id).toBeUndefined(); expect(view.get<HTMLInputElement>(inputs.key).element.value).toBe('')
    await view.get('button[aria-label="Clear user filter"]').trigger('click')
    expect(model.user_id).toBeUndefined(); expect(view.get<HTMLInputElement>(inputs.user).element.value).toBe('')
    expect(view.emitted('change')?.length).toBeGreaterThanOrEqual(4)
  })

  it('debounces global key search, preserves its literal query and displays a nameless key by ID', async () => {
    const { view, model } = await host()
    const field = view.get<HTMLInputElement>(inputs.key)
    await field.trigger('focus'); await field.setValue('first'); await field.setValue('nameless')
    expect(wire.filter(item => item.path.endsWith('search-api-keys'))).toHaveLength(0)
    await tick()
    expect(wire.filter(item => item.path.endsWith('search-api-keys'))).toEqual([{ path: '/api/v1/admin/usage/search-api-keys', query: { q: 'nameless' } }])
    await view.findAll('button').find(item => item.text().startsWith('#9'))!.trigger('click')
    expect(model.api_key_id).toBe(9); expect(field.element.value).toBe('9')
    model.api_key_id = undefined; await flushPromises(); expect(field.element.value).toBe('')
  })

  it('looks up an upstream by keyword and clears the selected account without retaining stale text', async () => {
    const { view, model } = await host()
    const field = view.get<HTMLInputElement>(inputs.account)
    await field.trigger('focus'); await field.setValue('first'); await field.setValue('Synthetic +'); await tick()
    const request = wire.find(item => item.path.endsWith('/accounts'))!
    expect(request.query).toEqual({ page: '1', page_size: '20', search: 'Synthetic +' })
    await view.findAll('button').find(item => item.text().includes(account.name))!.trigger('click')
    expect(model.account_id).toBe(41); expect(field.element.value).toBe(account.name)
    await view.get('button[aria-label="Clear account filter"]').trigger('click')
    expect(model.account_id).toBeUndefined(); expect(field.element.value).toBe('')
    await field.setValue(''); await tick()
    expect(wire.filter(item => item.path.endsWith('/accounts'))).toHaveLength(1)
  })

  it.each(['user', 'key', 'account'] as const)('keeps the %s search usable after a definitive lookup failure', async kind => {
    const path = kind === 'user' ? '/api/v1/admin/usage/search-users' : kind === 'key' ? '/api/v1/admin/usage/search-api-keys' : '/api/v1/admin/accounts'
    failures.add(path)
    const { view } = await host()
    const field = view.get<HTMLInputElement>(inputs[kind]); await field.trigger('focus'); await field.setValue('synthetic'); await tick()
    expect(view.text()).not.toContain(kind === 'user' ? user.email : kind === 'key' ? key.name : account.name)
    failures.clear(); await field.setValue('retry'); await tick()
    expect(view.text()).toContain(kind === 'user' ? user.email : kind === 'key' ? key.name : account.name)
  })

  it('retains the selected user when its automatic key lookup is refused', async () => {
    failures.add('/api/v1/admin/usage/search-api-keys')
    const { view, model } = await host()
    await view.get(inputs.user).trigger('focus'); await view.get(inputs.user).setValue('synthetic'); await tick()
    await view.findAll('button').find(item => item.text().includes(user.email))!.trigger('click'); await flushPromises()
    expect(model.user_id).toBe(7); expect(model.api_key_id).toBeUndefined()
    expect(view.emitted('change')).toHaveLength(1)
  })

  it('closes lookup results on outside click and updates the public date inputs', async () => {
    const { view, model } = await host()
    await view.get(inputs.user).trigger('focus'); await view.get(inputs.user).setValue('synthetic'); await tick()
    expect(view.text()).toContain(user.email)
    document.body.click(); await flushPromises(); expect(view.text()).not.toContain(user.email)
    await view.setProps({ startDate: '2030-02-01', endDate: '2030-02-05' })
    expect(model).toMatchObject({ start_date: '2030-02-01', end_date: '2030-02-05' })
    await view.get(inputs.user).setValue('   '); await tick()
    expect(wire.filter(item => item.path.endsWith('search-users'))).toHaveLength(1)
  })

  it('preserves independent model, transport, billing and group filters, including false and zero', async () => {
    const { view, model } = await host()
    await choose(view, 'usage.model', 'synthetic-model')
    await choose(view, 'usage.type', 'usage.ws')
    await choose(view, 'usage.compactionFilter', 'usage.compactionOnly')
    await choose(view, 'admin.usage.billingType', 'admin.usage.billingTypeBalance')
    await choose(view, 'admin.usage.billingMode', 'admin.usage.billingModeImage')
    await choose(view, 'admin.usage.upstreamModelAudit', 'admin.usage.upstreamModelMatchedOnly')
    await choose(view, 'admin.usage.group', 'Synthetic group')
    expect(model).toMatchObject({ model: 'synthetic-model', request_type: 'ws_v2', native_compaction_v2: true, billing_type: 0, billing_mode: 'image', upstream_model_mismatch: false, group_id: 4 })
    expect(view.emitted('change')).toHaveLength(7)
  })

  it('uses error phase/category/status fields without exposing usage-only actions', async () => {
    const { view, model } = await host({ mode: 'errors', flat: true })
    await choose(view, 'admin.ops.errorLog.type', 'admin.ops.errorLog.typeAccountAuth')
    await choose(view, 'usage.errors.category', 'usage.errors.categories.rate_limit')
    await choose(view, 'admin.ops.errorLog.status', '429')
    expect(model).toMatchObject({ error_phase: 'account_auth', error_category: 'rate_limit', status_code: 429 })
    expect(view.text()).not.toContain('usage.exportExcel'); expect(view.text()).not.toContain('admin.usage.billingMode')
  })

  it('emits action commands, disables duplicate export, and hides unsupported ranking actions', async () => {
    const { view } = await host()
    for (const [label, event] of [['common.refresh', 'refresh'], ['common.reset', 'reset'], ['admin.usage.cleanup.button', 'cleanup'], ['usage.exportExcel', 'export']]) {
      await view.findAll('button').find(item => item.text() === label)!.trigger('click')
      expect(view.emitted(event)).toHaveLength(1)
    }
    await view.setProps({ exporting: true })
    const exportButton = view.findAll('button').find(item => item.text() === 'usage.exportExcel')!
    expect(exportButton.attributes('disabled')).toBeDefined()
    await exportButton.trigger('click'); expect(view.emitted('export')).toHaveLength(1)
    await view.setProps({ mode: 'ranking' })
    expect(view.text()).not.toContain('usage.exportExcel'); expect(view.text()).not.toContain('admin.usage.cleanup.button'); expect(view.text()).not.toContain('admin.usage.billingMode')
    await view.setProps({ showActions: false }); expect(view.text()).not.toContain('common.refresh')
  })

  it('keeps filters available when group options fail and cancels pending user search on unmount', async () => {
    failures.add('/api/v1/admin/groups')
    const { view } = await host()
    await choose(view, 'admin.usage.group', 'admin.usage.allGroups')
    await view.get(inputs.user).setValue('will not send'); view.unmount(); await tick()
    expect(wire.filter(item => item.path.endsWith('search-users'))).toHaveLength(0)
  })
})
