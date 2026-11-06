import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import ProxiesView from '../ProxiesView.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({
  list: vi.fn(), getAllWithCount: vi.fn(), create: vi.fn(), update: vi.fn(),
  batchCreate: vi.fn(), getProxyAccounts: vi.fn(), delete: vi.fn(), batchDelete: vi.fn(),
  testProxy: vi.fn(), checkProxyQuality: vi.fn(), exportData: vi.fn()
}))
const notice = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }))
const clipboard = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin', () => ({ adminAPI: { proxies: api } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => notice }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: clipboard }) }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params?.name ? key+':'+params.name : key })
}))

function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((r, fail) => { resolve = r; reject = fail })
  return { promise, resolve, reject }
}
const rows = [9, 10].map(id => ({
  id, name: 'proxy-'+id, protocol: 'socks5', host: id===9 ? '2001:db8::1' : 'proxy.example.invalid',
  port: 1080, username: 'test user', password: 'test:@password', status: 'active', account_count: 0,
  created_at: '2026-11-06T00:00:00Z', expires_at: null, fallback_mode: 'none'
}))
const mountView = () => shallowMount(ProxiesView, { global: { stubs: {
  AppLayout: { template: '<main><slot /></main>' },
  TablePageLayout: { template: '<div><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
  DataTable: { props: ['data'], emits: ['sort'], template: `<div><button data-sort @click="$emit('sort','name','asc')">Sort</button><div v-for="row in data" :key="row.id" :data-row="row.id">
    <slot name="cell-select" :row="row"/><slot name="cell-address" :row="row"/><slot name="cell-account_count" :row="row" :value="row.account_count"/>
    <slot name="cell-actions" :row="row"/>
    </div></div>` },
  BaseDialog: { props: ['show','title'], emits: ['close'], template: `<section v-if="show" :data-dialog="title">
    <button data-dismiss @click="$emit('close')">Dismiss</button><slot/><slot name="footer"/></section>` },
  ConfirmDialog: { props: ['show','title','message'], emits: ['confirm','cancel'], template: `<section v-if="show" :data-confirm="title">{{message}}<button data-confirm-yes @click="$emit('confirm')">Confirm</button><button data-confirm-cancel @click="$emit('cancel')">Cancel</button></section>` },
  Select: { props: ['modelValue','options'], emits: ['update:modelValue','change'], template: `<select :value="modelValue"
    @change="$emit('update:modelValue',$event.target.value);$emit('change',$event.target.value)">
    <option v-for="option in options" :key="String(option.value)" :value="option.value">{{option.label}}</option></select>` }
} } })
let wrapper: ReturnType<typeof mountView>
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'SYNTHETIC-ADMIN', user: { id: 1, role: 'admin' } })
  api.list.mockResolvedValue({ items: structuredClone(rows), total: 2, pages: 1 })
  api.getAllWithCount.mockResolvedValue([])
  api.create.mockResolvedValue({ id: 11 })
  api.update.mockResolvedValue({})
  api.getProxyAccounts.mockResolvedValue([])
  api.batchCreate.mockResolvedValue({ created: 1, skipped: 0 })
  api.delete.mockResolvedValue({})
  api.batchDelete.mockResolvedValue({ deleted_ids: [9], skipped: [] })
  api.testProxy.mockResolvedValue({ success: true })
  api.checkProxyQuality.mockResolvedValue(quality('synthetic quality'))
  api.exportData.mockResolvedValue({ proxies: [] })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function open() { wrapper = mountView(); await flushPromises() }
async function clickText(text: string, scope = wrapper) {
  const button=scope.findAll('button').find(button => button.text()===text)
  expect(button, text+' button').toBeTruthy()
  await button!.trigger('click'); await flushPromises()
}
const confirmation = (title: string) => wrapper.get(`[data-confirm="${title}"]`)
const rowAction = async (id: number, label: string) => {
  const button = wrapper.get(`[data-row="${id}"]`).findAll('button').find(button => button.text() === label)
  expect(button).toBeDefined()
  await button!.trigger('click'); await flushPromises()
}
const quality = (summary: string) => ({ score: 90, grade: 'A', summary, checked_at: 1, challenge_count: 0, failed_count: 0, warn_count: 0, items: [] })

describe('proxy lifecycle and boundary workflows', () => {
  it('keeps B deletion and selection intact when an earlier A deletion finishes', async () => {
    const result = pending<any>(); api.delete.mockReturnValueOnce(result.promise)
    await open()
    await wrapper.get('[data-row="10"] input[type="checkbox"]').setValue(true)
    await rowAction(9, 'common.delete')
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-yes]').trigger('click')
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-cancel]').trigger('click')
    await rowAction(10, 'common.delete')
    expect(confirmation('admin.proxies.deleteProxy').text()).toContain('proxy-10')
    result.resolve({}); await flushPromises()
    expect(wrapper.find('[data-confirm="admin.proxies.deleteProxy"]').exists()).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-row="10"] input[type="checkbox"]').element.checked).toBe(true)
  })

  it('does not submit two deletes while confirmation is pending', async () => {
    const result = pending<any>(); api.delete.mockReturnValue(result.promise)
    await open(); await rowAction(9, 'common.delete')
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-yes]').trigger('click')
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-yes]').trigger('click')
    expect(api.delete).toHaveBeenCalledTimes(1)
    result.resolve({}); await flushPromises()
  })

  it('does not download proxy credentials after the exporting page unmounts', async () => {
    const result = pending<any>(); api.exportData.mockReturnValueOnce(result.promise)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await open(); await clickText('admin.proxies.dataExport')
    await confirmation('admin.proxies.dataExport').get('[data-confirm-yes]').trigger('click')
    wrapper.unmount()
    result.resolve({ proxies: [{ password: 'synthetic-private' }] }); await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('does not close a newly opened export confirmation from an earlier export', async () => {
    const result = pending<any>(); api.exportData.mockReturnValueOnce(result.promise)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await open(); await clickText('admin.proxies.dataExport')
    await confirmation('admin.proxies.dataExport').get('[data-confirm-yes]').trigger('click')
    await confirmation('admin.proxies.dataExport').get('[data-confirm-cancel]').trigger('click')
    await clickText('admin.proxies.dataExport')
    result.resolve({ proxies: [] }); await flushPromises()
    expect(wrapper.find('[data-confirm="admin.proxies.dataExport"]').exists()).toBe(true)
  })

  it('does not replace the latest quality report with an older request', async () => {
    const first = pending<any>()
    api.checkProxyQuality.mockImplementation(id => id === 9 ? first.promise : Promise.resolve(quality('latest B report')))
    await open(); await rowAction(9, 'admin.proxies.qualityCheck'); await rowAction(10, 'admin.proxies.qualityCheck')
    expect(wrapper.text()).toContain('latest B report')
    first.resolve(quality('old A report')); await flushPromises()
    expect(wrapper.text()).toContain('latest B report')
    expect(wrapper.text()).not.toContain('old A report')
  })

  it('stops scheduling batch work after its page unmounts', async () => {
    const firstWave = pending<any>()
    const six = Array.from({length: 6}, (_, index) => ({ ...rows[0], id: index + 1 }))
    api.list.mockResolvedValue({ items: six, total: 6, pages: 1 })
    api.testProxy.mockReturnValueOnce(firstWave.promise).mockReturnValueOnce(firstWave.promise).mockReturnValueOnce(firstWave.promise).mockReturnValueOnce(firstWave.promise).mockReturnValueOnce(firstWave.promise).mockResolvedValue({ success: true })
    await open()
    const button = wrapper.findAll('button').find(button => button.text() === 'admin.proxies.testConnection')!
    await button.trigger('click'); await flushPromises()
    expect(api.testProxy).toHaveBeenCalledTimes(5)
    wrapper.unmount()
    firstWave.resolve({ success: true }); await flushPromises()
    expect(api.testProxy).toHaveBeenCalledTimes(5)
  })

  it('round-trips a copied IPv6 URL without changing authentication bytes', async () => {
    await open()
    await wrapper.get('[data-row="9"] button[title="admin.proxies.copyProxyUrl"]').trigger('click')
    const copied = clipboard.mock.calls[0][0]
    await clickText('admin.proxies.createProxy'); await clickText('admin.proxies.batchAdd')
    await wrapper.get('textarea').setValue(copied)
    const button = wrapper.findAll('button').find(button => button.text().startsWith('admin.proxies.importProxies'))
      ?? wrapper.findAll('button').find(button => button.attributes('class')?.includes('btn-primary') && button.attributes('type') === 'button')
    expect(button).toBeDefined(); await button!.trigger('click'); await flushPromises()
    expect(api.batchCreate).toHaveBeenCalledWith([expect.objectContaining({ host: '2001:db8::1', username: 'test user', password: 'test:@password' })])
  })
})

describe('proxy bulk and export operation ownership', () => {
  it.each(['test','quality'])('ignores an old %s result after the proxy endpoint is edited', async kind => {
    const result=pending<any>()
    const endpoint=kind === 'test' ? api.testProxy : api.checkProxyQuality
    endpoint.mockReturnValueOnce(result.promise)
    await open(); await rowAction(9, kind === 'test' ? 'admin.proxies.testConnection' : 'admin.proxies.qualityCheck')
    await rowAction(9,'common.edit')
    await wrapper.get('#proxy-edit-host').setValue('new-synthetic.invalid')
    await wrapper.get('#edit-proxy-form').trigger('submit'); await flushPromises()
    expect(api.update).toHaveBeenCalledTimes(1)
    notice.showSuccess.mockClear()
    result.resolve(kind === 'test' ? {success:true,latency_ms:99} : quality('old endpoint report')); await flushPromises()
    expect(notice.showSuccess).not.toHaveBeenCalled()
    expect(wrapper.find('[data-dialog="admin.proxies.qualityReportTitle"]').exists()).toBe(false)
  })

  it.each(['success', 'failure'])('discards an export %s from a replaced login', async outcome => {
    const result = pending<any>(); api.exportData.mockReturnValueOnce(result.promise)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic') })
    await open(); await clickText('admin.proxies.dataExport')
    await confirmation('admin.proxies.dataExport').get('[data-confirm-yes]').trigger('click')
    replaceAuthSession({accessToken: 'SYNTHETIC-NEW-SESSION', user: {id: 1, role: 'admin'}})
    if (outcome === 'success') result.resolve({proxies: [{password: 'synthetic-old-password'}]})
    else result.reject(new Error('old export failed'))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(notice.showSuccess).not.toHaveBeenCalled()
    expect(notice.showError).not.toHaveBeenCalled()
  })

  it('reclaims a generated export URL when clicking download throws and permits retry', async () => {
    const createUrl = vi.fn(() => 'blob:synthetic')
    const revokeUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(() => { throw new Error('synthetic download blocked') }).mockImplementation(() => {})
    await open(); await clickText('admin.proxies.dataExport')
    await confirmation('admin.proxies.dataExport').get('[data-confirm-yes]').trigger('click'); await flushPromises()
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:synthetic')
    expect(notice.showError).toHaveBeenCalledWith('synthetic download blocked')
    expect(wrapper.find('[data-confirm="admin.proxies.dataExport"]').exists()).toBe(true)
    await confirmation('admin.proxies.dataExport').get('[data-confirm-yes]').trigger('click'); await flushPromises()
    expect(api.exportData).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(2)
    expect(revokeUrl).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-confirm="admin.proxies.dataExport"]').exists()).toBe(false)
  })

  it('keeps a failed deletion open and retries the captured proxy id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.delete.mockRejectedValueOnce({response: {data: {detail: 'synthetic delete blocked'}}})
    await open(); await rowAction(9, 'common.delete')
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-yes]').trigger('click'); await flushPromises()
    expect(notice.showError).toHaveBeenCalledWith('synthetic delete blocked')
    expect(wrapper.find('[data-confirm="admin.proxies.deleteProxy"]').exists()).toBe(true)
    await confirmation('admin.proxies.deleteProxy').get('[data-confirm-yes]').trigger('click'); await flushPromises()
    expect(api.delete.mock.calls).toEqual([[9], [9]])
    expect(wrapper.find('[data-confirm="admin.proxies.deleteProxy"]').exists()).toBe(false)
  })

  it('keeps a reopened batch-delete target and selection independent of an older deletion', async () => {
    const result = pending<any>(); api.batchDelete.mockReturnValueOnce(result.promise)
    await open(); await wrapper.get('[data-row="9"] input[type="checkbox"]').setValue(true)
    await clickText('admin.proxies.batchDeleteAction')
    await confirmation('admin.proxies.batchDelete').get('[data-confirm-yes]').trigger('click')
    await confirmation('admin.proxies.batchDelete').get('[data-confirm-cancel]').trigger('click')
    await wrapper.get('[data-row="9"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-row="10"] input[type="checkbox"]').setValue(true)
    await clickText('admin.proxies.batchDeleteAction')
    result.resolve({deleted_ids: [9], skipped: []}); await flushPromises()
    expect(wrapper.find('[data-confirm="admin.proxies.batchDelete"]').exists()).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-row="10"] input[type="checkbox"]').element.checked).toBe(true)
    await confirmation('admin.proxies.batchDelete').get('[data-confirm-yes]').trigger('click'); await flushPromises()
    expect(api.batchDelete).toHaveBeenNthCalledWith(1, [9])
    expect(api.batchDelete).toHaveBeenNthCalledWith(2, [10])
  })

  it('deletes its confirmed snapshot once and preserves skipped or newly selected rows', async () => {
    const result = pending<any>(); api.batchDelete.mockReturnValueOnce(result.promise)
    await open()
    await wrapper.get('[data-row="9"] input[type="checkbox"]').setValue(true)
    await clickText('admin.proxies.batchDeleteAction')
    await confirmation('admin.proxies.batchDelete').get('[data-confirm-yes]').trigger('click')
    await confirmation('admin.proxies.batchDelete').get('[data-confirm-yes]').trigger('click')
    await wrapper.get('[data-row="10"] input[type="checkbox"]').setValue(true)
    expect(api.batchDelete).toHaveBeenCalledExactlyOnceWith([9])
    result.resolve({deleted_ids: [9], skipped: []}); await flushPromises()
    expect(wrapper.get<HTMLInputElement>('[data-row="9"] input[type="checkbox"]').element.checked).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[data-row="10"] input[type="checkbox"]').element.checked).toBe(true)
  })

  it.each(['test', 'quality'])('stops scheduling remaining %s checks when the login is replaced', async kind => {
    const wave = pending<any>()
    const concurrency = kind === 'test' ? 5 : 3
    const endpoint = kind === 'test' ? api.testProxy : api.checkProxyQuality
    const batchRows = Array.from({length: concurrency + 1}, (_, index) => ({...rows[0], id: index + 1}))
    api.list.mockResolvedValue({items: batchRows, total: batchRows.length, pages: 1})
    endpoint.mockReturnValue(wave.promise)
    await open(); await clickText(kind === 'test' ? 'admin.proxies.testConnection' : 'admin.proxies.batchQualityCheck')
    expect(endpoint).toHaveBeenCalledTimes(concurrency)
    replaceAuthSession({accessToken: 'SYNTHETIC-REPLACEMENT', user: {id: 1, role: 'admin'}})
    wave.resolve(kind === 'test' ? {success: true} : quality('old session')); await flushPromises()
    expect(endpoint).toHaveBeenCalledTimes(concurrency)
    expect(notice.showSuccess).not.toHaveBeenCalled()
    expect(notice.showError).not.toHaveBeenCalled()
  })

  it.each(['test', 'quality'])('snapshots filters and sort for paginated %s target discovery', async kind => {
    const firstPage = pending<any>()
    await open()
    api.list.mockImplementation((page, pageSize) => {
      if (pageSize !== 200) return Promise.resolve({items: structuredClone(rows), pages: 1, total: 2})
      if (page === 1) return firstPage.promise
      return Promise.resolve({items: [{...rows[0], id: 102}], pages: 2, total: 2})
    })
    await clickText(kind === 'test' ? 'admin.proxies.testConnection' : 'admin.proxies.batchQualityCheck')
    await wrapper.get('select[aria-label="admin.proxies.allProtocols"]').setValue('http')
    await wrapper.get('[data-sort]').trigger('click')
    await wrapper.get('input[placeholder="admin.proxies.searchProxies"]').setValue('new-target')
    firstPage.resolve({items: [{...rows[0], id: 101}], pages: 2, total: 2}); await flushPromises()
    const batchPages = api.list.mock.calls.filter(call => call[1] === 200)
    expect(batchPages).toHaveLength(2)
    expect(batchPages[1][2]).toEqual({protocol: undefined, status: undefined, search: undefined, sort_by: 'id', sort_order: 'desc'})
    const endpoint = kind === 'test' ? api.testProxy : api.checkProxyQuality
    expect(endpoint.mock.calls.map(call => call[0])).toEqual([101, 102])
  })

  it.each(['test', 'quality'])('does not discover the next %s page after unmounting', async kind => {
    const firstPage = pending<any>()
    await open(); api.list.mockReturnValueOnce(firstPage.promise)
    await clickText(kind === 'test' ? 'admin.proxies.testConnection' : 'admin.proxies.batchQualityCheck')
    wrapper.unmount()
    firstPage.resolve({items: [{...rows[0], id: 101}], pages: 2, total: 2}); await flushPromises()
    expect(api.list.mock.calls.filter(call => call[1] === 200)).toHaveLength(1)
    expect(api.testProxy).not.toHaveBeenCalled()
    expect(api.checkProxyQuality).not.toHaveBeenCalled()
  })
})

describe('proxy URI credential import compatibility', () => {
  it.each([
    ['socks5://plain-user:plain-password@[::1]:1080', 'plain-user', 'plain-password'],
    ['socks5://user%20name:p%3Aa%40ss%25@[::1]:1080', 'user name', 'p:a@ss%'],
    ['socks5://user:raw%notescaped@[::1]:1080', 'user', 'raw%notescaped'],
    ['socks5://user:raw%FF@[::1]:1080', 'user', 'raw%FF'],
    ['socks5://user-only@[::1]:1080', 'user-only', ''],
    ['socks5://:password-only@[::1]:1080', '', 'password-only']
  ])('preserves the represented credentials in %s', async (uri, username, password) => {
    await open(); await clickText('admin.proxies.createProxy'); await clickText('admin.proxies.batchAdd')
    await wrapper.get('#proxy-batch-input').setValue(uri)
    const button=wrapper.findAll('button').find(button => button.attributes('class')?.includes('btn-primary') && button.attributes('type') === 'button')!
    await button.trigger('click'); await flushPromises()
    expect(api.batchCreate).toHaveBeenCalledExactlyOnceWith([{protocol: 'socks5', host: '::1', port: 1080, username, password}])
  })
})
