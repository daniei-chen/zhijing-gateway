import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ProxySelector from '../ProxySelector.vue'
import BaseDialog from '../BaseDialog.vue'
import { replaceAuthSession } from '@/api/authSession'
import type { Proxy } from '@/types'

const { testProxy } = vi.hoisted(() => ({ testProxy: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { proxies: { testProxy } } }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const proxies = [{ id: 1, name: 'Synthetic IPv6', host: '::1', port: 8000, protocol: 'http' }, { id: 2, name: 'Synthetic HTTPS', host: 'synthetic.invalid', port: 8001, protocol: 'https' }] as Proxy[]
const wrappers: VueWrapper[] = []
function selector(props: Record<string, unknown> = {}) {
  const wrapper = mount(ProxySelector, { props: { modelValue: null, proxies, ...props }, attachTo: document.body, global: { stubs: { Icon: true, Transition: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
beforeEach(() => { testProxy.mockReset().mockResolvedValue({ success: true, country: 'GB', latency_ms: 20 }) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('ProxySelector named controls and keyboard interaction', () => {
  it('consumes Escape inside the picker before the parent account dialog handles it', async () => {
    const onClose = vi.fn()
    const wrapper = mount(BaseDialog, { attachTo: document.body, props: { show: true, title: 'Synthetic account', onClose }, slots: { default: () => h(ProxySelector, { modelValue: null, proxies }) } })
    wrappers.push(wrapper)
    const picker = wrapper.getComponent(ProxySelector)
    await picker.get('.select-trigger').trigger('click')
    await flushPromises()
    picker.get('input').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(picker.get('.select-trigger').attributes('aria-expanded')).toBe('false')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(picker.get('.select-trigger').element)
  })
  it('opens from the keyboard, names the search field, and renders keyboard reachable choices', async () => {
    const wrapper = selector()
    const trigger = wrapper.get('.select-trigger')
    expect(trigger.attributes('aria-label')).toBe('admin.accounts.proxy')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const input = wrapper.get('input')
    expect(document.activeElement).toBe(input.element)
    expect(input.attributes('aria-label')).toBe('admin.proxies.searchProxies')
    const choice = wrapper.findAll('button').find(button => button.text().includes('Synthetic IPv6'))!
    expect(choice).toBeDefined()
    choice.element.focus()
    choice.element.click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([[1]])
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('restores trigger focus after Escape and closes immediately when disabled', async () => {
    const wrapper = selector()
    const trigger = wrapper.get('.select-trigger')
    await trigger.trigger('click')
    await flushPromises()
    await wrapper.get('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(trigger.element.matches(':disabled')).toBe(true)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('uses distinct IDs across instances while preserving an explicit external label', () => {
    const parent = mount(defineComponent({ components: { ProxySelector }, setup: () => ({ proxies }), template: '<div><label for="synthetic-proxy">Route proxy</label><ProxySelector id="synthetic-proxy" :model-value="null" :proxies="proxies"/><ProxySelector :model-value="null" :proxies="proxies"/></div>' }), { global: { stubs: { Icon: true } } })
    wrappers.push(parent)
    const triggers = parent.findAll('.select-trigger')
    expect(triggers[0].attributes('id')).toBe('synthetic-proxy')
    expect(triggers[0].attributes('aria-label')).toBeUndefined()
    expect((triggers[0].element as HTMLButtonElement).labels?.[0].textContent).toBe('Route proxy')
    expect(triggers[1].attributes('id')).toBeTruthy()
    expect(triggers[0].attributes('aria-controls')).not.toBe(triggers[1].attributes('aria-controls'))
  })

  it('filters options by host and exposes one explicitly named test per visible proxy', async () => {
    const wrapper = selector()
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.get('input').setValue('synthetic.invalid')
    expect(wrapper.findAll('.test-btn')).toHaveLength(1)
    expect(wrapper.get('.test-btn').attributes('aria-label')).toContain('Synthetic HTTPS')
    await wrapper.get('.test-btn').trigger('click')
    await flushPromises()
    expect(testProxy).toHaveBeenCalledWith(2)
    expect(wrapper.text()).toContain('GB')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('ProxySelector request ownership', () => {
  it.each(['reopen', 'endpoint', 'disable'])('rejects a connection result belonging to the prior %s state', async (change) => {
    const old = deferred<{ success: boolean; country: string }>()
    testProxy.mockReturnValueOnce(old.promise)
    const wrapper = selector()
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.findAll('.test-btn')[0].trigger('click')
    if (change === 'endpoint') await wrapper.setProps({ proxies: [{ ...proxies[0], port: 9000 }, proxies[1]] })
    else if (change === 'disable') { await wrapper.setProps({ disabled: true }); await wrapper.setProps({ disabled: false }); await wrapper.get('.select-trigger').trigger('click') }
    else { await wrapper.get('.select-trigger').trigger('click'); await wrapper.get('.select-trigger').trigger('click') }
    await wrapper.findAll('.test-btn')[0].trigger('click')
    await flushPromises()
    expect(testProxy).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('GB')
    old.resolve({ success: true, country: 'US' })
    await flushPromises()
    expect(wrapper.text()).toContain('GB')
    expect(wrapper.text()).not.toContain('US')
  })

  it('rejects old-session results and does not start another test in the obsolete picker', async () => {
    const old = deferred<{ success: boolean; country: string }>()
    testProxy.mockReturnValueOnce(old.promise)
    const wrapper = selector()
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.findAll('.test-btn')[0].trigger('click')
    replaceAuthSession({ accessToken: 'synthetic-next-login', user: { id: 91001 } })
    old.resolve({ success: true, country: 'US' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('US')
    await wrapper.findAll('.test-btn')[1].trigger('click')
    expect(testProxy).toHaveBeenCalledTimes(1)
  })

  it('does not let a pending batch clear the next batch loading flag', async () => {
    const old = deferred<{ success: boolean; country: string }>()
    const current = deferred<{ success: boolean; country: string }>()
    testProxy.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ success: true }).mockReturnValueOnce(current.promise).mockResolvedValueOnce({ success: true })
    const wrapper = selector()
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.get('.batch-test-btn').trigger('click')
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.get('.select-trigger').trigger('click')
    await wrapper.get('.batch-test-btn').trigger('click')
    expect(testProxy).toHaveBeenCalledTimes(4)
    old.resolve({ success: true, country: 'US' })
    await flushPromises()
    expect(wrapper.get('.batch-test-btn').element.matches(':disabled')).toBe(true)
    current.resolve({ success: true, country: 'GB' })
    await flushPromises()
    expect(wrapper.get('.batch-test-btn').element.matches(':disabled')).toBe(false)
    expect(wrapper.text()).not.toContain('US')
  })
})
