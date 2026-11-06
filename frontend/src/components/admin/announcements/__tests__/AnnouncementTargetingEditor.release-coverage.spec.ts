import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import AnnouncementTargetingEditor from '../AnnouncementTargetingEditor.vue'
import type { AdminGroup, AnnouncementCondition, AnnouncementTargeting } from '@/types'

vi.mock('@/stores', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ publicSettings: null }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const hosts: VueWrapper[] = []
const packages = [{ id: 21, name: 'Alpha package', platform: 'openai', subscription_type: 'subscription' }, { id: 22, name: 'Beta package', platform: 'anthropic', subscription_type: 'subscription' }] as AdminGroup[]
const subscription = (ids: number[] = []) => ({ type: 'subscription' as const, operator: 'in' as const, group_ids: ids })
const balance = (value = 0) => ({ type: 'balance' as const, operator: 'gte' as const, value })
async function render(initial: AnnouncementTargeting = { any_of: [] }) {
  const host = defineComponent({ components: { AnnouncementTargetingEditor }, setup: () => ({ target: ref(structuredClone(initial)), packages }), template: '<AnnouncementTargetingEditor v-model="target" :groups="packages"/><output>{{ JSON.stringify(target) }}</output>' })
  const view = mount(host, { attachTo: document.body, global: { stubs: { teleport: true, transition: true } } })
  hosts.push(view); await flushPromises(); await settle(); return view
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 5)); await flushPromises() }
const value = (view: VueWrapper) => JSON.parse(view.get('output').text()) as { any_of: { all_of: AnnouncementCondition[] }[] }
function buttons(view: VueWrapper, label: string) { return view.findAll('button').filter(node => node.text() === label) }
async function choose(trigger: ReturnType<VueWrapper['get']>, label: string) {
  await trigger.trigger('click'); await flushPromises()
  const option = Array.from(document.getElementById(trigger.attributes('aria-controls')!)!.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.trim() === label)
  expect(option, label).toBeDefined(); option!.click(); await flushPromises(); await settle()
}
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); document.body.innerHTML = '' })

describe('Announcement audience conditions through the public v-model contract', () => {
  it('moves from everyone to packages, persists checkbox changes, and explicitly returns to everyone', async () => {
    const view = await render(); expect(view.get<HTMLInputElement>('input[value="all"]').element.checked).toBe(true)
    await view.get('input[value="custom"]').setValue(true); await settle()
    expect(view.text()).toContain('admin.announcements.form.selectPackages')
    const checkboxes = view.findAll('input[type="checkbox"]'); await checkboxes[0].setValue(true); await settle(); await checkboxes[1].setValue(true); await settle()
    expect(value(view)).toEqual({ any_of: [{ all_of: [subscription([21, 22])] }] })
    await checkboxes[0].setValue(false); await settle(); expect(value(view)).toEqual({ any_of: [{ all_of: [subscription([22])] }] })
    await view.get('input[value="all"]').setValue(true); await settle(); expect(value(view)).toEqual({ any_of: [] })
    expect(view.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it.each(['gt', 'gte', 'lt', 'lte', 'eq'])('emits a literal %s balance comparison including decimal and zero values', async operator => {
    const view = await render({ any_of: [{ all_of: [subscription([21])] }] })
    await choose(view.findAll('button[aria-haspopup="true"]')[0], 'admin.announcements.form.conditionBalance')
    expect(value(view)).toEqual({ any_of: [{ all_of: [balance()] }] })
    await choose(view.findAll('button[aria-haspopup="true"]')[1], `admin.announcements.operators.${operator}`)
    await view.get('input[type="number"]').setValue('12.75')
    expect(value(view)).toEqual({ any_of: [{ all_of: [{ type: 'balance', operator, value: 12.75 }] }] })
    await view.get('input[type="number"]').setValue('')
    expect(value(view).any_of[0].all_of[0]).toEqual({ type: 'balance', operator, value: 0 })
    await choose(view.findAll('button[aria-haspopup="true"]')[0], 'admin.announcements.form.conditionSubscription')
    expect(value(view)).toEqual({ any_of: [{ all_of: [subscription()] }] })
  })

  it('creates two OR alternatives, adds and deletes an AND requirement, then removes a whole alternative', async () => {
    const view = await render({ any_of: [{ all_of: [balance(5)] }] })
    await buttons(view, 'admin.announcements.form.addAndCondition')[0].trigger('click'); await settle()
    expect(value(view).any_of[0].all_of).toEqual([balance(5), subscription()])
    await buttons(view, 'admin.announcements.form.addOrGroup')[0].trigger('click'); await settle()
    expect(value(view).any_of).toHaveLength(2)
    // Order is group delete, condition delete(s), then the next group's buttons.
    await buttons(view, 'common.delete')[2].trigger('click'); await settle()
    expect(value(view).any_of[0].all_of).toEqual([balance(5)])
    await buttons(view, 'common.delete')[2].trigger('click'); await settle()
    expect(value(view)).toEqual({ any_of: [{ all_of: [balance(5)] }] })
  })

  it('shows an empty conjunction as requiring a condition and clears that error after native add', async () => {
    const view = await render({ any_of: [{ all_of: [] }] })
    expect(view.find('.border-red-200').text()).toBe('admin.announcements.form.addAndCondition')
    await buttons(view, 'admin.announcements.form.addAndCondition')[0].trigger('click'); await settle()
    expect(value(view).any_of[0].all_of).toEqual([subscription()])
    expect(view.find('.border-red-200').text()).toBe('admin.announcements.form.selectPackages')
    await view.get('input[type="checkbox"]').setValue(true); await settle()
    expect(view.find('.border-red-200').exists()).toBe(false)
  })

  it('disables adding a fifty-first alternative while allowing removal and a replacement at the boundary', async () => {
    const view = await render({ any_of: Array.from({ length: 50 }, () => ({ all_of: [balance()] })) })
    const add = buttons(view, 'admin.announcements.form.addOrGroup')[0]
    expect(add.attributes('disabled')).toBeDefined(); add.element.click(); await settle(); expect(value(view).any_of).toHaveLength(50)
    await buttons(view, 'common.delete')[0].trigger('click'); await settle(); expect(value(view).any_of).toHaveLength(49)
    expect(add.attributes('disabled')).toBeUndefined(); await add.trigger('click'); await settle()
    expect(value(view).any_of).toHaveLength(50); expect(value(view).any_of[49].all_of).toEqual([subscription()])
  })

  it('disables a fifty-first AND condition and allows a replacement after deleting one requirement', async () => {
    const view = await render({ any_of: [{ all_of: Array.from({ length: 50 }, () => balance()) }] })
    const add = buttons(view, 'admin.announcements.form.addAndCondition')[0]
    expect(add.attributes('disabled')).toBeDefined(); add.element.click(); await settle(); expect(value(view).any_of[0].all_of).toHaveLength(50)
    await buttons(view, 'common.delete')[1].trigger('click'); await settle(); await add.trigger('click'); await settle()
    expect(value(view).any_of[0].all_of).toHaveLength(50); expect(value(view).any_of[0].all_of[49]).toEqual(subscription())
  })

  it('renders an existing package selection without losing it while unrelated balance conditions change', async () => {
    const initial = { any_of: [{ all_of: [subscription([22, 21]), balance(7)] }] }
    const view = await render(initial)
    expect(view.findAll<HTMLInputElement>('input[type="checkbox"]').every(node => node.element.checked)).toBe(true)
    await view.get('input[type="number"]').setValue('8.5'); await settle()
    expect(value(view).any_of[0].all_of).toEqual([subscription([22, 21]), balance(8.5)])
    expect(initial.any_of[0].all_of).toEqual([subscription([22, 21]), balance(7)])
  })
})
