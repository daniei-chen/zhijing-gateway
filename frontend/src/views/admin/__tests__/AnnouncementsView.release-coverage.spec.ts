import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { InternalAxiosRequestConfig } from 'axios'
import AnnouncementsView from '../AnnouncementsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  announcements: (await vi.importActual<typeof import('@/api/admin/announcements')>('@/api/admin/announcements')).default,
  groups: await vi.importActual('@/api/admin/groups'),
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('@/stores', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))

interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const originalAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: Record<string, unknown>[]
let fail: string
let unexpected: string[]
let total: number
const announcement = (patch: Record<string, unknown> = {}) => ({ id: 31, title: 'Release notice', content: 'Synthetic notice body', status: 'draft', notify_mode: 'silent', targeting: { any_of: [] }, starts_at: null, ends_at: null, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) {
  const result = root.findAll('button').find(node => node.text() === label)
  expect(result, label).toBeDefined(); return result!
}
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const id = trigger.attributes('aria-controls')
  const option = document.getElementById(id!)?.querySelectorAll<HTMLElement>('[role="option"]')
  const match = Array.from(option ?? []).find(item => item.textContent?.trim() === label)
  expect(match, label).toBeDefined(); match!.click(); await flushPromises()
}
async function render() {
  const view = mount(AnnouncementsView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' },
    teleport: true, transition: true,
    AnnouncementReadStatusDialog: { props: ['show', 'announcementId'], template: '<aside v-if="show" data-test="read-status">{{ announcementId }}<button @click="$emit(\'close\')">Close readers</button></aside>' },
    AnnouncementPopup: { props: ['announcement'], template: '<aside v-if="announcement" data-test="preview">{{ announcement.title }}<button @click="$emit(\'close\')">Close preview</button></aside>' },
  } } })
  mounted.push(view); await flushPromises(); return view
}
const commands = () => wires.filter(wire => wire.method !== 'get')
const lastList = () => wires.filter(wire => wire.path === '/admin/announcements' && wire.method === 'get').at(-1)!
async function openCreate(view: VueWrapper) { await button(view, 'admin.announcements.createAnnouncement').trigger('click'); return view.get('#announcement-form') }
async function fillRequired(form: ReturnType<VueWrapper['get']>) {
  await form.get('input[type="text"]').setValue('Synthetic new announcement')
  await form.get('textarea').setValue('Synthetic markdown **body**')
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-announcement-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [announcement()]; fail = ''; unexpected = []; total = 1
  feedback.error.mockReset(); feedback.success.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }
    wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new Error('Synthetic announcement failure') }
    let data: unknown
    if (wire.path === '/admin/groups/all') data = [{ id: 11, name: 'Subscription A', platform: 'openai', subscription_type: 'subscription' }, { id: 12, name: 'Metered B', platform: 'openai', subscription_type: 'standard' }]
    else if (wire.path === '/admin/announcements') data = wire.method === 'get' ? { items: rows, total, page: wire.params.page, page_size: wire.params.page_size, pages: Math.ceil(total / Number(wire.params.page_size)) } : announcement(wire.body)
    else if (wire.path === '/admin/announcements/31' && ['put', 'delete'].includes(wire.method)) data = announcement(wire.body)
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic announcement request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => {
  mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe('Announcement administration through native controls and the real HTTP client', () => {
  it.each([
    { status: 'draft', notify_mode: 'silent', statusLabel: 'draft', notifyLabel: 'silent', tone: 'badge-gray', targeting: { any_of: [] } },
    { status: 'active', notify_mode: 'popup', statusLabel: 'active', notifyLabel: 'popup', tone: 'badge-success', targeting: { any_of: [{ all_of: [{ type: 'balance', operator: 'gte', value: 0 }] }] } },
    { status: 'archived', notify_mode: 'silent', statusLabel: 'archived', notifyLabel: 'silent', tone: 'badge-warning', targeting: { any_of: [] } },
  ])('renders the $status/$notify_mode publication and audience state without making a write', async ({ status, notify_mode, statusLabel, notifyLabel, tone, targeting }) => {
    rows = [announcement({ status, notify_mode, targeting })]
    const view = await render(); const row = view.get('tbody tr')
    expect(row.text()).toContain(`admin.announcements.statusLabels.${statusLabel}`)
    expect(row.text()).toContain(`admin.announcements.notifyModeLabels.${notifyLabel}`)
    expect(row.find(`.${tone}`).exists()).toBe(true)
    expect(row.text()).toContain(targeting.any_of.length ? 'admin.announcements.targetingSummaryCustom' : 'admin.announcements.targetingSummaryAll')
    expect(row.text()).toContain('admin.announcements.timeImmediate'); expect(row.text()).toContain('admin.announcements.timeNever')
    expect(commands()).toEqual([])
  })

  it('loads scheduled dates, routes preview/read-status public events to the selected row, and closes both presentations', async () => {
    rows = [announcement({ starts_at: '2030-01-01T00:00:00Z', ends_at: '2030-02-01T00:00:00Z' })]
    const view = await render(); expect(view.get('tbody tr').text()).not.toContain('admin.announcements.timeImmediate')
    await view.get('[title="admin.announcements.preview"]').trigger('click')
    expect(view.get('[data-test="preview"]').text()).toContain('Release notice')
    await button(view, 'Close preview').trigger('click'); expect(view.find('[data-test="preview"]').exists()).toBe(false)
    await view.get('[title="admin.announcements.readStatus"]').trigger('click'); expect(view.get('[data-test="read-status"]').text()).toContain('31')
    await button(view, 'Close readers').trigger('click'); expect(view.find('[data-test="read-status"]').exists()).toBe(false)
    expect(commands()).toEqual([])
  })

  it('offers create from the empty state and submits the literal default publication DTO', async () => {
    rows = []; total = 0
    const view = await render(); const create = view.findAll('button').filter(node => node.text() === 'admin.announcements.createAnnouncement')
    expect(create.length).toBe(2); await create[1].trigger('click')
    const form = view.get('#announcement-form'); await fillRequired(form)
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(commands()).toEqual([{ method: 'post', path: '/admin/announcements', params: {}, body: { title: 'Synthetic new announcement', content: 'Synthetic markdown **body**', status: 'draft', notify_mode: 'silent', targeting: { any_of: [] } } }])
    expect(feedback.success).toHaveBeenCalledWith('common.success'); expect(view.find('#announcement-form').exists()).toBe(false)
  })

  it('creates a scheduled popup with a subscription audience selected through the actual targeting child', async () => {
    const view = await render(); const form = await openCreate(view); await fillRequired(form)
    await choose(form.findAll('button[aria-haspopup="true"]')[0], 'admin.announcements.statusLabels.active')
    await choose(form.findAll('button[aria-haspopup="true"]')[1], 'admin.announcements.notifyModeLabels.popup')
    const dates = form.findAll('input[type="datetime-local"]'); await dates[0].setValue('2030-04-01T10:30'); await dates[1].setValue('2030-04-02T11:45')
    await form.get('input[value="custom"]').setValue(true); await flushPromises()
    expect(form.findAll('input[type="checkbox"]')).toHaveLength(1)
    await form.get('input[type="checkbox"]').setValue(true); await new Promise(resolve => setTimeout(resolve, 5)); await flushPromises()
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(commands()[0].body).toEqual({ title: 'Synthetic new announcement', content: 'Synthetic markdown **body**', status: 'active', notify_mode: 'popup', starts_at: Math.floor(new Date('2030-04-01T10:30').getTime() / 1000), ends_at: Math.floor(new Date('2030-04-02T11:45').getTime() / 1000), targeting: { any_of: [{ all_of: [{ type: 'subscription', operator: 'in', group_ids: [11] }] }] } })
  })

  it('omits unchanged fields on update and explicitly sends zero when a scheduled boundary is cleared', async () => {
    rows = [announcement({ starts_at: '2030-01-01T00:00:00Z', ends_at: '2030-02-01T00:00:00Z' })]
    const view = await render(); await view.get('[title="common.edit"]').trigger('click')
    const form = view.get('#announcement-form'); await form.get('input[type="text"]').setValue('Renamed notice')
    await form.findAll('input[type="datetime-local"]')[1].setValue('')
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(commands()[0]).toMatchObject({ method: 'put', path: '/admin/announcements/31', body: { title: 'Renamed notice', ends_at: 0 } })
    expect(Object.keys(commands()[0].body).sort()).toEqual(['ends_at', 'title'])
  })

  it('updates content, status, notification policy, dates and targeting together without changing the ID', async () => {
    const view = await render(); await view.get('[title="common.edit"]').trigger('click')
    const form = view.get('#announcement-form'); await form.get('textarea').setValue('Revised synthetic body')
    await choose(form.findAll('button[aria-haspopup="true"]')[0], 'admin.announcements.statusLabels.archived')
    await choose(form.findAll('button[aria-haspopup="true"]')[1], 'admin.announcements.notifyModeLabels.popup')
    await form.findAll('input[type="datetime-local"]')[0].setValue('2030-05-01T12:00')
    await form.get('input[value="custom"]').setValue(true); await flushPromises()
    await choose(form.findAll('button[aria-haspopup="true"]')[2], 'admin.announcements.form.conditionBalance')
    await form.get('input[type="number"]').setValue('2.5')
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(commands()[0].body).toEqual({ content: 'Revised synthetic body', status: 'archived', notify_mode: 'popup', starts_at: Math.floor(new Date('2030-05-01T12:00').getTime() / 1000), targeting: { any_of: [{ all_of: [{ type: 'balance', operator: 'gte', value: 2.5 }] }] } })
  })

  it.each(['post', 'put'])('keeps the %s form draft after a failed save and supports an explicit retry', async method => {
    const view = await render()
    const form = method === 'post' ? await openCreate(view) : (await view.get('[title="common.edit"]').trigger('click'), view.get('#announcement-form'))
    await fillRequired(form); fail = `${method} /admin/announcements${method === 'put' ? '/31' : ''}`
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith(`admin.announcements.failedTo${method === 'post' ? 'Create' : 'Update'}`)
    expect(form.get<HTMLInputElement>('input[type="text"]').element.value).toBe('Synthetic new announcement')
    expect(view.get('button[form="announcement-form"]').attributes('disabled')).toBeUndefined()
    view.get<HTMLButtonElement>('button[form="announcement-form"]').element.click(); await flushPromises()
    expect(commands()).toHaveLength(2); expect(commands()[1].body).toEqual(commands()[0].body)
  })

  it('cancels deletion without a command, retains the confirmation on error, then deletes the captured row on retry', async () => {
    const view = await render(); await view.get('[title="common.delete"]').trigger('click')
    await button(view.get('[role="dialog"]'), 'common.cancel').trigger('click'); expect(commands()).toEqual([])
    await view.get('[title="common.delete"]').trigger('click'); fail = 'delete /admin/announcements/31'
    await button(view.get('[role="dialog"]'), 'common.delete').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('admin.announcements.failedToDelete'); expect(view.find('[role="dialog"]').exists()).toBe(true)
    await button(view.get('[role="dialog"]'), 'common.delete').trigger('click'); await flushPromises()
    expect(commands().map(item => [item.method, item.path])).toEqual([['delete', '/admin/announcements/31'], ['delete', '/admin/announcements/31']])
    expect(view.find('[role="dialog"]').exists()).toBe(false)
  })

  it('applies native status, sort, page and page-size changes to the literal GET query', async () => {
    total = 75; const view = await render()
    await choose(view.findAll('button[aria-haspopup="true"]')[0], 'admin.announcements.statusLabels.active')
    expect(lastList().params).toMatchObject({ page: 1, status: 'active', sort_by: 'created_at', sort_order: 'desc' })
    const title = view.findAll('th').find(node => node.text().includes('admin.announcements.columns.title'))!
    await title.trigger('click'); await flushPromises(); expect(lastList().params).toMatchObject({ sort_by: 'title', sort_order: 'asc' })
    await view.get('[aria-label="pagination.next"]').trigger('click'); await flushPromises(); expect(lastList().params.page).toBe(2)
    await choose(view.findAll('button[aria-haspopup="true"]').at(-1)!, '50'); expect(lastList().params).toMatchObject({ page: 1, page_size: 50, status: 'active' })
  })

  it('debounces search and can recover a failed list without replacing the existing table with a write', async () => {
    const view = await render(); fail = 'get /admin/announcements'
    await view.get('[title="common.refresh"]').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('admin.announcements.failedToLoad'); expect(view.text()).toContain('Release notice')
    vi.useFakeTimers(); const field = view.get('input[placeholder="admin.announcements.searchAnnouncements"]')
    await field.setValue('Synthetic'); await field.setValue('Synthetic query'); await vi.advanceTimersByTimeAsync(301); await flushPromises()
    expect(lastList().params).toMatchObject({ page: 1, search: 'Synthetic query' }); expect(commands()).toEqual([])
  })

  it('allows the nonfatal group lookup to fail while still rendering announcements and an empty custom package selector', async () => {
    fail = 'get /admin/groups/all'; const view = await render(); expect(view.text()).toContain('Release notice')
    const form = await openCreate(view); await form.get('input[value="custom"]').setValue(true); await flushPromises()
    expect(form.text()).toContain('common.noGroupsAvailable'); expect(feedback.error).not.toHaveBeenCalled()
    await button(view.get('[role="dialog"]'), 'common.cancel').trigger('click'); expect(commands()).toEqual([])
  })
})
