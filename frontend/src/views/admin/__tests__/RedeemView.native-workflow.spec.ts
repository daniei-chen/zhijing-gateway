import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import RedeemView from '@/views/admin/RedeemView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { RedeemCode } from '@/types'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), clipboard: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, showInfo: feedback.info }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  redeem: (await import('@/api/admin/redeem')).default,
  groups: { getAll: async () => [
    { id: 11, name: 'Synthetic subscription', subscription_type: 'subscription', platform: 'openai', description: 'Synthetic', rate_multiplier: 1 },
    { id: 12, name: 'Synthetic balance group', subscription_type: 'standard', platform: 'anthropic', rate_multiplier: 1 },
  ] },
} }))

// Render the page's real cell slots and native filters; data/table presentation
// is synthetic. Requests below execute the actual redeem API and Axios client.
const table = defineComponent({
  props: ['columns', 'data', 'loading'], emits: ['sort'],
  setup(props, { slots, emit }) {
    return () => h('table', { 'aria-busy': props.loading }, [
      h('thead', h('tr', props.columns.map((column: { key: string; label: string; sortable?: boolean }) => h('th', [
        slots[`header-${column.key}`]?.({ column }) ?? column.label,
        column.sortable ? h('button', { type: 'button', onClick: () => emit('sort', column.key, 'asc') }, `sort-${column.key}`) : null,
      ])))),
      h('tbody', props.data.map((row: RedeemCode) => h('tr', { 'data-row': row.id }, props.columns.map((column: { key: keyof RedeemCode }) =>
        h('td', slots[`cell-${column.key}`]?.({ row, value: row[column.key] }) ?? String(row[column.key] ?? '')))))),
    ])
  },
})
const nativeSelect = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options', 'disabled'], emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit }) { return () => h('select', { ...attrs, disabled: props.disabled, value: String(props.modelValue ?? ''),
    onChange: (event: Event) => {
      const raw = (event.target as HTMLSelectElement).value
      const option = props.options.find((entry: { value: unknown }) => String(entry.value ?? '') === raw)
      emit('update:modelValue', option ? option.value : raw); emit('change', option?.value ?? raw, option)
    },
  }, props.options.map((entry: { value: unknown; label: string }) => h('option', { value: String(entry.value ?? '') }, entry.label))) },
})
type WireRequest = { method: string; url: string; params: Record<string, unknown>; body: any }
const wire = {
  requests: [] as WireRequest[],
  rows: [] as RedeemCode[],
  handler: undefined as undefined | ((request: WireRequest, config: InternalAxiosRequestConfig) => Promise<unknown>),
}
const views: VueWrapper[] = []
let oldAdapter: typeof apiClient.defaults.adapter
const record = (id: number, overrides: Partial<RedeemCode> = {}): RedeemCode => ({
  id, code: `SYNTHETIC-CODE-${id}`, type: 'balance', value: 12.5, status: 'unused',
  used_by: null, used_at: null, expires_at: null, created_at: '2026-01-01T00:00:00Z', ...overrides,
} as RedeemCode)
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function page(rows: RedeemCode[], number = 1, size = 20) {
  return { items: rows.slice((number - 1) * size, number * size), total: rows.length, page: number, page_size: size, pages: Math.ceil(rows.length / size) }
}
function normal(request: WireRequest) {
  if (request.method === 'GET' && request.url === '/admin/redeem-codes/export') return new Blob(['code,value\nSYNTHETIC,12.5'], { type: 'text/csv' })
  if (request.method === 'GET' && request.url === '/admin/redeem-codes') {
    const rows = wire.rows.filter(row => (!request.params.type || row.type === request.params.type) && (!request.params.status || row.status === request.params.status))
    return page(rows, Number(request.params.page), Number(request.params.page_size))
  }
  if (request.method === 'POST' && request.url.endsWith('/generate')) return [record(90)]
  if (request.method === 'POST' && request.url.endsWith('/batch-update')) return { updated: request.body.ids.length, message: 'OK' }
  if (request.method === 'POST' && request.url.endsWith('/batch-delete')) return { deleted: request.body.ids.length, message: 'OK' }
  if (request.method === 'DELETE') return { message: 'OK' }
  throw new Error('Unexpected synthetic redeem path: ' + request.method + ' ' + request.url)
}
async function render() {
  const view = mount(RedeemView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<div><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
    DataTable: table, Select: nativeSelect, GroupBadge: true, GroupOptionItem: true, Icon: true,
    BaseDialog: { props: ['show', 'title'], emits: ['close'], template: '<section v-if="show" role="dialog" :aria-label="title"><button type="button" aria-label="Close modal" @click="$emit(\'close\')">Close modal</button><slot/><slot name="footer"/></section>' },
    Pagination: { props: ['page', 'pageSize'], emits: ['update:page', 'update:pageSize'],
      template: '<nav aria-label="synthetic pagination"><button @click="$emit(\'update:page\', page+1)">next-page</button><button @click="$emit(\'update:pageSize\', 50)">size-50</button></nav>' },
  } } })
  views.push(view); await flushPromises(); return view
}
function button(root: Pick<DOMWrapper<Element>, 'findAll'>, text: string) {
  const match = root.findAll<HTMLButtonElement>('button').find(item => item.text() === text)
  expect(match, text).toBeDefined(); return match!
}
async function generator(view: VueWrapper) {
  await button(view, 'admin.redeem.generateCodes').trigger('click'); await flushPromises()
  return body().findAll('form').find(form => form.attributes('data-test') !== 'batch-update-form')!
}
const body = () => new DOMWrapper(document.body)
const mutations = (suffix = '') => wire.requests.filter(request => request.method !== 'GET' && request.url.endsWith(suffix))
const lists = () => wire.requests.filter(request => request.method === 'GET' && request.url === '/admin/redeem-codes')

beforeEach(() => {
  Object.values(feedback).forEach(mock => mock.mockReset())
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-redeem-admin', user: { id: 7 } })
  wire.requests = []; wire.rows = [record(1), record(2), record(3, { status: 'used', used_by: 14, used_at: '2026-01-02T00:00:00Z', user: { email: 'synthetic@example.invalid' } as any })]; wire.handler = undefined
  oldAdapter = apiClient.defaults.adapter
  apiClient.defaults.adapter = async config => {
    const request = { method: String(config.method).toUpperCase(), url: String(config.url), params: { ...config.params },
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    wire.requests.push(request)
    const value = wire.handler ? await wire.handler(request, config) : normal(request)
    return { data: value instanceof Blob ? value : { code: 0, message: 'OK', data: value }, status: 200, statusText: 'OK', headers: {}, config }
  }
  feedback.clipboard.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: feedback.clipboard } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic-redeem')
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = oldAdapter
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
})

describe('administrator redeem native normal workflows and wire contract', () => {
  it('resets the list page when a visible filter changes', async () => {
    const view = await render(); await button(view, 'next-page').trigger('click'); await flushPromises()
    await view.findAll('select')[1].setValue('unused'); await flushPromises()
    expect(lists().at(-1)!.params).toMatchObject({ page: 1, status: 'unused' })
  })

  it('debounces search and stops the pending search when the page is disposed', async () => {
    const view = await render(); vi.useFakeTimers()
    const search = view.get('input[placeholder="admin.redeem.searchCodes"]')
    await search.setValue('first'); await vi.advanceTimersByTimeAsync(150); await search.setValue('last')
    await vi.advanceTimersByTimeAsync(299); expect(lists()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1); await flushPromises()
    expect(lists().at(-1)!.params.search).toBe('last')
    await search.setValue('disposed'); const reads = lists().length; view.unmount()
    await vi.advanceTimersByTimeAsync(500); expect(lists()).toHaveLength(reads)
  })

  it('keeps an empty unused-code lookup informational and sends no destructive request', async () => {
    wire.rows = [record(3, { status: 'used' })]
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    await button(view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]'), 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(mutations()).toHaveLength(0)
    expect(feedback.info).toHaveBeenCalledWith('admin.redeem.noUnusedCodes')
    expect(view.find('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]').exists()).toBe(false)
  })

  it.each([1, 3, 7, 10])('preserves the %i day code expiry independently of subscription duration', async days => {
    const view = await render(); const form = await generator(view)
    if (days === 10) {
      await button(form, 'admin.redeem.customExpiry').trigger('click')
      await form.get('input[placeholder="admin.redeem.customExpiryDays"]').setValue(10)
    } else {
      await form.findAll('button').filter(item => item.text() === 'admin.redeem.expiryPresetDays')[[1, 3, 7].indexOf(days)].trigger('click')
    }
    await form.trigger('submit'); await flushPromises()
    expect(mutations('/generate')[0].body).toEqual({ count: 1, type: 'balance', value: 10, expires_in_days: days })
  })

  it('requires a positive custom code expiry and recovers after correction', async () => {
    const view = await render(); const form = await generator(view)
    await button(form, 'admin.redeem.customExpiry').trigger('click')
    const expiry = form.get<HTMLInputElement>('input[placeholder="admin.redeem.customExpiryDays"]')
    await expiry.setValue(0); await form.trigger('submit'); await flushPromises()
    expect(mutations()).toHaveLength(0); expect(feedback.error).toHaveBeenCalledWith('admin.redeem.expiryDaysRequired')
    await expiry.setValue(30); await form.trigger('submit'); await flushPromises()
    expect(mutations('/generate')[0].body.expires_in_days).toBe(30)
  })

  it('converts a selected local batch expiry to ISO and preserves the selected group', async () => {
    const view = await render(); await view.get('[data-test="select-code"]').setValue(true)
    await view.get('[data-test="batch-update-open"]').trigger('click')
    const form = body().get('[data-test="batch-update-form"]'); const boxes = form.findAll('input[type="checkbox"]')
    await boxes[1].setValue(true); await form.get('select').setValue('custom')
    await form.get('input[type="datetime-local"]').setValue('2027-01-20T11:30')
    await boxes[3].setValue(true); await form.findAll('select')[1].setValue(11)
    await form.trigger('submit'); await flushPromises()
    expect(mutations('/batch-update')[0].body).toEqual({ ids: [1], fields: { expires_at: new Date('2027-01-20T11:30').toISOString(), group_id: 11 } })
  })

  it('keeps a missing custom batch expiry recoverable without sending a partial update', async () => {
    const view = await render(); await view.get('[data-test="select-code"]').setValue(true)
    await view.get('[data-test="batch-update-open"]').trigger('click')
    const form = body().get('[data-test="batch-update-form"]')
    await form.findAll('input[type="checkbox"]')[1].setValue(true); await form.get('select').setValue('custom')
    await form.get('input[type="datetime-local"]').setValue(''); await form.trigger('submit'); await flushPromises()
    expect(mutations()).toHaveLength(0); expect(feedback.error).toHaveBeenCalledWith('admin.redeem.expiryDateRequired')
    await form.get('select').setValue('clear'); await form.trigger('submit'); await flushPromises()
    expect(mutations('/batch-update')[0].body.fields).toEqual({ expires_at: null })
  })

  it('downloads only the newly generated codes as the original plain-text format', async () => {
    wire.handler = request => Promise.resolve(request.url.endsWith('/generate') ? [record(90), record(91)] : normal(request))
    const view = await render(); const form = await generator(view); await form.trigger('submit'); await flushPromises()
    await button(body(), 'admin.redeem.download').trigger('click')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/plain')
    expect(body().get<HTMLTextAreaElement>('textarea[readonly]').element.value).toBe('SYNTHETIC-CODE-90\nSYNTHETIC-CODE-91')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-redeem')
    expect(document.body.querySelector('a[download]')).toBeNull()
  })

  it.each([
    ['balance', { count: 2, type: 'balance', value: 25.75 }],
    ['concurrency', { count: 2, type: 'concurrency', value: 4 }],
    ['invitation', { count: 2, type: 'invitation', value: 0 }],
    ['subscription', { count: 2, type: 'subscription', value: 10, group_id: 11, validity_days: 45 }],
  ])('generates %s through the visible form with the original Go DTO fields', async (type, expected) => {
    const view = await render(); const form = await generator(view)
    await form.get('select').setValue(type); await flushPromises()
    const numbers = form.findAll<HTMLInputElement>('input[type="number"]')
    if (type === 'subscription') {
      expect(form.findAll('select')[1].findAll('option').map(option => option.text())).not.toContain('Synthetic balance group')
      await form.findAll('select')[1].setValue(11); await numbers[0].setValue(45)
    } else if (type !== 'invitation') await numbers[0].setValue(type === 'balance' ? 25.75 : 4)
    await numbers.at(-1)!.setValue(2); await form.trigger('submit'); await flushPromises()
    expect(mutations('/generate')).toEqual([expect.objectContaining({ body: expected })])
    expect(body().get<HTMLTextAreaElement>('textarea[readonly]').element.value).toBe('SYNTHETIC-CODE-90')
    expect(lists()).toHaveLength(2)
  })

  it('changes type from invitation back to a nonzero ordinary amount', async () => {
    const view = await render(); const form = await generator(view)
    await form.get('select').setValue('invitation'); await flushPromises(); expect(form.findAll('input[type="number"]')).toHaveLength(1)
    await form.get('select').setValue('balance'); await flushPromises(); expect(form.get<HTMLInputElement>('input[type="number"]').element.value).toBe('10')
    await form.trigger('submit'); await flushPromises(); expect(mutations('/generate')[0].body).toEqual({ count: 1, type: 'balance', value: 10 })
  })

  it('keeps the subscription group requirement and sends no generation before it is selected', async () => {
    const view = await render(); const form = await generator(view); await form.get('select').setValue('subscription')
    await form.trigger('submit'); await flushPromises()
    expect(mutations()).toHaveLength(0); expect(feedback.error).toHaveBeenCalledWith('admin.redeem.groupRequired')
  })

  it('preserves query filters, sorting and pagination on normal list and CSV actions', async () => {
    const view = await render(); await view.findAll('select')[0].setValue('balance')
    await button(view, 'sort-value').trigger('click'); await button(view, 'next-page').trigger('click')
    await button(view, 'size-50').trigger('click'); await flushPromises()
    expect(lists().at(-1)!.params).toMatchObject({ page: 1, page_size: 50, type: 'balance', sort_by: 'value', sort_order: 'asc' })
    await button(view, 'admin.redeem.exportCsv').trigger('click'); await flushPromises()
    expect(wire.requests.find(request => request.url.endsWith('/export'))?.params).toMatchObject({ type: 'balance', sort_by: 'value', sort_order: 'asc' })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-redeem')
  })

  it('selects only checked fields, including explicit empty notes, group clearing and expiry clearing', async () => {
    const view = await render(); await view.get('[data-test="select-all-codes"]').setValue(true)
    await view.get('[data-test="select-code"]').setValue(false)
    await view.get('[data-test="batch-update-open"]').trigger('click')
    const form = body().get('[data-test="batch-update-form"]')
    await form.get('[data-test="batch-field-status"]').setValue(true)
    await form.get('[data-test="batch-field-notes"]').setValue(true)
    const boxes = form.findAll<HTMLInputElement>('input[type="checkbox"]')
    await boxes[1].setValue(true); await boxes[3].setValue(true)
    await form.trigger('submit'); await flushPromises()
    expect(mutations('/batch-update')[0].body).toEqual({ ids: [2, 3], fields: { status: 'disabled', expires_at: null, notes: '', group_id: null } })
  })

  it('rejects a batch without selected fields and does not send an empty mutation', async () => {
    const view = await render(); await view.get('[data-test="select-code"]').setValue(true)
    await view.get('[data-test="batch-update-open"]').trigger('click'); await body().get('[data-test="batch-update-form"]').trigger('submit'); await flushPromises()
    expect(mutations()).toHaveLength(0); expect(feedback.error).toHaveBeenCalledWith('admin.redeem.noBatchFieldsSelected')
  })

  it('deletes only the native confirmed unused target and keeps a used code without a delete control', async () => {
    const view = await render(); expect(view.get('[data-row="3"]').findAll('button').some(item => item.text() === 'common.delete')).toBe(false)
    await button(view.get('[data-row="2"]'), 'common.delete').trigger('click')
    await button(view.get('[role="dialog"][aria-label="admin.redeem.deleteCode"]'), 'common.delete').trigger('click'); await flushPromises()
    expect(mutations()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/admin/redeem-codes/2' })])
  })
})

describe('administrator redeem operation ownership regressions', () => {
  it('keeps an accepted unused-code deletion visibly pending after its confirmation is closed', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/batch-delete') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    const dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]')
    await button(dialog, 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(1)
    await button(dialog, 'common.cancel').trigger('click')
    const action = button(view, 'admin.redeem.deleteAllUnused').element
    expect(action.disabled).toBe(true)
    expect(view.find('[role="status"]').text()).toBe('common.submitting')
    action.click(); await flushPromises(); expect(mutations('/batch-delete')).toHaveLength(1)
    pending.resolve({ deleted: 2, message: 'OK' }); await flushPromises()
    expect(action.disabled).toBe(false)
    expect(feedback.success).not.toHaveBeenCalled()
  })
  it('allows a new unused-code lookup after cancelling an old read without letting its finally unlock the new read', async () => {
    wire.rows = Array.from({ length: 1001 }, (_, index) => record(index + 1))
    const oldPage = deferred<unknown>(); const newPage = deferred<unknown>(); let generation = 0
    wire.handler = request => {
      if (request.params.page_size === 1000) {
        if (request.params.page === 1) generation += 1
        if (request.params.page === 2) return generation === 1 ? oldPage.promise : newPage.promise
      }
      return Promise.resolve(normal(request))
    }
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    let dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]')
    await button(dialog, 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(lists().filter(request => request.params.page_size === 1000).map(request => request.params.page)).toEqual([1, 2])
    await button(dialog, 'common.cancel').trigger('click')
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]')
    await button(dialog, 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(lists().filter(request => request.params.page_size === 1000).map(request => request.params.page)).toEqual([1, 2, 1, 2])
    oldPage.resolve(page(wire.rows, 2, 1000)); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(0)
    const confirm = button(dialog, 'common.submitting')
    confirm.element.click(); await flushPromises()
    expect(lists().filter(request => request.params.page_size === 1000)).toHaveLength(4)
    newPage.resolve(page(wire.rows, 2, 1000)); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(1)
  })

  it('does not publish CSV success when native anchor activation synchronously disposes its page', async () => {
    const view = await render()
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) {
      this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const disposeOnDownload = (event: Event) => {
      if (event.target instanceof HTMLAnchorElement) { event.preventDefault(); view.unmount() }
    }
    document.addEventListener('click', disposeOnDownload)
    try {
      await button(view, 'admin.redeem.exportCsv').trigger('click'); await flushPromises()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-redeem')
      expect(feedback.success).not.toHaveBeenCalled()
      expect(feedback.error).not.toHaveBeenCalled()
    } finally { document.removeEventListener('click', disposeOnDownload) }
  })

  it('keeps a separate confirmed delete target usable while an earlier cancelled target is still in flight', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.method === 'DELETE' && request.url.endsWith('/1') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await button(view.get('[data-row="1"]'), 'common.delete').trigger('click')
    let dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteCode"]')
    await button(dialog, 'common.delete').trigger('click'); await flushPromises()
    await button(dialog, 'common.cancel').trigger('click')
    await button(view.get('[data-row="2"]'), 'common.delete').trigger('click')
    dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteCode"]')
    await button(dialog, 'common.delete').trigger('click'); await flushPromises()
    expect(mutations().map(request => request.url)).toEqual(['/admin/redeem-codes/1', '/admin/redeem-codes/2'])
    pending.resolve({ message: 'OK' }); await flushPromises()
    expect(feedback.success).toHaveBeenCalledTimes(1)
  })

  it('keeps field labels unique across two mounted applications in the same document', async () => {
    const first = await render(); const formA = await generator(first)
    const second = await render(); await button(second, 'admin.redeem.generateCodes').trigger('click'); await flushPromises()
    const formB = body().findAll('form').at(-1)!
    expect(formA.element).not.toBe(formB.element)
    const ids = [formA, formB].flatMap(form => form.findAll<HTMLLabelElement>('label').map(label => {
      expect(label.element.control).not.toBeNull()
      expect(form.element.contains(label.element.control)).toBe(true)
      return label.element.control!.id
    }))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps a newer successful list when an earlier filter response arrives late', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url === '/admin/redeem-codes' && request.params.status === 'unused'
      ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await view.findAll('select')[1].setValue('used'); await flushPromises()
    expect(view.text()).toContain('SYNTHETIC-CODE-3')
    pending.resolve(page([record(1)], 1, 20)); await flushPromises()
    expect(view.text()).toContain('SYNTHETIC-CODE-3')
    expect(view.text()).not.toContain('SYNTHETIC-CODE-1')
    expect(feedback.error).not.toHaveBeenCalled()
  })

  it.each(['empty', 'duplicate', 'changed-total', 'used-row'] as const)('refuses a partial destructive command when unused pagination is %s', async kind => {
    wire.rows = Array.from({ length: 1001 }, (_, index) => record(index + 1))
    wire.handler = request => {
      if (request.params.page_size === 1000 && request.params.page === 2) {
        const result = page(wire.rows, 2, 1000)
        if (kind === 'empty') result.items = []
        if (kind === 'duplicate') result.items = [record(1)]
        if (kind === 'changed-total') result.total += 1
        if (kind === 'used-row') result.items = [record(1001, { status: 'used' })]
        return Promise.resolve(result)
      }
      return Promise.resolve(normal(request))
    }
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    await button(view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]'), 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(0)
    expect(feedback.success).not.toHaveBeenCalled()
    expect(feedback.error).toHaveBeenCalledWith('admin.redeem.failedToDeleteUnused')
    expect(view.find('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]').exists()).toBe(true)
  })

  it('does not continue to delete when the user cancels the pending unused-code lookup', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url === '/admin/redeem-codes' && request.params.page_size === 1000 ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    const dialog = view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]')
    await button(dialog, 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    await button(dialog, 'common.cancel').trigger('click')
    pending.resolve(page([record(1)], 1, 1000)); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(0)
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
  })

  it('ignores synchronous repeated native delete confirmation while its captured request is pending', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.method === 'DELETE' ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await button(view.get('[data-row="1"]'), 'common.delete').trigger('click')
    const action = button(view.get('[role="dialog"][aria-label="admin.redeem.deleteCode"]'), 'common.delete').element
    action.click(); action.click(); await flushPromises()
    expect(mutations()).toHaveLength(1)
    pending.resolve({ message: 'OK' }); await flushPromises()
  })

  it('does not send commands from a view captured before a replacement login', async () => {
    const view = await render(); const form = await generator(view)
    replaceAuthSession({ accessToken: 'synthetic-redeem-replaced-login', user: { id: 7 } })
    await form.trigger('submit'); await button(view, 'admin.redeem.exportCsv').trigger('click'); await flushPromises()
    expect(mutations()).toHaveLength(0)
    expect(wire.requests.some(request => request.url.endsWith('/export'))).toBe(false)
    expect(feedback.error).not.toHaveBeenCalled()
  })

  it('associates generation labels with their own controls and names the expiry choice group', async () => {
    const view = await render(); const form = await generator(view)
    await form.get('select').setValue('subscription'); await flushPromises()
    await button(form, 'admin.redeem.customExpiry').trigger('click')
    const labels = form.findAll<HTMLLabelElement>('label')
    expect(labels.length).toBeGreaterThanOrEqual(5)
    for (const label of labels) {
      expect(label.element.control, label.text()).not.toBeNull()
      expect(form.element.contains(label.element.control)).toBe(true)
    }
    const choice = form.get('[role="group"]')
    const labelledBy = choice.attributes('aria-labelledby')
    expect(document.getElementById(labelledBy!)?.textContent).toBe('admin.redeem.codeExpiry')
  })

  it('shows the actual current HTTP rejection message and keeps a corrected generation retry usable', async () => {
    wire.handler = (request, config) => request.url.endsWith('/generate')
      ? Promise.reject(new AxiosError('Synthetic HTTP 400', 'ERR_BAD_REQUEST', config, undefined, {
        data: { code: 400, message: 'Synthetic generation policy rejection' }, status: 400, statusText: 'Bad Request', headers: {}, config,
      })) : Promise.resolve(normal(request))
    const view = await render(); const form = await generator(view); await form.trigger('submit'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith('Synthetic generation policy rejection')
    expect(body().find('form').exists()).toBe(true)
    wire.handler = undefined; await form.get('input[type="number"]').setValue(14)
    await form.trigger('submit'); await flushPromises()
    expect(mutations('/generate').at(-1)!.body.value).toBe(14)
    expect(body().get<HTMLTextAreaElement>('textarea[readonly]').element.value).toBe('SYNTHETIC-CODE-90')
  })

  it('does not let an earlier row copy timer clear newer visible copy feedback', async () => {
    const view = await render(); vi.useFakeTimers()
    await view.get('[data-row="1"] button[title="keys.copyToClipboard"]').trigger('click'); await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await view.get('[data-row="2"] button[title="keys.copyToClipboard"]').trigger('click'); await flushPromises()
    await vi.advanceTimersByTimeAsync(600)
    expect(view.get('[data-row="2"] button').attributes('title')).toBe('admin.redeem.copied')
    expect(feedback.clipboard.mock.calls.map(call => call[0])).toEqual(['SYNTHETIC-CODE-1', 'SYNTHETIC-CODE-2'])
  })

  it('keeps copied feedback and notification owned by the result that was actually copied', async () => {
    const pending = deferred<void>(); feedback.clipboard.mockReturnValue(pending.promise)
    let generation = 0
    wire.handler = request => Promise.resolve(request.url.endsWith('/generate') ? [record(90 + generation++)] : normal(request))
    const view = await render(); const first = await generator(view); await first.trigger('submit'); await flushPromises()
    await button(body(), 'admin.redeem.copyAll').trigger('click'); await flushPromises()
    expect(feedback.clipboard).toHaveBeenCalledWith('SYNTHETIC-CODE-90')
    const close = body().get('[role="dialog"][aria-label="admin.redeem.generatedSuccessfully"] button[aria-label="Close modal"]')
    expect(close).toBeDefined(); await close.trigger('click')
    const next = await generator(view); await next.trigger('submit'); await flushPromises()
    pending.resolve(); await flushPromises()
    expect(body().get<HTMLTextAreaElement>('textarea[readonly]').element.value).toBe('SYNTHETIC-CODE-91')
    expect(button(body(), 'admin.redeem.copyAll')).toBeDefined()
    expect(feedback.success).not.toHaveBeenCalledWith('admin.redeem.copied')
  })

  it('keeps a reopened generation draft when an older request completes', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/generate') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); const first = await generator(view)
    await first.trigger('submit'); await vi.waitFor(() => expect(mutations('/generate')).toHaveLength(1))
    await button(first, 'common.cancel').trigger('click')
    const next = await generator(view); await next.get('input[type="number"]').setValue(77)
    pending.resolve([record(90)]); await flushPromises()
    expect(body().find('form').exists()).toBe(true)
    expect(body().get<HTMLInputElement>('form input[type="number"]').element.value).toBe('77')
    expect(body().find('textarea[readonly]').exists()).toBe(false)
  })

  it('preserves changes made to a pending generation form instead of presenting them as submitted', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/generate') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); const form = await generator(view)
    await form.trigger('submit'); await vi.waitFor(() => expect(mutations('/generate')).toHaveLength(1))
    await form.findAll('input[type="number"]')[0].setValue(89)
    pending.resolve([record(90)]); await flushPromises()
    expect(body().find('form').exists()).toBe(true)
    expect(body().get<HTMLInputElement>('form input[type="number"]').element.value).toBe('89')
    expect(mutations('/generate')[0].body.value).toBe(10)
  })

  it.each(['session', 'unmount'] as const)('does not follow up or publish an old generation after %s replacement', async boundary => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/generate') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); const form = await generator(view)
    await form.trigger('submit'); await vi.waitFor(() => expect(mutations('/generate')).toHaveLength(1))
    const reads = lists().length
    if (boundary === 'session') replaceAuthSession({ accessToken: 'synthetic-redeem-new-login', user: { id: 7 } })
    else view.unmount()
    pending.resolve([record(90)]); await flushPromises()
    expect(lists()).toHaveLength(reads)
    expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
  })

  it('keeps the newer delete target after cancelling a pending confirmation', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.method === 'DELETE' ? pending.promise : Promise.resolve(normal(request))
    const view = await render()
    await button(view.get('[data-row="1"]'), 'common.delete').trigger('click')
    const old = view.get('[role="dialog"][aria-label="admin.redeem.deleteCode"]')
    await button(old, 'common.delete').trigger('click'); await vi.waitFor(() => expect(mutations()).toHaveLength(1))
    await button(old, 'common.cancel').trigger('click')
    await button(view.get('[data-row="2"]'), 'common.delete').trigger('click')
    pending.resolve({ message: 'OK' }); await flushPromises()
    expect(view.find('[role="dialog"][aria-label="admin.redeem.deleteCode"]').exists()).toBe(true)
    expect(mutations()[0].url).toBe('/admin/redeem-codes/1')
  })

  it('keeps a new batch draft and selection when a previous closed batch completes', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/batch-update') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await view.get('[data-row="1"] input[type="checkbox"]').setValue(true)
    await view.get('[data-test="batch-update-open"]').trigger('click')
    const old = body().get('[data-test="batch-update-form"]')
    await old.get('[data-test="batch-field-notes"]').setValue(true); await old.get('textarea').setValue('Old captured notes')
    await old.trigger('submit'); await vi.waitFor(() => expect(mutations('/batch-update')).toHaveLength(1))
    await button(old, 'common.cancel').trigger('click')
    await view.get('[data-row="1"] input[type="checkbox"]').setValue(false)
    await view.get('[data-row="2"] input[type="checkbox"]').setValue(true)
    const open = view.findAll<HTMLButtonElement>('button').find(item => item.text() === 'admin.redeem.batchUpdate' && !item.element.disabled)!
    expect(open).toBeDefined(); open.element.click(); await flushPromises()
    await body().get('[data-test="batch-field-notes"]').setValue(true)
    await body().get('[data-test="batch-notes-input"]').setValue('New captured notes')
    pending.resolve({ updated: 1, message: 'OK' }); await flushPromises()
    expect(body().find('[data-test="batch-update-form"]').exists()).toBe(true)
    expect(body().get<HTMLTextAreaElement>('[data-test="batch-notes-input"]').element.value).toBe('New captured notes')
    expect(view.get<HTMLInputElement>('[data-row="2"] input[type="checkbox"]').element.checked).toBe(true)
    expect(mutations('/batch-update')[0].body).toEqual({ ids: [1], fields: { notes: 'Old captured notes' } })
  })

  it('keeps a failed filter list explicit and retries the current query without old code actions', async () => {
    let unavailable = true
    wire.handler = (request, config) => request.method === 'GET' && request.url === '/admin/redeem-codes' && request.params.status === 'disabled' && unavailable
      ? Promise.reject(new AxiosError('Synthetic failed current list', 'ERR_NETWORK', config)) : Promise.resolve(normal(request))
    const view = await render(); await view.findAll('select')[1].setValue('disabled'); await flushPromises()
    expect(body().find('[role="alert"]').exists()).toBe(true)
    expect(view.text()).not.toContain('SYNTHETIC-CODE-1')
    unavailable = false
    await button(body().get('[role="alert"]'), 'common.retry').trigger('click'); await flushPromises()
    expect(lists().at(-1)!.params.status).toBe('disabled')
    expect(body().find('[role="alert"]').exists()).toBe(false)
  })

  it('starts at most one CSV request from repeated native export clicks', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/export') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); const exportButton = button(view, 'admin.redeem.exportCsv').element
    exportButton.click(); exportButton.click(); await flushPromises()
    expect(wire.requests.filter(request => request.url.endsWith('/export'))).toHaveLength(1)
    pending.resolve(new Blob(['synthetic csv'])); await flushPromises()
  })

  it('does not produce a late CSV download or feedback after the view is disposed', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url.endsWith('/export') ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await button(view, 'admin.redeem.exportCsv').trigger('click'); await flushPromises()
    expect(wire.requests.some(request => request.url.endsWith('/export'))).toBe(true)
    view.unmount(); pending.resolve(new Blob(['synthetic old csv'])); await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
  })

  it('releases the CSV URL when native download activation fails', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error('Synthetic blocked download') })
    const view = await render(); await button(view, 'admin.redeem.exportCsv').trigger('click'); await flushPromises()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-redeem')
    expect(document.body.querySelector('a[download]')).toBeNull()
    expect(feedback.error).toHaveBeenCalledWith('admin.redeem.failedToExport')
  })

  it('reads every unused-code page before confirming the original batch-delete contract', async () => {
    wire.rows = Array.from({ length: 1001 }, (_, index) => record(index + 1))
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    await button(view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]'), 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(1)
    expect(mutations('/batch-delete')[0].body.ids).toEqual(Array.from({ length: 1001 }, (_, index) => index + 1))
    expect(lists().filter(request => request.params.page_size === 1000).map(request => request.params.page)).toEqual([1, 2])
  })

  it('does not send a destructive batch after an unused-code lookup finishes on a disposed page', async () => {
    const pending = deferred<unknown>()
    wire.handler = request => request.url === '/admin/redeem-codes' && request.params.page_size === 1000 ? pending.promise : Promise.resolve(normal(request))
    const view = await render(); await view.findAll('select')[1].setValue('unused'); await flushPromises()
    await button(view, 'admin.redeem.deleteAllUnused').trigger('click')
    await button(view.get('[role="dialog"][aria-label="admin.redeem.deleteAllUnused"]'), 'admin.redeem.deleteAll').trigger('click'); await flushPromises()
    view.unmount(); pending.resolve(page([record(1)], 1, 1000)); await flushPromises()
    expect(mutations('/batch-delete')).toHaveLength(0)
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
  })
})
