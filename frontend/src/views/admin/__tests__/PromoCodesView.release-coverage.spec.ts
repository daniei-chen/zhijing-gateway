import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { InternalAxiosRequestConfig } from 'axios'
import PromoCodesView from '../PromoCodesView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import { loadLocaleMessages } from '@/i18n'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: { promo: (await vi.importActual<typeof import('@/api/admin/promo')>('@/api/admin/promo')).default } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))
interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const adapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: Record<string, unknown>[]
let usages: Record<string, unknown>[]
let total: number
let usagesTotal: number
let fail: string
let unexpected: string[]
const writeText = vi.fn<(text: string) => Promise<void>>()
const promo = (patch: Record<string, unknown> = {}) => ({ id: 51, code: 'RELEASE-ONLY', bonus_amount: 1.25, max_uses: 0, used_count: 0, status: 'active', expires_at: null, notes: 'Synthetic memo', created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const match = root.findAll('button').find(node => node.text() === label); expect(match, label).toBeDefined(); return match! }
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const options = document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')
  const option = Array.from(options).find(node => node.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises()
}
async function render() {
  const view = mount(PromoCodesView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, TablePageLayout: { template: '<section><slot name="filters"/><slot name="table"/><slot name="pagination"/></section>' }, teleport: true, transition: true } } })
  mounted.push(view); await flushPromises(); return view
}
const writes = () => wires.filter(wire => wire.method !== 'get')
const lastList = () => wires.filter(wire => wire.path === '/admin/promo-codes' && wire.method === 'get').at(-1)!
async function create(view: VueWrapper) { await button(view, 'admin.promo.createCode').trigger('click'); return view.get('#create-promo-form') }
beforeAll(async () => { await loadLocaleMessages('en') })
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-promo-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [promo()]; usages = []; total = 1; usagesTotal = 0; fail = ''; unexpected = []
  feedback.error.mockReset(); feedback.success.mockReset(); writeText.mockReset(); writeText.mockResolvedValue()
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, clipboard: { writeText } }); vi.stubGlobal('isSecureContext', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }; wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new Error('Synthetic promo transport failure') }
    let data: unknown
    if (wire.path === '/admin/promo-codes') data = wire.method === 'get' ? { items: rows, total, pages: Math.ceil(total / Number(wire.params.page_size)), page: wire.params.page, page_size: wire.params.page_size } : promo(wire.body)
    else if (wire.path === '/admin/promo-codes/51' && ['put', 'delete'].includes(wire.method)) data = promo(wire.body)
    else if (wire.path === '/admin/promo-codes/51/usages' && wire.method === 'get') data = { items: usages, total: usagesTotal, pages: Math.ceil(usagesTotal / Number(wire.params.page_size)), page: wire.params.page, page_size: wire.params.page_size }
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic promo request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = adapter; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Promo administration with literal Go DTO fields and native controls', () => {
  it.each([
    { patch: {}, label: 'statusActive', tone: 'badge-success', usage: '0 / ∞' },
    { patch: { status: 'disabled' }, label: 'statusDisabled', tone: 'badge-gray', usage: '0 / ∞' },
    { patch: { max_uses: 2, used_count: 2 }, label: 'statusMaxUsed', tone: 'badge-gray', usage: '2 / 2' },
    { patch: { max_uses: 2, used_count: 2, expires_at: '2020-01-01T00:00:00Z' }, label: 'statusExpired', tone: 'badge-danger', usage: '2 / 2' },
    { patch: { expires_at: '2099-01-01T00:00:00Z', max_uses: 3, used_count: 1 }, label: 'statusActive', tone: 'badge-success', usage: '1 / 3' },
  ])('renders $label with expiry precedence and the correct finite/unlimited usage denominator', async ({ patch, label, tone, usage }) => {
    rows = [promo(patch)]; const view = await render(); const row = view.get('tbody tr')
    expect(row.get(`.${tone}`).text()).toBe(`admin.promo.${label}`); expect(row.text()).toContain(usage); expect(row.text()).toContain('$1.25')
    expect(row.text().includes('admin.promo.neverExpires')).toBe(!('expires_at' in patch)); expect(writes()).toEqual([])
  })

  it('omits optional create fields for server code generation while preserving the unlimited zero', async () => {
    const view = await render(); await create(view)
    view.get<HTMLButtonElement>('button[form="create-promo-form"]').element.click(); await flushPromises()
    expect(writes()).toEqual([{ method: 'post', path: '/admin/promo-codes', params: {}, body: { bonus_amount: 1, max_uses: 0 } }])
    expect(feedback.success).toHaveBeenCalledWith('admin.promo.codeCreated')
    const fresh = await create(view); expect(fresh.get<HTMLInputElement>('input[type="text"]').element.value).toBe(''); expect(fresh.get<HTMLInputElement>('input[type="number"]').element.value).toBe('1')
  })

  it('submits an explicit code, decimal credit, finite uses, seconds expiry and notes through the real API', async () => {
    const view = await render(); const form = await create(view)
    await form.get('input[type="text"]').setValue('SYNTHETIC-2030'); const numbers = form.findAll('input[type="number"]')
    await numbers[0].setValue('2.75'); await numbers[1].setValue('12'); await form.get('input[type="datetime-local"]').setValue('2030-02-03T04:05'); await form.get('textarea').setValue('Synthetic release promotion')
    view.get<HTMLButtonElement>('button[form="create-promo-form"]').element.click(); await flushPromises()
    expect(writes()[0].body).toEqual({ code: 'SYNTHETIC-2030', bonus_amount: 2.75, max_uses: 12, expires_at: Math.floor(new Date('2030-02-03T04:05').getTime() / 1000), notes: 'Synthetic release promotion' })
  })

  it('blocks negative native credit input, preserves a cancelled create draft, and sends only after it is corrected', async () => {
    const view = await render(); const form = await create(view); const amount = form.get<HTMLInputElement>('input[type="number"]')
    await amount.setValue('-1'); expect(amount.element.validity.rangeUnderflow).toBe(true)
    view.get<HTMLButtonElement>('button[form="create-promo-form"]').element.click(); await flushPromises(); expect(writes()).toEqual([])
    await amount.setValue('4.5'); await form.get('input[type="text"]').setValue('SYNTHETIC-DRAFT')
    await button(view.get('[role="dialog"]'), 'common.cancel').trigger('click'); const reopened = await create(view)
    expect(reopened.get<HTMLInputElement>('input[type="text"]').element.value).toBe('SYNTHETIC-DRAFT'); expect(writes()).toEqual([])
    view.get<HTMLButtonElement>('button[form="create-promo-form"]').element.click(); await flushPromises(); expect(writes()[0].body.bonus_amount).toBe(4.5)
  })

  it('edits a stored code and explicitly clears expiry and notes while retaining valid zero fields', async () => {
    rows = [promo({ max_uses: 8, expires_at: '2030-01-01T00:00:00Z' })]
    const view = await render(); await view.get('[title="common.edit"]').trigger('click'); const form = view.get('#edit-promo-form')
    await form.get('input[type="text"]').setValue('SYNTHETIC-EDITED'); const numbers = form.findAll('input[type="number"]')
    await numbers[0].setValue('0'); await numbers[1].setValue('0'); await form.get('input[type="datetime-local"]').setValue(''); await form.get('textarea').setValue('')
    await choose(form.get('button[aria-haspopup="true"]'), 'admin.promo.statusDisabled')
    view.get<HTMLButtonElement>('button[form="edit-promo-form"]').element.click(); await flushPromises()
    expect(writes()[0]).toMatchObject({ method: 'put', path: '/admin/promo-codes/51', body: { code: 'SYNTHETIC-EDITED', bonus_amount: 0, max_uses: 0, status: 'disabled', expires_at: 0, notes: '' } })
    expect(feedback.success).toHaveBeenCalledWith('admin.promo.codeUpdated')
  })

  it('saves a newly chosen edit expiry in seconds and populates absent notes as an editable empty string', async () => {
    rows = [promo({ notes: null })]; const view = await render(); await view.get('[title="common.edit"]').trigger('click')
    const form = view.get('#edit-promo-form'); expect(form.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
    await form.get('input[type="datetime-local"]').setValue('2031-02-03T04:05')
    view.get<HTMLButtonElement>('button[form="edit-promo-form"]').element.click(); await flushPromises()
    expect(writes()[0].body.expires_at).toBe(Math.floor(new Date('2031-02-03T04:05').getTime() / 1000))
  })

  it.each(['post', 'put'])('keeps the %s draft after a failed request and retries the same payload only on an explicit second action', async method => {
    const view = await render(); const form = method === 'post' ? await create(view) : (await view.get('[title="common.edit"]').trigger('click'), view.get('#edit-promo-form'))
    await form.get('input[type="text"]').setValue('SYNTHETIC-RETRY'); fail = `${method} /admin/promo-codes${method === 'put' ? '/51' : ''}`
    const submit = view.get<HTMLButtonElement>(`button[form="${method === 'post' ? 'create' : 'edit'}-promo-form"]`)
    submit.element.click(); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith(`admin.promo.failedTo${method === 'post' ? 'Create' : 'Update'}`)
    expect(form.get<HTMLInputElement>('input[type="text"]').element.value).toBe('SYNTHETIC-RETRY'); expect(submit.attributes('disabled')).toBeUndefined()
    submit.element.click(); await flushPromises(); expect(writes()).toHaveLength(2); expect(writes()[1].body).toEqual(writes()[0].body)
  })

  it('cancels and retries deletion of the captured promo row after a visible failure', async () => {
    const view = await render(); await view.get('[title="common.delete"]').trigger('click'); await button(view.get('[role="dialog"]'), 'common.cancel').trigger('click'); expect(writes()).toEqual([])
    await view.get('[title="common.delete"]').trigger('click'); fail = 'delete /admin/promo-codes/51'
    await button(view.get('[role="dialog"]'), 'common.delete').trigger('click'); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith('admin.promo.failedToDelete')
    await button(view.get('[role="dialog"]'), 'common.delete').trigger('click'); await flushPromises()
    expect(writes().map(wire => [wire.method, wire.path])).toEqual([['delete', '/admin/promo-codes/51'], ['delete', '/admin/promo-codes/51']]); expect(feedback.success).toHaveBeenCalledWith('admin.promo.codeDeleted')
  })

  it('copies the literal code with temporary visible feedback and copies an encoded registration URL separately', async () => {
    rows = [promo({ code: 'SYNTHETIC /中?' })]; const view = await render(); vi.useFakeTimers()
    await view.get('[title="keys.copyToClipboard"]').trigger('click'); await flushPromises()
    expect(writeText).toHaveBeenCalledWith('SYNTHETIC /中?'); expect(view.find('[title="admin.promo.copied"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(2001); expect(view.find('[title="keys.copyToClipboard"]').exists()).toBe(true)
    await view.get('[title="admin.promo.copyRegisterLink"]').trigger('click'); await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/register?promo=SYNTHETIC%20%2F%E4%B8%AD%3F`); expect(feedback.success).toHaveBeenCalledWith('admin.promo.registerLinkCopied')
    expect(writes()).toEqual([])
  })

  it('uses a temporary native textarea for the registration link when Clipboard API rejects and cleans it after copy', async () => {
    writeText.mockRejectedValue(new Error('Synthetic clipboard unavailable'))
    const captured: string[] = []; Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn((command: string) => { expect(command).toBe('copy'); captured.push(document.body.querySelector<HTMLTextAreaElement>('textarea')!.value); return true }) })
    const view = await render(); await view.get('[title="admin.promo.copyRegisterLink"]').trigger('click'); await flushPromises()
    expect(captured).toEqual([`${window.location.origin}/register?promo=RELEASE-ONLY`]); expect(document.body.querySelector('textarea')).toBeNull(); expect(feedback.success).toHaveBeenCalledWith('admin.promo.registerLinkCopied')
  })

  it('does not display copied state when both the native clipboard and the code-copy fallback fail', async () => {
    writeText.mockRejectedValue(new Error('Synthetic clipboard unavailable')); Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
    const view = await render(); await view.get('[title="keys.copyToClipboard"]').trigger('click'); await flushPromises()
    expect(view.find('[title="admin.promo.copied"]').exists()).toBe(false); expect(document.body.querySelector('textarea')).toBeNull(); expect(feedback.success).not.toHaveBeenCalled()
  })

  it('shows usage emails and missing-user IDs, and requests subsequent usage pages and sizes for the same code', async () => {
    usages = [{ id: 1, user_id: 91, user: { email: 'synthetic-user@example.invalid' }, used_at: '2026-11-06T00:00:00Z', bonus_amount: 1.25 }, { id: 2, user_id: 92, user: null, used_at: '2026-11-06T00:00:00Z', bonus_amount: 2.5 }]; usagesTotal = 35
    const view = await render(); await view.get('[title="admin.promo.viewUsages"]').trigger('click'); await flushPromises(); const dialog = view.get('[role="dialog"]')
    expect(dialog.text()).toContain('synthetic-user@example.invalid'); expect(dialog.text()).toContain('admin.promo.userPrefix:{"id":92}'); expect(dialog.text()).toContain('+$2.50')
    await dialog.get('[aria-label="pagination.next"]').trigger('click'); await flushPromises(); expect(wires.at(-1)).toMatchObject({ path: '/admin/promo-codes/51/usages', params: { page: 2, page_size: 20 } })
    await choose(dialog.get('button[aria-haspopup="true"]'), '50'); expect(wires.at(-1)).toMatchObject({ path: '/admin/promo-codes/51/usages', params: { page: 1, page_size: 50 } })
    await button(dialog, 'common.close').trigger('click'); expect(view.find('[role="dialog"]').exists()).toBe(false)
  })

  it('shows empty and failed usage states and reloads usage records after closing and reopening', async () => {
    const view = await render(); fail = 'get /admin/promo-codes/51/usages'; await view.get('[title="admin.promo.viewUsages"]').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('admin.promo.failedToLoadUsages'); expect(view.get('[role="dialog"]').text()).toContain('admin.promo.noUsages')
    await button(view.get('[role="dialog"]'), 'common.close').trigger('click'); await view.get('[title="admin.promo.viewUsages"]').trigger('click'); await flushPromises()
    expect(wires.filter(wire => wire.path.endsWith('/usages'))).toHaveLength(2); expect(writes()).toEqual([])
  })

  it('requests status, sorting, pagination and debounced text through the list wire and can recover a failed refresh', async () => {
    total = 75; const view = await render(); await choose(view.findAll('button[aria-haspopup="true"]')[0], 'admin.promo.statusDisabled')
    expect(lastList().params.status).toBe('disabled')
    const sort = view.findAll('th').find(node => node.text().includes('admin.promo.columns.bonusAmount'))!; await sort.trigger('click'); await flushPromises(); expect(lastList().params).toMatchObject({ sort_by: 'bonus_amount', sort_order: 'asc' })
    await view.get('[aria-label="pagination.next"]').trigger('click'); await flushPromises(); expect(lastList().params.page).toBe(2)
    await choose(view.findAll('button[aria-haspopup="true"]').at(-1)!, '50'); expect(lastList().params).toMatchObject({ page: 1, page_size: 50 })
    fail = 'get /admin/promo-codes'; await view.get('[title="common.refresh"]').trigger('click'); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith('admin.promo.failedToLoad')
    vi.useFakeTimers(); await view.get('input[placeholder="admin.promo.searchCodes"]').setValue('SYNTHETIC'); await vi.advanceTimersByTimeAsync(301); await flushPromises()
    expect(lastList().params).toMatchObject({ page: 1, search: 'SYNTHETIC', status: 'disabled' }); expect(writes()).toEqual([])
  })
})
