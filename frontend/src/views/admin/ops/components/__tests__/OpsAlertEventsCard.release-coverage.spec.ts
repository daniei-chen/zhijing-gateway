import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Card from '../OpsAlertEventsCard.vue'
import Select from '@/components/common/Select.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { AlertEvent } from '@/api/admin/ops'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
let desktop = ref(true)
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => desktop }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
const base = '/api/v1/admin/ops/alert-events'
const now = new Date('2030-01-02T00:00:00Z')
type Wire = { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | undefined }
const wire: Wire[] = []
let rows: AlertEvent[], history: AlertEvent[], pages: AlertEvent[][], refusal: ((request: Wire) => boolean) | undefined
function row(extra: Partial<AlertEvent> = {}): AlertEvent { return { id: 41, rule_id: 7, severity: 'P1', status: 'firing', title: 'Synthetic alert 41', description: 'Synthetic risk explanation', dimensions: { platform: 'openai', group_id: 4, region: 'synthetic-region' }, fired_at: '2030-01-01T00:00:00Z', created_at: '2030-01-01T00:00:00Z', email_sent: false, ...extra } }
async function host() { const view = mount(Card, { attachTo: document.body, global: { stubs: { Icon: true } } }); await flushPromises(); return view }
async function choose(select: ReturnType<ReturnType<typeof mount>['getComponent']>, text: string) {
  const trigger = select.get('button.select-trigger')
  await trigger.trigger('click'); await flushPromises()
  const listbox = document.getElementById(trigger.attributes('aria-controls')!)
  expect(listbox).not.toBeNull()
  const option = new DOMWrapper(listbox!).findAll('[role="option"]').find(item => item.text() === text)
  expect(option, text).toBeDefined(); await option!.trigger('click'); await flushPromises()
}
async function open(view: ReturnType<typeof mount>, title = 'Synthetic alert 41') {
  const item = view.findAll('tr,button').find(item => item.text().includes(title))
  expect(item, title).toBeDefined(); await item!.trigger('click'); await flushPromises()
  return new DOMWrapper(document.body).get('[role="dialog"]')
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-alert-ui', user: { id: 7, role: 'admin' } })
  desktop = ref(true); rows = [row()]; history = []; pages = []; refusal = undefined; wire.length = 0
  feedback.success.mockReset(); feedback.error.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid'); const query = Object.fromEntries(url.searchParams); delete query.timezone
    const request: Wire = { method: String(config.method).toUpperCase(), path: url.pathname, query, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    wire.push(request)
    let value: unknown
    if (request.path === base && request.method === 'GET') value = query.limit === '20' ? history : query.before_id ? pages.shift() ?? [] : rows
    else if (/\/alert-events\/\d+$/.test(request.path) && request.method === 'GET') value = rows.find(row => row.id === Number(request.path.split('/').at(-1))) ?? rows[0]
    else if (/\/alert-events\/\d+\/status$/.test(request.path) && request.method === 'PUT') { rows = rows.map(item => item.id === Number(request.path.split('/').at(-2)) ? { ...item, status: String(request.body?.status), resolved_at: now.toISOString() } : item); value = { message: 'updated' } }
    else if (request.path === '/api/v1/admin/ops/alert-silences' && request.method === 'POST') value = { id: 8 }
    else throw new Error(`Unexpected synthetic alert request ${request.method} ${request.path}`)
    const denied = refusal?.(request)
    const response = { config, status: denied ? 422 : 200, statusText: 'Synthetic alert fixture', headers: {}, data: denied ? { code: 422, message: 'Synthetic alert request refused' } : { code: 0, data: value } }
    if (denied) throw new AxiosError('Synthetic alert request refused', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open') })

describe('alert list, detail and actions through native controls and actual Axios', () => {
  it.each([true, false])('renders severity/status/email and duration distinctions on desktop=%s', async isDesktop => {
    desktop.value = isDesktop
    rows = [
      row({ id: 41, severity: 'P0', email_sent: true }),
      row({ id: 42, title: 'Synthetic 42', severity: 'critical', status: 'resolved', resolved_at: '2030-01-01T00:00:59Z', description: '' }),
      row({ id: 43, title: 'Synthetic 43', severity: 'warning', status: 'manual_resolved', resolved_at: '2030-01-01T01:00:00Z', dimensions: { platform: 0, group_id: 0, region: false } }),
      row({ id: 44, title: 'Synthetic 44', severity: 'P2', status: 'unknown-state', dimensions: { platform: {}, group_id: null, region: [] } }),
      row({ id: 45, title: 'Synthetic 45', severity: 'info', status: '', dimensions: {} }),
      row({ id: 46, title: 'Synthetic 46', severity: 'P3' }),
      row({ id: 47, title: '', severity: '', description: '', fired_at: 'not-a-date', dimensions: undefined }),
    ]
    const view = await host()
    for (const label of ['Synthetic 42', 'Synthetic 43', 'UNKNOWN-STATE', '59s', '1h', '1d', 'admin.ops.alertEvents.table.emailSent', 'admin.ops.alertEvents.table.emailIgnored']) expect(view.text()).toContain(label)
    expect(view.find('.bg-red-100').exists()).toBe(true); expect(view.find('.bg-amber-100').exists()).toBe(true); expect(view.find('.bg-blue-100').exists()).toBe(true)
    expect(view.find('.bg-green-50').exists()).toBe(true); expect(view.find('.bg-slate-50').exists()).toBe(true)
    expect(view.find('table').exists()).toBe(isDesktop)
    if (isDesktop) { expect(view.text()).toContain('platform=0 group_id=0 region=false'); expect(view.text()).toContain('synthetic-region') }
  })

  it.each([[0, '0s'], [61000, '1m'], [3600000, '1h'], [86400000, '1d']] as const)('formats a resolved interval of %s ms without treating it as still firing', async (milliseconds, label) => {
    rows = [row({ status: 'resolved', resolved_at: new Date(new Date('2030-01-01T00:00:00Z').getTime() + milliseconds).toISOString() })]
    const view = await host(); expect(view.text()).toContain(`admin.ops.alertEvents.status.resolved ${label}`)
  })

  it('falls back to firing duration when the resolved timestamp is malformed', async () => {
    rows = [row({ resolved_at: 'not-a-date' })]; const view = await host()
    expect(view.text()).toContain('admin.ops.alertEvents.status.firing 1d')
  })

  it('serializes each independent filter, including ignored-email false, and resets the list cursor', async () => {
    const view = await host(); const selects = view.findAllComponents(Select)
    await choose(selects[0], 'admin.ops.timeRange.7d'); await choose(selects[1], 'P2')
    await choose(selects[2], 'admin.ops.alertEvents.status.resolved'); await choose(selects[3], 'admin.ops.alertEvents.table.emailIgnored')
    expect(wire.at(-1)).toMatchObject({ method: 'GET', path: base, query: { limit: '10', time_range: '7d', severity: 'P2', status: 'resolved', email_sent: 'false' } })
    await choose(selects[3], 'admin.ops.alertEvents.table.emailSent'); expect(wire.at(-1)?.query.email_sent).toBe('true')
    for (const select of selects.slice(1)) await choose(select, 'common.all')
    expect(wire.at(-1)?.query).toEqual({ limit: '10', time_range: '7d' })
  })

  it('loads further rows near the real scroll boundary and stops after the short last page', async () => {
    rows = Array.from({ length: 10 }, (_, index) => row({ id: 41 + index, title: `Synthetic row ${index}`, fired_at: index === 9 ? '' : row().fired_at }))
    pages = [[row({ id: 60, title: 'Synthetic final row' })]]
    const view = await host(); const scroll = view.get('div.overflow-y-auto')
    Object.defineProperties(scroll.element, { scrollTop: { configurable: true, value: 850 }, clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, value: 1100 } })
    await scroll.trigger('scroll'); await flushPromises()
    expect(view.text()).toContain('Synthetic final row')
    expect(wire.at(-1)?.query).toMatchObject({ before_id: '50', before_fired_at: '2030-01-01T00:00:00Z' })
    const count = wire.length; await scroll.trigger('scroll'); await flushPromises(); expect(wire).toHaveLength(count)
  })

  it('opens the full detail and narrows history to the same rule, platform and group', async () => {
    history = [
      row({ id: 70, title: 'Synthetic matching history', metric_value: 0, threshold_value: 0, status: 'resolved', resolved_at: now.toISOString() }),
      row({ id: 71, rule_id: 8 }), row({ id: 72, dimensions: { platform: 'anthropic', group_id: 4 } }), row({ id: 73, dimensions: { platform: 'openai', group_id: 5 } }),
    ]
    const view = await host(); const dialog = await open(view)
    expect(wire.some(item => item.path === `${base}/41`)).toBe(true)
    expect(wire.at(-1)?.query).toEqual({ limit: '20', time_range: '7d', platform: 'openai', group_id: '4', status: '' })
    expect(dialog.findAll('tbody tr')).toHaveLength(1)
    expect(dialog.get('a[href*="open_alert_rules"]').attributes('href')).toContain('alert_rule_id=7')
    expect(dialog.get('a[href*="open_error_details"]').attributes('href')).toContain('group_id=4')
    expect(dialog.text()).toContain('synthetic-region')
    const historySelect = view.findAllComponents(Select).at(-1)!
    await choose(historySelect, 'admin.ops.timeRange.30d'); expect(wire.at(-1)?.query.time_range).toBe('30d')
    await dialog.get('button[aria-label]').trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })

  it.each([['admin.ops.timeRange.1h', 3600000], ['admin.ops.timeRange.24h', 86400000], ['admin.ops.timeRange.7d', 604800000]] as const)('creates a bounded silence for %s and retains literal dimensions', async (label, duration) => {
    const view = await host(); const dialog = await open(view)
    await choose(view.findAllComponents(Select)[4], label)
    await dialog.findAll('button').find(item => item.text() === 'common.apply')!.trigger('click'); await flushPromises()
    const request = wire.find(item => item.method === 'POST')!
    expect(request).toMatchObject({ path: '/api/v1/admin/ops/alert-silences', body: { rule_id: 7, platform: 'openai', group_id: 4, region: 'synthetic-region', until: new Date(now.getTime() + duration).toISOString() } })
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.alertEvents.detail.silenceSuccess')
  })

  it('omits absent group/region dimensions when creating a silence', async () => {
    rows = [row({ dimensions: { group_id: '4' } })]
    const view = await host(); const dialog = await open(view)
    await dialog.findAll('button').find(item => item.text() === 'common.apply')!.trigger('click'); await flushPromises()
    const request = wire.find(item => item.method === 'POST')!
    expect(request.body).toEqual({ rule_id: 7, platform: '', until: new Date(now.getTime() + 3600000).toISOString(), reason: 'silence from UI (1h)' })
  })

  it('manually resolves the selected alert and refreshes its detail, list and history', async () => {
    const view = await host(); const dialog = await open(view)
    await dialog.findAll('button').find(item => item.text() === 'admin.ops.alertEvents.detail.manualResolve')!.trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'PUT')).toMatchObject({ path: `${base}/41/status`, body: { status: 'manual_resolved' } })
    expect(feedback.success).toHaveBeenCalledWith('admin.ops.alertEvents.detail.manualResolvedSuccess')
    expect(dialog.text()).toContain('admin.ops.alertEvents.status.manualResolved')
    expect(wire.filter(item => item.path === base && item.query.limit === '10')).toHaveLength(2)
  })

  it.each(['list', 'detail', 'history', 'silence', 'resolve'] as const)('shows a safe failure state for %s without making an automatic write retry', async kind => {
    refusal = request => kind === 'list' ? request.path === base && request.query.limit === '10' : kind === 'detail' ? request.path === `${base}/41` : kind === 'history' ? request.query.limit === '20' : kind === 'silence' ? request.method === 'POST' : request.method === 'PUT'
    const view = await host()
    if (kind === 'list') {
      expect(view.text()).toContain('admin.ops.alertEvents.empty'); expect(feedback.error).toHaveBeenCalledWith('admin.ops.alertEvents.loadFailed')
      refusal = undefined; await view.findAll('button').find(item => item.text() === 'common.refresh')!.trigger('click'); await flushPromises(); expect(view.text()).toContain('Synthetic alert 41')
    } else {
      const dialog = await open(view)
      if (kind === 'silence' || kind === 'resolve') {
        await dialog.findAll('button').find(item => item.text() === (kind === 'silence' ? 'common.apply' : 'admin.ops.alertEvents.detail.manualResolve'))!.trigger('click'); await flushPromises()
        expect(wire.filter(item => item.method === (kind === 'silence' ? 'POST' : 'PUT'))).toHaveLength(1)
        expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).toHaveBeenCalled()
      } else if (kind === 'detail') expect(feedback.error).toHaveBeenCalledWith('admin.ops.alertEvents.detail.loadFailed')
      else expect(dialog.text()).toContain('admin.ops.alertEvents.detail.historyEmpty')
    }
  })
})
