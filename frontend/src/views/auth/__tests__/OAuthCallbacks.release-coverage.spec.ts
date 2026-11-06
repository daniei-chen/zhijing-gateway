/** Actual four callback pages, Pinia authStore, router, public forms and Axios wire.
 * Only the outer layout and external CAPTCHA capability are presentation stubs.
 * Every response and token below is synthetic; no OAuth/provider/mail request occurs.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createApp, defineComponent, reactive, ref, type Component, type App } from 'vue'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import DingTalkCallbackView from '../DingTalkCallbackView.vue'
import WechatCallbackView from '../WechatCallbackView.vue'
import OidcCallbackView from '../OidcCallbackView.vue'
import LinuxDoCallbackView from '../LinuxDoCallbackView.vue'
import { apiClient } from '@/api/client'
import { clearStoredAuthSession, replaceAuthSession } from '@/api/authSession'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings } from '@/types'

const fixture = vi.hoisted(() => ({ app: null as Record<string, unknown> | null, error: vi.fn(), success: vi.fn(), proof: vi.fn(), reset: vi.fn(), translated: false }))
vi.mock('@/stores', async () => ({ useAuthStore: (await vi.importActual<typeof import('@/stores/auth')>('@/stores/auth')).useAuthStore, useAppStore: () => fixture.app }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ locale: ref('en'), te: () => fixture.translated, t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }) }))
const captcha = defineComponent({ emits: ['verify', 'expire', 'error'], setup(_, { expose, emit }) { expose({ verifyAction: fixture.proof, reset: fixture.reset }); return { emit } }, template: `<section data-captcha><button type="button" @click="emit('verify','synthetic-captcha','synthetic-rand')">Captcha verify</button><button type="button" @click="emit('expire')">Captcha expire</button><button type="button" @click="emit('error')">Captcha error</button></section>` })
const pages = { dingtalk: DingTalkCallbackView, wechat: WechatCallbackView, oidc: OidcCallbackView, linuxdo: LinuxDoCallbackView }
type Provider = keyof typeof pages
let view: VueWrapper | undefined
let hostApp: App | undefined
let pinia: Pinia
let router: Router
let provider: Provider
let exchanges: Record<string, unknown>[]
let settings: Partial<PublicSettings>
let completions: Record<string, Record<string, unknown>>
let refusal: { path: string; data: Record<string, unknown>; status?: number } | undefined
let gate: { path: string; promise: Promise<void>; resolve: () => void } | undefined
let requests: { path: string; method: string; body: Record<string, unknown> }[]
const oldAdapter = apiClient.defaults.adapter
const user = { id: 210, role: 'user', status: 'active', email: 'member@example.test', balance: 20, concurrency: 1 }
const tokens = (redirect = '/keys') => ({ access_token: 'synthetic-callback-access-210', refresh_token: 'synthetic-callback-refresh-210', token_type: 'Bearer', expires_in: 3600, redirect })
const suggested = () => ({ adoption_required: true, suggested_display_name: 'Synthetic Member', suggested_avatar_url: 'https://images.example.test/synthetic-avatar.png' })
const exchangePath = '/auth/oauth/pending/exchange'
const createPath = '/auth/oauth/pending/create-account'
const bindPath = '/auth/oauth/pending/bind-login'
const otpPath = '/auth/login/2fa'
function pending(step = 'create_account', patch: Record<string, unknown> = {}) { return { auth_result: 'pending_session', step, pending_email: 'member@example.test', ...patch } }
function deferred(path: string) { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { path, promise, resolve } }
function reply(config: InternalAxiosRequestConfig, value: unknown) { return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: value } } }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); clearStoredAuthSession(); window.history.replaceState({}, '', '/'); pinia = createPinia(); provider = 'dingtalk'; fixture.translated = false
  for (const fn of [fixture.error, fixture.success, fixture.proof, fixture.reset]) fn.mockReset()
  fixture.proof.mockResolvedValue({ token: 'synthetic-action-proof', randstr: 'synthetic-action-rand' })
  fixture.app = reactive({ cachedPublicSettings: { wechat_oauth_open_enabled: true, wechat_oauth_mp_enabled: false }, publicSettingsLoaded: true, fetchPublicSettings: vi.fn(async () => ({})), showError: fixture.error, showSuccess: fixture.success })
  settings = { email_verify_enabled: false, invitation_code_enabled: false, turnstile_enabled: false, oidc_oauth_provider_name: 'Synthetic Identity' }
  exchanges = [tokens()]; completions = { [createPath]: tokens(), [bindPath]: tokens(), [otpPath]: tokens(), '/auth/oauth/pending/send-verify-code': { countdown: 2 } }; refusal = undefined; gate = undefined; requests = []
  apiClient.defaults.adapter = async config => {
    const path = String(config.url); requests.push({ path, method: String(config.method), body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} })
    if (gate?.path === path) await gate.promise
    if (refusal?.path === path) throw new AxiosError('Synthetic callback refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: refusal.status ?? 400, statusText: 'Refused', headers: {}, data: refusal.data })
    if (path === '/settings/public') return reply(config, settings)
    if (path === '/auth/me') return reply(config, user)
    if (path === exchangePath) return reply(config, exchanges.length > 1 ? exchanges.shift() : exchanges[0])
    if (path === `/auth/oauth/${provider}/complete-registration`) return reply(config, completions[path] ?? tokens())
    if (completions[path]) return reply(config, completions[path])
    throw new Error(`Unexpected synthetic callback endpoint ${path}`)
  }
})
afterEach(async () => { view?.unmount(); view = undefined; gate?.resolve(); await flushPromises(); hostApp?.unmount(); hostApp = undefined; disposePinia(pinia); apiClient.defaults.adapter = oldAdapter; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function render(nextProvider: Provider = provider, query = '', fragment = '') {
  provider = nextProvider
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/callback', component: { template: '<div/>' } }, { path: '/keys', component: { template: '<div/>' } }, { path: '/dashboard', component: { template: '<div/>' } }, { path: '/profile', component: { template: '<div/>' } }, { path: '/login', component: { template: '<div/>' } }, { path: '/auth/dingtalk/email-completion', component: { template: '<div/>' } }] })
  await router.push('/callback' + query); await router.isReady(); window.location.hash = fragment
  hostApp?.unmount(); const host = document.createElement('div'); document.body.append(host); hostApp = createApp({ template: '<div/>' }); hostApp.use(pinia); hostApp.use(router); hostApp.mount(host)
  view = mount(pages[provider] as Component, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { AuthLayout: { template: '<main><slot/></main>' }, TurnstileWidget: captcha } } }); await flushPromises(); return view
}
function action(text: string) { const result = view!.findAll('button').find(node => node.text() === text); expect(result, text).toBeDefined(); return result! }
function field(suffix: string) { return view!.get(`[data-testid="${provider}-${suffix}"]`) }
const calls = (path: string) => requests.filter(request => request.path === path)
async function create() { await field('create-account-password').setValue('synthetic-password'); await field('create-account-submit').trigger('click'); await flushPromises() }
async function bind() { await field('bind-login-password').setValue('synthetic-password'); await field('bind-login-submit').trigger('click'); await flushPromises() }
function expectBoundForm() { expect(view!.find(`[data-testid="${provider}-bind-login-email"]`).exists()).toBe(true); expect(field('bind-login-email').element).toHaveProperty('value', 'member@example.test') }

for (const name of ['dingtalk', 'wechat', 'oidc', 'linuxdo'] as const) {
  describe(`${name} actual callback release workflow`, () => {
    it('establishes a browser login only after exchange and current-user resolution, then uses the captured local redirect', async () => {
      await render(name); expect(calls(exchangePath)[0].body).toEqual({}); expect(calls('/auth/me')).toHaveLength(1); expect(useAuthStore(pinia).user?.id).toBe(210); expect(router.currentRoute.value.path).toBe('/keys'); expect(fixture.success).toHaveBeenCalledWith('auth.loginSuccess'); expect(localStorage.getItem('pending_auth_session')).toBeNull()
    })
    it.each(['https://elsewhere.example.test', '//elsewhere.example.test', '/unsafe://path', '/keys\nbad', '/keys\rbad'])('rejects unsafe redirect %s without leaving a valid established account', async redirect => {
      exchanges = [tokens(redirect)]; await render(name); expect(router.currentRoute.value.path).toBe('/dashboard'); expect(useAuthStore(pinia).user?.id).toBe(210)
    })
    it('strips unsolicited reusable fragment credentials and displays the restart error without exchanging or logging in', async () => {
      await render(name, '', '#access_token=synthetic-unsolicited&refresh_token=synthetic-refresh&expires_in=120&token_type=Bearer'); expect(calls(exchangePath)).toHaveLength(0); expect(fixture.error).toHaveBeenCalledWith('auth.oauth.invalidCallbackHint'); expect(window.location.hash).toBe(''); expect(useAuthStore(pinia).user).toBeNull()
    })
    it('surfaces a provider fragment error and an initial transport refusal without creating a session', async () => {
      await render(name, '', '#error=synthetic_provider_denied&error_description=Synthetic%20provider%20refusal'); expect(fixture.error).toHaveBeenCalledWith('Synthetic provider refusal'); expect(calls(exchangePath)).toHaveLength(0); view!.unmount(); view = undefined; refusal = { path: exchangePath, data: { message: 'Synthetic callback exchange refused' } }; await render(name); expect(fixture.error).toHaveBeenCalledWith('Synthetic callback exchange refused'); expect(useAuthStore(pinia).user).toBeNull()
    })
    it('lets the member choose create, return to existing-account sign-in and edit the chosen email visibly', async () => {
      exchanges = [pending('choice')]; await render(name); await action('auth.oauthFlow.createNewAccount').trigger('click'); await flushPromises(); expect(field('create-account-email').element).toHaveProperty('value', 'member@example.test'); await field('create-account-email').setValue('corrected@example.test'); await action('auth.alreadyHaveAccount').trigger('click'); await flushPromises(); expect(field('bind-login-email').element).toHaveProperty('value', name === 'wechat' ? 'corrected@example.test' : 'member@example.test'); await field('bind-login-email').setValue('corrected@example.test'); expect(field('bind-login-email').element).toHaveProperty('value', 'corrected@example.test'); expect(field('bind-login-password').element).toHaveProperty('value', ''); await action(name === 'wechat' ? 'auth.oauthFlow.createNewAccount' : 'auth.oauthFlow.useDifferentEmail').trigger('click'); await flushPromises(); expect(view!.find(`[data-testid="${name}-create-account-email"]`).exists()).toBe(true); expect(calls(createPath)).toHaveLength(0)
    })
    it.each([
      { code: 'EMAIL_EXISTS', message: 'Synthetic account exists' },
      { code: 409, reason: ' BIND_LOGIN_REQUIRED ', message: 'Synthetic binding required' },
      { error: 'bind_login', message: 'Synthetic login needed' },
      { message: 'adopt_existing_user_by_email' },
      { code: 'UNKNOWN', reason: 'existing_account_required', message: 'Synthetic account found' },
      { code: 'EXISTING_ACCOUNT_BINDING_REQUIRED', message: 'Synthetic binding found' },
    ])('recovers an exact server recovery state into the existing-account form (%j)', async data => {
      exchanges = [pending()]; refusal = { path: createPath, data, status: 409 }; await render(name); await create(); expect(calls(createPath)[0].body).toMatchObject({ email: 'member@example.test', password: 'synthetic-password' }); expectBoundForm(); expect(field('bind-login-password').element).toHaveProperty('value', ''); expect(router.currentRoute.value.path).toBe('/callback')
    })
    it.each([{ code: 409, message: 'Synthetic EMAIL_EXISTS text is only a description' }, { code: 'UNKNOWN', message: 'Synthetic unrelated failure' }])('retains an unrelated rejected create draft without substring recovery (%j)', async data => {
      exchanges = [pending()]; refusal = { path: createPath, data }; await render(name); await create(); expect(view!.find(`[data-testid="${name}-bind-login-email"]`).exists()).toBe(false); expect(field('create-account-password').element).toHaveProperty('value', 'synthetic-password'); expect(fixture.error).toHaveBeenCalledWith(data.message); refusal = undefined; await field('create-account-submit').trigger('click'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/keys')
    })
    it('keeps invitation and adoption decisions for a refused completion, then retries exactly that member choice', async () => {
      exchanges = [{ error: 'invitation_required', ...suggested() }]; sessionStorage.setItem('oauth_aff_code', 'synthetic-affiliate'); await render(name); expect(action(name === 'dingtalk' ? 'auth.dingtalk.completeRegistration' : name === 'linuxdo' ? 'auth.linuxdo.completeRegistration' : 'auth.oidc.completeRegistration').attributes('disabled')).toBeDefined(); const checks = view!.findAll('input[type="checkbox"]'); await checks[0].setValue(false); await checks[1].setValue(true); await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').setValue('  synthetic-invite  ')
      const path = `/auth/oauth/${name}/complete-registration`; refusal = { path, data: { message: 'Synthetic invitation refused' } }; await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').trigger('keyup', { key: 'Enter' }); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('Synthetic invitation refused'); expect(calls(path)[0].body).toEqual({ invitation_code: 'synthetic-invite', aff_code: 'synthetic-affiliate', adopt_display_name: false, adopt_avatar: true }); refusal = undefined; await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').trigger('keyup', { key: 'Enter' }); await flushPromises(); expect(calls(path)).toHaveLength(2); expect(router.currentRoute.value.path).toBe('/keys')
    })
    it('accepts a legacy invitation handle only for registration and includes it on that existing endpoint', async () => {
      await render(name, '', '#error=invitation_required&pending_oauth_token=synthetic-pending-handle&redirect=%2Fkeys'); expect(calls(exchangePath)).toHaveLength(0); await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').setValue('synthetic-invite'); await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').trigger('keyup', { key: 'Enter' }); await flushPromises(); expect(calls(`/auth/oauth/${name}/complete-registration`)[0].body).toMatchObject({ pending_oauth_token: 'synthetic-pending-handle', invitation_code: 'synthetic-invite' }); expect(router.currentRoute.value.path).toBe('/keys')
    })
    it('requires explicit profile adoption, sends exactly the current checkboxes and continues through another server step', async () => {
      exchanges = [{ auth_result: 'pending_session', ...suggested() }, { error: 'invitation_required', ...suggested() }]; await render(name); expect(calls(exchangePath)).toHaveLength(1); const checks = view!.findAll('input[type="checkbox"]'); await checks[0].setValue(true); await checks[1].setValue(false); await action('auth.continue').trigger('click'); await flushPromises(); expect(calls(exchangePath)[1].body).toEqual({ adopt_display_name: true, adopt_avatar: false }); expect(view!.find('input[placeholder="auth.invitationCodePlaceholder"]').exists()).toBe(true); expect(router.currentRoute.value.path).toBe('/callback')
    })
    it('announces a refused explicit adoption exchange and never installs a login from it', async () => {
      exchanges = [{ auth_result: 'pending_session', ...suggested() }]; await render(name); refusal = { path: exchangePath, data: { message: 'Synthetic adoption exchange refused' } }; await action('auth.continue').trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('Synthetic adoption exchange refused'); expect(useAuthStore(pinia).user).toBeNull()
    })
    it('keeps failed bind credentials editable, then completes a separate TOTP challenge after a rejected code', async () => {
      exchanges = [pending('bind_login', { adoption_required: false })]; refusal = { path: bindPath, data: { message: 'Synthetic password refused' } }; await render(name); expect(field('bind-login-submit').attributes('disabled')).toBeDefined(); await bind(); expect(fixture.error).toHaveBeenCalledWith('Synthetic password refused'); expect(field('bind-login-password').element).toHaveProperty('value', 'synthetic-password'); expect(calls(bindPath)[0].body).toEqual({ email: 'member@example.test', password: 'synthetic-password', adopt_display_name: false, adopt_avatar: false })
      refusal = undefined; completions[bindPath] = { requires_2fa: true, temp_token: 'synthetic-otp-temp', user_email_masked: 'm***@example.test' }; await field('bind-login-submit').trigger('click'); await flushPromises(); expect(view!.text()).toContain('m***@example.test'); await field('bind-login-totp').setValue('123'); expect(field('bind-login-totp-submit').attributes('disabled')).toBeDefined(); await field('bind-login-totp').setValue('123456'); refusal = { path: otpPath, data: { message: 'Synthetic TOTP refused' } }; await field('bind-login-totp-submit').trigger('click'); await flushPromises(); expect(fixture.error).toHaveBeenCalledWith('Synthetic TOTP refused'); expect(calls(otpPath)[0].body).toEqual({ temp_token: 'synthetic-otp-temp', totp_code: '123456' }); refusal = undefined; await field('bind-login-totp-submit').trigger('click'); await flushPromises(); expect(useAuthStore(pinia).user?.id).toBe(210); expect(router.currentRoute.value.path).toBe('/dashboard')
    })
    it('does not notify, navigate or create a new login from an old create-account response after unmount', async () => {
      exchanges = [pending()]; gate = deferred(createPath); await render(name); await create(); expect(calls(createPath)).toHaveLength(1); view!.unmount(); view = undefined; gate.resolve(); await flushPromises(); expect(fixture.success).not.toHaveBeenCalled(); expect(fixture.error).not.toHaveBeenCalled(); expect(router.currentRoute.value.path).toBe('/callback'); expect(useAuthStore(pinia).user).toBeNull()
    })
    it('does not replay or report an old bind failure after a new same-subject login generation', async () => {
      exchanges = [pending('bind_login')]; gate = deferred(bindPath); refusal = { path: bindPath, data: { message: 'Synthetic stale bind refusal' } }; await render(name); await bind(); replaceAuthSession({ accessToken: 'synthetic-other-login', user: { id: 210 } }); gate.resolve(); await flushPromises(); expect(fixture.error).not.toHaveBeenCalled(); expect(fixture.success).not.toHaveBeenCalled(); expect(calls(otpPath)).toHaveLength(0); expect(localStorage.getItem('auth_token')).toBe('synthetic-other-login')
    })
  })
}

describe('DingTalk-specific pending account steps', () => {
  it.each([{ step: 'email_completion' }, { requires_email_completion: true }])('routes a server-required email completion step through the dedicated screen (%j)', async patch => {
    exchanges = [{ auth_result: 'pending_session', ...patch }]; await render('dingtalk', '?redirect=%2Fkeys'); expect(router.currentRoute.value.path).toBe('/auth/dingtalk/email-completion'); expect(router.currentRoute.value.query.redirect).toBe('/keys'); expect(calls('/auth/me')).toHaveLength(0)
  })
  it('returns from email completion into the existing-account password form with the explicitly provided email', async () => {
    exchanges = [{ auth_result: 'pending_session', step: 'email_completion' }]; await render('dingtalk', '?bind=1&email=member%40example.test&redirect=%2Fkeys'); expectBoundForm(); await bind(); expect(calls(bindPath)[0].body.email).toBe('member@example.test'); expect(router.currentRoute.value.path).toBe('/keys')
  })
  it('continues an invitation completion into an email-completion step without inventing a successful login', async () => {
    exchanges = [{ error: 'invitation_required' }]; const path = '/auth/oauth/dingtalk/complete-registration'; completions[path] = { requires_email_completion: true, redirect: '/keys' }; await render(); await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').setValue('synthetic-invite'); await view!.get('input[placeholder="auth.invitationCodePlaceholder"]').trigger('keyup', { key: 'Enter' }); await flushPromises(); expect(router.currentRoute.value.path).toBe('/auth/dingtalk/email-completion'); expect(router.currentRoute.value.query.redirect).toBe('/keys'); expect(fixture.success).not.toHaveBeenCalled()
  })
  it('renders a direct TOTP step with its account fallback and sends its exact temporary challenge identity', async () => {
    exchanges = [{ requires_2fa: true, temp_token: 'synthetic-direct-temp' }]; await render(); expect(view!.text()).toContain('auth.oauthFlow.yourAccount'); await field('bind-login-totp').setValue('654321'); await field('bind-login-totp-submit').trigger('click'); await flushPromises(); expect(calls(otpPath)[0].body).toEqual({ temp_token: 'synthetic-direct-temp', totp_code: '654321' }); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it.each([{ suggested_display_name: 'Synthetic Only Name', expected: { adopt_display_name: true, adopt_avatar: false } }, { suggested_avatar_url: 'https://images.example.test/only-avatar.png', expected: { adopt_display_name: false, adopt_avatar: true } }])('does not adopt an absent profile field while confirming the one suggested field (%j)', async sample => {
    const { expected, ...profile } = sample; exchanges = [{ adoption_required: true, ...profile }, { auth_result: 'bind', redirect: '/profile' }]; await render(); expect(view!.findAll('input[type="checkbox"]')).toHaveLength(1); await action('auth.continue').trigger('click'); await flushPromises(); expect(calls(exchangePath)[1].body).toEqual(expected); expect(router.currentRoute.value.path).toBe('/profile'); expect(fixture.success).toHaveBeenCalledWith('profile.authBindings.bindSuccess')
  })
  it.each([{ step: 'choose' }, { error: 'choose_account_action' }, { intent: 'choose_account_action_required' }])('honors a supported chooser state without an invented email (%j)', async patch => {
    exchanges = [{ auth_result: 'pending_session', ...patch }]; await render(); expect(view!.text()).toContain('auth.oauthFlow.chooseAccountActionHint'); await action('auth.oauthFlow.bindExistingAccount').trigger('click'); await flushPromises(); expect(field('bind-login-email').element).toHaveProperty('value', ''); await field('bind-login-email').setValue('member@example.test'); await bind(); expect(router.currentRoute.value.path).toBe('/keys')
  })
  it.each([
    { state: { step: 'email_required', email: 'member@example.test' }, form: 'create-account' },
    { state: { step: 'create_account_required', resolved_email: 'member@example.test' }, form: 'create-account' },
    { state: { intent: 'create_account', suggested_email: 'member@example.test' }, form: 'create-account' },
    { state: { step: 'bind_login_required', existing_account_email: 'member@example.test' }, form: 'bind-login' },
    { state: { intent: 'existing_account_binding_required', pending_email: 'member@example.test' }, form: 'bind-login' },
    { state: { error: 'adopt_existing_user_by_email', email: 'member@example.test' }, form: 'bind-login' },
  ])('uses the server pending-state email source in the actual visible form and submitted request (%j)', async ({ state, form }) => {
    exchanges = [{ auth_result: 'pending_session', ...state }]; await render(); expect(field(form + '-email').element).toHaveProperty('value', 'member@example.test'); if (form === 'create-account') await create(); else await bind(); expect(calls(form === 'create-account' ? createPath : bindPath)[0].body.email).toBe('member@example.test'); expect(router.currentRoute.value.path).toBe('/keys')
  })
  it.each(['turnstile', 'tencent', 'aliyun'] as const)('sends email verification and fresh %s proof through the real create-account form', async mode => {
    exchanges = [pending()]; settings.email_verify_enabled = true; settings.invitation_code_enabled = true
    if (mode === 'turnstile') Object.assign(settings, { turnstile_enabled: true, turnstile_site_key: 'synthetic-site' })
    else if (mode === 'tencent') Object.assign(settings, { tencent_captcha_enabled: true, tencent_captcha_app_id: 'synthetic-app' })
    else Object.assign(settings, { aliyun_captcha_enabled: true, aliyun_captcha_scene_id: 'synthetic-scene', aliyun_captcha_prefix: 'synthetic-prefix' })
    await render(); await field('create-account-password').setValue('synthetic-password'); await field('create-account-invitation-code').setValue('synthetic-invite'); if (mode === 'turnstile') await action('Captcha verify').trigger('click'); await field('create-account-send-code').trigger('click'); await flushPromises(); expect(calls('/auth/oauth/pending/send-verify-code')[0].body).toMatchObject({ email: 'member@example.test' }); expect(view!.text()).toContain('auth.codeSentSuccess'); expect(field('create-account-send-code').attributes('disabled')).toBeDefined(); await vi.advanceTimersByTimeAsync(2000); if (mode === 'turnstile') expect(field('create-account-send-code').attributes('disabled')).toBeDefined(); else expect(field('create-account-send-code').attributes('disabled')).toBeUndefined()
    if (mode === 'turnstile') await action('Captcha verify').trigger('click'); await field('create-account-verify-code').setValue('654321'); await field('create-account-submit').trigger('click'); await flushPromises(); const body = calls(createPath)[0].body; expect(body).toMatchObject({ email: 'member@example.test', password: 'synthetic-password', verify_code: '654321', invitation_code: 'synthetic-invite', adopt_display_name: false, adopt_avatar: false }); expect(mode === 'tencent' ? body.tencent_captcha_ticket : body.turnstile_token).toBe(mode === 'turnstile' ? 'synthetic-captcha' : 'synthetic-action-proof'); if (mode === 'tencent') expect(body.tencent_captcha_randstr).toBe('synthetic-action-rand'); expect(fixture.reset).toHaveBeenCalled(); expect(router.currentRoute.value.path).toBe('/keys')
  })
  it('can retain a server pending session after confirmation without misreporting bind success', async () => {
    exchanges = [{ ...suggested(), auth_result: 'pending_session' }, { auth_result: 'pending_session' }]; await render(); await action('auth.continue').trigger('click'); await flushPromises(); expect(router.currentRoute.value.path).toBe('/callback'); expect(fixture.success).not.toHaveBeenCalled(); expect(JSON.parse(localStorage.getItem('pending_auth_session')!).provider).toBe('dingtalk')
  })
  it('uses an available localized provider error key and clears the URL fragment', async () => {
    fixture.translated = true; await render('dingtalk', '', '#error=synthetic_provider_error&error_message=Synthetic%20fallback'); expect(fixture.error).toHaveBeenCalledWith('auth.dingtalk.error.synthetic_provider_error'); expect(window.location.hash).toBe('')
  })
})

describe('Wechat and OIDC real callback boundaries', () => {
  it.each(['desktop', 'wechat'] as const)('recovers an unsigned-in existing-account resume with a runtime %s mode and no invented email', async runtime => {
    fixture.app!.cachedPublicSettings = {}; vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(runtime === 'wechat' ? 'Synthetic MicroMessenger' : 'Synthetic desktop'); await render('wechat', '?wechat_bind_existing=1'); expect(calls(exchangePath)).toHaveLength(0); expect(router.currentRoute.value.path).toBe('/login'); const resume = new URL(String(router.currentRoute.value.query.redirect), 'http://localhost'); expect(resume.pathname).toBe('/auth/wechat/callback'); expect(resume.searchParams.get('mode')).toBe(runtime === 'wechat' ? 'mp' : 'open'); expect(resume.searchParams.has('email')).toBe(false)
  })
  it('preserves the explicitly entered email and local destination in an existing-account login resume', async () => {
    await render('wechat', '?wechat_bind_existing=1&email=member%40example.test&redirect=%2Fkeys&mode=mp'); expect(router.currentRoute.value.path).toBe('/login'); expect(router.currentRoute.value.query.email).toBe('member@example.test'); const resume = new URL(String(router.currentRoute.value.query.redirect), 'http://localhost'); expect(resume.searchParams.get('email')).toBe('member@example.test'); expect(resume.searchParams.get('redirect')).toBe('/keys'); expect(resume.searchParams.get('mode')).toBe('open')
  })
  it('reports a refused current-user bind-token preparation before any external navigation', async () => {
    replaceAuthSession({ accessToken: 'synthetic-current-user', user }); exchanges = [pending('bind_login')]; refusal = { path: '/auth/oauth/bind-token', data: { message: 'Synthetic bind preparation refused' } }; await render('wechat'); expect(view!.find('[data-testid="wechat-bind-login-password"]').exists()).toBe(false); await view!.get('[data-testid="existing-account-submit"]').trigger('click'); await flushPromises(); expect(calls('/auth/oauth/bind-token')).toHaveLength(1); expect(fixture.error).toHaveBeenCalledWith('Synthetic bind preparation refused'); expect(router.currentRoute.value.path).toBe('/callback')
  })
  it('keeps the OIDC provider fallback usable after its public-name lookup is refused', async () => {
    exchanges = [pending('bind_login')]; refusal = { path: '/settings/public', data: { message: 'Synthetic settings refused' } }; await render('oidc'); expect(view!.text()).toContain('OIDC'); expectBoundForm(); expect(fixture.error).not.toHaveBeenCalled(); refusal = undefined; await bind(); expect(router.currentRoute.value.path).toBe('/keys')
  })
})
