import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import SubscriptionsView from '../SubscriptionsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  subscriptions: await vi.importActual('@/api/admin/subscriptions'), groups: await vi.importActual('@/api/admin/groups'),
  users: await vi.importActual('@/api/admin/users'), usage: await vi.importActual('@/api/admin/usage'),
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const previousAdapter = apiClient.defaults.adapter
const views: VueWrapper[] = []
let requests: Wire[]
let unexpected: string[]
let rows: Record<string, unknown>[]
let rejectList: boolean
const plan = (patch: Record<string, unknown> = {}) => ({ id: 11, name: 'Release subscription plan', platform: 'openai', subscription_type: 'subscription', status: 'active', rate_multiplier: 1, daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 100, ...patch })
const subscription = (patch: Record<string, unknown> = {}) => ({
  id: 42, user_id: 51, group_id: 11, status: 'active', user: { id: 51, email: 'subscription-wave@example.invalid', username: 'Release subscriber' }, group: plan(),
  starts_at: '2026-10-01T00:00:00Z', expires_at: '2026-12-06T12:00:00Z', daily_usage_usd: 1, weekly_usage_usd: 2, monthly_usage_usd: 3,
  daily_window_start: null, weekly_window_start: null, monthly_window_start: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...patch,
})
type Root = Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>
function button(root: Root, label: string) {
  const found = root.findAll('button').find(node => node.text() === label)
  expect(found, label).toBeDefined()
  return found!
}
async function render() {
  const view = mount(SubscriptionsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' },
    RouterLink: { props: ['to'], template: '<a :data-usage-user="to.query.user_id"><slot/></a>' },
    teleport: true, transition: true,
  } } })
  views.push(view); await flushPromises(); return view
}
const row = (view: VueWrapper) => view.get('tbody tr')
async function choose(view: VueWrapper, selector: string, label: string) {
  const trigger = view.get(selector)
  await trigger.trigger('click'); await flushPromises()
  const listbox = document.getElementById(trigger.attributes('aria-controls')!)!
  const option = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
const writes = () => requests.filter(request => request.method !== 'get')
const lists = () => requests.filter(request => request.method === 'get' && request.path === '/admin/subscriptions')
async function openAdjustment(view: VueWrapper) {
  await button(row(view), 'admin.subscriptions.adjust').trigger('click'); await flushPromises()
  return view.get('#extend-subscription-form')
}
async function confirmAdjustment(view: VueWrapper) {
  const submit = view.get<HTMLButtonElement>('button[form="extend-subscription-form"]')
  submit.element.click(); await flushPromises()
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-wave-subscriptions', user: { id: 7, role: 'admin' } })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime('2026-11-06T12:00:00Z')
  requests = []; unexpected = []; rows = [subscription()]; rejectList = false
  feedback.error.mockReset(); feedback.success.mockReset()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }
    requests.push(request)
    let data: unknown
    if (request.path === '/admin/subscriptions' && rejectList) {
      rejectList = false
      throw new AxiosError('Synthetic subscription unavailable', 'ERR_BAD_RESPONSE', config, undefined, { status: 400, statusText: 'Synthetic rejection', headers: {}, data: { message: 'Synthetic subscription unavailable' }, config })
    }
    if (request.path === '/admin/subscriptions') {
      const items = rows.filter(item => !request.params.status || item.status === request.params.status)
      data = { items, total: items.length, page: request.params.page, page_size: request.params.page_size, pages: 1 }
    } else if (request.path === '/admin/groups/all') data = [plan()]
    else if (request.path === '/admin/subscriptions/42/extend') data = subscription()
    else { unexpected.push(`${request.method} ${request.path}`); throw new Error(`Unexpected synthetic subscription endpoint ${request.path}`) }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data } }
  }
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = previousAdapter
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('Subscription release quota windows and list contracts', () => {
  it.each([
    { used: 6.9, width: '69%', tone: 'bg-green-500' },
    { used: 7, width: '70%', tone: 'bg-orange-500' },
    { used: 9, width: '90%', tone: 'bg-red-500' },
    { used: 12, width: '100%', tone: 'bg-red-500' },
    { used: null, width: '0%', tone: 'bg-green-500' },
  ])('renders $used dollars of daily usage with the correct public progress state', async ({ used, width, tone }) => {
    rows = [subscription({ daily_usage_usd: used })]
    const view = await render()
    const daily = row(view).findAll('.usage-row')[0]
    expect(daily.get(`.${tone}`).attributes('style')).toContain(`width: ${width}`)
    expect(daily.text()).toContain('$10.00')
    if (used === null) expect(daily.text()).toContain('$0.00')
    expect(writes()).toEqual([])
  })

  it.each([
    { field: 'daily_window_start', start: '2026-11-05T12:30:00Z', expected: 'admin.subscriptions.resetInMinutes:{"minutes":30}', index: 0 },
    { field: 'daily_window_start', start: '2026-11-06T00:00:00Z', expected: 'admin.subscriptions.resetInHoursMinutes:{"hours":12,"minutes":0}', index: 0 },
    { field: 'weekly_window_start', start: '2026-11-01T12:00:00Z', expected: 'admin.subscriptions.resetInDaysHours:{"days":2,"hours":0}', index: 1 },
    { field: 'monthly_window_start', start: '2026-10-08T14:00:00Z', expected: 'admin.subscriptions.resetInDaysHours:{"days":1,"hours":2}', index: 2 },
    { field: 'daily_window_start', start: '2026-11-01T12:00:00Z', expected: 'admin.subscriptions.windowNotActive', index: 0 },
  ])('shows the reset contract for $field starting at $start', async ({ field, start, expected, index }) => {
    rows = [subscription({ [field]: start })]
    const view = await render()
    expect(row(view).findAll('.usage-row')[index].get('.reset-info').text()).toBe(expected)
  })

  it.each([
    { expires: '2026-11-06T12:30:00Z', expected: 'admin.subscriptions.quotaEndsInMinutes:{"minutes":30}' },
    { expires: '2026-11-06T14:15:00Z', expected: 'admin.subscriptions.quotaEndsInHoursMinutes:{"hours":2,"minutes":15}' },
    { expires: '2026-11-06T11:00:00Z', expected: 'admin.subscriptions.windowNotActive' },
  ])('uses the actual one-time quota end rather than tomorrow reset when expiration is $expires', async ({ expires, expected }) => {
    rows = [subscription({ starts_at: '2026-11-06T00:00:00Z', expires_at: expires, daily_window_start: '2026-11-06T00:00:00Z' })]
    const view = await render()
    expect(row(view).findAll('.usage-row')[0].get('.reset-info').text()).toBe(expected)
  })

  it.each([
    { expires: '2026-11-06T12:45:00Z', expected: 'admin.subscriptions.minutesRemaining:{"minutes":45}' },
    { expires: '2026-11-06T14:15:00Z', expected: 'admin.subscriptions.hoursMinutesRemaining:{"hours":2,"minutes":15}' },
    { expires: '2026-11-08T12:00:00Z', expected: 'admin.subscriptions.daysRemaining:{"days":2}' },
  ])('renders the short expiration $expires with its remaining duration and warning color', async ({ expires, expected }) => {
    rows = [subscription({ expires_at: expires })]
    const view = await render()
    expect(row(view).text()).toContain(expected)
    expect(row(view).findAll('span').some(node => node.classes().includes('text-orange-600'))).toBe(true)
  })

  it('shows an unlimited plan without an expiration, preserving the public usage link user ID', async () => {
    rows = [subscription({ group: plan({ daily_limit_usd: 0, weekly_limit_usd: null, monthly_limit_usd: null }), expires_at: null })]
    const view = await render()
    expect(row(view).text()).toContain('admin.subscriptions.unlimited')
    expect(row(view).text()).toContain('admin.subscriptions.noExpiration')
    expect(row(view).get('a[data-usage-user]').attributes('data-usage-user')).toBe('51')
    expect(row(view).findAll('.usage-row')).toHaveLength(0)
  })

  it('uses the user-ID fallback and an empty-group marker when the optional related records are missing', async () => {
    rows = [subscription({ user: null, group: null })]
    const view = await render()
    expect(row(view).text()).toContain('admin.redeem.userPrefix:{"id":51}')
    expect(row(view).text()).toContain('admin.subscriptions.unlimited')
  })

  it('switches the user column to username through its preference menu and persists it for the next visit', async () => {
    const view = await render()
    await view.get('[title="admin.users.columnSettings"]').trigger('click')
    await button(view, 'admin.users.columns.username').trigger('click')
    expect(row(view).get('a[data-usage-user]').text()).toBe('Release subscriber')
    expect(localStorage.getItem('subscription-user-column-mode')).toBe('username')
    expect(writes()).toEqual([])
  })

  it('hides and restores the usage column without dropping the selected subscription', async () => {
    const view = await render()
    await row(view).get('input[type="checkbox"]').setValue(true)
    await view.get('[title="admin.users.columnSettings"]').trigger('click')
    await button(view, 'admin.subscriptions.columns.usage').trigger('click')
    expect(row(view).findAll('.usage-row')).toHaveLength(0)
    await button(view, 'admin.subscriptions.columns.usage').trigger('click')
    expect(row(view).findAll('.usage-row')).toHaveLength(3)
    expect(row(view).get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('recovers a failed readonly list request with refresh and never dispatches a subscription command', async () => {
    rejectList = true
    const view = await render()
    expect(feedback.error).toHaveBeenCalledWith('admin.subscriptions.failedToLoad')
    await view.get('[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(row(view).text()).toContain('subscription-wave@example.invalid')
    expect(lists()).toHaveLength(2); expect(writes()).toEqual([])
  })

  it('filters revoked records with the actual query before exposing the restore action', async () => {
    rows = [subscription({ status: 'revoked' })]
    const view = await render()
    expect(view.findAll('tbody tr').some(node => node.text().includes('subscription-wave@example.invalid'))).toBe(false)
    await choose(view, 'button.select-trigger', 'admin.subscriptions.status.revoked')
    expect(lists().at(-1)!.params.status).toBe('revoked')
    expect(row(view).text()).toContain('admin.subscriptions.status.revoked')
    expect(button(row(view), 'admin.subscriptions.restore').exists()).toBe(true)
    expect(writes()).toEqual([])
  })

  it.each([0, 36501, -36501])('refuses an integer adjustment of %i days before any write and keeps the dialog correctable', async days => {
    const view = await render()
    const form = await openAdjustment(view)
    await form.get('input[type="number"]').setValue(String(days))
    await confirmAdjustment(view)
    expect(feedback.error).toHaveBeenCalledWith('admin.subscriptions.bulk.invalidDays')
    expect(writes()).toEqual([])
    expect(view.find('#extend-subscription-form').exists()).toBe(true)
  })

  it('blocks a negative adjustment that would expire the subscription and submits a valid correction in day units', async () => {
    rows = [subscription({ expires_at: '2026-11-06T14:00:00Z' })]
    const view = await render()
    const form = await openAdjustment(view)
    await form.get('input[type="number"]').setValue('-1'); await confirmAdjustment(view)
    expect(feedback.error).toHaveBeenCalledWith('admin.subscriptions.adjustWouldExpire')
    expect(writes()).toEqual([])
    await form.get('input[type="number"]').setValue('2'); await confirmAdjustment(view)
    expect(writes()).toEqual([expect.objectContaining({ method: 'post', path: '/admin/subscriptions/42/extend', body: { days: 2 } })])
  })

  it('adjusts an unlimited subscription without manufacturing an expires_at value in the command', async () => {
    rows = [subscription({ expires_at: null })]
    const view = await render()
    const form = await openAdjustment(view)
    expect(form.text()).toContain('admin.subscriptions.noExpiration')
    await form.get('input[type="number"]').setValue('7'); await confirmAdjustment(view)
    expect(writes()[0]).toMatchObject({ path: '/admin/subscriptions/42/extend', body: { days: 7 } })
    expect(writes()[0].body).not.toHaveProperty('expires_at')
  })
})
