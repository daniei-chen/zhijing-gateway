import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BulkEditAccountModal from '../BulkEditAccountModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { AdminGroup, Proxy } from '@/types'

const ui = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  accounts: (await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')).accountsAPI
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: ui.success, showError: ui.error, showInfo: ui.info }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const originalAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let wire: Array<{ path: string; method: string; body: Record<string, any> }> = []
let unexpected: string[] = []
const dom = () => new DOMWrapper(document.body)
async function render(platform: 'anthropic' | 'openai' = 'anthropic', types: Array<'oauth' | 'setup-token' | 'apikey'> = ['oauth']) {
  const view = mount(BulkEditAccountModal, {
    attachTo: document.body,
    props: {
      show: true, accountIds: [84, 85], selectedPlatforms: [platform], selectedTypes: types,
      groups: [{ id: 841, name: 'Synthetic bulk group', platform, status: 'active' }] as unknown as AdminGroup[],
      proxies: [{ id: 842, name: 'Synthetic bulk proxy', protocol: 'socks5', host: 'bulk.example.test', port: 1080, status: 'active' }] as Proxy[]
    },
    global: { mocks: { $t: (key: string) => key }, stubs: { Icon: true, Transition: true, ProxyAdBanner: true } }
  })
  views.push(view)
  await flushPromises()
  return view
}
function button(text: string) {
  const found = dom().findAll('button').find(node => node.text() === text)
    ?? dom().findAll('button').find(node => node.text().includes(text))
  expect(found, `visible button ${text}`).toBeDefined()
  return found!
}
async function click(text: string) {
  const target = button(text).element as HTMLButtonElement
  target.click()
  await flushPromises()
}
function field(text: string) {
  const label = dom().findAll('label').find(node => node.text() === text && node.attributes('for'))
  expect(label, `associated field ${text}`).toBeDefined()
  return new DOMWrapper(document.getElementById(label!.attributes('for')!)!)
}
async function enable(id: string) {
  await dom().get(`#bulk-edit-${id}-enabled`).setValue(true)
  await flushPromises()
}
async function select(selector: string, label: string) {
  await dom().get(selector).trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const option = dom().findAll('[role="option"]').find(node => node.text() === label)
  expect(option, `native Select option ${label}`).toBeDefined()
  ;(option!.element as HTMLElement).click()
  await flushPromises()
}
async function submit() {
  const form = dom().get('form').element as HTMLFormElement
  expect(form.checkValidity()).toBe(true)
  ;(dom().get('button[form="bulk-edit-account-form"]').element as HTMLButtonElement).click()
  await flushPromises()
}
const writes = () => wire.filter(request => request.path === '/admin/accounts/bulk-update')
beforeEach(() => {
  wire = []
  unexpected = []
  Object.values(ui).forEach(mock => mock.mockReset())
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-bulk-release-admin', user: { id: 84, role: 'admin' } })
  apiClient.defaults.adapter = async config => {
    const request = { path: String(config.url), method: config.method ?? 'get', body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {} }
    wire.push(request)
    let data: unknown
    if (request.path === '/admin/accounts/bulk-update') data = { success: 2, failed: 0, results: [] }
    else if (request.path === '/admin/accounts/check-mixed-channel') data = { has_risk: false }
    else {
      unexpected.push(`${request.method} ${request.path}`)
      throw new Error('Unexpected synthetic bulk endpoint')
    }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data } }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('native bulk configuration sends only explicitly enabled changes through the real account API', () => {
  it('applies scheduling, status, group and proxy selection with a zero billing multiplier in a single literal payload', async () => {
    const view = await render('openai', ['apikey'])
    await enable('concurrency')
    await dom().get('#bulk-edit-concurrency').setValue('3')
    await enable('load-factor')
    await dom().get('#bulk-edit-load-factor').setValue('4')
    await enable('priority')
    await dom().get('#bulk-edit-priority').setValue('9')
    await enable('rate-multiplier')
    await dom().get('#bulk-edit-rate-multiplier').setValue('0')
    await enable('status')
    await select('#bulk-edit-status button', 'common.inactive')
    await enable('proxy')
    await dom().get('#bulk-edit-proxy-body button').trigger('click')
    await click('Synthetic bulk proxy')
    await enable('groups')
    const group = dom().findAll('label').find(node => node.text().includes('Synthetic bulk group'))!
    await group.get('input').setValue(true)
    await submit()
    expect(writes()).toHaveLength(1)
    expect(writes()[0]!.body).toEqual({
      account_ids: [84, 85], concurrency: 3, load_factor: 4, priority: 9, rate_multiplier: 0,
      status: 'inactive', proxy_id: 842, group_ids: [841]
    })
    expect(view.emitted('updated')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })
  it.each(['tiered', 'sticky_exempt'])('sends an explicitly edited Anthropic %s RPM policy while preserving unrelated account settings', async strategy => {
    await render()
    await enable('rpm-limit')
    await dom().get('button[role="switch"][aria-label="admin.accounts.quotaControl.rpmLimit.label"]').trigger('click')
    await field('admin.accounts.quotaControl.rpmLimit.baseRpm').setValue('35')
    await click('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt')
    if (strategy === 'tiered') {
      await click('admin.accounts.quotaControl.rpmLimit.strategyTiered')
      await field('admin.accounts.quotaControl.rpmLimit.stickyBuffer').setValue('7')
    }
    await submit()
    expect(writes()[0]!.body).toEqual({ account_ids: [84, 85], extra: {
      base_rpm: 35, rpm_strategy: strategy, ...(strategy === 'tiered' ? { rpm_sticky_buffer: 7 } : {})
    } })
  })
  it('explicitly clears an existing RPM policy using the established JSONB merge reset sentinels', async () => {
    await render('anthropic', ['setup-token'])
    await enable('rpm-limit')
    await submit()
    expect(writes()[0]!.body).toEqual({ account_ids: [84, 85], extra: { base_rpm: 0, rpm_strategy: '', rpm_sticky_buffer: 0 } })
  })
  it.each([
    ['umqModeOff', ''], ['umqModeThrottle', 'throttle'], ['umqModeSerialize', 'serialize']
  ])('sets %s independently of the RPM toggle and clears the old legacy flag', async (label, value) => {
    await render()
    await click(`admin.accounts.quotaControl.rpmLimit.${label}`)
    await submit()
    expect(writes()[0]!.body).toEqual({ account_ids: [84, 85], extra: { user_msg_queue_mode: value, user_msg_queue_enabled: false } })
  })
  it('lets the administrator cancel a selected message-queue change without writing an empty patch', async () => {
    await render()
    await click('admin.accounts.quotaControl.rpmLimit.umqModeSerialize')
    await click('admin.accounts.quotaControl.rpmLimit.umqModeSerialize')
    await submit()
    expect(writes()).toEqual([])
    expect(ui.error).toHaveBeenCalledWith('admin.accounts.bulkEdit.noFieldsSelected')
    expect(dom().find('form').exists()).toBe(true)
  })
  it('does not include an edited number once its apply-checkbox has been explicitly unchecked', async () => {
    await render('openai', ['apikey'])
    await enable('concurrency')
    await dom().get('#bulk-edit-concurrency').setValue('8')
    await dom().get('#bulk-edit-concurrency-enabled').setValue(false)
    await enable('priority')
    await dom().get('#bulk-edit-priority').setValue('12')
    await submit()
    expect(writes()[0]!.body).toEqual({ account_ids: [84, 85], priority: 12 })
  })
  it('selects a base URL and a deliberately edited model mapping without inheriting untouched provider flags', async () => {
    await render('openai', ['apikey'])
    await enable('base-url')
    await dom().get('input[aria-labelledby="bulk-edit-base-url-label"]').setValue(' https://bulk-upstream.example.test/v1 ')
    await enable('model-restriction')
    await click('admin.accounts.modelMapping')
    await click('admin.accounts.addMapping')
    await dom().get('input[aria-label="admin.accounts.requestModel"]').setValue('request-model')
    await dom().get('input[aria-label="admin.accounts.actualModel"]').setValue('upstream-model')
    await submit()
    expect(writes()[0]!.body).toEqual({ account_ids: [84, 85], credentials: {
      base_url: 'https://bulk-upstream.example.test/v1', model_mapping: { 'request-model': 'upstream-model' }
    } })
  })
})
