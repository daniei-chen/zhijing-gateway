import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Modal from '../ErrorPassthroughRulesModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { ErrorPassthroughRule } from '@/api/admin/errorPassthrough'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter, endpoint = '/api/v1/admin/error-passthrough-rules'
const wire: Array<{ method: string; path: string; body: Record<string, unknown> | undefined }> = []
let rules: ErrorPassthroughRule[], rejectMethod: string
const rule = (extra: Partial<ErrorPassthroughRule> = {}): ErrorPassthroughRule => ({ id: 41, name: 'Synthetic rule', enabled: true, priority: 0, error_codes: [429], keywords: [], match_mode: 'any', platforms: [], passthrough_code: true, response_code: null, passthrough_body: true, custom_message: null, skip_monitoring: false, description: null, created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', ...extra })
const body = () => new DOMWrapper(document.body)
async function host(initial = false) { const view = mount(Modal, { attachTo: document.body, props: { show: initial }, global: { stubs: { Icon: true } } }); if (!initial) await view.setProps({ show: true }); await flushPromises(); return view }
function button(root: Pick<DOMWrapper<Element>, 'findAll'>, text: string) { const element = root.findAll('button').find(item => item.text() === text); expect(element, text).toBeDefined(); return element! }
function input(root: Pick<DOMWrapper<Element>, 'findAll'>, key: string) {
  const label = root.findAll('label').find(item => item.text() === `admin.errorPassthrough.form.${key}`)
  expect(label, key).toBeDefined(); return new DOMWrapper(label!.element.parentElement!).get('input,textarea')
}
async function checkbox(root: Pick<DOMWrapper<Element>, 'findAll'>, key: string, value: boolean) {
  const label = root.findAll('label,span').find(item => item.text() === `admin.errorPassthrough.form.${key}` && item.element.parentElement?.querySelector('input[type="checkbox"]'))
  expect(label, key).toBeDefined(); await new DOMWrapper(label!.element.parentElement!).get('input[type="checkbox"]').setValue(value)
}
async function createForm() { await button(body(), 'admin.errorPassthrough.createRule').trigger('click'); await flushPromises(); return body().get('form') }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-error-rules', user: { id: 7, role: 'admin' } })
  rules = [rule(), rule({ id: 42, name: 'Synthetic rewrite', enabled: false, priority: 10, error_codes: [500, 502, 503], keywords: ['Synthetic upstream', 'Synthetic overloaded'], match_mode: 'all', platforms: ['openai'], passthrough_code: false, response_code: 422, passthrough_body: false, custom_message: 'Synthetic safe message', skip_monitoring: true, description: 'Synthetic description' })]
  wire.length = 0; rejectMethod = ''; feedback.success.mockReset(); feedback.error.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const path = new URL(apiClient.getUri(config), 'https://synthetic.invalid').pathname
    if (!path.startsWith(endpoint)) throw new Error(`Unexpected synthetic rules route ${path}`)
    const request = { method: String(config.method).toUpperCase(), path, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }; wire.push(request)
    if (request.method === rejectMethod) {
      const response = { config, status: 422, statusText: 'Synthetic rules refused', headers: {}, data: { code: 422, message: 'Synthetic rules refused' } }
      throw new AxiosError('Synthetic rules refused', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    }
    const id = Number(path.split('/').at(-1)); let value: unknown
    if (request.method === 'GET') value = rules
    else if (request.method === 'POST') { const created = rule({ ...request.body, id: 43 }); rules.push(created); value = created }
    else if (request.method === 'PUT') { const saved = { ...rules.find(item => item.id === id)!, ...request.body }; rules = rules.map(item => item.id === id ? saved : item); value = saved }
    else { rules = rules.filter(item => item.id !== id); value = { message: 'deleted' } }
    return { config, status: 200, statusText: 'Synthetic error rules', headers: {}, data: { code: 0, data: structuredClone(value) } }
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open') })

describe('error rule editor native controls and actual API contract', () => {
  it('loads on the initially visible conditional mount used by the account page', async () => {
    await host(true)
    expect(wire.filter(item => item.method === 'GET')).toHaveLength(1)
    expect(body().text()).toContain('Synthetic rule')
  })
  it('renders passthrough and rewritten rule summaries without requiring a custom response', async () => {
    await host(); expect(body().findAll('tbody tr')).toHaveLength(2)
    for (const text of ['429', '500', 'Synthetic ...', 'Synthetic rewrite', '422']) expect(body().text()).toContain(text)
  })
  it('validates blank names and empty/invalid conditions before a write', async () => {
    await host(); const form = await createForm()
    await button(body(), 'common.create').trigger('click'); expect(feedback.error).toHaveBeenLastCalledWith('admin.errorPassthrough.nameRequired')
    await input(form, 'name').setValue('Synthetic new rule'); await input(form, 'errorCodes').setValue('-1, invalid, 0')
    await button(body(), 'common.create').trigger('click'); expect(feedback.error).toHaveBeenLastCalledWith('admin.errorPassthrough.conditionsRequired')
    expect(wire.filter(item => item.method === 'POST')).toHaveLength(0)
  })
  it('creates an explicit rewritten rule with parsed conditions, platform and boolean controls', async () => {
    await host(); const form = await createForm()
    await input(form, 'name').setValue('  Synthetic new rule  '); await input(form, 'priority').setValue(0)
    await input(form, 'errorCodes').setValue('429, 500 invalid -1 0'); await input(form, 'keywords').setValue(' first needle \n\n second needle ')
    await input(form, 'description').setValue('  Synthetic description  ')
    await form.get('input[type="radio"][value="all"]').setValue(true)
    await form.get('input[type="checkbox"][value="openai"]').setValue(true)
    await checkbox(form, 'passthroughCode', false); await input(form, 'responseCode').setValue(422)
    await checkbox(form, 'passthroughBody', false); await input(form, 'customMessage').setValue('Synthetic safe output')
    await checkbox(form, 'skipMonitoring', true); await checkbox(form, 'enabled', false)
    await button(body(), 'common.create').trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'POST')?.body).toEqual({ name: 'Synthetic new rule', priority: 0, error_codes: [429, 500], keywords: ['first needle', 'second needle'], match_mode: 'all', platforms: ['openai'], passthrough_code: false, response_code: 422, passthrough_body: false, custom_message: 'Synthetic safe output', skip_monitoring: true, enabled: false, description: 'Synthetic description' })
    expect(feedback.success).toHaveBeenCalledWith('admin.errorPassthrough.ruleCreated')
  })
  it('edits only its chosen rule and clears rewritten fields when passthrough is selected', async () => {
    await host(); await body().findAll('tbody tr')[1].get('button[title="common.edit"]').trigger('click'); await flushPromises()
    const form = body().get('form'); expect((input(form, 'name').element as HTMLInputElement).value).toBe('Synthetic rewrite')
    await checkbox(form, 'passthroughCode', true); await checkbox(form, 'passthroughBody', true)
    await input(form, 'description').setValue('   '); await button(body(), 'common.update').trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'PUT')).toMatchObject({ path: `${endpoint}/42`, body: { passthrough_code: true, passthrough_body: true, response_code: null, custom_message: null, description: null } })
    expect(feedback.success).toHaveBeenCalledWith('admin.errorPassthrough.ruleUpdated')
  })
  it('resets a cancelled editor before the next create and emits close from the list footer', async () => {
    const view = await host(); const form = await createForm(); await input(form, 'name').setValue('Discarded draft')
    await button(body(), 'common.cancel').trigger('click'); await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
    const next = await createForm(); expect((input(next, 'name').element as HTMLInputElement).value).toBe('')
    await button(body(), 'common.cancel').trigger('click'); await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
    await button(body(), 'common.close').trigger('click'); expect(view.emitted('close')).toHaveLength(1)
  })
  it('cancels deletion, then confirms only the selected target', async () => {
    await host(); await body().findAll('tbody tr')[0].get('button[title="common.delete"]').trigger('click'); await flushPromises()
    await button(body(), 'common.cancel').trigger('click'); expect(wire.filter(item => item.method === 'DELETE')).toHaveLength(0)
    await body().findAll('tbody tr')[0].get('button[title="common.delete"]').trigger('click'); await flushPromises()
    await button(body(), 'common.delete').trigger('click'); await flushPromises()
    expect(wire.find(item => item.method === 'DELETE')?.path).toBe(`${endpoint}/41`)
    expect(body().findAll('tbody tr')).toHaveLength(1); expect(body().text()).toContain('Synthetic rewrite')
  })
  it.each(['GET', 'POST', 'PUT', 'DELETE'])('shows a safe failure after %s is refused', async method => {
    if (method === 'GET') rejectMethod = method
    await host()
    if (method === 'POST') { const form = await createForm(); await input(form, 'name').setValue('Synthetic retry'); await input(form, 'keywords').setValue('synthetic'); rejectMethod = method; await button(body(), 'common.create').trigger('click') }
    if (method === 'PUT') { await body().findAll('tbody tr')[0].get('button[title="common.edit"]').trigger('click'); rejectMethod = method; await button(body(), 'common.update').trigger('click') }
    if (method === 'DELETE') { await body().findAll('tbody tr')[0].get('button[title="common.delete"]').trigger('click'); rejectMethod = method; await button(body(), 'common.delete').trigger('click') }
    await flushPromises(); expect(feedback.error).toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
  })
})
