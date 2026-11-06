import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import Select from '../Select.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const options = [{ value:'low',label:'Low' }, { value:'blocked',label:'Unavailable',disabled:true }, { value:'high',label:'High' }]
let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); document.body.innerHTML=''; vi.restoreAllMocks() })

describe('Select field names and keyboard equivalents', () => {
  it('lets an associated visible label name its trigger without a generic aria-label overriding it', () => {
    const wrapper=mount(defineComponent({
      components:{ProtocolSelect:Select},
      data:()=>({value:'low',options}),
      template:'<div><label for="effort-limit">Maximum effort</label><ProtocolSelect id="effort-limit" v-model="value" :options="options"/></div>'
    }),{attachTo:document.body})
    cleanup=()=>wrapper.unmount()
    const trigger=wrapper.get<HTMLButtonElement>('button')
    expect(trigger.attributes('aria-label')).toBeUndefined()
    expect(trigger.element.labels?.[0]?.textContent).toBe('Maximum effort')
  })

  it('provides a separate focusable clear button and a Delete keyboard equivalent', async () => {
    const wrapper=mount(Select,{attachTo:document.body,props:{modelValue:'low',options,clearable:true}})
    cleanup=()=>wrapper.unmount()
    const clear=wrapper.get<HTMLButtonElement>('button.select-clear')
    expect(clear.element.tabIndex).toBe(0)
    expect(clear.element.closest('.select-trigger')).toBeNull()
    await clear.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
    await wrapper.get('.select-trigger').trigger('keydown',{key:'Delete'})
    expect(wrapper.emitted('update:modelValue')).toEqual([[null],[null]])
    expect(wrapper.emitted('change')).toEqual([[null,null],[null,null]])
  })

  it.each([false,true])('announces keyboard highlight on the actual focused list or search field (search=%s)', async searchable => {
    const wrapper=mount(Select,{attachTo:document.body,props:{modelValue:'low',options,searchable}})
    cleanup=()=>wrapper.unmount()
    await wrapper.get('.select-trigger').trigger('click'); await nextTick(); await nextTick()
    const focused=document.activeElement as HTMLElement
    expect(focused.matches(searchable?'input':'[role="listbox"]')).toBe(true)
    focused.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))
    await nextTick()
    const activeId=focused.getAttribute('aria-activedescendant')
    expect(activeId).toBeTruthy()
    expect(document.getElementById(activeId!)?.textContent).toContain('High')
    focused.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toEqual([['high']])
    expect(document.activeElement).toBe(wrapper.get('.select-trigger').element)
  })

  it('does not clear a disabled or non-clearable field or intercept IME composition', async () => {
    const wrapper=mount(Select,{props:{modelValue:'low',options,clearable:false}})
    cleanup=()=>wrapper.unmount()
    await wrapper.get('.select-trigger').trigger('keydown',{key:'Backspace'})
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({clearable:true})
    await wrapper.get('.select-trigger').trigger('keydown',{key:'Delete',isComposing:true})
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({disabled:true})
    expect(wrapper.find('button.select-clear').exists()).toBe(false)
  })
})
