import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import PluginsView from '../PluginsView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { PluginInstallation } from '@/api/admin/plugins'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('@/api/admin', async () => ({ adminAPI: { plugins: await vi.importActual('@/api/admin/plugins') } }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success, showInfo: feedback.info }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))
interface Wire { method: string; path: string; body: unknown }
const previousAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: PluginInstallation[]
let result: { success: boolean; message: string; latency_ms: number }
let fail: string
let block: string
let unexpected: string[]
let pendingConfig: Promise<Record<string, unknown>> | null
const plugin = (patch: Partial<PluginInstallation> = {}): PluginInstallation => ({ id: 71, plugin_key: 'synthetic.release.transport', name: 'Synthetic Transport', version: '1.0.0', description: '', author: '', manifest: { schema_version: 1, id: 'synthetic.release.transport', name: 'Synthetic Transport', version: '1.0.0', requires: { sub2api: '>=0.1.0', plugin_protocol: 1, transport_api: 1, ui_bridge: 1 }, capabilities: [], ui: { entrypoint: 'ui/index.html' } }, binary_sha256: 'a'.repeat(64), signature_status: 'trusted', state: 'disabled', last_error: '', installed_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', bindings: [{ id: 1, plugin_id: 71, capability: 'openai.oauth.outbound_transport.v1', platform: 'openai', account_type: 'oauth', enabled: false, rollout_percent: 100 }], compatibility: { compatible: true, tested: true, status: 'compatible', message: 'Synthetic compatibility', current_sub2api_version: '0.1.0', required_sub2api_version: '>=0.1.0', recommended_sub2api_version: '0.1.0', plugin_protocol: 1, transport_api: 1, ui_bridge: 1 }, runtime_healthy: false, runtime_message: '', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll('button').find(node => node.text() === label); expect(found, label).toBeDefined(); return found! }
async function render() {
  const view = mount(PluginsView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, teleport: true, transition: true } } })
  mounted.push(view); await flushPromises(); return view
}
async function open(view: VueWrapper) {
  await button(view, 'admin.plugins.configure').trigger('click'); await flushPromises()
  const frame = view.get<HTMLIFrameElement>('iframe'); await frame.trigger('load')
  return frame
}
async function message(frame: HTMLIFrameElement, data: Record<string, unknown>, options: { source?: MessageEventSource | null; origin?: string } = {}) {
  window.dispatchEvent(new MessageEvent('message', { source: options.source === undefined ? frame.contentWindow : options.source, origin: options.origin ?? 'null', data: { source: 'sub2api-plugin-ui', bridge_token: 'synthetic-bridge-token', ...data } })); await flushPromises()
}
const actions = () => wires.filter(wire => wire.path !== '/admin/plugins/71/ui-session' && wire.method !== 'get')
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-plugin-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [plugin()]; result = { success: true, message: 'Synthetic connection healthy', latency_ms: 5 }; fail = ''; block = ''; unexpected = []; pendingConfig = null
  Object.values(feedback).forEach(mock => mock.mockReset()); vi.spyOn(window, 'confirm').mockReturnValue(true)
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), body: config.data instanceof FormData ? config.data : config.data ? JSON.parse(String(config.data)) as unknown : undefined }; wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new Error('Synthetic plugin transport unavailable') }
    if (block && wire.path.endsWith('/enable')) { const reason = block; block = ''; throw new AxiosError('Synthetic step-up challenge', 'ERR_BAD_REQUEST', config, undefined, { config, status: 403, statusText: 'Forbidden', headers: {}, data: { code: 403, reason, message: 'Synthetic step-up challenge' } }) }
    let data: unknown
    if (wire.path === '/admin/plugins' && wire.method === 'get') data = rows
    else if (wire.path === '/admin/plugins/upload' && wire.method === 'post') data = plugin()
    else if (wire.path === '/admin/plugins/71/ui-session' && wire.method === 'post') data = { url: 'about:blank', bridge_token: 'synthetic-bridge-token', ui_bridge_version: 1, expires_at: '2030-01-01T00:00:00Z' }
    else if (wire.path === '/admin/plugins/71/config') data = wire.method === 'put' ? { accepted: true, ...wire.body as Record<string, unknown> } : pendingConfig ? await pendingConfig : { endpoint: 'https://synthetic.invalid', enabled: false }
    else if (wire.path === '/admin/plugins/71/test' && wire.method === 'post') data = result
    else if (wire.path === '/admin/plugins/71/status' && wire.method === 'get') data = { healthy: false, message: 'Synthetic passive health', status_json: '{"ready":false}' }
    else if (['/admin/plugins/71/enable', '/admin/plugins/71/disable', '/admin/plugins/71'].includes(wire.path) && ['post', 'delete'].includes(wire.method)) data = plugin()
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic plugin request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = previousAdapter; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Plugin management and sandbox protocol through native DOM and real API transport', () => {
  it.each([
    { state: 'enabled' as const, compatibility: 'compatible' as const, healthy: true, tone: 'bg-emerald-100' },
    { state: 'starting' as const, compatibility: 'untested' as const, healthy: false, tone: 'bg-amber-100' },
    { state: 'error' as const, compatibility: 'compatible' as const, healthy: false, tone: 'bg-red-100' },
    { state: 'incompatible' as const, compatibility: 'incompatible' as const, healthy: false, tone: 'bg-red-100' },
    { state: 'disabled' as const, compatibility: 'compatible' as const, healthy: false, tone: 'bg-gray-100' },
  ])('renders $state installation and $compatibility compatibility with its available actions', async ({ state, compatibility, healthy, tone }) => {
    const row = plugin(); row.state = state; row.compatibility.status = compatibility; row.compatibility.compatible = compatibility !== 'incompatible'; row.runtime_healthy = healthy
    if (state === 'enabled') row.bindings[0].enabled = true
    rows = [row]; const view = await render(); const card = view.get('article')
    expect(card.findAll(`.${tone}`).some(node => node.text() === `admin.plugins.${state}`)).toBe(true)
    expect(card.text()).toContain(`admin.plugins.${healthy ? 'healthy' : 'unhealthy'}`)
    if (state === 'enabled') { expect(button(card, 'admin.plugins.disable').exists()).toBe(true); expect(card.get('input[type="range"]').attributes('disabled')).toBeDefined(); expect(button(card, 'admin.plugins.uninstall').attributes('disabled')).toBeDefined() }
    else expect(button(card, 'admin.plugins.enable').attributes('disabled') !== undefined).toBe(state === 'starting' || compatibility === 'incompatible')
    expect(actions()).toEqual([])
  })

  it('shows author, description, unsigned signature and last failure in preference to passive runtime text', async () => {
    rows = [plugin({ author: 'Synthetic author', description: 'Synthetic plugin description', signature_status: 'unsigned', last_error: 'Synthetic startup failure', runtime_message: 'Hidden passive message' })]
    const view = await render(); expect(view.text()).toContain('Synthetic author'); expect(view.text()).toContain('Synthetic plugin description'); expect(view.text()).toContain('admin.plugins.unsigned'); expect(view.text()).toContain('Synthetic startup failure'); expect(view.text()).not.toContain('Hidden passive message')
  })

  it('shows missing recommendation and passive status without inventing an error, and can recover list loading', async () => {
    const row = plugin({ runtime_message: 'Synthetic passive notice' }); row.compatibility.recommended_sub2api_version = ''; row.bindings = []; rows = [row]
    const view = await render(); expect(view.text()).toContain('Synthetic passive notice'); expect(view.get<HTMLInputElement>('input[type="range"]').element.value).toBe('100'); expect(view.findAll('dd').at(-1)?.text()).toBe('-')
    fail = 'get /admin/plugins'; await view.get('[title="common.refresh"]').trigger('click'); await flushPromises(); expect(feedback.error).toHaveBeenCalledWith('Network error. Please check your connection.')
    rows = []; await view.get('[title="common.refresh"]').trigger('click'); await flushPromises(); expect(view.text()).toContain('admin.plugins.empty')
  })

  it('requires explicit acceptance of untested compatibility and submits the selected rollout on acceptance', async () => {
    const row = plugin(); row.compatibility.tested = false; row.compatibility.status = 'untested'; rows = [row]
    const view = await render(); await view.get('input[type="range"]').setValue('25'); vi.mocked(window.confirm).mockReturnValueOnce(false)
    await button(view, 'admin.plugins.enable').trigger('click'); await flushPromises(); expect(actions()).toEqual([])
    await button(view, 'admin.plugins.enable').trigger('click'); await flushPromises()
    expect(actions()).toEqual([{ method: 'post', path: '/admin/plugins/71/enable', body: { rollout_percent: 25, accept_untested: true } }]); expect(feedback.success).toHaveBeenCalledWith('admin.plugins.enableSuccess')
  })

  it.each(['disable', 'uninstall'])('cancels %s with no command, then submits only the captured plugin after confirmation', async action => {
    const row = plugin(); if (action === 'disable') row.bindings[0].enabled = true; rows = [row]
    const view = await render(); vi.mocked(window.confirm).mockReturnValueOnce(false)
    await button(view, `admin.plugins.${action}`).trigger('click'); await flushPromises(); expect(actions()).toEqual([])
    await button(view, `admin.plugins.${action}`).trigger('click'); await flushPromises()
    expect(actions()).toEqual([{ method: action === 'disable' ? 'post' : 'delete', path: `/admin/plugins/71${action === 'disable' ? '/disable' : ''}`, body: undefined }])
  })

  it.each(['STEP_UP_TOTP_NOT_ENABLED', 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'])('surfaces %s as an actionable sensitive-operation refusal and leaves the command retryable', async reason => {
    block = reason; const view = await render(); await button(view, 'admin.plugins.enable').trigger('click'); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith(reason === 'STEP_UP_TOTP_NOT_ENABLED' ? 'stepUp.notEnabled' : 'stepUp.adminApiKeyForbidden')
    expect(button(view, 'admin.plugins.enable').attributes('disabled')).toBeUndefined(); expect(actions()).toHaveLength(1)
  })

  it('cancels a real step-up prompt without replaying the enable request or raising an operation error', async () => {
    block = 'STEP_UP_REQUIRED'; const view = await render(); await button(view, 'admin.plugins.enable').trigger('click'); await flushPromises()
    const dialog = view.get('[role="dialog"]'); await button(dialog, 'common.cancel').trigger('click'); await flushPromises()
    expect(actions()).toHaveLength(1); expect(feedback.error).not.toHaveBeenCalled(); expect(button(view, 'admin.plugins.enable').attributes('disabled')).toBeUndefined()
  })

  it.each([{ success: true, message: '', expected: 'admin.plugins.testSuccess' }, { success: false, message: '', expected: 'common.error' }, { success: false, message: 'Synthetic test rejection', expected: 'Synthetic test rejection' }])('displays test outcome success=$success with the appropriate explicit or fallback message', async ({ success, message: text, expected }) => {
    result = { success, message: text, latency_ms: 0 }; const view = await render(); await button(view, 'admin.plugins.test').trigger('click'); await flushPromises()
    expect(success ? feedback.success : feedback.error).toHaveBeenCalledWith(expected); expect(actions()).toEqual([{ method: 'post', path: '/admin/plugins/71/test', body: undefined }])
  })

  it('rejects missing or incorrect package extensions and uploads an explicitly selected synthetic package as multipart', async () => {
    const view = await render(); const field = view.get<HTMLInputElement>('input[type="file"]')
    for (const file of [undefined, new File(['synthetic'], 'wrong.zip')]) { Object.defineProperty(field.element, 'files', { configurable: true, value: file ? [file] : [] }); await field.trigger('change'); await flushPromises() }
    expect(feedback.error).toHaveBeenCalledTimes(2); expect(feedback.error).toHaveBeenCalledWith('admin.plugins.fileRequired'); expect(actions()).toEqual([])
    const file = new File(['synthetic'], 'release.S2PLUGIN', { type: 'application/zip' }); Object.defineProperty(field.element, 'files', { configurable: true, value: [file] }); await field.trigger('change'); await flushPromises()
    const upload = actions()[0]; expect(upload.path).toBe('/admin/plugins/upload'); expect((upload.body as FormData).get('plugin')).toBe(file); expect(field.element.value).toBe(''); expect(feedback.success).toHaveBeenCalledWith('admin.plugins.uploadSuccess')
  })

  it('reports a failed UI-session load and creates a sandboxed no-referrer iframe only after an explicit reopen', async () => {
    fail = 'post /admin/plugins/71/ui-session'; const view = await render(); await button(view, 'admin.plugins.configure').trigger('click'); await flushPromises()
    expect(view.text()).toContain('admin.plugins.uiUnavailable'); expect(view.find('iframe').exists()).toBe(false)
    await view.get('[aria-label="Close modal"]').trigger('click'); const frame = await open(view)
    expect(frame.attributes('sandbox')).toBe('allow-scripts'); expect(frame.attributes('referrerpolicy')).toBe('no-referrer'); expect(view.text()).not.toContain('admin.plugins.loadingUI')
  })

  it('exchanges config.load/save, explicit test and passive status results with the current sandbox and literal HTTP bodies', async () => {
    const view = await render(); const frame = (await open(view)).element; const reply = vi.spyOn(frame.contentWindow!, 'postMessage')
    await message(frame, { type: 'config.load', request_id: ' load-1 ' })
    expect(reply).toHaveBeenLastCalledWith({ source: 'sub2api-plugin-host', bridge_token: 'synthetic-bridge-token', type: 'config.load.result', request_id: 'load-1', ok: true, config: { endpoint: 'https://synthetic.invalid', enabled: false } }, '*')
    await message(frame, { type: 'config.save', request_id: 'save-1', config: { endpoint: 'https://revised.invalid', enabled: true, retry_count: 0 } })
    expect(actions()).toEqual([{ method: 'put', path: '/admin/plugins/71/config', body: { endpoint: 'https://revised.invalid', enabled: true, retry_count: 0 } }]); expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'config.save.result', ok: true, config: { accepted: true, endpoint: 'https://revised.invalid', enabled: true, retry_count: 0 } }), '*')
    feedback.success.mockClear(); await message(frame, { type: 'config.test', request_id: 'test-1' }); expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'config.test.result', ok: true, result }), '*'); expect(feedback.success).not.toHaveBeenCalled()
    await message(frame, { type: 'plugin.status', request_id: 'status-1' }); expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'plugin.status.result', ok: true, result: { healthy: false, message: 'Synthetic passive health', status_json: '{"ready":false}' } }), '*')
    expect(wires.at(-1)).toEqual({ method: 'get', path: '/admin/plugins/71/status', body: undefined }); expect(feedback.success).not.toHaveBeenCalled()
  })

  it.each([null, [], 'unexpected config'])('rejects a malformed config %j over the public bridge without making a PUT', async config => {
    const view = await render(); const frame = (await open(view)).element; const reply = vi.spyOn(frame.contentWindow!, 'postMessage')
    await message(frame, { type: 'config.save', request_id: 'invalid-config', config })
    expect(actions()).toEqual([]); expect(reply).toHaveBeenCalledWith(expect.objectContaining({ type: 'config.save.result', ok: false, error: 'admin.plugins.bridgeRejected' }), '*')
  })

  it('ignores foreign origins, windows, protocol senders, tokens and malformed request IDs without reading configuration', async () => {
    const view = await render(); const frame = (await open(view)).element; const before = wires.length; const reply = vi.spyOn(frame.contentWindow!, 'postMessage')
    await message(frame, { type: 'config.load', request_id: 'wrong-origin' }, { origin: window.location.origin })
    await message(frame, { type: 'config.load', request_id: 'wrong-window' }, { source: window })
    await message(frame, { type: 'config.load', request_id: 'wrong-sender', source: 'other-ui' })
    await message(frame, { type: 'config.load', request_id: 'wrong-token', bridge_token: 'foreign-token' })
    for (const request_id of ['', '   ', 123]) await message(frame, { type: 'config.load', request_id })
    expect(wires).toHaveLength(before); expect(reply).not.toHaveBeenCalled(); expect(actions()).toEqual([])
  })

  it('deduplicates an in-flight request ID and drops its late reply when the iframe navigates', async () => {
    let resolve!: (data: Record<string, unknown>) => void; pendingConfig = new Promise(done => { resolve = done })
    const view = await render(); const frame = await open(view); const reply = vi.spyOn(frame.element.contentWindow!, 'postMessage')
    await message(frame.element, { type: 'config.load', request_id: 'one-read' }); await message(frame.element, { type: 'config.load', request_id: 'one-read' })
    expect(wires.filter(wire => wire.path.endsWith('/config'))).toHaveLength(1)
    await frame.trigger('load'); resolve({ synthetic: 'obsolete document' }); await flushPromises(); expect(reply).not.toHaveBeenCalled()
  })

  it('expires an unanswered public request and never delivers a response to a closed configuration dialog', async () => {
    let resolve!: (data: Record<string, unknown>) => void; pendingConfig = new Promise(done => { resolve = done })
    const view = await render(); const frame = (await open(view)).element; const reply = vi.spyOn(frame.contentWindow!, 'postMessage'); vi.useFakeTimers()
    await message(frame, { type: 'config.load', request_id: 'timeout-read' }); await vi.advanceTimersByTimeAsync(30001)
    resolve({ synthetic: 'expired response' }); await flushPromises(); expect(reply).not.toHaveBeenCalled()
    await view.get('[aria-label="Close modal"]').trigger('click'); expect(view.find('iframe').exists()).toBe(false)
    await message(frame, { type: 'plugin.status', request_id: 'closed-read' }); expect(wires.filter(wire => wire.path.endsWith('/status'))).toEqual([])
  })

  it('returns transport errors to the requesting plugin and reports an explicit failed test to the host', async () => {
    const view = await render(); const frame = (await open(view)).element; const reply = vi.spyOn(frame.contentWindow!, 'postMessage')
    fail = 'get /admin/plugins/71/config'; await message(frame, { type: 'config.load', request_id: 'load-failed' })
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: 'Network error. Please check your connection.' }), '*')
    result = { success: false, message: '', latency_ms: 0 }; await message(frame, { type: 'config.test', request_id: 'failed-test' }); expect(feedback.error).toHaveBeenCalledWith('common.error'); expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, result }), '*')
  })

  it.each([{ input: 1, expected: 520 }, { input: 701.6, expected: 702 }, { input: 5000, expected: 960 }, { input: 'not-a-number', expected: 640 }])('applies a finite bounded iframe height for the public resize request $input', async ({ input, expected }) => {
    const view = await render(); const frame = (await open(view)).element; await message(frame, { type: 'ui.resize', height: input })
    expect(frame.parentElement!.style.height).toBe(`${expected}px`); expect(actions()).toEqual([])
  })

  it('accepts ready and bounded notifications while ignoring empty, non-text and unknown public messages', async () => {
    const view = await render(); const frame = (await open(view)).element
    await message(frame, { type: 'sub2api.plugin.ready' }); expect(view.text()).not.toContain('admin.plugins.loadingUI')
    await message(frame, { type: 'ui.notify', level: 'error', message: 'Synthetic error notice' }); expect(feedback.error).toHaveBeenCalledWith('Synthetic error notice')
    await message(frame, { type: 'ui.notify', level: 'success', message: 'Synthetic success notice' }); expect(feedback.success).toHaveBeenCalledWith('Synthetic success notice')
    await message(frame, { type: 'ui.notify', level: 'info', message: 'x'.repeat(501) }); expect(feedback.info).toHaveBeenCalledWith('x'.repeat(500))
    await message(frame, { type: 'ui.notify', message: '' }); await message(frame, { type: 'ui.notify', message: { unexpected: true } }); await message(frame, { type: 'not-a-supported-method' })
    expect(feedback.info).toHaveBeenCalledTimes(1); expect(actions()).toEqual([])
  })
})
