import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import Select from '../Select.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let wrapper: VueWrapper | undefined
let frames: FrameRequestCallback[] = []
async function frame() { const pending = frames.splice(0); pending.forEach(callback => callback(performance.now())); await nextTick() }
beforeEach(() => { frames = []; vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length }) })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; frames = []; vi.unstubAllGlobals() })

async function renderOpen() {
  wrapper = mount(defineComponent({
    components: { FieldSelect: Select },
    setup: () => ({ value: ref('auto'), locked: ref(false), options: [{ value: 'auto', label: 'Auto' }, { value: 'force_off', label: 'Force off' }] }),
    template: '<main><FieldSelect v-model="value" :disabled="locked" :options="options" /><button id="lock-field" type="button" @click.stop="locked = true">Start saving</button><button id="outside-field" type="button">Outside</button><output>{{ value }}</output></main>',
  }), { attachTo: document.body, global: { stubs: { transition: false } } })
  await wrapper.get('button.select-trigger').trigger('click'); await nextTick(); await frame(); await frame()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.trim() === 'Force off')
  expect(option).toBeDefined(); expect(option!.isConnected).toBe(true)
  return { view: wrapper, option: option!, list: document.querySelector<HTMLElement>('[role="listbox"]')! }
}

describe('Select options during a real leave transition', () => {
  it.each(['disabled', 'escape', 'outside'] as const)('does not commit an option after the field is closed by %s', async reason => {
    const { view, option, list } = await renderOpen()
    if (reason === 'disabled') (view.get('#lock-field').element as HTMLButtonElement).click()
    if (reason === 'escape') list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    if (reason === 'outside') (view.get('#outside-field').element as HTMLButtonElement).click()
    await nextTick()
    expect(view.get('.select-trigger').attributes('aria-expanded')).toBe('false')
    // Keep the two public animation frames pending: Vue has logically closed
    // the menu but its old, pointer-enabled portal still exists during leave.
    expect(option.isConnected).toBe(true)
    option.click(); await nextTick()
    expect(view.get('output').text()).toBe('auto')
    expect(view.findComponent(Select).emitted('update:modelValue')).toBeUndefined()
    expect(view.findComponent(Select).emitted('change')).toBeUndefined()
    await frame(); await frame()
  })
  it('commits a current enabled option through the same native activation', async () => {
    const { view, option } = await renderOpen(); option.click(); await nextTick()
    expect(view.get('output').text()).toBe('force_off')
    expect(view.findComponent(Select).emitted('update:modelValue')).toEqual([['force_off']])
  })
})
