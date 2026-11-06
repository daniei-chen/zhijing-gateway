import { defineComponent, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PricingEntryCard from '../PricingEntryCard.vue'
import type { PricingFormEntry } from '../types'
import { replaceAuthSession } from '@/api/authSession'

const { getDefault } = vi.hoisted(() => ({ getDefault: vi.fn() }))
vi.mock('@/api/admin/channels', () => ({ default: { getModelDefaultPricing: getDefault } }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string) => key })
}))

function entry(): PricingFormEntry {
  return {
    models: [], billing_mode: 'token', input_price: null, output_price: null, cache_write_price: null,
    cache_write_1h_price: null, cache_read_price: null, image_input_price: null, image_output_price: null,
    per_request_price: null, intervals: [], reasoning_effort_multipliers: null,
    time_pricing: { timezone: 'Asia/Shanghai', weekdays_only: false, periods: [] }
  }
}
function deferred() {
  let resolve!: (value: { found: boolean; input_price?: number; output_price?: number }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ found: boolean; input_price?: number; output_price?: number }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const wrappers: VueWrapper[] = []
function mountEditor(initial = entry()) {
  const wrapper = mount(defineComponent({
    components: { PricingEntryCard },
    setup() {
      const draft = ref(initial)
      const platform = ref('anthropic')
      const shown = ref(true)
      return { draft, platform, shown, replacement: { ...entry(), models: ['model-a'] } }
    },
    template: `<div>
      <PricingEntryCard v-if="shown" :entry="draft" :platform="platform" enable-tier-multipliers @update="draft = $event" @remove="shown = false" />
      <button data-replace @click="draft = replacement">Replace entry</button>
      <button data-platform @click="platform = 'openai'">Change platform</button>
      <button data-unmount @click="shown = false">Close editor</button>
      <output>{{ JSON.stringify(draft) }}</output>
    </div>`
  }), { attachTo: document.body, global: { stubs: { teleport: true, Icon: true } } })
  wrappers.push(wrapper)
  return wrapper
}
async function addModel(wrapper: VueWrapper, name: string) {
  const input = wrapper.get('.collapsible-inner input[type="text"]')
  await input.setValue(name)
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}
function field(wrapper: VueWrapper, key: string) {
  const label = wrapper.findAll('label').find(candidate => candidate.text() === `admin.channels.form.${key}`)!
  const id = label.attributes('for')
  if (id) return wrapper.get(`#${id}`)
  const input = label.element.parentElement!.querySelector('input')!
  return wrapper.findAll('input').find(candidate => candidate.element === input)!
}
const draft = (wrapper: VueWrapper) => JSON.parse(wrapper.get('output').text()) as PricingFormEntry

describe('PricingEntryCard default-price ownership through DOM', () => {
  beforeEach(() => {
    localStorage.clear()
    getDefault.mockReset().mockResolvedValue({ found: true, input_price: 0.000003, output_price: 0.000015 })
  })
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('offers a focusable native disclosure for an existing collapsed pricing entry', async () => {
    const wrapper = mountEditor({ ...entry(), models: ['synthetic-existing'] })
    expect(wrapper.find('.collapsible-content--collapsed').exists()).toBe(true)
    const header = wrapper.get('.cursor-pointer')
    header.element.focus()
    expect.soft(document.activeElement).toBe(header.element)
    expect(header.element.tagName).toBe('BUTTON')
    expect(header.attributes('type')).toBe('button')
    expect(header.attributes('aria-label')).toContain('synthetic-existing')
    expect(header.attributes('aria-expanded')).toBe('false')
    const content = document.getElementById(header.attributes('aria-controls'))
    expect(content).toBe(wrapper.get('.collapsible-content').element)
    expect(content?.hasAttribute('inert')).toBe(true)
    expect(header.find('button').exists()).toBe(false)
    // jsdom does not synthesize a button's native Enter/Space click activation.
    // Its native button semantics provide that keyboard behavior in the browser.
    await header.trigger('click')
    expect(header.attributes('aria-expanded')).toBe('true')
    expect(content?.hasAttribute('inert')).toBe(false)
    expect(wrapper.find('.collapsible-content--collapsed').exists()).toBe(false)
    await header.trigger('click')
    expect(header.attributes('aria-expanded')).toBe('false')
    expect(content?.hasAttribute('inert')).toBe(true)
  })

  it('keeps removal separate from disclosure and gives each entry its own controlled region', async () => {
    const wrapper = mount(defineComponent({
      components: { PricingEntryCard },
      setup: () => ({ entries: ref([
        { ...entry(), models: ['first-model'] }, { ...entry(), models: ['second-model'] }
      ]) }),
      template: `<PricingEntryCard v-for="(value, index) in entries" :key="value.models[0]" :entry="value"
        @update="entries[index] = $event" @remove="entries.splice(index, 1)" />`
    }), { attachTo: document.body, global: { stubs: { teleport: true, Icon: true } } })
    wrappers.push(wrapper)
    const [firstHeader, secondHeader] = wrapper.findAll('button[aria-expanded]')
    expect(firstHeader.attributes('aria-controls')).not.toBe(secondHeader.attributes('aria-controls'))
    const remove = wrapper.findAll('button[aria-label="common.delete"]')[0]
    expect(remove.element.parentElement).toBe(firstHeader.element.parentElement)
    await remove.trigger('click')
    expect(wrapper.findAll('.collapsible-content')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('first-model')
    expect(secondHeader.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.collapsible-content').attributes('aria-hidden')).toBe('true')
  })

  it('keeps the established default price and token-unit contract when the entry remains unchanged', async () => {
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    expect(getDefault).toHaveBeenCalledWith('model-a')
    expect(draft(wrapper)).toMatchObject({ models: ['model-a'], input_price: 3, output_price: 15 })
  })

  it.each(['inputPrice', 'outputPrice', 'imageInputPrice', 'imageTokenPrice', 'cacheWrite1hPrice'])('keeps manual %s entered during a lookup', async key => {
    const pending = deferred()
    getDefault.mockReturnValueOnce(pending.promise)
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    await field(wrapper, key).setValue('7')
    pending.resolve({ found: true, input_price: 0.000099, output_price: 0.000088 })
    await flushPromises()
    expect((field(wrapper, key).element as HTMLInputElement).value).toBe('7')
    expect(draft(wrapper).input_price).not.toBe(99)
  })

  it('rejects the old default when the model was replaced, even if the old response arrives last', async () => {
    const a = deferred()
    const b = deferred()
    getDefault.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    await wrapper.get('.collapsible-inner span button').trigger('click')
    await addModel(wrapper, 'model-b')
    b.resolve({ found: true, input_price: 0.000005 })
    await flushPromises()
    a.resolve({ found: true, input_price: 0.000099 })
    await flushPromises()
    expect(draft(wrapper)).toMatchObject({ models: ['model-b'], input_price: 5 })
  })

  it('does not modify a replacement entry that happens to have the same model name', async () => {
    const pending = deferred()
    getDefault.mockReturnValueOnce(pending.promise)
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    await wrapper.get('[data-replace]').trigger('click')
    pending.resolve({ found: true, input_price: 0.000099 })
    await flushPromises()
    expect(draft(wrapper)).toMatchObject({ models: ['model-a'], input_price: null })
  })

  it.each(['platform', 'unmount', 'login'] as const)('ignores the lookup after %s changes', async changed => {
    const pending = deferred()
    getDefault.mockReturnValueOnce(pending.promise)
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    if (changed === 'login') replaceAuthSession({ accessToken: 'synthetic-new-admin', user: { id: 2 } })
    else await wrapper.get(`[data-${changed}]`).trigger('click')
    pending.resolve({ found: true, input_price: 0.000099 })
    await flushPromises()
    expect(draft(wrapper).input_price).toBeNull()
  })

  it('does not reapply token defaults after switching billing mode while the query is pending', async () => {
    const pending = deferred()
    getDefault.mockReturnValueOnce(pending.promise)
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    await wrapper.get('button.select-trigger').trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text() === 'admin.channels.billingMode.perRequest')!.trigger('click')
    pending.resolve({ found: true, input_price: 0.000099 })
    await flushPromises()
    expect(draft(wrapper)).toMatchObject({ billing_mode: 'per_request', input_price: null })
  })

  it.each(['missing', 'reject'] as const)('keeps empty prices when the default result is %s', async outcome => {
    if (outcome === 'missing') getDefault.mockResolvedValueOnce({ found: false })
    else getDefault.mockRejectedValueOnce(new Error('Synthetic catalog unavailable'))
    const wrapper = mountEditor()
    await addModel(wrapper, 'model-a')
    expect(draft(wrapper)).toMatchObject({ models: ['model-a'], input_price: null, output_price: null })
  })
})
