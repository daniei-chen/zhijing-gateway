import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import Select from '../Select.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = '' })

function renderFields() {
  const view = mount(defineComponent({
    components: { FieldSelect: Select },
    setup() {
      return {
        first: ref<string | null>('low'),
        second: ref<string | null>('high'),
        options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]
      }
    },
    template: '<div><FieldSelect id="first-priority" v-model="first" :options="options" clearable/><FieldSelect id="second-priority" v-model="second" :options="options" clearable/><output>{{ first === null ? "empty" : first }} / {{ second }}</output></div>'
  }), { attachTo: document.body })
  wrapper = view
  return view
}

it.each(['clear_button', 'Delete_key'])('keeps the first field focused after its controlled value is cleared by %s', async activation => {
  const view = renderFields()
  const first = view.findAllComponents(Select)[0]
  const trigger = first.get<HTMLButtonElement>('button.select-trigger').element
  if (activation === 'clear_button') {
    const clear = first.get<HTMLButtonElement>('button.select-clear').element
    clear.focus()
    // Native button activation is shared by pointer and Enter/Space activation.
    clear.click()
  } else {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
  }
  await nextTick()
  expect(view.get('output').text()).toBe('empty / high')
  expect(first.find('button.select-clear').exists()).toBe(false)
  expect(view.findAllComponents(Select)[1].get('.select-value').text()).toBe('High')
  expect(document.activeElement).toBe(trigger)
})

it('keeps deliberately transferred focus on the second field after clearing the first', async () => {
  const view = renderFields()
  const [first, second] = view.findAllComponents(Select)
  const clear = first.get<HTMLButtonElement>('button.select-clear').element
  const secondTrigger = second.get<HTMLButtonElement>('button.select-trigger').element
  clear.focus()
  clear.click()
  secondTrigger.focus()
  await nextTick()
  expect(view.get('output').text()).toBe('empty / high')
  expect(document.activeElement).toBe(secondTrigger)
})

it('does not move focus back to a field unmounted during the clear operation', async () => {
  const view = renderFields()
  const first = view.findAllComponents(Select)[0]
  const oldTrigger = first.get<HTMLButtonElement>('button.select-trigger').element
  const clear = first.get<HTMLButtonElement>('button.select-clear').element
  clear.focus()
  clear.click()
  view.unmount()
  wrapper = undefined
  const replacement = document.createElement('input')
  document.body.append(replacement)
  replacement.focus()
  await nextTick()
  expect(oldTrigger.isConnected).toBe(false)
  expect(document.activeElement).toBe(replacement)
})
