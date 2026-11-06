/** Actual keys/groups/usage API wire plus native row and real dialog workflows.
 * TablePageLayout/DataTable expose production slots as a small presentation adapter;
 * clipboard and external protocol launch are synthetic browser capabilities.
 */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import KeysView from '../KeysView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { ApiKey, Group } from '@/types'

const fixture = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), copy: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: fixture.error, showSuccess: fixture.success }) }))
vi.mock('@/stores/onboarding', () => ({ useOnboardingStore: () => ({ isCurrentStep: () => false, nextStep: vi.fn() }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: fixture.copy }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }) }))
const layout = defineComponent({ template: '<section><slot name="overview"/><slot name="filters"/><slot name="actions"/><slot name="table"/><slot name="pagination"/></section>' })
const table = defineComponent({ props: ['data', 'columns'], template: `<table><tbody><tr v-for="row in data" :key="row.id" :data-key="row.id"><td v-for="column in columns" :key="column.key" :data-column="column.key"><slot :name="'cell-'+column.key" :row="row" :value="row[column.key]"/></td></tr></tbody></table>` })
let view: VueWrapper | undefined
let rows: ApiKey[]
let groups: Group[]
let settings: Record<string, unknown>
let requests: { path: string; method: string; body: Record<string, unknown>; params: Record<string, unknown> }[]
let refusal: { path: string; method?: string } | undefined
let putGate: { promise: Promise<void>; resolve: () => void } | undefined
const oldAdapter = apiClient.defaults.adapter
const now = new Date('2026-11-06T04:00:00Z')
function key(id: number, patch: Partial<ApiKey> = {}): ApiKey { return { id, user_id: 209, name: `Synthetic key ${id}`, key: `SYNTHETIC-RELEASE-ONLY-${id}`, group_id: 11, group: groups[0], status: 'active', ip_whitelist: [], ip_blacklist: [], quota: 100, quota_used: 25, expires_at: null, rate_limit_5h: 100, rate_limit_1d: 100, rate_limit_7d: 100, usage_5h: 25, usage_1d: 25, usage_7d: 25, reset_5h_at: null, reset_1d_at: null, reset_7d_at: null, window_5h_start: null, window_1d_start: null, window_7d_start: null, current_concurrency: 0, last_used_at: null, last_used_ip: null, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch } as ApiKey }
function reply(config: InternalAxiosRequestConfig, value: unknown) { return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: value } } }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-release-keys-209', user: { id: 209 } }); fixture.error.mockReset(); fixture.success.mockReset(); fixture.copy.mockReset().mockResolvedValue(true)
  localStorage.setItem('api-key-hidden-columns', '[]'); localStorage.setItem('api-key-column-settings-version', '3')
  groups = [{ id: 11, name: 'Synthetic Claude', description: 'Primary text group', platform: 'anthropic', subscription_type: 'standard', rate_multiplier: 1 }, { id: 22, name: 'Synthetic OpenAI', description: 'Code collaboration', platform: 'openai', subscription_type: 'subscription', rate_multiplier: 2 }, { id: 33, name: 'Synthetic Gemini', description: null, platform: 'gemini', subscription_type: 'standard', rate_multiplier: 1 }] as Group[]
  rows = [key(1), key(2, { quota: 0, quota_used: 0, rate_limit_5h: 0, rate_limit_1d: 0, rate_limit_7d: 0, usage_5h: 0, usage_1d: 0, usage_7d: 0, group: undefined, group_id: null, status: 'inactive' })]
  settings = { hide_ccs_import_button: false, api_base_url: 'https://gateway.example.test/', site_name: 'Synthetic gateway', custom_endpoints: [] }; requests = []; refusal = undefined; putGate = undefined
  vi.spyOn(window, 'open').mockReturnValue(null); vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); const method = String(config.method); const body = config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}; requests.push({ path, method, body, params: config.params || {} })
    if (method === 'put' && putGate) await putGate.promise
    if (path === refusal?.path && (!refusal.method || refusal.method === method)) throw new AxiosError('Synthetic key refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic key operation refused' } })
    if (path === '/keys' && method === 'get') return reply(config, { items: rows, total: rows.length, page: 1, pages: 1, page_size: 20 })
    if (path === '/groups/available') return reply(config, groups)
    if (path === '/groups/rates') return reply(config, { 11: 1.2 })
    if (path === '/settings/public') return reply(config, settings)
    if (path === '/usage/dashboard/api-keys-usage') return reply(config, { stats: { 1: { today_actual_cost: .0123, total_actual_cost: 1.2345 } } })
    if (/^\/keys\/\d+$/.test(path)) {
      const id = Number(path.split('/').at(-1)); const current = rows.find(row => row.id === id)!
      if (method === 'delete') { rows = rows.filter(row => row.id !== id); return reply(config, { message: 'Synthetic deleted' }) }
      if (method === 'put') { if (body.reset_quota) Object.assign(current, { quota_used: 0, status: 'active' }); else if (body.reset_rate_limit_usage) Object.assign(current, { usage_5h: 0, usage_1d: 0, usage_7d: 0 }); else Object.assign(current, body, 'group_id' in body ? { group: groups.find(group => group.id === body.group_id) ?? null } : {}); return reply(config, current) }
    }
    throw new Error(`Unexpected synthetic keys endpoint ${method} ${path}`)
  }
})
afterEach(async () => { view?.unmount(); view = undefined; putGate?.resolve(); await flushPromises(); apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
async function render() { view = mount(KeysView, { attachTo: document.body, global: { stubs: { AppLayout: { template: '<main><slot/></main>' }, TablePageLayout: layout, DataTable: table, BulkEditKeysModal: true } } }); await flushPromises(); return view }
function action(text: string, scope: Pick<DOMWrapper<Element>, 'findAll'> = view!) { const button = scope.findAll('button').find(node => node.text() === text || node.text().startsWith(text + ' ')); expect(button, text).toBeDefined(); return button! }
function row(id = 1) { return view!.get(`[data-key="${id}"]`) }
function dialog(title: string) { const node = new DOMWrapper(document.body).findAll('[role="dialog"]').find(node => node.find('.modal-title').exists() && node.get('.modal-title').text() === title); expect(node, title).toBeDefined(); return node! }
async function edit(id = 1) { await action('common.edit', row(id)).trigger('click'); await flushPromises(); return dialog('keys.editKey') }
async function groupMenu(id = 1) { await row(id).get('button[title="keys.clickToChangeGroup"]').trigger('click'); await flushPromises(); return new DOMWrapper(document.body).get('[role="dialog"][aria-label="keys.groupLabel"]') }
async function groupOption(menu: Pick<DOMWrapper<Element>, 'findAll'>, label: string) { const option = menu.findAll('button').find(node => node.text().includes(label)); expect(option, label).toBeDefined(); await option!.trigger('click'); await flushPromises() }
const puts = () => requests.filter(row => row.method === 'put')

describe('member key release contracts', () => {
  it.each([[20, 'bg-primary-500', 'bg-green-500'], [85, 'bg-yellow-500', 'bg-yellow-500'], [120, 'bg-red-500', 'bg-red-500']] as const)('renders %s percent quota/window usage with bounded progress and the actual per-key costs', async (used, quotaColor, rateColor) => {
    rows[0] = key(1, { quota_used: used, usage_5h: used, usage_1d: used, usage_7d: used, ip_whitelist: ['192.0.2.0/24'], current_concurrency: 3, last_used_ip: '192.0.2.1', last_used_at: '2026-11-06T02:00:00Z', expires_at: '2026-11-05T00:00:00Z' }); await render()
    expect(requests.find(row => row.path === '/usage/dashboard/api-keys-usage')!.body).toEqual({ api_key_ids: [1, 2] }); const usage = row().get('[data-column="usage"]'); expect(usage.text()).toContain('$0.0123'); expect(usage.text()).toContain('$1.2345'); expect(usage.get(`.${quotaColor}`).attributes('style')).toContain(`width: ${Math.min(used, 100)}%`)
    const rate = row().get('[data-column="rate_limit"]'); expect(rate.findAll(`div.h-full.${rateColor === 'bg-green-500' ? 'bg-emerald-500' : rateColor}`)).toHaveLength(3); const editor = await edit(); expect(editor.text()).toContain(`$${used.toFixed(4)}`); expect(editor.findAll(`div.h-full.${rateColor}`)).toHaveLength(3); expect(row().get('[data-column="last_used_ip"]').text()).toBe('192.0.2.1'); expect(row().find('[data-column="expires_at"] .text-red-500').exists()).toBe(true)
  })
  it.each([['2026-11-06T03:59:00Z', 'keys.resetNow'], ['2026-11-08T06:00:00Z', '2d 2h'], ['2026-11-06T06:15:00Z', '2h 15m'], ['2026-11-06T04:20:00Z', '20m']] as const)('renders actual reset %s as %s and keeps absent limits unadorned', async (reset, label) => {
    rows[0] = key(1, { reset_5h_at: reset, reset_1d_at: reset, reset_7d_at: reset }); await render(); expect(row().get('[data-column="rate_limit"]').text()).toContain(label); expect(row(2).get('[data-column="rate_limit"]').text()).toBe('-'); expect(row(2).text()).toContain('keys.noGroup'); expect(row(2).text()).toContain('keys.noExpiration')
  })
  it('filters real group options by description, reports no matches and avoids a write for the current group', async () => {
    await render(); let menu = await groupMenu(); await menu.get('input').setValue('code collaboration'); expect(menu.text()).toContain('Synthetic OpenAI'); expect(menu.text()).not.toContain('Synthetic Claude'); await menu.get('input').setValue('unmatched-value'); expect(menu.text()).toContain('keys.noGroupFound'); await menu.get('input').setValue(''); await groupOption(menu, 'Synthetic Claude'); expect(puts()).toHaveLength(0); expect(row().get('button[title="keys.clickToChangeGroup"]').attributes('aria-expanded')).toBe('false')
    menu = await groupMenu(); await menu.trigger('keydown', { key: 'Escape' }); expect(row().get('button[title="keys.clickToChangeGroup"]').element).toBe(document.activeElement)
  })
  it('places a group menu above a low trigger within a narrow viewport and closes it from an outside click', async () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 400); await render(); const trigger = row().get('button[title="keys.clickToChangeGroup"]'); vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({ top: 340, bottom: 380, left: 300, right: 320, width: 20, height: 40, x: 300, y: 340, toJSON: () => ({}) })
    const menu = await groupMenu(); expect(menu.attributes('style')).toContain('bottom: 64px'); expect(menu.attributes('style')).toContain('left: 8px'); document.body.click(); await flushPromises(); expect(new DOMWrapper(document.body).find('[role="dialog"][aria-label="keys.groupLabel"]').exists()).toBe(false)
  })
  it('locks one group mutation until it fails, then retries the same public choice against the actual endpoint', async () => {
    await render(); putGate = deferred(); refusal = { path: '/keys/1', method: 'put' }; const menu = await groupMenu(); await groupOption(menu, 'Synthetic OpenAI'); expect(puts()).toHaveLength(1); expect(puts()[0].body).toEqual({ group_id: 22 }); expect(row().get('button[title="keys.clickToChangeGroup"]').attributes('disabled')).toBeDefined(); putGate.resolve(); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('keys.failedToChangeGroup'); refusal = undefined; putGate = undefined; await groupOption(await groupMenu(), 'Synthetic OpenAI'); expect(puts()).toHaveLength(2); expect(fixture.success).toHaveBeenCalledWith('keys.groupChangedSuccess'); expect(row().get('[data-column="group"]').text()).toContain('Synthetic OpenAI')
  })
  it('dismisses a group selector when a refreshed list no longer contains its key', async () => {
    await render(); await groupMenu(); rows = [rows[1]]; await view!.get('button[aria-label="common.refresh"]').trigger('click'); await flushPromises(); expect(new DOMWrapper(document.body).find('[role="dialog"][aria-label="keys.groupLabel"]').exists()).toBe(false)
  })
  it.each(['inactive', 'expired', 'quota_exhausted'] as const)('explicitly enables a %s key and sends the normal active status wire', async status => {
    rows[0].status = status; await render(); await action('keys.enable', row()).trigger('click'); await flushPromises(); expect(puts()[0]).toMatchObject({ path: '/keys/1', body: { status: 'active' } }); expect(row().get('[data-column="status"]').text()).toBe('keys.status.active'); expect(fixture.success).toHaveBeenCalledWith('keys.keyEnabledSuccess')
  })
  it.each(['quota', 'rate'] as const)('keeps the editor and reset action retryable after an actual %s reset refusal', async kind => {
    await render(); const editor = await edit(); refusal = { path: '/keys/1', method: 'put' }; const open = async () => { if (kind === 'quota') await editor.get('button[title="keys.resetQuotaUsed"]').trigger('click'); else await action('keys.resetRateLimitUsage', editor).trigger('click'); await flushPromises(); const confirm = dialog(kind === 'quota' ? 'keys.resetQuotaTitle' : 'keys.resetRateLimitTitle'); await action('keys.reset', confirm).trigger('click'); await flushPromises() }
    await open(); expect(fixture.error).toHaveBeenCalledWith(kind === 'quota' ? 'keys.failedToResetQuota' : 'keys.failedToResetRateLimit'); expect(editor.find('form').exists()).toBe(true); refusal = undefined; await open(); expect(puts().at(-1)!.body).toEqual(kind === 'quota' ? { reset_quota: true } : { reset_rate_limit_usage: true }); expect(fixture.success).toHaveBeenCalledWith(kind === 'quota' ? 'keys.quotaResetSuccess' : 'keys.rateLimitResetSuccess'); expect(editor.text()).toContain('$0.0000')
  })
  it('recovers an initial list refusal with Refresh and retains actual API error text for a rejected delete', async () => {
    refusal = { path: '/keys', method: 'get' }; await render(); expect(fixture.error).toHaveBeenCalledWith('keys.failedToLoad'); refusal = undefined; await view!.get('button[aria-label="common.refresh"]').trigger('click'); await flushPromises(); expect(view!.find('[data-key="1"]').exists()).toBe(true); await action('common.delete', row()).trigger('click'); await flushPromises(); refusal = { path: '/keys/1', method: 'delete' }; await action('common.delete', dialog('keys.deleteKey')).trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('Synthetic key operation refused'); expect(view!.find('[data-key="1"]').exists()).toBe(true); refusal = undefined; await action('common.delete', dialog('keys.deleteKey')).trigger('click'); await flushPromises(); expect(view!.find('[data-key="1"]').exists()).toBe(false)
  })
  it.each([
    ['anthropic', 'claude', 'https://gateway.example.test/', null], ['openai', 'codex', 'https://gateway.example.test', 'gpt-5.5'], ['gemini', 'gemini', 'https://gateway.example.test/', null], ['grok', 'grokbuild', 'https://gateway.example.test/v1', 'grok-4.5'], ['antigravity', 'claude', 'https://gateway.example.test/antigravity', null], ['antigravity', 'gemini', 'https://gateway.example.test/antigravity', null],
  ] as const)('launches only the selected %s / %s synthetic CC Switch configuration', async (platform, app, endpoint, model) => {
    rows[0].group = { ...groups[0], platform }; await render(); await action('keys.importToCcSwitch', row()).trigger('click'); await flushPromises(); if (platform === 'antigravity') { const choose = dialog('keys.ccsClientSelect.title'); const label = app === 'claude' ? 'keys.ccsClientSelect.claudeCode' : 'keys.ccsClientSelect.geminiCli'; const option = choose.findAll('button').find(button => button.findAll('span').some(span => span.text() === label))!; expect(option).toBeDefined(); await option.trigger('click') }
    expect(window.open).toHaveBeenCalledOnce(); const url = new URL(String(vi.mocked(window.open).mock.calls[0][0])); expect(url.protocol).toBe('ccswitch:'); expect(url.searchParams.get('app')).toBe(app); expect(url.searchParams.get('endpoint')).toBe(endpoint); expect(url.searchParams.get('model')).toBe(model); expect(url.searchParams.get('apiKey')).toBe('SYNTHETIC-RELEASE-ONLY-1'); expect(url.searchParams.get('name')).toBe('Synthetic gateway'); expect(atob(url.searchParams.get('usageScript')!)).toContain('/v1/usage'); await vi.advanceTimersByTimeAsync(150); expect(fixture.error).not.toHaveBeenCalled()
  })
  it.each(['focus', 'throw'] as const)('shows the configured CC Switch fallback when protocol launch fails by %s', async failure => {
    if (failure === 'focus') vi.mocked(document.hasFocus).mockReturnValue(true); else vi.mocked(window.open).mockImplementation(() => { throw new Error('Synthetic protocol unavailable') }); settings.api_base_url = ''; settings.site_name = ' '; rows[0].group = undefined; await render(); await action('keys.importToCcSwitch', row()).trigger('click'); await vi.advanceTimersByTimeAsync(150); expect(fixture.error).toHaveBeenCalledWith('keys.ccSwitchNotInstalled')
  })
  it('cancels Antigravity client selection and honors the hidden import flag', async () => {
    rows[0].group = { ...groups[0], platform: 'antigravity' }; await render(); await action('keys.importToCcSwitch', row()).trigger('click'); await action('common.cancel', dialog('keys.ccsClientSelect.title')).trigger('click'); expect(window.open).not.toHaveBeenCalled(); view!.unmount(); view = undefined; settings.hide_ccs_import_button = true; await render(); expect(row().text()).not.toContain('keys.importToCcSwitch')
  })
  it('copies custom endpoint text from the keyboard, exposes its safe test link and resets the copied hint', async () => {
    settings.custom_endpoints = [{ name: 'Synthetic secondary', endpoint: 'https://secondary.example.test/v1', description: 'Synthetic region' }]; await render(); const code = view!.findAll('code[role="button"]').find(node => node.text() === 'https://secondary.example.test/v1')!; expect(code).toBeDefined(); await code.trigger('keydown', { key: 'Enter' }); await flushPromises(); expect(fixture.copy).toHaveBeenCalledWith('https://secondary.example.test/v1', 'keys.endpoints.copied'); expect(view!.text()).toContain('keys.endpoints.copiedHint'); expect(view!.findAll('a').some(link => link.attributes('href') === 'https://www.tcptest.cn/http/https%3A%2F%2Fsecondary.example.test%2Fv1')).toBe(true); await vi.advanceTimersByTimeAsync(1800); expect(view!.text()).not.toContain('keys.endpoints.copiedHint')
  })
  it('does not claim a copied endpoint after clipboard refusal, then copies another endpoint explicitly', async () => {
    fixture.copy.mockResolvedValueOnce(false); await render(); const code = view!.get('code[role="button"]'); await code.trigger('keydown', { key: ' ' }); await flushPromises(); expect(view!.text()).not.toContain('keys.endpoints.copiedHint'); await code.trigger('click'); await flushPromises(); expect(view!.text()).toContain('keys.endpoints.copiedHint')
  })
  it('migrates saved version-one column choices without reviving new hidden fields and closes the menu outside', async () => {
    localStorage.setItem('api-key-hidden-columns', JSON.stringify(['name', 'usage', 'unsupported', 42])); localStorage.setItem('api-key-column-settings-version', '1'); await render(); expect(row().find('[data-column="name"]').exists()).toBe(true); expect(row().find('[data-column="usage"]').exists()).toBe(false); expect(row().find('[data-column="id"]').exists()).toBe(false); expect(localStorage.getItem('api-key-column-settings-version')).toBe('3'); await view!.get('button[title="keys.columnSettings"]').trigger('click'); await action('keys.usage').trigger('click'); expect(row().find('[data-column="usage"]').exists()).toBe(true); document.body.click(); await flushPromises(); expect(view!.findAll('button').some(node => node.text() === 'keys.usage')).toBe(false)
  })
  it('shows a group-less connection warning, then the chosen OpenAI key in its actual client instructions', async () => {
    await render(); await action('keys.useKey', row(2)).trigger('click'); await flushPromises(); const empty = dialog('keys.useKeyModal.title'); expect(empty.text()).toContain('keys.useKeyModal.noGroupTitle'); await empty.get('button[aria-label="Close modal"]').trigger('click'); await flushPromises(); rows[0].group = groups[1]; await view!.get('button[aria-label="common.refresh"]').trigger('click'); await flushPromises(); await action('keys.useKey', row()).trigger('click'); await flushPromises(); const modal = dialog('keys.useKeyModal.title'); expect(modal.text()).toContain('SYNTHETIC-RELEASE-ONLY-1'); await modal.get('[data-testid="codex-auth-mode-api-key"]').trigger('click'); expect(modal.find('[data-testid="codex-api-key-restart-notice"]').exists()).toBe(true); await modal.get('select[data-testid="codex-model-catalog-mode"]').setValue('file'); expect(modal.text()).toContain('codex-models.json')
  })
})
