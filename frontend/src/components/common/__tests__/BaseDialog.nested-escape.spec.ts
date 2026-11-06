import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import BaseDialog from '../BaseDialog.vue'
import NativeSelect from '../Select.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
enableAutoUnmount(afterEach)
afterEach(() => { document.body.innerHTML = '' })

const escape = (target: Element, isComposing = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing })
  target.dispatchEvent(event)
  return event
}

async function openHost() {
  const Host = defineComponent({
    components: { BaseDialog, NativeSelect },
    setup: () => ({ show: ref(true), value: ref('alpha'), options: [
      { value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }
    ] }),
    template: `<BaseDialog :show="show" title="Preferences" @close="show = false">
      <NativeSelect id="nested-select" v-model="value" :options="options" :searchable="false" />
      <input aria-label="Nested editor" @keydown.esc.prevent />
      <textarea aria-label="Notes" />
    </BaseDialog>`
  })
  const wrapper = mount(Host, { attachTo: document.body, global: { stubs: { Transition: true } } })
  await nextTick()
  return wrapper
}

describe('dialog Escape ownership with native child controls', () => {
  it('closes the Select portal first, then dismisses the dialog on the next Escape', async () => {
    await openHost()
    const trigger = document.getElementById('nested-select') as HTMLButtonElement
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await nextTick()
    await nextTick()
    const listbox = document.querySelector('[role="listbox"]')!
    expect(listbox).not.toBeNull()
    const first = escape(listbox)
    await nextTick()
    expect(first.defaultPrevented).toBe(true)
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    escape(trigger)
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('respects an editor that consumes Escape without stopping propagation', async () => {
    await openHost()
    const editor = document.querySelector('input[aria-label="Nested editor"]')!
    const event = escape(editor)
    await nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('preserves the dialog while Escape cancels an active IME composition', async () => {
    await openHost()
    const notes = document.querySelector('textarea[aria-label="Notes"]')!
    escape(notes, true)
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    escape(notes)
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('continues dismissing a dialog for an unconsumed ordinary Escape', async () => {
    await openHost()
    const notes = document.querySelector('textarea[aria-label="Notes"]')!
    const event = escape(notes)
    await nextTick()
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
