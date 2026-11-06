import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import Modal from '../OpsErrorDetailModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { OpsErrorDetail } from '@/api/admin/ops'

const feedback = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: feedback.error }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${Object.values(params).join(',')}` : key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
enableAutoUnmount(afterEach)
const oldAdapter = apiClient.defaults.adapter
const wire: Array<{ path: string; params: Record<string, unknown> }> = []
const fixture = (patch: Partial<OpsErrorDetail> = {}): OpsErrorDetail => ({ id: 31, created_at: '2030-01-01T00:00:00Z', phase: 'request', type: 'upstream_error', error_owner: 'provider', error_source: 'gateway', severity: 'P1', status_code: 502, platform: 'openai', model: 'synthetic-model', resolved: false, client_request_id: '', request_id: 'synthetic-request', message: 'Synthetic gateway message', user_email: '', account_name: '', group_name: '', error_body: '', is_business_limited: false, ...patch })
let detail: OpsErrorDetail, events: OpsErrorDetail[], refusal: 'detail' | 'events' | ''
const body = () => new DOMWrapper(document.body)
async function host(props: { show?: boolean; errorId?: number | null; errorType?: 'request' | 'upstream'; backToList?: boolean } = {}) {
  const view = mount(Modal, { attachTo: document.body, props: { show: true, errorId: 31, errorType: 'request', ...props }, global: { stubs: { Icon: true } } }); await flushPromises(); return view
}
function summary(key: string) { const label = body().findAll('.uppercase').find(item => item.text() === `admin.ops.errorDetail.${key}`); expect(label, key).toBeDefined(); return new DOMWrapper(label!.element.parentElement!) }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-error-detail', user: { id: 7, role: 'admin' } }); feedback.error.mockReset(); wire.length = 0; detail = fixture(); events = []; refusal = ''; vi.spyOn(console, 'error').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const path = new URL(apiClient.getUri(config), 'https://synthetic.invalid').pathname, isList = path.endsWith('/upstream-errors')
    if (!/^\/api\/v1\/admin\/ops\/(request-errors|upstream-errors)\/\d+(\/upstream-errors)?$/.test(path)) throw new Error(`Unexpected synthetic diagnostics route ${path}`)
    wire.push({ path, params: config.params ?? {} })
    const response = { config, status: (isList ? refusal === 'events' : refusal === 'detail') ? 422 : 200, statusText: 'Synthetic diagnostic fixture', headers: {}, data: {} as unknown }
    response.data = response.status === 422 ? { code: 422, message: 'Synthetic diagnostics refused' } : { code: 0, data: structuredClone(isList ? { items: events, total: events.length, page: 1, page_size: 100, pages: 1 } : detail) }
    if (response.status >= 400) throw new AxiosError('Synthetic diagnostics refused', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.classList.remove('modal-open') })

describe('native diagnostic detail dialog over the actual operations API', () => {
  it.each([null, 0, -1])('does not query an absent or invalid selected error (%s)', async errorId => {
    const view = await host({ errorId }); expect(wire).toHaveLength(0); expect(body().text()).toContain('admin.ops.errorDetail.noErrorSelected')
    await body().get('button[aria-label="Close modal"]').trigger('click'); expect(view.emitted('update:show')).toEqual([[false]])
  })
  it('loads only after a closed dialog is opened and returns to the same list with explicit events', async () => {
    const view = await host({ show: false, backToList: true }); expect(wire).toHaveLength(0)
    await view.setProps({ show: true }); await flushPromises()
    expect(wire.map(item => item.path)).toEqual(['/api/v1/admin/ops/request-errors/31', '/api/v1/admin/ops/request-errors/31/upstream-errors'])
    expect(wire[1].params).toEqual({ page: 1, page_size: 100, view: 'all', include_detail: '1', timezone: expect.any(String) })
    await body().get('[data-testid="error-detail-back-to-list"]').trigger('click'); expect(view.emitted('back')).toHaveLength(1); expect(view.emitted('update:show')).toEqual([[false]])
    await view.setProps({ show: false }); await flushPromises(); await view.setProps({ show: true, errorId: null }); await flushPromises(); expect(body().text()).toContain('admin.ops.errorDetail.noErrorSelected')
  })
  it.each([[200, 'gray'], [400, 'amber'], [429, 'purple'], [503, 'red']] as const)('uses severity badges for %s without altering stored attribution', async (status_code, color) => {
    detail = fixture({ phase: 'upstream', status_code, upstream_status_code: status_code, account_id: 91, group_id: 12, request_id: '', client_request_id: 'synthetic-client', requested_model: 'client-model', upstream_model: 'provider-model', api_key_prefix: 'synthetic-prefix', inbound_endpoint: '/v1/chat/completions', upstream_endpoint: '/v1/responses' })
    await host({ errorType: 'upstream' }); expect(wire).toHaveLength(1); expect(wire[0].path).toBe('/api/v1/admin/ops/upstream-errors/31')
    expect(summary('status').get('span').classes().join(' ')).toContain(`bg-${color}-50`); expect(summary('upstreamStatus').text()).toContain(String(status_code))
    expect(summary('account').text()).toContain('91'); expect(summary('group').text()).toContain('12'); expect(summary('requestId').text()).toContain('synthetic-client')
    expect(summary('model').findAll('span').map(span => span.text())).toEqual(['client-model', '→', 'provider-model']); expect(summary('apiKeyPrefix').text()).toContain('synthetic-prefix')
    expect(summary('inboundEndpoint').text()).toContain('/v1/chat/completions'); expect(summary('upstreamEndpoint').text()).toContain('/v1/responses')
  })
  it.each([[1, 'Sync'], [2, 'Stream'], [3, 'Ws'], [null, 'Unknown']] as const)('preserves the numeric request type (%s)', async (request_type, label) => {
    detail = fixture({ request_type, user_id: 44, requested_model: 'selected-model', upstream_model: '' }); await host()
    expect(summary('requestType').text()).toContain(`admin.ops.errorDetail.requestType${label}`); expect(summary('user').text()).toContain('44'); expect(summary('model').text()).toContain('selected-model')
  })
  it.each([
    { upstream_error_message: 'Synthetic root upstream', upstream_error_detail: '{"detail":true}', message: 'gateway', error_body: '{"client":true}', upstream_errors: '[{"attempt":1}]', expected: 'Synthetic root upstream', count: 4 },
    { upstream_error_message: '[]', upstream_error_detail: '{"root":"detail"}', message: 'gateway', error_body: '{"root":"detail"}', upstream_errors: '{}', expected: '{"root":"detail"}', count: 1 },
    { upstream_error_message: 'null', upstream_error_detail: '', message: 'Synthetic fallback message', error_body: '', upstream_errors: 'NULL', expected: 'Synthetic fallback message', count: 0 },
    { upstream_error_message: '', upstream_error_detail: '{}', message: '', error_body: 'Synthetic plain body', upstream_errors: '[]', expected: 'Synthetic plain body', count: 1 },
  ])('prioritizes and deduplicates meaningful payloads ($expected)', async ({ expected, count, ...patch }) => {
    detail = fixture(patch); await host({ errorType: 'upstream' }); expect(summary('message').get('[title]').attributes('title')).toBe(expected); expect(body().findAll('pre')).toHaveLength(count)
    if (count) expect(body().findAll('pre').map(pre => pre.text()).join(' ')).not.toContain('undefined')
  })
  it('keeps sparse rows empty and uses the original model when no mapping is recorded', async () => {
    detail = fixture({ request_id: '', client_request_id: '', platform: '', model: '', message: '', error_body: '', upstream_status_code: null })
    await host({ errorType: 'upstream' }); for (const key of ['requestId', 'account', 'group', 'platform', 'model', 'message', 'upstreamStatus']) expect(summary(key === 'account' ? 'user' : key).text()).toContain('—')
    expect(body().findAll('pre')).toHaveLength(0)
  })
  it('expands and collapses each upstream response while disabling absent payloads', async () => {
    detail = fixture({ user_email: 'synthetic@example.invalid', group_name: 'Synthetic group', requested_model: 'same-model', upstream_model: 'same-model' })
    events = [fixture({ id: 41, phase: 'upstream', upstream_error_detail: '{"provider":"synthetic"}', message: 'Synthetic first attempt', request_id: 'synthetic-upstream' }), fixture({ id: 42, phase: 'upstream', upstream_error_message: '', upstream_errors: '[]', error_body: 'Synthetic raw response', type: '', message: '', request_id: '', client_request_id: 'synthetic-fallback' }), fixture({ id: 43, phase: 'upstream', message: '', error_body: '' })]
    await host(); expect(summary('user').text()).toContain('synthetic@example.invalid'); expect(summary('group').text()).toContain('Synthetic group')
    const expand = () => body().findAll('button').filter(button => button.text().includes('admin.ops.errorDetail.responsePreview'))
    expect(expand()).toHaveLength(3); expect(expand()[2].attributes('disabled')).toBeDefined()
    await expand()[0].trigger('click'); expect(body().findAll('pre')).toHaveLength(1); expect(body().get('pre').text()).toBe('{\n  "provider": "synthetic"\n}')
    await expand()[1].trigger('click'); expect(body().findAll('pre')[1].text()).toBe('Synthetic raw response')
    await expand()[0].trigger('click'); expect(body().findAll('pre')).toHaveLength(1); expect(body().get('pre').text()).toBe('Synthetic raw response')
  })
  it('shows a recorded local concurrency refusal with the recorded numeric limit', async () => {
    detail = fixture({ status_code: 429, error_owner: 'client', message: '个人并发已达上限（上限 2）', error_body: '{"error":{"code":"gateway_user_concurrency_limit"}}' }); await host()
    const notice = body().get('aside'); expect(notice.text()).toContain('admin.ops.diagnostics.scope.user'); expect(notice.text()).toContain('admin.ops.diagnostics.limit:2'); expect(notice.text()).toContain('admin.ops.diagnostics.recordedHint')
  })
  it('retains the selected detail if only its upstream correlation query is refused', async () => {
    refusal = 'events'; await host(); expect(summary('requestId').text()).toContain('synthetic-request'); expect(body().findAll('pre')).toHaveLength(0); expect(feedback.error).not.toHaveBeenCalled()
  })
  it('reports a refused detail then recovers when another selected error is loaded', async () => {
    refusal = 'detail'; const view = await host(); expect(body().text()).toContain('admin.ops.errorDetail.noErrorSelected'); expect(feedback.error).toHaveBeenCalledWith('Synthetic diagnostics refused')
    refusal = ''; detail = fixture({ id: 32, account_name: 'Synthetic named account', phase: 'upstream' }); await view.setProps({ errorId: 32, errorType: 'upstream' }); await flushPromises()
    expect(summary('account').text()).toContain('Synthetic named account'); expect(wire.at(-1)?.path).toBe('/api/v1/admin/ops/upstream-errors/32')
  })
})
