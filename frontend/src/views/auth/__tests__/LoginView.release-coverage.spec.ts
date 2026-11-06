/** Real auth store/API and public consent/OTP with synthetic CAPTCHA/WebAuthn. */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import LoginView from '../LoginView.vue'
import { apiClient } from '@/api/client'
import { clearStoredAuthSession } from '@/api/authSession'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings } from '@/types'

const fixture = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), proof: vi.fn(), reset: vi.fn(), credential: vi.fn(), admin: false, language: 'en' }))
vi.mock('@/stores', async () => ({ useAuthStore: (await vi.importActual<typeof import('@/stores/auth')>('@/stores/auth')).useAuthStore, useAppStore: () => ({ showError: fixture.error, showSuccess: fixture.success, showWarning: fixture.warning }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref(fixture.language), t: (key: string, values?: Record<string, unknown>) => key + (values && Object.keys(values).length ? ':' + Object.values(values).join(',') : '') }) }))
const captcha = defineComponent({ emits: ['verify', 'expire', 'error'], setup(_, { expose, emit }) { expose({ verifyAction: fixture.proof, reset: fixture.reset }); return { emit } }, template: `<section><button type="button" @click="emit('verify','synthetic-captcha','synthetic-rand')">Captcha verify</button><button type="button" @click="emit('expire')">Captcha expire</button><button type="button" @click="emit('error')">Captcha error</button></section>` })
class SyntheticCredential { id = 'synthetic-passkey'; rawId = new Uint8Array([1, 2]).buffer; type = 'public-key'; authenticatorAttachment = 'platform'; response = { authenticatorData: new Uint8Array([3]).buffer, clientDataJSON: new Uint8Array([4]).buffer, signature: new Uint8Array([5]).buffer, userHandle: null }; getClientExtensionResults() { return {} } }
let view: VueWrapper | undefined
let pinia: Pinia
let router: Router
let settings: Partial<PublicSettings>
let loginReply: Record<string, unknown> | undefined
let refusal: string | undefined
let requests: { path: string; body: Record<string, unknown> }[]
const oldAdapter = apiClient.defaults.adapter
const credentialDescriptor = Object.getOwnPropertyDescriptor(navigator, 'credentials')
function reply(config: InternalAxiosRequestConfig, value: unknown) { return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: value } } }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); clearStoredAuthSession(); fixture.admin = false; fixture.language = 'en'; for (const fn of [fixture.error, fixture.success, fixture.warning, fixture.proof, fixture.reset, fixture.credential]) fn.mockReset()
  fixture.proof.mockResolvedValue({ token: 'synthetic-action-proof', randstr: 'synthetic-action-rand' }); fixture.credential.mockResolvedValue(new SyntheticCredential()); vi.stubGlobal('PublicKeyCredential', SyntheticCredential); Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: fixture.credential } }); pinia = createPinia()
  settings = { registration_enabled: true, turnstile_enabled: false, password_reset_enabled: true, passkey_enabled: false, linuxdo_oauth_enabled: false, wechat_oauth_enabled: false, dingtalk_oauth_enabled: false, oidc_oauth_enabled: false, github_oauth_enabled: false, google_oauth_enabled: false }; loginReply = undefined; refusal = undefined; requests = []
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); requests.push({ path, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} })
    if (path === refusal) throw new AxiosError('Synthetic login refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic credentials refused' } })
    if (path === '/settings/public') return reply(config, settings)
    if (path === '/auth/passkey/login/begin') return reply(config, { session_token: 'synthetic-webauthn-session', options: { publicKey: { challenge: 'dGVzdA', rpId: 'localhost', allowCredentials: [] } } })
    if (path === '/auth/login' && loginReply) return reply(config, loginReply)
    if (path.startsWith('/auth/oauth/')) throw new AxiosError('Synthetic OAuth refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic OAuth start refused' } })
    if (['/auth/login', '/auth/login/2fa', '/auth/passkey/login/finish'].includes(path)) return reply(config, { access_token: 'synthetic-login-access-211', user: { id: 211, email: 'member@example.test', role: fixture.admin ? 'admin' : 'user', status: 'active', balance: 0, concurrency: 1 } })
    throw new Error(`Unexpected synthetic login endpoint ${path}`)
  }
})
afterEach(async () => { view?.unmount(); view = undefined; await flushPromises(); disposePinia(pinia); apiClient.defaults.adapter = oldAdapter; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (credentialDescriptor) Object.defineProperty(navigator, 'credentials', credentialDescriptor); else Reflect.deleteProperty(navigator, 'credentials'); document.body.innerHTML = '' })
async function render(query: LocationQueryRaw = {}) { router = createRouter({ history: createMemoryHistory(), routes: ['/login','/dashboard','/admin/dashboard','/keys','/forgot-password','/register','/legal/:documentId'].map(path => ({ path, name: path === '/legal/:documentId' ? 'LegalDocument' : undefined, component: { template: '<div/>' } })) }); await router.push({ path: '/login', query }); await router.isReady(); view = mount(LoginView, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { ZhijingLoginLayout: { template: '<main><slot/></main>' }, TurnstileWidget: captcha } } }); await flushPromises(); return view }
function action(text: string, scope: Pick<DOMWrapper<Element>, 'findAll'> = view!) { const node = scope.findAll('button').find(node => node.text() === text); expect(node, text).toBeDefined(); return node! }
async function submit() { await view!.get('#email').setValue('member@example.test'); await view!.get('#password').setValue('synthetic-password'); await view!.get('form').trigger('submit'); await flushPromises() }
const calls = (path: string) => requests.filter(request => request.path === path)

describe('login release workflows', () => {
  it.each(['https://elsewhere.example.test','//elsewhere.example.test','/bad\\path','/bad://path','/login','/login?next=x','/login/restart'])('finishes a real login while rejecting unsafe/self-referential redirect %s', async redirect => {
    await render({ redirect }); await submit(); expect(calls('/auth/login')).toHaveLength(1); expect(useAuthStore(pinia).user?.id).toBe(211); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it('uses the first safe redirect in a repeated query and the admin default without a redirect', async () => {
    await render({ redirect: ['/keys', '/admin/dashboard'] }); await submit(); expect(router.currentRoute.value.path).toBe('/keys'); view!.unmount(); view = undefined; disposePinia(pinia); pinia = createPinia(); clearStoredAuthSession(); fixture.admin = true; await render(); await submit(); expect(router.currentRoute.value.path).toBe('/admin/dashboard')
  })
  it('announces an expired session once and toggles the named password control in Chinese', async () => {
    fixture.language = 'zh'; sessionStorage.setItem('auth_expired', '1'); await render(); expect(fixture.warning).toHaveBeenCalledWith('auth.reloginRequired'); expect(sessionStorage.getItem('auth_expired')).toBeNull(); await view!.get('button[aria-label="显示密码"]').trigger('click'); expect(view!.get('#password').attributes('type')).toBe('text'); await view!.get('button[aria-label="隐藏密码"]').trigger('click'); expect(view!.get('#password').attributes('type')).toBe('password')
  })
  it('retains credentials after a server refusal and succeeds after explicit retry', async () => {
    refusal = '/auth/login'; await render(); await submit(); expect(fixture.error).toHaveBeenCalledWith('Synthetic credentials refused'); expect(view!.get<HTMLInputElement>('#password').element.value).toBe('synthetic-password'); refusal = undefined; await view!.get('form').trigger('submit'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it.each(['checkbox','modal'] as const)('gates password login behind a real %s agreement and persists explicit acceptance', async mode => {
    Object.assign(settings, { login_agreement_enabled: true, login_agreement_mode: mode, login_agreement_revision: 'synthetic-login-consent', login_agreement_documents: [{ id: 'terms', title: 'Synthetic terms', content_md: '# Synthetic' }] }); localStorage.setItem('sub2api_login_agreement_consent', 'bad-json'); await render(); expect(view!.get('#email').attributes('disabled')).toBeDefined(); if (mode === 'checkbox') await view!.get('#login-agreement-consent').setValue(true); else await action('legal.loginAgreementPrompt.accept', new DOMWrapper(document.body)).trigger('click'); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); await submit(); expect(calls('/auth/login')).toHaveLength(1); expect(JSON.parse(localStorage.getItem('sub2api_login_agreement_consent')!).revision).toBe('synthetic-login-consent')
  })
  it('honors only current saved consent and disables credentials after rejection', async () => {
    Object.assign(settings, { login_agreement_enabled: true, login_agreement_mode: 'checkbox', login_agreement_revision: 'synthetic-login-consent', login_agreement_documents: [{ id: 'terms', title: 'Synthetic terms', content_md: '' }] }); localStorage.setItem('sub2api_login_agreement_consent', JSON.stringify({ revision: 'synthetic-login-consent' })); await render(); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); await view!.get('#login-agreement-consent').setValue(false); expect(fixture.warning).toHaveBeenCalledWith('legal.loginAgreementPrompt.loginRejectedWarning'); expect(view!.get('#email').attributes('disabled')).toBeDefined()
  })
  it.each(['turnstile','tencent','aliyun'] as const)('sends only the correct %s proof with actual password login', async mode => {
    if (mode === 'turnstile') Object.assign(settings, { turnstile_enabled: true, turnstile_site_key: 'synthetic-site' }); else if (mode === 'tencent') Object.assign(settings, { tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' }); else Object.assign(settings, { aliyun_captcha_enabled: true, aliyun_captcha_scene_id: 'synthetic-scene', aliyun_captcha_prefix: 'synthetic-prefix' }); await render(); if (mode === 'turnstile') { await action('Captcha verify').trigger('click'); await action('Captcha expire').trigger('click'); expect(fixture.error).toHaveBeenCalledWith('auth.turnstileExpired'); await action('Captcha error').trigger('click'); expect(fixture.error).toHaveBeenCalledWith('auth.turnstileFailed'); await action('Captcha verify').trigger('click') } await submit(); const body = calls('/auth/login')[0].body; expect(mode === 'tencent' ? body.tencent_captcha_ticket : body.turnstile_token).toBe(mode === 'turnstile' ? 'synthetic-captcha' : 'synthetic-action-proof'); expect(fixture.reset).toHaveBeenCalled(); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it('renders the real TOTP modal, clears a rejected code and accepts corrected autofill', async () => {
    loginReply = { requires_2fa: true, temp_token: 'synthetic-login-temp', user_email_masked: 'm***@example.test' }; await render(); await submit(); const dialog = view!.get('[role="dialog"]'); expect(dialog.text()).toContain('m***@example.test'); refusal = '/auth/login/2fa'; await dialog.get('input[autocomplete="one-time-code"]').setValue('123456'); await flushPromises(); expect(calls('/auth/login/2fa')[0].body).toEqual({ temp_token: 'synthetic-login-temp', totp_code: '123456' }); expect(fixture.error).toHaveBeenCalledWith('Synthetic credentials refused'); expect(dialog.findAll<HTMLInputElement>('input[autocomplete="off"]').every(input => input.element.value === '')).toBe(true); refusal = undefined; await dialog.get('input[autocomplete="one-time-code"]').setValue('654321'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/dashboard'); expect(view!.find('[role="dialog"]').exists()).toBe(false)
  })
  it('cancels a TOTP step without posting a code or losing the password login form', async () => {
    loginReply = { requires_2fa: true }; await render(); await submit(); await action('common.cancel', view!.get('[role="dialog"]')).trigger('click'); expect(view!.find('[role="dialog"]').exists()).toBe(false); expect(calls('/auth/login/2fa')).toHaveLength(0); expect(view!.find('form').exists()).toBe(true)
  })
  it.each(['cancelled','failed'] as const)('allows a new password attempt after a %s WebAuthn ceremony', async kind => {
    settings.passkey_enabled = true; fixture.credential.mockRejectedValue(kind === 'cancelled' ? new DOMException('Synthetic authenticator dismissed', 'NotAllowedError') : new Error('Synthetic authenticator unavailable')); await render(); await action('auth.passkeySignIn').trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith(kind === 'cancelled' ? 'Synthetic authenticator dismissed' : 'Synthetic authenticator unavailable'); expect(calls('/auth/passkey/login/finish')).toHaveLength(0); expect(view!.get('#email').attributes('disabled')).toBeUndefined()
  })
  it('completes real passkey begin/finish transport with action proof and a synthetic credential', async () => {
    Object.assign(settings, { passkey_enabled: true, tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' }); await render(); await action('auth.passkeySignIn').trigger('click'); await flushPromises(); expect(calls('/auth/passkey/login/begin')[0].body).toEqual({ tencent_captcha_ticket: 'synthetic-action-proof', tencent_captcha_randstr: 'synthetic-action-rand' }); expect(calls('/auth/passkey/login/finish')[0].body).toMatchObject({ session_token: 'synthetic-webauthn-session', credential: { id: 'synthetic-passkey', type: 'public-key', response: { signature: 'BQ' } } }); expect(router.currentRoute.value.path).toBe('/dashboard'); expect(fixture.reset).toHaveBeenCalled()
  })
  it('keeps a cancelled OAuth proof local and reports refused actual start without navigation', async () => {
    Object.assign(settings, { github_oauth_enabled: true, tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' }); fixture.proof.mockResolvedValueOnce(null); await render(); await action('auth.emailOAuth.signIn:GitHub').trigger('click'); await flushPromises(); expect(calls('/auth/oauth/github/start')).toHaveLength(0); await action('auth.emailOAuth.signIn:GitHub').trigger('click'); await flushPromises(); expect(calls('/auth/oauth/github/start')[0].body).toEqual({ tencent_captcha_ticket: 'synthetic-action-proof', tencent_captcha_randstr: 'synthetic-action-rand' }); expect(fixture.error).toHaveBeenCalledWith('Synthetic OAuth start refused'); expect(router.currentRoute.value.path).toBe('/login')
  })
})
