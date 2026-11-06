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
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const rows = [9, 10].map(id => ({
  id, name: 'proxy-'+id, protocol: 'socks5', host: id===9 ? '2001:db8::1' : 'proxy.example.invalid',
  port: 1080, username: 'test user', password: 'test:@password', status: 'active', account_count: 1,
  created_at: '2026-11-06T00:00:00Z', expires_at: null, fallback_mode: 'none'
}))
const mountView = () => shallowMount(ProxiesView, { global: { stubs: {
  AppLayout: { template: '<main><slot /></main>' },
  TablePageLayout: { template: '<div><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
  DataTable: { props: ['data'], template: `<div><div v-for="row in data" :key="row.id" :data-row="row.id">
    <slot name="cell-address" :row="row"/><slot name="cell-account_count" :row="row" :value="row.account_count"/>
    <slot name="cell-actions" :row="row"/>
    </div></div>` },
  BaseDialog: { props: ['show','title'], emits: ['close'], template: `<section v-if="show" :data-dialog="title">
    <button data-dismiss @click="$emit('close')">Dismiss</button><slot/><slot name="footer"/></section>` },
  Select: { props: ['modelValue','options'], emits: ['update:modelValue','change'], template: `<select :value="modelValue"
    @change="$emit('update:modelValue',$event.target.value);$emit('change',$event.target.value)">
    <option v-for="option in options" :key="String(option.value)" :value="option.value">{{option.label}}</option></select>` }
} } })
let wrapper: ReturnType<typeof mountView>
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'SYNTHETIC-ADMIN', user: { id: 1, role: 'admin' } })
  api.list.mockResolvedValue({ items: structuredClone(rows), total: 2, pages: 1 })
  api.getAllWithCount.mockResolvedValue([])
  api.create.mockResolvedValue({ id: 11 })
  api.update.mockResolvedValue({})
  api.getProxyAccounts.mockResolvedValue([])
  api.batchCreate.mockResolvedValue({ created: 1, skipped: 0 })
})
afterEach(() => wrapper?.unmount())
async function open() { wrapper = mountView(); await flushPromises() }
async function clickText(text: string, scope = wrapper) {
  const button=scope.findAll('button').find(button => button.text()===text)
  expect(button, text+' button').toBeTruthy()
  await button!.trigger('click'); await flushPromises()
}
async function createForm() {
  await clickText('admin.proxies.createProxy')
  const form = wrapper.get('#create-proxy-form')
  await form.get('input[placeholder="admin.proxies.enterProxyName"]').setValue('New proxy')
  await form.get('input[placeholder="admin.proxies.form.hostPlaceholder"]').setValue('proxy.example.invalid')
  return form
}

describe('proxy management workflow contracts', () => {
  it('copies a valid bracketed IPv6 endpoint and percent-encodes credentials', async () => {
    await open()
    await wrapper.get('[data-row="9"] button[title="admin.proxies.copyProxyUrl"]').trigger('click')
    expect(clipboard).toHaveBeenCalledWith('socks5://test%20user:test%3A%40password@[2001:db8::1]:1080', expect.any(String))
  })

  it('ignores an old accounts list after the selected proxy changes', async () => {
    const first=pending<Array<{id:number;name:string;platform:string;type:string}>>()
    api.getProxyAccounts.mockImplementation(id => id===9 ? first.promise : Promise.resolve([{id:8,name:'Member of B',platform:'openai',type:'oauth'}]))
    await open()
    await wrapper.get('[data-row="9"]').findAll('button').find(button => button.text()==='admin.groups.accountsCount')!.trigger('click')
    await wrapper.get('[data-row="10"]').findAll('button').find(button => button.text()==='admin.groups.accountsCount')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Member of B')
    first.resolve([{id:7,name:'Member of A',platform:'openai',type:'oauth'}]); await flushPromises()
    expect(wrapper.text()).toContain('Member of B')
    expect(wrapper.text()).not.toContain('Member of A')
  })

  it('does not repeat a create request while saving', async () => {
    const result=pending<{id:number}>(); api.create.mockReturnValue(result.promise)
    await open(); const form=await createForm()
    await form.trigger('submit'); await form.trigger('submit')
    expect(api.create).toHaveBeenCalledTimes(1)
    result.resolve({id:11}); await flushPromises()
  })

  it('preserves a reopened create draft when an older save finishes', async () => {
    const result=pending<{id:number}>(); api.create.mockReturnValue(result.promise)
    await open(); const form=await createForm(); await form.trigger('submit')
    await wrapper.get('[data-dialog="admin.proxies.createProxy"] [data-dismiss]').trigger('click')
    const next=await createForm()
    await next.get('input[placeholder="admin.proxies.enterProxyName"]').setValue('Newer unsaved draft')
    result.resolve({id:11}); await flushPromises()
    expect(wrapper.get('#create-proxy-form input[placeholder="admin.proxies.enterProxyName"]').element).toHaveProperty('value','Newer unsaved draft')
  })

  it('reports save failure and allows a corrected retry', async () => {
    api.create.mockRejectedValueOnce({response:{data:{detail:'Invalid upstream host'}}}).mockResolvedValueOnce({id:11})
    await open(); const form=await createForm()
    await form.trigger('submit'); await flushPromises()
    expect(notice.showError).toHaveBeenCalledWith('Invalid upstream host')
    expect(wrapper.find('#create-proxy-form').exists()).toBe(true)
    await form.trigger('submit'); await flushPromises()
    expect(api.create).toHaveBeenCalledTimes(2)
    expect(notice.showSuccess).toHaveBeenCalledWith('admin.proxies.proxyCreated')
    expect(wrapper.find('#create-proxy-form').exists()).toBe(false)
  })

  it('does not show completion or change UI after a login replacement', async () => {
    const result=pending<{id:number}>(); api.create.mockReturnValue(result.promise)
    await open(); const form=await createForm(); await form.trigger('submit')
    replaceAuthSession({accessToken:'SYNTHETIC-MEMBER',user:{id:2,role:'user'}})
    result.resolve({id:11}); await flushPromises()
    expect(notice.showSuccess).not.toHaveBeenCalled()
    expect(api.list).toHaveBeenCalledTimes(1)
  })
})
