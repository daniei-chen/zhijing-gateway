import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import ImportDataModal from '../ImportDataModal.vue'
import { replaceAuthSession } from '@/api/authSession'

const { importData, showError, showSuccess } = vi.hoisted(() => ({ importData: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({adminAPI: {proxies: {importData}}}))
vi.mock('@/stores/app', () => ({useAppStore: () => ({showError, showSuccess})}))
vi.mock('vue-i18n', () => ({useI18n: () => ({t: (key: string) => key})}))
const Dialog = defineComponent({props: ['show'], emits: ['close'], template: '<section v-if="show"><button data-dismiss @click="$emit(\'close\')">dismiss</button><slot/><slot name="footer"/></section>'})
const payload = {version: 1, proxies: [{name: 'synthetic-proxy', host: 'synthetic.invalid', port: 1080, password: 'synthetic-only'}]}
const success = {proxy_created: 1, proxy_reused: 0, proxy_failed: 0, errors: []}
let wrapper: VueWrapper
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return {promise, resolve, reject}
}
function open() { wrapper = mount(ImportDataModal, {props: {show: true}, global: {stubs: {BaseDialog: Dialog}}}); return wrapper }
async function choose(file: {name: string; text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer>} | File) {
  const input=wrapper.get('input[type="file"]')
  Object.defineProperty(input.element,'files',{configurable: true,value: [file]})
  await input.trigger('change')
}
async function submit() { await wrapper.get('form').trigger('submit'); await flushPromises() }
async function contextChange(change: string) {
  if(change === 'login') replaceAuthSession({accessToken: 'SYNTHETIC-REPLACEMENT', user: {id: 1, role: 'admin'}})
  if(change === 'reopen') { await wrapper.setProps({show: false}); await wrapper.setProps({show: true}) }
  if(change === 'unmount') wrapper.unmount()
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  replaceAuthSession({accessToken: 'SYNTHETIC-IMPORT', user: {id: 1, role: 'admin'}})
  importData.mockReset().mockResolvedValue(success)
})
afterEach(() => wrapper?.unmount())

describe('proxy data import workflow', () => {
  it('requires a file before importing', async () => {
    open(); await submit()
    expect(showError).toHaveBeenCalledWith('admin.proxies.dataImportSelectFile')
    expect(importData).not.toHaveBeenCalled()
  })

  it('submits only the parsed file content and emits one completion', async () => {
    open(); await choose({name: 'synthetic.json', text: () => Promise.resolve(JSON.stringify(payload))})
    await submit()
    expect(importData).toHaveBeenCalledExactlyOnceWith({data: payload})
    expect(showSuccess).toHaveBeenCalledWith('admin.proxies.dataImportSuccess')
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('permits replacing invalid JSON and retrying', async () => {
    open(); await choose({name: 'broken.json', text: () => Promise.resolve('{broken')}); await submit()
    expect(showError).toHaveBeenCalledWith('admin.proxies.dataImportParseFailed')
    expect(importData).not.toHaveBeenCalled()
    await choose({name: 'valid.json', text: () => Promise.resolve(JSON.stringify(payload))}); await submit()
    expect(importData).toHaveBeenCalledExactlyOnceWith({data: payload})
  })

  it('reports a file read failure without sending an import', async () => {
    open(); await choose({name: 'failed.json', text: () => Promise.reject(new Error('synthetic file unavailable'))}); await submit()
    expect(showError).toHaveBeenCalledWith('synthetic file unavailable')
    expect(importData).not.toHaveBeenCalled()
  })

  it('reads the arrayBuffer fallback without requiring File.text', async () => {
    open(); const bytes=new TextEncoder().encode(JSON.stringify(payload))
    await choose({name: 'buffer.json', arrayBuffer: () => Promise.resolve(bytes.buffer)}); await submit()
    expect(importData).toHaveBeenCalledExactlyOnceWith({data: payload})
  })

  it('reads a browser FileReader fallback', async () => {
    open(); await choose(new File([JSON.stringify(payload)],'reader.json',{type:'application/json'})); await submit()
    await vi.waitFor(() => expect(importData).toHaveBeenCalledExactlyOnceWith({data: payload}))
  })

  it.each([0,1])('refreshes on close only when partial results changed data (created=%s)', async created => {
    importData.mockResolvedValueOnce({proxy_created: created, proxy_reused: 0, proxy_failed: 1, errors: [{kind:'proxy',name:'synthetic-proxy',message:'synthetic rejected'}]})
    open(); await choose({name: 'partial.json', text: () => Promise.resolve(JSON.stringify(payload))}); await submit()
    expect(wrapper.text()).toContain('synthetic rejected')
    expect(showError).toHaveBeenCalledWith('admin.proxies.dataImportCompletedWithErrors')
    expect(wrapper.emitted('imported')).toBeUndefined()
    await wrapper.get('[data-dismiss]').trigger('click')
    expect(Boolean(wrapper.emitted('imported'))).toBe(created > 0)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('retains the selected file after an API failure and allows retry', async () => {
    importData.mockRejectedValueOnce(new Error('synthetic service unavailable'))
    open(); await choose({name: 'retry.json', text: () => Promise.resolve(JSON.stringify(payload))}); await submit()
    expect(showError).toHaveBeenCalledWith('synthetic service unavailable')
    expect(wrapper.emitted('imported')).toBeUndefined()
    await submit()
    expect(importData).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('prevents a duplicate form submission while the file is being read', async () => {
    const reading=pending<string>(); const read=vi.fn(() => reading.promise)
    open(); await choose({name: 'pending.json',text: read}); await submit(); await submit()
    expect(read).toHaveBeenCalledTimes(1)
    reading.resolve(JSON.stringify(payload)); await flushPromises()
    expect(importData).toHaveBeenCalledTimes(1)
  })

  it.each(['login','reopen','unmount'])('does not import an old file after %s', async change => {
    const reading=pending<string>()
    open(); await choose({name: 'old.json',text: () => reading.promise}); await submit(); await contextChange(change)
    reading.resolve(JSON.stringify(payload)); await flushPromises()
    expect(importData).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.emitted('imported')).toBeUndefined()
  })

  it.each(['login','reopen','unmount'])('does not toast a file read failure after %s', async change => {
    const reading=pending<string>()
    open(); await choose({name: 'old.json',text: () => reading.promise}); await submit(); await contextChange(change)
    reading.reject(new Error('old file error')); await flushPromises()
    expect(importData).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['login','reopen','unmount'])('does not emit completion from an accepted import after %s', async change => {
    const importing=pending<any>(); importData.mockReturnValueOnce(importing.promise)
    open(); await choose({name: 'old.json',text: () => Promise.resolve(JSON.stringify(payload))}); await submit(); await contextChange(change)
    importing.resolve(success); await flushPromises()
    expect(importData).toHaveBeenCalledTimes(1)
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.emitted('imported')).toBeUndefined()
  })

  it.each(['login','reopen','unmount'])('does not toast an accepted import failure after %s', async change => {
    const importing=pending<any>(); importData.mockReturnValueOnce(importing.promise)
    open(); await choose({name: 'old.json',text: () => Promise.resolve(JSON.stringify(payload))}); await submit(); await contextChange(change)
    importing.reject(new Error('old import error')); await flushPromises()
    expect(showError).not.toHaveBeenCalled()
    expect(wrapper.emitted('imported')).toBeUndefined()
  })

  it('does not clear the busy state of a newer import when an older file read completes', async () => {
    const old=pending<string>(), current=pending<string>()
    open(); await choose({name:'old.json',text:()=>old.promise}); await submit()
    await wrapper.setProps({show:false}); await wrapper.setProps({show:true})
    await choose({name:'current.json',text:()=>current.promise}); await submit()
    old.resolve(JSON.stringify(payload)); await flushPromises()
    expect(importData).not.toHaveBeenCalled()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    current.resolve(JSON.stringify(payload)); await flushPromises()
    expect(importData).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })
})
