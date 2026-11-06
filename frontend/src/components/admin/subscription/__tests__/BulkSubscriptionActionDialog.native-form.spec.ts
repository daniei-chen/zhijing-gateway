import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import BulkSubscriptionActionDialog from '../BulkSubscriptionActionDialog.vue'
import { replaceAuthSession } from '@/api/authSession'
import { apiClient } from '@/api/client'
import * as subscriptionsAPI from '@/api/admin/subscriptions'
import type { UserSubscription } from '@/types'

const { bulkAction } = vi.hoisted(() => ({ bulkAction: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { subscriptions: { bulkAction } } }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual('vue-i18n'),
  useI18n: () => ({ t: (key: string) => key })
}))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const wrappers: VueWrapper[] = []
const stubs = { teleport: true, transition: true, Icon: true }
const subscriptions = (id: number) => [{
  id, user_id: id + 100, group_id: 61, status: 'active',
  user: { email: `synthetic-${id}@example.invalid` }, group: { name: 'Synthetic group' }
} as UserSubscription]

function props(id: number) {
  return { show: true, action: 'extend' as const, subscriptions: subscriptions(id) }
}

function mountPair(sharedHost: boolean) {
  if (sharedHost) {
    const host = mount(defineComponent({
      setup: () => () => h('div', [
        h(BulkSubscriptionActionDialog, props(41)),
        h(BulkSubscriptionActionDialog, props(42))
      ])
    }), { attachTo: document.body, global: { stubs } })
    wrappers.push(host)
    return host.findAllComponents(BulkSubscriptionActionDialog)
  }
  return [41, 42].map(id => {
    const wrapper = mount(BulkSubscriptionActionDialog, {
      props: props(id), attachTo: document.body, global: { stubs }
    })
    wrappers.push(wrapper)
    return wrapper
  })
}

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-native-bulk-admin', user: { id: 7 } })
  bulkAction.mockReset().mockImplementation(subscriptionsAPI.bulkAction)
  await new Promise(resolve => setTimeout(resolve, 0))
})

afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

describe('bulk subscription native form ownership', () => {
  it.each([
    ['one Vue host', true],
    ['separate Vue apps in one document', false]
  ] as const)('submits only the second dialog target within %s and associates its own field labels', async (_scope, sharedHost) => {
    const originalAdapter = apiClient.defaults.adapter
    const wire: Array<{ url?: string; body: unknown; key: unknown }> = []
    const completed = { success_count: 1, failed_count: 0, results: [{ subscription_id: 42, success: true }] }
    apiClient.defaults.adapter = async config => {
      wire.push({ url: config.url, body: JSON.parse(config.data), key: config.headers.get('Idempotency-Key') })
      return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: completed } }
    }
    try {
      const [old, current] = mountPair(sharedHost)
      await old.get('input[type="number"]').setValue(-4)
      await current.get('input[type="number"]').setValue(7)
      expect(current.text()).toContain('synthetic-42@example.invalid')
      const form = current.get('form').element as HTMLFormElement
      const button = current.get('button[type="submit"]').element as HTMLButtonElement
      const buttonForm = button.form
      button.click()
      await flushPromises()

      expect(wire).toEqual([{
        url: '/admin/subscriptions/bulk-action',
        body: { subscription_ids: [42], action: 'extend', days: 7 },
        key: expect.any(String)
      }])
      expect(current.emitted('completed')).toEqual([[completed]])
      expect(old.emitted('completed')).toBeUndefined()
      expect(buttonForm).toBe(form)

      const ownedIds: string[] = []
      for (const dialog of [old, current]) {
        const input = dialog.get('input[type="number"]').element as HTMLInputElement
        const label = dialog.get('label').element as HTMLLabelElement
        const hintId = input.getAttribute('aria-describedby')!
        const hint = document.getElementById(hintId)
        expect(label.control).toBe(input)
        expect(hint?.textContent).toContain('admin.subscriptions.bulk.extendHint')
        expect(dialog.element.contains(hint)).toBe(true)
        ownedIds.push((dialog.get('form').element as HTMLFormElement).id, input.id, hintId)
      }
      expect(ownedIds.every(Boolean)).toBe(true)
      expect(new Set(ownedIds).size).toBe(ownedIds.length)
    } finally {
      apiClient.defaults.adapter = originalAdapter
    }
  })
})
