// @vitest-environment-options {"url":"https://setup.example.test"}
/** Native setup steps using actual setup API/Axios with an isolated synthetic adapter. */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import SetupWizardView from '../SetupWizardView.vue'

const fixture = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios')
  return { ...actual, default: new Proxy(actual.default, { get(target, key, receiver) { if (key === 'create') return (config?: import('axios').CreateAxiosDefaults) => target.create({ ...config, adapter: config => fixture.transport(config) }); return Reflect.get(target, key, receiver) } }) }
})
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
let view: VueWrapper | undefined
let requests: { path: string; body: Record<string, unknown> }[]
let refusal: { path: string; data: Record<string, unknown>; message: string } | undefined
let pending: { path: string; promise: Promise<void>; resolve: () => void } | undefined
let statuses: ('network' | 'http' | 'missing' | 'setup' | 'ready')[]
const dbPath = '/setup/test-db'; const redisPath = '/setup/test-redis'; const installPath = '/setup/install'
function deferred(path: string) { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { path, promise, resolve } }
beforeEach(() => {
  vi.useFakeTimers(); requests = []; refusal = undefined; pending = undefined; statuses = ['setup']; localStorage.clear()
  fixture.transport.mockReset().mockImplementation(async (config: InternalAxiosRequestConfig) => {
    const path = String(config.url); requests.push({ path, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }); if (![dbPath, redisPath, installPath].includes(path)) throw new Error(`Unexpected synthetic setup endpoint ${path}`)
    if (pending?.path === path) await pending.promise
    if (refusal?.path === path) throw new AxiosError(refusal.message, 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: refusal.data })
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { message: 'Synthetic setup accepted', restart: true } } }
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url, window.location.href).pathname).toBe('/setup/status'); expect(init).toEqual({ method: 'GET', cache: 'no-store' }); const state = statuses.length > 1 ? statuses.shift() : statuses[0]
    if (state === 'network') throw new Error('Synthetic service restarting'); if (state === 'http') return new Response('', { status: 503 }); return new Response(JSON.stringify(state === 'missing' ? {} : { data: { needs_setup: state !== 'ready' } }), { status: 200 })
  }))
})
afterEach(async () => { view?.unmount(); view = undefined; pending?.resolve(); await flushPromises(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
async function render() { view = mount(SetupWizardView, { attachTo: document.body }); await flushPromises(); return view }
function action(text: string) { const button = view!.findAll('button').find(node => node.text() === text); expect(button, text).toBeDefined(); return button! }
function input(labelText: string) { const label = view!.findAll('label').find(label => label.text() === labelText); expect(label, labelText).toBeDefined(); const control = label!.element.parentElement!.querySelector('input')!; expect(control).not.toBeNull(); return new DOMWrapper(control) }
async function next() { await action('common.next').trigger('click'); await flushPromises() }
async function database() { await action('setup.status.testConnection').trigger('click'); await flushPromises(); await next() }
async function redis() { await action('setup.status.testConnection').trigger('click'); await flushPromises(); await next() }
async function admin() { await input('setup.admin.email').setValue('admin@example.test'); await input('setup.admin.password').setValue('synthetic-admin-password'); await input('setup.admin.confirmPassword').setValue('synthetic-admin-password'); await next() }

describe('setup wizard release workflows', () => {
  it('keeps step progression gated by an actual connection test, locks one pending test and preserves defaults', async () => {
    await render(); expect(action('common.next').attributes('disabled')).toBeDefined(); pending = deferred(dbPath); await action('setup.status.testConnection').trigger('click'); await flushPromises(); expect(action('setup.status.testing').attributes('disabled')).toBeDefined(); expect(requests).toHaveLength(1); expect(requests[0]).toEqual({ path: dbPath, body: { host: 'localhost', port: 5432, user: 'postgres', password: '', dbname: 'sub2api', sslmode: 'disable' } }); pending.resolve(); await flushPromises(); expect(action('common.next').attributes('disabled')).toBeUndefined(); await next(); expect(view!.text()).toContain('setup.redis.title')
  })
  it.each(['disable', 'require', 'verify-ca', 'verify-full'] as const)('submits edited database settings with numeric port and %s SSL using the real selector', async sslmode => {
    await render(); await input('setup.database.host').setValue('synthetic-db.example.test'); await input('setup.database.port').setValue('15432'); await input('setup.database.username').setValue('synthetic_admin'); await input('setup.database.password').setValue('synthetic-db-password'); await input('setup.database.databaseName').setValue('synthetic_gateway'); await view!.get('.select-trigger').trigger('click'); await flushPromises(); const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent?.includes('setup.database.ssl.' + ({ disable: 'disable', require: 'require', 'verify-ca': 'verifyCa', 'verify-full': 'verifyFull' }[sslmode])))!; expect(option).toBeDefined(); option.click(); await flushPromises(); await action('setup.status.testConnection').trigger('click'); await flushPromises(); expect(requests[0].body).toEqual({ host: 'synthetic-db.example.test', port: 15432, user: 'synthetic_admin', password: 'synthetic-db-password', dbname: 'synthetic_gateway', sslmode })
  })
  it.each([{ data: { detail: 'Synthetic database detail' }, message: '', expected: 'Synthetic database detail' }, { data: { message: 'Synthetic database message' }, message: '', expected: 'Synthetic database message' }, { data: {}, message: 'Synthetic database offline', expected: 'Synthetic database offline' }, { data: {}, message: '', expected: 'Connection failed' }])('shows a database refusal and recovers the same visible draft on explicit retry (%j)', async sample => {
    refusal = { path: dbPath, ...sample }; await render(); await input('setup.database.host').setValue('synthetic-db.example.test'); await action('setup.status.testConnection').trigger('click'); await flushPromises(); expect(view!.text()).toContain(sample.expected); expect(action('common.next').attributes('disabled')).toBeDefined(); refusal = undefined; await action('setup.status.testConnection').trigger('click'); await flushPromises(); expect(requests.at(-1)!.body.host).toBe('synthetic-db.example.test'); expect(action('common.next').attributes('disabled')).toBeUndefined()
  })
  it('submits Redis ACL, database number and TLS through its real controls and blocks progression after failure', async () => {
    await render(); await database(); await input('setup.redis.host').setValue('synthetic-cache.example.test'); await input('setup.redis.port').setValue('16379'); await input('setup.redis.username').setValue('synthetic_acl'); await input('setup.redis.password').setValue('synthetic-redis-password'); await input('setup.redis.database').setValue('4'); await view!.get('button[role="switch"]').trigger('click'); refusal = { path: redisPath, data: { detail: 'Synthetic Redis refusal' }, message: '' }; await action('setup.status.testConnection').trigger('click'); await flushPromises(); expect(view!.text()).toContain('Synthetic Redis refusal'); expect(action('common.next').attributes('disabled')).toBeDefined(); expect(requests.at(-1)!.body).toEqual({ host: 'synthetic-cache.example.test', port: 16379, username: 'synthetic_acl', password: 'synthetic-redis-password', db: 4, enable_tls: true }); refusal = undefined; await action('setup.status.testConnection').trigger('click'); await flushPromises(); await next(); expect(view!.text()).toContain('setup.admin.title')
  })
  it('validates admin length and confirmation, preserves review drafts on Back and sends one complete installation JSON', async () => {
    await render(); await database(); await redis(); expect(action('common.next').attributes('disabled')).toBeDefined(); await input('setup.admin.email').setValue('admin@example.test'); await input('setup.admin.password').setValue('short'); await input('setup.admin.confirmPassword').setValue('short'); expect(action('common.next').attributes('disabled')).toBeDefined(); await input('setup.admin.password').setValue('synthetic-admin-password'); expect(view!.text()).toContain('setup.admin.passwordMismatch'); await input('setup.admin.confirmPassword').setValue('synthetic-admin-password'); await next(); expect(view!.text()).toContain('admin@example.test'); await action('common.back').trigger('click'); expect(input('setup.admin.password').element).toHaveProperty('value', 'synthetic-admin-password'); await next(); pending = deferred(installPath); await action('setup.status.completeInstallation').trigger('click'); await flushPromises(); expect(action('setup.status.installing').attributes('disabled')).toBeDefined(); expect(requests.filter(request => request.path === installPath)).toHaveLength(1); expect(requests.at(-1)!.body).toEqual({ database: { host: 'localhost', port: 5432, user: 'postgres', password: '', dbname: 'sub2api', sslmode: 'disable' }, redis: { host: 'localhost', port: 6379, username: '', password: '', db: 0, enable_tls: false }, admin: { email: 'admin@example.test', password: 'synthetic-admin-password' }, server: { host: '0.0.0.0', port: 443, mode: 'release' } }); pending.resolve(); await flushPromises(); expect(view!.text()).toContain('setup.status.restarting')
  })
  it.each([{ detail: 'Synthetic installation detail' }, { message: 'Synthetic installation message' }])('keeps the review screen retryable after an installation refusal (%j)', async data => {
    await render(); await database(); await redis(); await admin(); refusal = { path: installPath, data, message: '' }; await action('setup.status.completeInstallation').trigger('click'); await flushPromises(); expect(view!.text()).toContain(Object.values(data)[0]); expect(action('setup.status.completeInstallation').attributes('disabled')).toBeUndefined(); refusal = undefined; await action('setup.status.completeInstallation').trigger('click'); await flushPromises(); expect(requests.filter(request => request.path === installPath)).toHaveLength(2); expect(view!.text()).toContain('setup.status.completed')
  })
  it('waits through restart network/HTTP/incomplete/setup responses until the real readiness DTO permits login', async () => {
    statuses = ['network', 'http', 'missing', 'setup', 'ready']; await render(); await database(); await redis(); await admin(); await action('setup.status.completeInstallation').trigger('click'); await flushPromises(); await vi.advanceTimersByTimeAsync(7000); await flushPromises(); expect(fetch).toHaveBeenCalledTimes(5); expect(view!.text()).toContain('setup.status.redirecting'); expect(view!.text()).not.toContain('setup.status.timeout')
  })
  it('stops readiness polling after its documented attempt budget and reports timeout without a false redirect', async () => {
    statuses = ['setup']; await render(); await database(); await redis(); await admin(); await action('setup.status.completeInstallation').trigger('click'); await flushPromises(); await vi.advanceTimersByTimeAsync(63000); await flushPromises(); expect(fetch).toHaveBeenCalledTimes(60); expect(view!.text()).toContain('setup.status.timeout'); expect(view!.text()).not.toContain('setup.status.redirecting')
  })
})
