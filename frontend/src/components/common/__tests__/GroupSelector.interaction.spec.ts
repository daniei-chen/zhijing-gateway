import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import GroupSelector from '../GroupSelector.vue'
import type { Group } from '@/types'

vi.mock('@/stores', () => ({ useAuthStore: () => ({ isSimpleMode: false }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const groups = [{ id: 1, name: 'Synthetic Alpha', platform: 'anthropic', status: 'active' }, { id: 2, name: 'Synthetic Beta', platform: 'gemini', status: 'active', description: 'Synthetic search' }] as Group[]
const wrappers: VueWrapper[] = []
function selector(props: Record<string, unknown> = {}) { const wrapper = mount(GroupSelector, { props: { modelValue: [], groups, searchable: true, ...props }, global: { stubs: { Icon: true, GroupBadge: { props: ['name'], template: '<span>{{ name }}</span>' } } } }); wrappers.push(wrapper); return wrapper }
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('GroupSelector native names and disabled propagation', () => {
  it('connects the group label and search, and binds a checked native checkbox', async () => {
    const wrapper = selector()
    const search = wrapper.get('input[type="text"]')
    expect(search.attributes('id')).toBeTruthy()
    expect(wrapper.get(`label[for="${search.attributes('id')}"]`).text()).toContain('admin.users.groups')
    await search.setValue('search')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
    const checkbox = wrapper.get('input[type="checkbox"]')
    expect(checkbox.attributes('id')).toBeTruthy()
    expect((checkbox.element as HTMLInputElement).labels?.[0].textContent).toContain('Synthetic Beta')
    await checkbox.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[[2]]])
  })

  it('disables the actual native controls and suppresses changes while disabled', async () => {
    const wrapper = selector({ disabled: true })
    expect(wrapper.get('input[type="text"]').element.matches(':disabled')).toBe(true)
    const checkbox = wrapper.get('input[type="checkbox"]')
    expect(checkbox.element.matches(':disabled')).toBe(true)
    await checkbox.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({ disabled: false })
    await checkbox.setValue(false)
    expect(wrapper.emitted('update:modelValue')).toEqual([[[]]])
  })

  it('uses unique native IDs when two pickers show the same group IDs', () => {
    const parent = mount(defineComponent({ components: { GroupSelector }, setup: () => ({ groups }), template: '<div><GroupSelector :model-value="[]" :groups="groups" searchable/><GroupSelector :model-value="[]" :groups="groups" searchable/></div>' }), { global: { stubs: { Icon: true, GroupBadge: true } } })
    wrappers.push(parent)
    const ids = parent.findAll('input').map(input => input.attributes('id'))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
