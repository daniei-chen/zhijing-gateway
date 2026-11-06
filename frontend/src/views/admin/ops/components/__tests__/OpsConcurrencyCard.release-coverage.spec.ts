import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { AxiosError } from 'axios'
import Card from '../OpsConcurrencyCard.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
type Stats = { enabled?: boolean; platform?: Record<string, Record<string, unknown> | null>; group?: Record<string, Record<string, unknown> | null>; account?: Record<string, Record<string, unknown> | null>; user?: Record<string, Record<string, unknown> | null> }
let concurrency: Stats, availability: Stats, users: Stats, failure: string
const wire: Array<{ path: string; query: Record<string, string> }> = []
function sample(load: number, extra = {}) { return { current_in_use: load, max_capacity: 100, waiting_in_queue: 2, load_percentage: load, ...extra } }
async function host(props = {}) { const view = mount(Card, { props: { refreshToken: 0, ...props } }); await flushPromises(); return view }
function rows(view: ReturnType<typeof mount>) { return view.findAll('div.rounded-lg.bg-gray-50') }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-concurrency', user: { id: 7, role: 'admin' } })
  wire.length = 0; failure = ''
  concurrency = { enabled: true, platform: { openai: sample(80) }, group: {}, account: {} }
  availability = { enabled: true, platform: { openai: { total_accounts: 4, available_count: 2, rate_limit_count: 1, error_count: 1 } }, group: {}, account: {} }
  users = { enabled: true, user: {} }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid'); const query = Object.fromEntries(url.searchParams); delete query.timezone
    wire.push({ path: url.pathname, query })
    const value = url.pathname.endsWith('/concurrency') ? concurrency : url.pathname.endsWith('/account-availability') ? availability : url.pathname.endsWith('/user-concurrency') ? users : undefined
    if (value === undefined) throw new Error(`Unexpected synthetic concurrency route ${url.pathname}`)
    const rejected = failure === url.pathname
    const response = { config, status: rejected ? 422 : 200, statusText: 'Synthetic concurrency', headers: {}, data: rejected ? { code: 422, message: 'Synthetic concurrency refusal' } : { code: 0, data: structuredClone(value) } }
    if (rejected) throw new AxiosError('Synthetic concurrency refusal', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks() })

describe('capacity dimensions and availability through actual API DTOs', () => {
  it('joins sparse platform maps, sorts by load, and keeps availability separate from concurrency', async () => {
    concurrency.platform = { openai: sample(80), anthropic: sample(10), minimax: sample(110), opencode_go: { current_in_use: null, max_capacity: 0 } }
    availability.platform = { openai: { total_accounts: 4, available_count: 2, rate_limit_count: 1, error_count: 1 }, gemini: { total_accounts: 0, available_count: 0 } }
    const view = await host()
    expect(rows(view).map(item => item.get('[title]').attributes('title'))).toEqual(['MINIMAX', 'OPENAI', 'ANTHROPIC', 'OPENCODE_GO', 'GEMINI'])
    expect(rows(view)[1].text()).toContain('80/100'); expect(rows(view)[1].text()).toContain('50%')
    expect(rows(view)[1].text()).toContain('admin.ops.concurrency.rateLimited'); expect(rows(view)[1].text()).toContain('admin.ops.concurrency.errorAccounts'); expect(rows(view)[1].text()).toContain('admin.ops.concurrency.queued')
    expect(rows(view)[0].get('div.bg-red-500').attributes('style')).toContain('width: 100%')
    expect(rows(view)[3].text()).toContain('0/0')
    expect(view.text()).not.toContain('NaN')
    expect(wire.map(item => item.path)).toEqual(['/api/v1/admin/ops/concurrency', '/api/v1/admin/ops/account-availability'])
  })

  it.each([[0, 'bg-green-500'], [50, 'bg-yellow-500'], [70, 'bg-orange-500'], [90, 'bg-red-500']] as const)('shows the configured capacity color at %s%% load', async (load, color) => {
    concurrency.platform = { openai: sample(load) }
    const view = await host(); expect(rows(view)[0].get(`div.${color}`).attributes('style')).toContain(`width: ${load}%`)
    expect(rows(view)[0].text()).toContain(`${load}%`)
  })

  it('filters groups by either DTO platform, supports sparse names and ignores other-platform rows', async () => {
    concurrency.group = { 1: sample(80, { platform: 'openai', group_name: 'Synthetic main group' }), 2: sample(10), 3: sample(90, { platform: 'anthropic' }), 4: null }
    availability.group = { 2: { platform: 'openai', group_name: 'Synthetic availability group', total_accounts: 2, available_count: 1 }, 4: { platform: 'openai' }, 5: { platform: 'openai' } }
    const view = await host({ platformFilter: 'openai' })
    expect(view.text()).toContain('admin.ops.concurrency.byGroup')
    expect(rows(view).map(item => item.get('[title]').attributes('title'))).toEqual(['Synthetic main group', 'Synthetic availability group', 'Group 4', 'Group 5'])
    expect(wire.every(item => item.query.platform === 'openai')).toBe(true)
    expect(view.text()).not.toContain('ANTHROPIC')
  })

  it('uses the selected group for detailed accounts and prioritizes errors and rate limits before load', async () => {
    concurrency.account = {
      1: sample(50, { account_name: 'Synthetic healthy', group_id: 4, group_name: 'Synthetic group' }),
      2: sample(30, { account_name: 'Synthetic limited', group_id: 4 }),
      3: sample(10, { account_name: 'Synthetic error', group_id: 4 }),
      4: sample(90, { account_name: 'Synthetic excluded', group_id: 5 }),
      5: sample(80, { account_name: 'Synthetic overloaded', group_id: 4 }),
      6: sample(20), 7: null,
    }
    availability.account = {
      1: { group_id: 4, is_available: true }, 2: { group_id: 4, is_rate_limited: true, rate_limit_remaining_sec: 65 },
      3: { group_id: 4, has_error: true, error_message: 'Synthetic upstream unavailable' },
      5: { group_id: 4, is_overloaded: true, overload_remaining_sec: 3601 },
      6: { group_id: 4, account_name: 'Synthetic availability-only' }, 7: { group_id: 4 },
    }
    const view = await host({ platformFilter: 'openai', groupIdFilter: 4 })
    expect(view.text()).toContain('admin.ops.concurrency.byAccount')
    expect(rows(view).map(item => item.get('[title]').attributes('title'))).toEqual(['Synthetic error', 'Synthetic limited', 'Synthetic overloaded', 'Synthetic healthy', 'Synthetic availability-only', 'Account 7'])
    expect(view.text()).not.toContain('Synthetic excluded'); expect(view.text()).toContain('1m'); expect(view.text()).toContain('1h')
    expect(view.text()).toContain('admin.ops.accountAvailability.available'); expect(view.text()).toContain('admin.ops.accountAvailability.unavailable')
    expect(wire.every(item => item.query.platform === 'openai' && item.query.group_id === '4')).toBe(true)
  })

  it.each([[-1, '0s'], [30.5, '31s'], [60, '1m'], [3600, '1h']] as const)('formats a rate-limit wait of %s seconds without changing its duration', async (seconds, label) => {
    availability.account = { 1: { group_id: 4, is_rate_limited: true, rate_limit_remaining_sec: seconds } }
    const view = await host({ groupIdFilter: 4 }); expect(view.text()).toContain(label)
  })

  it('switches to user capacity, sorts by active work and restores platform mode', async () => {
    users.user = { 1: { ...sample(70), user_id: 7, user_email: 'member@synthetic.invalid', username: 'Synthetic member' }, 2: { ...sample(90), user_id: 8, user_email: 'other@synthetic.invalid' }, 3: { ...sample(90), user_id: 9, load_percentage: 95 }, 4: {} }
    const view = await host()
    await view.get('button[title="admin.ops.concurrency.switchToUser"]').trigger('click'); await flushPromises()
    expect(wire.at(-1)?.path).toBe('/api/v1/admin/ops/user-concurrency')
    expect(view.text()).toContain('admin.ops.concurrency.byUser')
    expect(rows(view).map(item => item.get('[title]').attributes('title'))).toEqual(['User 3', 'other@synthetic.invalid', 'Synthetic member', 'User 4'])
    expect(view.text()).toContain('member@synthetic.invalid'); expect(view.text()).toContain('admin.ops.concurrency.queued')
    await view.get('button[title="admin.ops.concurrency.switchToPlatform"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('admin.ops.concurrency.byPlatform')
  })

  it('does not keep polling a disabled capability, while allowing a manual retry to restore it', async () => {
    concurrency.enabled = false
    const view = await host(); expect(view.text()).toContain('admin.ops.concurrency.disabledHint')
    const count = wire.length; await view.setProps({ refreshToken: 1 }); await flushPromises(); expect(wire).toHaveLength(count)
    concurrency.enabled = true
    await view.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(view.text()).not.toContain('admin.ops.concurrency.disabledHint'); expect(view.text()).toContain('OPENAI')
  })

  it('shows empty maps safely and refreshes account/group queries under the parent refresh token', async () => {
    concurrency = {}; availability = {}
    const view = await host(); expect(view.text()).toContain('admin.ops.concurrency.empty')
    await view.setProps({ platformFilter: 'anthropic', groupIdFilter: 8, refreshToken: 1 }); await flushPromises()
    expect(wire.at(-1)?.query).toEqual({ platform: 'anthropic', group_id: '8' })
    expect(view.text()).not.toContain('NaN')
  })

  it('shows a visible network failure and recovers on an explicit retry', async () => {
    failure = '/api/v1/admin/ops/concurrency'
    const view = await host(); expect(view.text()).toContain('admin.ops.concurrency.loadFailed')
    failure = ''; await view.get('button[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(view.text()).not.toContain('admin.ops.concurrency.loadFailed'); expect(view.text()).toContain('OPENAI')
  })
})
