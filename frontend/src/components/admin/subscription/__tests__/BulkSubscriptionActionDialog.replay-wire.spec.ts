import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BulkSubscriptionActionDialog from '../BulkSubscriptionActionDialog.vue'
import type { SubscriptionBulkActionResult } from '@/api/admin/subscriptions'
import type { UserSubscription } from '@/types'
import { replaceAuthSession } from '@/api/authSession'

const { bulkAction } = vi.hoisted(() => ({ bulkAction: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { subscriptions: { bulkAction } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const result: SubscriptionBulkActionResult = { success_count: 1, failed_count: 0, results: [{ subscription_id: 41, success: true }] }
const subscriptions = (id = 41) => [{ id, user_id: 51, group_id: 61, status: 'active', user: { email: `synthetic-${id}@example.invalid` } } as UserSubscription]
const wrappers: VueWrapper[] = []
let adminID = 3000
function render(id = 41) {
  const wrapper = mount(BulkSubscriptionActionDialog, {
    props: { show: true, action: 'extend', subscriptions: subscriptions(id) }, attachTo: document.body,
    global: { stubs: { teleport: true, transition: true } }
  })
  wrappers.push(wrapper)
  return wrapper
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
function savedOperationKey() {
  const scope = Object.keys(sessionStorage).find(key => key.startsWith('sub2api:admin:subscription-bulk:'))
  expect(scope).toBeDefined()
  return sessionStorage.getItem(scope!)
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: `synthetic-bulk-session-${++adminID}`, user: { id: adminID } })
  await new Promise(resolve => setTimeout(resolve, 0))
  bulkAction.mockReset().mockResolvedValue(result)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })

describe('bulk subscription real-client replay wire', () => {
  it('uses the real client replay URL across 48 hours and leaves an old-backend result unconfirmed', async () => {
    const { apiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/admin/subscriptions')>('@/api/admin/subscriptions')
    const adapter = apiClient.defaults.adapter
    const wire: Array<{ url?: string; body: unknown; key: unknown }> = []
    apiClient.defaults.adapter = async config => {
      wire.push({ url: config.url, body: JSON.parse(config.data), key: config.headers.get('Idempotency-Key') })
      if (wire.length === 1) throw Object.assign(new Error('Synthetic lost reply'), { code: 'ERR_NETWORK', config })
      throw { config, response: { status: 404, data: { message: 'Synthetic legacy backend' }, headers: {} } }
    }
    bulkAction.mockImplementation(actual.bulkAction)
    vi.useFakeTimers({ toFake: ['Date'] })
    const wrapper = render()
    try {
      await submit(wrapper)
      vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000)
      await submit(wrapper); await submit(wrapper)
      expect(wire.map(request => request.url)).toEqual(['/admin/subscriptions/bulk-action', '/admin/subscriptions/bulk-action/replay', '/admin/subscriptions/bulk-action/replay'])
      expect(wire[1].body).toEqual(wire[0].body); expect(wire[2].body).toEqual(wire[0].body)
      expect(wire[1].key).toBe(wire[0].key); expect(wire[2].key).toBe(wire[0].key)
      expect(wrapper.text()).toContain('admin.subscriptions.bulk.resultUnconfirmed')
      expect(wrapper.emitted('completed')).toBeUndefined()
      expect(savedOperationKey()).toBe(wire[0].key)
    } finally { apiClient.defaults.adapter = adapter }
  })
})
