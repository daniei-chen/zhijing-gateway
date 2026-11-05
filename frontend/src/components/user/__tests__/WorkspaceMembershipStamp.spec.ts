import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceMembershipStamp from '../WorkspaceMembershipStamp.vue'
import type { UserSubscription } from '@/types'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'zh' } }) }))
const membership = (name: string, expires_at: string | null) => ({ id: 1, group_id: 7, group: { name }, expires_at } as UserSubscription)

describe('workspace membership metadata', () => {
  it('updates the plan and expiry from native subscription data', async () => {
    const wrapper = mount(WorkspaceMembershipStamp, { props: { subscription: membership('专业版', '2027-06-01T00:00:00Z') } })
    expect(wrapper.text()).toContain('专业版')
    expect(wrapper.text()).toContain('2027')
    expect(wrapper.text()).not.toContain('2099')
    await wrapper.setProps({ subscription: membership('旗舰版', '2099-12-31T00:00:00Z') })
    expect(wrapper.text()).toContain('旗舰版')
    expect(wrapper.text()).toContain('2099')
    expect(wrapper.text()).not.toContain('专业版')
  })
  it('uses the native no-expiry state without inventing an end date', () => {
    const wrapper = mount(WorkspaceMembershipStamp, { props: { subscription: membership('当前方案', null) } })
    expect(wrapper.text()).toContain('无到期限制')
    expect(wrapper.text()).not.toContain('2099')
  })
})
