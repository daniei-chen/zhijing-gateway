/** Real registration store/API and visible agreement/OAuth flows with synthetic Axios. */
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import RegisterView from '../RegisterView.vue'
import { apiClient } from '@/api/client'
import { clearStoredAuthSession } from '@/api/authSession'
import { clearRegistrationDraft, takeRegistrationDraft } from '@/utils/registrationDraft'
import type { PublicSettings } from '@/types'

const fixture = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), proof: vi.fn(), reset: vi.fn() }))
vi.mock('@/stores', async () => ({ useAuthStore: (await vi.importActual<typeof import('@/stores/auth')>('@/stores/auth')).useAuthStore, useAppStore: () => ({ cachedPublicSettings: {}, showError: fixture.error, showSuccess: fixture.success, showWarning: fixture.warning }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }) }))
const captcha = defineComponent({ emits: ['verify', 'expire', 'error'], setup(_, { expose, emit }) { expose({ verifyAction: fixture.proof, reset: fixture.reset }); return { emit } }, template: `<section data-captcha><button type="button" @click="emit('verify','synthetic-proof','synthetic-rand')">Captcha verify</button><button type="button" @click="emit('expire')">Captcha expire</button><button type="button" @click="emit('error')">Captcha error</button></section>` })
let view: VueWrapper | undefined
let pinia: Pinia
let router: Router
let settings: Partial<PublicSettings>
let promo: { valid: boolean; bonus_amount?: number; error_code?: string }
let invitation: { valid: boolean; error_code?: string }
let refusal: string | undefined
let requests: { path: string; method: string; body: Record<string, unknown>; params: Record<string, unknown> }[]
let validationGate: { promise: Promise<void>; resolve: () => void } | undefined
let registerGate: { promise: Promise<void>; resolve: () => void } | undefined
const oldAdapter = apiClient.defaults.adapter
const consentKey = 'sub2api_login_agreement_consent'
const docs = [{ id: 'terms', title: 'Terms of service', content_md: '# Synthetic' }, { id: 'privacy', title: 'Privacy policy', content_md: '# Synthetic' }, { id: 'region', title: 'Country regions', content_md: '# Synthetic' }, { id: 'settings', title: 'Settings terms', content_md: '# Synthetic' }]
function reply(config: InternalAxiosRequestConfig, value: unknown) { return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: value } } }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); clearStoredAuthSession(); clearRegistrationDraft(); for (const fn of Object.values(fixture)) fn.mockReset()
  fixture.proof.mockResolvedValue({ token: 'synthetic-action-proof', randstr: 'synthetic-action-rand' })
  settings = { registration_enabled: true, email_verify_enabled: false, promo_code_enabled: false, invitation_code_enabled: false, affiliate_enabled: false, turnstile_enabled: false, site_name: 'Synthetic gateway', registration_email_suffix_whitelist: [], linuxdo_oauth_enabled: false, wechat_oauth_enabled: false, oidc_oauth_enabled: false, github_oauth_enabled: false, google_oauth_enabled: false }
  promo = { valid: true, bonus_amount: 12 }; invitation = { valid: true }; refusal = undefined; validationGate = undefined; registerGate = undefined; requests = []; pinia = createPinia()
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); const body = config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}; requests.push({ path, method: String(config.method), body, params: config.params || {} })
    if (path.includes('validate-') && validationGate) await validationGate.promise
    if (path === '/auth/register' && registerGate) await registerGate.promise
    if (path === refusal) throw new AxiosError('Synthetic registration refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic server refused this request' } })
    if (path === '/settings/public') return reply(config, settings)
    if (path === '/auth/validate-promo-code') return reply(config, promo)
    if (path === '/auth/validate-invitation-code') return reply(config, invitation)
    if (path === '/auth/register') return reply(config, { access_token: 'synthetic-register-access-208', token_type: 'Bearer', user: { id: 208, email: String(body.email), role: 'user', status: 'active', balance: 0, concurrency: 1 } })
    if (path.startsWith('/auth/oauth/')) throw new AxiosError('Synthetic OAuth blocked', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 400, statusText: 'Refused', headers: {}, data: { message: 'Synthetic OAuth refusal' } })
    throw new Error(`Unexpected synthetic registration endpoint ${path}`)
  }
})
afterEach(async () => { view?.unmount(); view = undefined; validationGate?.resolve(); registerGate?.resolve(); await flushPromises(); disposePinia(pinia); clearRegistrationDraft(); apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function render(query = '') { router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/register', component: { template: '<div/>' } }, { path: '/dashboard', component: { template: '<div/>' } }, { path: '/email-verify', component: { template: '<div/>' } }, { path: '/login', component: { template: '<div/>' } }, { name: 'LegalDocument', path: '/legal/:documentId', component: { template: '<div/>' } }] }); await router.push('/register' + query); await router.isReady(); view = mount(RegisterView, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { AuthLayout: { template: '<main><slot/><slot name="footer"/></main>' }, TurnstileWidget: captcha } } }); await flushPromises(); return view }
function action(text: string, scope: VueWrapper | DOMWrapper<Element> = view!) { const button = scope.findAll('button').find(node => node.text() === text); expect(button, text).toBeDefined(); return button! }
async function fill(email = 'member@example.test', password = 'synthetic-password', confirmation = password) { await view!.get('#email').setValue(email); await view!.get('#password').setValue(password); await view!.get('#confirmPassword').setValue(confirmation) }
async function submit() { await view!.get('form').trigger('submit'); await flushPromises() }
async function code(id: string, value: string) { await view!.get(`#${id}`).setValue(value); await vi.advanceTimersByTimeAsync(500); await flushPromises() }
const writes = () => requests.filter(row => row.path === '/auth/register')

describe('registration release workflows', () => {
  it('registers through the real auth store with matching passwords and a referral captured from the URL', async () => {
    settings.affiliate_enabled = true; await render('?aff=synthetic-referral'); await fill(); await submit(); expect(writes()).toHaveLength(1); expect(writes()[0].body).toEqual({ email: 'member@example.test', password: 'synthetic-password', aff_code: 'synthetic-referral' }); expect(router.currentRoute.value.path).toBe('/dashboard'); expect(fixture.success).toHaveBeenCalledWith('auth.accountCreatedSuccess:Synthetic gateway'); expect(localStorage.getItem('affiliate_referral_code')).toBeNull()
  })
  it('reveals each password only through its own visible button', async () => {
    await render(); await fill(); for (const id of ['password', 'confirmPassword']) { const input = view!.get(`#${id}`); expect(input.attributes('type')).toBe('password'); input.element.parentElement!.querySelector('button')!.click(); await flushPromises(); expect(input.attributes('type')).toBe('text') }
    expect(writes()).toHaveLength(0)
  })
  it.each([
    ['', 'synthetic-password', 'synthetic-password', 'auth.emailRequired'],
    ['invalid-email', 'synthetic-password', 'synthetic-password', 'auth.invalidEmail'],
    ['member@example.test', '', '', 'auth.passwordRequired'],
    ['member@example.test', 'short', 'short', 'auth.passwordMinLength'],
    ['member@example.test', 'synthetic-password', '', 'auth.confirmPasswordRequired'],
    ['member@example.test', 'synthetic-password', 'different-password', 'auth.passwordsDoNotMatch'],
  ])('keeps invalid form data local and announces %s / %s / %s', async (email, password, confirmation, message) => {
    await render(); await fill(email, password, confirmation); await submit(); expect(fixture.error).toHaveBeenCalledWith(message); expect(writes()).toHaveLength(0)
  })
  it('shows disabled registration rather than an editable form', async () => {
    settings.registration_enabled = false; await render(); expect(view!.find('form').exists()).toBe(false); expect(view!.text()).toContain('auth.registrationDisabled')
  })
  it('debounces a changing promo code to its latest value, displays the credit bonus and includes it on registration', async () => {
    settings.promo_code_enabled = true; await render(); await fill(); await view!.get('#promo_code').setValue('old'); await vi.advanceTimersByTimeAsync(200); await view!.get('#promo_code').setValue('synthetic-promo'); await vi.advanceTimersByTimeAsync(500); await flushPromises()
    const checks = requests.filter(row => row.path === '/auth/validate-promo-code'); expect(checks).toHaveLength(1); expect(checks[0].body).toEqual({ code: 'synthetic-promo' }); expect(view!.text()).toContain('12'); await submit(); expect(writes()[0].body.promo_code).toBe('synthetic-promo')
  })
  it('validates an enabled URL promo code before registration and clears its display when removed', async () => {
    settings.promo_code_enabled = true; promo.bonus_amount = 0; await render('?promo=synthetic-url-promo'); expect(view!.get<HTMLInputElement>('#promo_code').element.value).toBe('synthetic-url-promo'); expect(requests.some(row => row.path === '/auth/validate-promo-code')).toBe(true); await view!.get('#promo_code').setValue(''); await vi.advanceTimersByTimeAsync(350); await flushPromises(); expect(view!.text()).not.toContain('auth.promoCodeValid')
  })
  it.each([
    ['PROMO_CODE_NOT_FOUND', 'promoCodeNotFound'], ['PROMO_CODE_EXPIRED', 'promoCodeExpired'], ['PROMO_CODE_DISABLED', 'promoCodeDisabled'], ['PROMO_CODE_MAX_USED', 'promoCodeMaxUsed'], ['PROMO_CODE_ALREADY_USED', 'promoCodeAlreadyUsed'], ['UNKNOWN_PROMO', 'promoCodeInvalid'],
  ])('blocks an invalid promo %s and then permits its corrected explicit registration', async (error_code, label) => {
    settings.promo_code_enabled = true; promo = { valid: false, error_code }; await render(); await fill(); await code('promo_code', 'synthetic-bad'); expect(fixture.error).toHaveBeenCalledWith(`auth.${label}`); await submit(); expect(writes()).toHaveLength(0)
    promo = { valid: true }; await code('promo_code', 'synthetic-good'); await submit(); expect(writes()[0].body.promo_code).toBe('synthetic-good')
  })
  it('keeps submission blocked while the server is validating a promo and recovers after a validation refusal', async () => {
    settings.promo_code_enabled = true; await render(); await fill(); validationGate = deferred(); await view!.get('#promo_code').setValue('synthetic-wait'); await vi.advanceTimersByTimeAsync(500); await submit(); expect(writes()).toHaveLength(0); refusal = '/auth/validate-promo-code'; validationGate.resolve(); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('auth.promoCodeInvalid'); refusal = undefined; validationGate = undefined; await code('promo_code', 'synthetic-retry'); await submit(); expect(writes()).toHaveLength(1)
  })
  it('requires a mandatory invitation and validates it immediately when the user submits before debounce', async () => {
    settings.invitation_code_enabled = true; await render(); await fill(); await submit(); expect(fixture.error).toHaveBeenCalledWith('auth.invitationCodeRequired'); await view!.get('#invitation_code').setValue('synthetic-invite'); await submit(); expect(requests.filter(row => row.path === '/auth/validate-invitation-code')).toHaveLength(1); expect(writes()[0].body.invitation_code).toBe('synthetic-invite')
  })
  it.each(['INVITATION_CODE_NOT_FOUND', 'INVITATION_CODE_INVALID', 'INVITATION_CODE_USED', 'INVITATION_CODE_DISABLED', 'UNKNOWN_INVITATION'])('keeps rejected invitation %s out of registration, then accepts a new valid code', async error_code => {
    settings.invitation_code_enabled = true; invitation = { valid: false, error_code }; await render(); await fill(); await code('invitation_code', 'synthetic-invalid'); expect(fixture.error).toHaveBeenCalledWith('auth.invitationCodeInvalid'); await submit(); expect(writes()).toHaveLength(0); invitation = { valid: true }; await code('invitation_code', 'synthetic-valid'); await submit(); expect(writes()[0].body.invitation_code).toBe('synthetic-valid')
  })
  it('does not register while invitation validation is pending and can retry after an HTTP refusal', async () => {
    settings.invitation_code_enabled = true; await render(); await fill(); validationGate = deferred(); await view!.get('#invitation_code').setValue('synthetic-wait'); await vi.advanceTimersByTimeAsync(500); await submit(); expect(writes()).toHaveLength(0); refusal = '/auth/validate-invitation-code'; validationGate.resolve(); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('auth.invitationCodeInvalid'); refusal = undefined; validationGate = undefined; await code('invitation_code', 'synthetic-retry'); await submit(); expect(writes()).toHaveLength(1)
  })
  it('uses the real checkbox agreement gate and removes consent if the member unchecks it', async () => {
    Object.assign(settings, { login_agreement_enabled: true, login_agreement_mode: 'checkbox', login_agreement_revision: 'synthetic-revision-1', login_agreement_documents: docs }); await render(); expect(view!.get('#email').attributes('disabled')).toBeDefined(); await view!.get('#login-agreement-consent').setValue(true); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); expect(JSON.parse(localStorage.getItem(consentKey)!).revision).toBe('synthetic-revision-1'); await view!.get('#login-agreement-consent').setValue(false); expect(localStorage.getItem(consentKey)).toBeNull(); expect(fixture.warning).toHaveBeenCalledWith('legal.loginAgreementPrompt.registerRejectedWarning')
  })
  it('opens actual agreement documents, rejects, then explicitly reopens and accepts the modal', async () => {
    Object.assign(settings, { login_agreement_enabled: true, login_agreement_mode: 'modal', login_agreement_updated_at: '2026-11-06', login_agreement_documents: docs }); localStorage.setItem(consentKey, 'bad-json'); await render(); const body = new DOMWrapper(document.body); expect(body.text()).toContain('legal.loginAgreementPrompt.dialogTitle'); expect(body.findAll('a[href^="/legal/"]')).toHaveLength(4); await action('legal.loginAgreementPrompt.reject', body).trigger('click'); await flushPromises(); expect(view!.get('#email').attributes('disabled')).toBeDefined(); await action('legal.loginAgreementPrompt.viewTerms').trigger('click'); await action('legal.loginAgreementPrompt.accept', body).trigger('click'); await flushPromises(); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); expect(JSON.parse(localStorage.getItem(consentKey)!).revision).toContain('2026-11-06:terms:Terms of service')
  })
  it('honors only matching saved consent and ignores documents without titles', async () => {
    Object.assign(settings, { login_agreement_enabled: true, login_agreement_mode: 'checkbox', login_agreement_revision: 'synthetic-saved', login_agreement_documents: [...docs, { id: 'empty', title: ' ', content_md: '' }] }); localStorage.setItem(consentKey, JSON.stringify({ revision: 'synthetic-saved' })); await render(); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); expect(view!.findAll('a[href^="/legal/"]')).toHaveLength(4)
  })
  it('requires a fresh Turnstile proof after expiration/error and sends the successful public widget proof', async () => {
    settings.turnstile_enabled = true; settings.turnstile_site_key = 'synthetic-site'; await render(); await fill(); expect(view!.get('button[type="submit"]').attributes('disabled')).toBeDefined(); await action('Captcha verify').trigger('click'); await action('Captcha expire').trigger('click'); expect(fixture.error).toHaveBeenCalledWith('auth.turnstileExpired'); await action('Captcha error').trigger('click'); expect(fixture.error).toHaveBeenCalledWith('auth.turnstileFailed'); await action('Captcha verify').trigger('click'); await submit(); expect(writes()[0].body.turnstile_token).toBe('synthetic-proof'); expect(fixture.reset).toHaveBeenCalled()
  })
  it.each(['tencent', 'aliyun'] as const)('preserves %s action proof fields in a one-use memory verification draft', async provider => {
    settings.email_verify_enabled = true; if (provider === 'tencent') Object.assign(settings, { tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' }); else Object.assign(settings, { aliyun_captcha_enabled: true, aliyun_captcha_scene_id: 'synthetic-scene', aliyun_captcha_prefix: 'synthetic-prefix' })
    await render(); await fill(); await submit(); expect(fixture.proof).toHaveBeenCalledOnce(); expect(router.currentRoute.value.path).toBe('/email-verify'); const draft = takeRegistrationDraft(); expect(draft?.password).toBe('synthetic-password'); expect(provider === 'tencent' ? draft?.tencent_captcha_ticket : draft?.turnstile_token).toBe('synthetic-action-proof'); if (provider === 'tencent') expect(draft?.tencent_captcha_randstr).toBe('synthetic-action-rand'); expect(writes()).toHaveLength(0); expect(sessionStorage.getItem('register_data')).toBeNull()
  })
  it('leaves action-captcha registration editable after a cancelled challenge and prevents duplicate POSTs while pending', async () => {
    Object.assign(settings, { tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' }); fixture.proof.mockResolvedValueOnce(null); await render(); await fill(); await submit(); expect(writes()).toHaveLength(0); expect(view!.get('#email').attributes('disabled')).toBeUndefined(); registerGate = deferred(); await view!.get('form').trigger('submit'); await flushPromises(); await view!.get('form').trigger('submit'); expect(writes()).toHaveLength(1); registerGate.resolve(); await flushPromises(); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it('uses actual email OAuth buttons and sends action proof plus captured affiliate/promo parameters on a refused start', async () => {
    Object.assign(settings, { tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app', github_oauth_enabled: true, google_oauth_enabled: true, promo_code_enabled: true, affiliate_enabled: true }); await render('?aff=synthetic-aff&promo=synthetic-promo'); await action('GitHub').trigger('click'); await flushPromises(); const write = requests.find(row => row.path === '/auth/oauth/github/start')!; expect(write.body).toEqual({ tencent_captcha_ticket: 'synthetic-action-proof', tencent_captcha_randstr: 'synthetic-action-rand' }); expect(write.params).toEqual({ redirect: '/dashboard', aff_code: 'synthetic-aff', promo_code: 'synthetic-promo' }); expect(fixture.error).toHaveBeenCalledWith('Synthetic OAuth refusal'); expect(fixture.reset).toHaveBeenCalled(); expect(view!.get('#email').attributes('disabled')).toBeUndefined()
  })
  it('retains the editable registration draft on a rejected POST and succeeds after explicit retry', async () => {
    refusal = '/auth/register'; await render(); await fill(); await submit(); expect(fixture.error).toHaveBeenCalledWith('Synthetic server refused this request'); expect(view!.get<HTMLInputElement>('#password').element.value).toBe('synthetic-password'); refusal = undefined; await submit(); expect(writes()).toHaveLength(2); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
})
