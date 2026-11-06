import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import CreateAccountModal from '@/components/account/CreateAccountModal.vue';
import EditAccountModal from '@/components/account/EditAccountModal.vue';
import { apiClient } from '@/api/client';
import { replaceAuthSession } from '@/api/authSession';
import type { Account } from '@/types';
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@/api/admin', async () => ({ adminAPI: {
        accounts: (await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')).accountsAPI,
        gemini: { getCapabilities: vi.fn().mockResolvedValue({ ai_studio_oauth_enabled: false }) },
        settings: { getSettings: vi.fn().mockResolvedValue({}), getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }) },
        tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([{ id: 71, name: 'Synthetic fixed TLS101' }]) },
    } }));
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: notices.success, showError: notices.error, showWarning: notices.warning, showInfo: notices.info }) }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isSimpleMode: true }) }));
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }));
type Wire = {
    method: string;
    path: string;
    body: Record<string, any>;
    config: InternalAxiosRequestConfig;
};
const originalAdapter = apiClient.defaults.adapter;
const views: VueWrapper[] = [];
let wire: Wire[] = [], unexpected: string[] = [], route: (request: Wire) => Promise<unknown>;
const body = () => new DOMWrapper(document.body);
function account(patch: Record<string, unknown> = {}): Account { return { id: 101, name: 'Synthetic account101', platform: 'anthropic', type: 'oauth', credentials: { synthetic_preserved_credential: 'keep' }, extra: { synthetic_preserved_extra: { owner: '101' } }, status: 'active', notes: '', concurrency: 2, priority: 1, rate_multiplier: 1, proxy_id: null, load_factor: null, group_ids: [], expires_at: null, auto_pause_on_expired: true, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...patch } as unknown as Account; }
const normal = async (request: Wire): Promise<unknown> => {
    if (request.method === 'post' && request.path === '/admin/accounts')
        return account({ ...request.body, id: 111 });
    if (request.method === 'put' && request.path === '/admin/accounts/101')
        return account(request.body);
    if (request.method === 'post' && request.path === '/admin/accounts/check-mixed-channel')
        return { has_risk: false };
    if (request.method === 'get' && request.path === '/admin/accounts/antigravity/default-model-mapping')
        return {};
    unexpected.push(`${request.method} ${request.path}`);
    throw new Error('Unexpected synthetic account101 endpoint');
};
function failed(request: Wire) { return new AxiosError('Synthetic account101 update failure', 'ERR_BAD_RESPONSE', request.config, undefined, { status: 503, statusText: 'Synthetic', headers: {}, config: request.config, data: { message: 'Synthetic account101 update failure' } }); }
async function render(kind: 'create' | 'edit', value = account()) {
    const options = { attachTo: document.body, props: { show: true, groups: [], proxies: [], ...(kind === 'edit' ? { account: value } : {}) }, global: { mocks: { $t: (key: string) => key }, stubs: { Transition: true, Icon: true, PlatformIcon: true, ProxyAdBanner: true } } };
    const view = kind === 'create' ? mount(CreateAccountModal, options) : mount(EditAccountModal, { ...options, props: { ...options.props, account: value } });
    views.push(view);
    await flushPromises();
    return view;
}
function field(label: string) { const found = body().findAll('label').find(node => node.text() === label && node.attributes('for')); expect(found, `visible label ${label}`).toBeDefined(); const element = document.getElementById(found!.attributes('for')!); expect(element, `native control ${label}`).not.toBeNull(); return new DOMWrapper(element!); }
function button(label: string) { const found = body().findAll('button').find(node => node.text() === label) ?? body().findAll('button').find(node => node.text().includes(label)); expect(found, `visible button ${label}`).toBeDefined(); return found!; }
async function click(label: string) { (button(label).element as HTMLButtonElement).click(); await flushPromises(); }
async function save() { (body().get('button[type="submit"]').element as HTMLButtonElement).click(); await flushPromises(); }
const writes = (method = 'put') => wire.filter(request => request.method === method && request.path === (method === 'post' ? '/admin/accounts' : '/admin/accounts/101'));
async function vertex(platform = 'Anthropic') { const view = await render('create'); if (platform === 'Gemini')
    await click('Gemini'); await click('admin.accounts.vertexLabel'); await field('admin.accounts.accountName').setValue('Synthetic Vertex101'); return view; }
const jsonCredential = { type: 'service_account', project_id: 'synthetic-project101', client_email: 'synthetic101@example.test', private_key: 'SYNTHETIC_PRIVATE_NOT_A_KEY' };
async function upload(contents: string) { const file = new File([contents], 'synthetic101.json', { type: 'application/json' }); Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) }); const input = body().get('input[type="file"]').element as HTMLInputElement; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true })); await flushPromises(); }
function advanced(type: 'oauth' | 'setup-token' = 'oauth', patch: Record<string, unknown> = {}) {
    const extra = { synthetic_preserved_extra: { owner: '101' }, window_cost_limit: 100, window_cost_sticky_reserve: 12, max_sessions: 4, session_idle_timeout_minutes: 6, base_rpm: 25, rpm_strategy: 'tiered', rpm_sticky_buffer: 8, user_msg_queue_mode: 'throttle', enable_tls_fingerprint: true, tls_fingerprint_profile_id: 71, session_id_masking_enabled: true, cache_ttl_override_enabled: true, cache_ttl_override_target: '5m', custom_base_url_enabled: true, custom_base_url: 'https://saved101.example.test', ...patch };
    return account({ type, extra, window_cost_limit: 100, window_cost_sticky_reserve: 12, max_sessions: 4, session_idle_timeout_minutes: 6, base_rpm: 25, rpm_strategy: 'tiered', rpm_sticky_buffer: 8, user_msg_queue_mode: 'throttle', enable_tls_fingerprint: true, tls_fingerprint_profile_id: 71, session_id_masking_enabled: true, cache_ttl_override_enabled: true, cache_ttl_override_target: '5m', custom_base_url_enabled: true, custom_base_url: 'https://saved101.example.test' });
}
async function toggle(label: string) { (body().get(`button[role="switch"][aria-label="${label}"]`).element as HTMLButtonElement).click(); await flushPromises(); }
beforeEach(() => { wire = []; unexpected = []; route = normal; Object.values(notices).forEach(mock => mock.mockReset()); localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-configuration101-admin', user: { id: 101, role: 'admin' } }); apiClient.defaults.adapter = async (config) => { const request: Wire = { method: config.method ?? 'get', path: String(config.url), body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {}, config }; wire.push(request); const result = await route(request); return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: result } }; }; vi.spyOn(console, 'error').mockImplementation(() => { }); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { views.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks(); document.body.innerHTML = ''; expect(unexpected).toEqual([]); });
describe('Account modal native configuration through actual JSON account client', () => {
    it.each([['{invalid', 'admin.accounts.vertexSaJsonInvalid'], [JSON.stringify({ project_id: 'missing101' }), 'admin.accounts.vertexSaJsonMissingFields']])('rejects the uploaded invalid service-account document %s then accepts a corrected file', async (content, message) => {
        const view = await vertex();
        await upload(content!);
        expect(notices.error).toHaveBeenCalledWith(message);
        await save();
        expect(writes('post')).toEqual([]);
        expect(view.emitted('created')).toBeUndefined();
        await upload(JSON.stringify(jsonCredential));
        expect((field('Project ID').element as HTMLInputElement).value).toBe('synthetic-project101');
        await save();
        expect(writes('post')).toHaveLength(1);
        expect(JSON.parse(writes('post')[0]!.body.credentials.service_account_json)).toEqual(jsonCredential);
        expect(view.emitted('created')).toHaveLength(1);
    });
    it.each(['Anthropic', 'Gemini'])('imports a native %s Vertex JSON file and submits its readonly project and selected location', async (platform) => {
        const view = await vertex(platform);
        await upload(JSON.stringify(jsonCredential));
        expect((field('Project ID').element as HTMLInputElement).readOnly).toBe(true);
        await field('Location').setValue('us-central1');
        await save();
        expect(writes('post')).toHaveLength(1);
        expect(writes('post')[0]!.body).toMatchObject({ name: 'Synthetic Vertex101', platform: platform.toLowerCase(), type: 'service_account', credentials: { project_id: 'synthetic-project101', client_email: 'synthetic101@example.test', location: 'us-central1', tier_id: 'vertex' } });
        expect(JSON.parse(writes('post')[0]!.body.credentials.service_account_json)).toEqual(jsonCredential);
        expect(view.emitted('created')).toHaveLength(1);
        expect(view.emitted('close')).toHaveLength(1);
    });
    it('clears the imported Vertex document and project when cancellation is followed by reopening', async () => {
        const view = await vertex();
        await upload(JSON.stringify(jsonCredential));
        await click('common.cancel');
        await view.setProps({ show: false });
        await view.setProps({ show: true });
        await flushPromises();
        await click('admin.accounts.vertexLabel');
        expect((field('Project ID').element as HTMLInputElement).value).toBe('');
        expect(body().text()).not.toContain('synthetic101@example.test');
        expect(writes('post')).toEqual([]);
    });
    it.each(['oauth', 'setup-token'] as const)('loads and edits the existing %s scheduling/privacy controls without losing unrelated extra or credentials', async (type) => {
        const view = await render('edit', advanced(type));
        expect((field('admin.accounts.quotaControl.windowCost.limit').element as HTMLInputElement).value).toBe('100');
        await field('admin.accounts.quotaControl.windowCost.limit').setValue('140');
        await field('admin.accounts.quotaControl.windowCost.stickyReserve').setValue('16');
        await field('admin.accounts.quotaControl.sessionLimit.maxSessions').setValue('7');
        await field('admin.accounts.quotaControl.sessionLimit.idleTimeout').setValue('9');
        await field('admin.accounts.quotaControl.rpmLimit.baseRpm').setValue('35');
        await click('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt');
        await click('admin.accounts.quotaControl.rpmLimit.umqModeSerialize');
        await field('admin.accounts.quotaControl.cacheTTLOverride.target').setValue('1h');
        await field('admin.accounts.quotaControl.customBaseUrl.label').setValue(' https://edited101.example.test/relay ');
        await save();
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.body.extra).toMatchObject({ synthetic_preserved_extra: { owner: '101' }, window_cost_limit: 140, window_cost_sticky_reserve: 16, max_sessions: 7, session_idle_timeout_minutes: 9, base_rpm: 35, rpm_strategy: 'sticky_exempt', user_msg_queue_mode: 'serialize', enable_tls_fingerprint: true, tls_fingerprint_profile_id: 71, session_id_masking_enabled: true, cache_ttl_override_enabled: true, cache_ttl_override_target: '1h', custom_base_url_enabled: true, custom_base_url: 'https://edited101.example.test/relay' });
        expect(writes()[0]!.body.credentials).toHaveProperty('synthetic_preserved_credential', 'keep');
        expect(view.emitted('updated')).toHaveLength(1);
    });
    it.each(['oauth', 'setup-token'] as const)('retains an existing random TLS profile for a %s DTO that omits its negative flattened ID', async (type) => {
        // The actual Go mapper emits flattened tls_fingerprint_profile_id only for >0.
        // The service explicitly supports stored extra=-1 as its random profile sentinel.
        const value = advanced(type, { tls_fingerprint_profile_id: -1 });
        delete value.tls_fingerprint_profile_id;
        await render('edit', value);
        await field('common.name').setValue('Renamed random-profile101');
        await save();
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.body.extra).toHaveProperty('tls_fingerprint_profile_id', -1);
        expect(writes()[0]!.body.extra.enable_tls_fingerprint).toBe(true);
    });
    it('lets the administrator explicitly select the existing random TLS option through its native control', async () => {
        await render('edit', advanced());
        await field('admin.accounts.quotaControl.tlsFingerprint.label').setValue('-1');
        await save();
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.body.extra).toMatchObject({ enable_tls_fingerprint: true, tls_fingerprint_profile_id: -1, synthetic_preserved_extra: { owner: '101' } });
    });
    it('keeps the built-in default unbound when the saved account has no TLS profile selection', async () => {
        const value = advanced();
        delete value.tls_fingerprint_profile_id;
        delete value.extra!.tls_fingerprint_profile_id;
        await render('edit', value);
        expect((field('admin.accounts.quotaControl.tlsFingerprint.label').element as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('admin.accounts.quotaControl.tlsFingerprint.defaultProfile');
        await save();
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.body.extra.enable_tls_fingerprint).toBe(true);
        expect(writes()[0]!.body.extra).not.toHaveProperty('tls_fingerprint_profile_id');
    });
    it('removes only disabled advanced options and preserves independent unknown metadata', async () => {
        await render('edit', advanced());
        await toggle('admin.accounts.quotaControl.windowCost.label');
        await toggle('admin.accounts.quotaControl.sessionLimit.label');
        await toggle('admin.accounts.quotaControl.rpmLimit.label');
        await toggle('admin.accounts.quotaControl.tlsFingerprint.label');
        await toggle('admin.accounts.quotaControl.sessionIdMasking.label');
        await toggle('admin.accounts.quotaControl.cacheTTLOverride.label');
        await toggle('admin.accounts.quotaControl.customBaseUrl.label');
        await save();
        expect(writes()).toHaveLength(1);
        const extra = writes()[0]!.body.extra;
        expect(extra).toHaveProperty('synthetic_preserved_extra', { owner: '101' });
        expect(extra).toHaveProperty('user_msg_queue_mode', 'throttle');
        for (const key of ['window_cost_limit', 'window_cost_sticky_reserve', 'max_sessions', 'session_idle_timeout_minutes', 'base_rpm', 'rpm_strategy', 'rpm_sticky_buffer', 'enable_tls_fingerprint', 'tls_fingerprint_profile_id', 'session_id_masking_enabled', 'cache_ttl_override_enabled', 'cache_ttl_override_target', 'custom_base_url_enabled', 'custom_base_url'])
            expect(extra).not.toHaveProperty(key);
    });
    it('keeps an advanced failed-write draft retryable and rehydrates saved values after cancellation', async () => {
        const saved = advanced();
        const view = await render('edit', saved);
        let attempts = 0;
        route = async (request) => { if (request.method === 'put' && ++attempts === 1)
            throw failed(request); return normal(request); };
        await field('admin.accounts.quotaControl.windowCost.limit').setValue('155');
        await save();
        expect(notices.error).toHaveBeenCalled();
        expect((field('admin.accounts.quotaControl.windowCost.limit').element as HTMLInputElement).value).toBe('155');
        await click('common.cancel');
        expect(view.emitted('close')).toHaveLength(1);
        await view.setProps({ show: false });
        await view.setProps({ show: true });
        await flushPromises();
        expect((field('admin.accounts.quotaControl.windowCost.limit').element as HTMLInputElement).value).toBe('100');
        await field('admin.accounts.quotaControl.windowCost.limit').setValue('155');
        await save();
        expect(writes()).toHaveLength(2);
        expect(writes().map(request => request.body.extra.window_cost_limit)).toEqual([155, 155]);
    });
    it('edits a Vertex mapping while retaining a redacted service-account secret and unrelated credentials', async () => {
        const value = account({ type: 'service_account', credentials: { project_id: 'saved-project101', client_email: 'saved101@example.test', location: 'us-central1', tier_id: 'vertex', model_mapping: { 'request101': 'old-model101' }, synthetic_preserved_credential: 'keep' }, credentials_status: { has_service_account_json: true } });
        await render('edit', value);
        await click('admin.accounts.modelMapping');
        const mapped = body().findAll('input[aria-label="admin.accounts.actualModel"]');
        expect(mapped).toHaveLength(1);
        await mapped[0]!.setValue('new-upstream101');
        expect((body().get('form').element as HTMLFormElement).checkValidity()).toBe(true);
        await save();
        expect(notices.error.mock.calls).toEqual([]);
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.body.credentials).toMatchObject({ model_mapping: { request101: 'new-upstream101' }, project_id: 'saved-project101', synthetic_preserved_credential: 'keep' });
        expect(writes()[0]!.body.credentials).not.toHaveProperty('service_account_json');
    });
});
