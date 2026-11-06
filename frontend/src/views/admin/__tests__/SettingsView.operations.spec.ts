import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { AxiosError } from 'axios'
import SettingsView from '../SettingsView.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({
  getSettings: vi.fn(), getWebSearchEmulationConfig: vi.fn(), getAdminApiKey: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn(), updateUpstreamBillingProbeSettings: vi.fn(),
  getOllamaCloudUsageSettings: vi.fn(), updateOllamaCloudUsageSettings: vi.fn(),
  getOpenCodeGoUsageSettings: vi.fn(), updateOpenCodeGoUsageSettings: vi.fn(),
  getOverloadCooldownSettings: vi.fn(), updateOverloadCooldownSettings: vi.fn(),
  getPanelRateLimitSettings: vi.fn(), updatePanelRateLimitSettings: vi.fn(),
  getRateLimit429CooldownSettings: vi.fn(), updateRateLimit429CooldownSettings: vi.fn(),
  getStreamTimeoutSettings: vi.fn(), updateStreamTimeoutSettings: vi.fn(),
  getRectifierSettings: vi.fn(), updateRectifierSettings: vi.fn(),
  getBetaPolicySettings: vi.fn(), updateBetaPolicySettings: vi.fn(),
  updateSettings: vi.fn(), groups: vi.fn(), proxies: vi.fn(), providers: vi.fn(),
  showError: vi.fn(), showSuccess: vi.fn(),
}))
const {
  updateUpstreamBillingProbeSettings, updateOllamaCloudUsageSettings, updateOpenCodeGoUsageSettings,
  updateOverloadCooldownSettings, updatePanelRateLimitSettings, updateRateLimit429CooldownSettings,
  updateStreamTimeoutSettings, updateRectifierSettings, updateBetaPolicySettings,
  getRectifierSettings, getBetaPolicySettings, showError, showSuccess, updateSettings,
} = api

vi.mock('@/api', () => ({ adminAPI: {
  settings: {
    getSettings: api.getSettings, getWebSearchEmulationConfig: api.getWebSearchEmulationConfig, getAdminApiKey: api.getAdminApiKey,
    getOverloadCooldownSettings: api.getOverloadCooldownSettings, updateOverloadCooldownSettings: api.updateOverloadCooldownSettings,
    getPanelRateLimitSettings: api.getPanelRateLimitSettings, updatePanelRateLimitSettings: api.updatePanelRateLimitSettings,
    getRateLimit429CooldownSettings: api.getRateLimit429CooldownSettings, updateRateLimit429CooldownSettings: api.updateRateLimit429CooldownSettings,
    getStreamTimeoutSettings: api.getStreamTimeoutSettings, updateStreamTimeoutSettings: api.updateStreamTimeoutSettings,
    getRectifierSettings: api.getRectifierSettings, updateRectifierSettings: api.updateRectifierSettings,
    getBetaPolicySettings: api.getBetaPolicySettings, updateBetaPolicySettings: api.updateBetaPolicySettings, updateSettings: api.updateSettings,
  },
  accounts: {
    getUpstreamBillingProbeSettings: api.getUpstreamBillingProbeSettings, updateUpstreamBillingProbeSettings: api.updateUpstreamBillingProbeSettings,
    getOllamaCloudUsageSettings: api.getOllamaCloudUsageSettings, updateOllamaCloudUsageSettings: api.updateOllamaCloudUsageSettings,
    getOpenCodeGoUsageSettings: api.getOpenCodeGoUsageSettings, updateOpenCodeGoUsageSettings: api.updateOpenCodeGoUsageSettings,
  },
  groups: { getAll: api.groups }, proxies: { list: api.proxies }, payment: { getProviders: api.providers },
} }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: api.showError, showSuccess: api.showSuccess }) }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => ({ fetch: vi.fn() }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: vi.fn() }) }))
vi.mock('@/api/admin/affiliates', () => {
  const affiliates = { listUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }) }
  return { default: affiliates, affiliatesAPI: affiliates }
})
vi.mock('vue-i18n', async () => {
  const translations: Record<string, string> = { 'admin.settings.upstreamBillingProbe.title': '上游倍率自动探测', 'admin.settings.upstreamBillingProbe.saved': '上游倍率自动探测设置已保存' }
  return { ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => translations[key] ?? key, locale: ref('zh-CN') }) }
})

const Toggle = defineComponent({
  props: { modelValue: Boolean }, emits: ['update:modelValue'], inheritAttrs: false,
  setup(props, { attrs, emit }) {
    return () => h('input', { ...attrs, type: 'checkbox', checked: props.modelValue,
      onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked),
    })
  },
})
const mounted: VueWrapper[] = []
function mountWorkflow() {
  const wrapper = mount(SettingsView, { global: { stubs: {
    AppLayout: { template: '<div><slot/></div>' }, Toggle, Icon: true, ConfirmDialog: true,
    PaymentProviderList: true, PaymentProviderDialog: true, GroupBadge: true, GroupOptionItem: true,
    ProxySelector: true, ImageUpload: true, BackupSettings: true, AdminAccessKeysSettings: true, EmailTemplateEditor: true,
    RouterLink: { template: '<a><slot/></a>' },
  } } })
  mounted.push(wrapper)
  return wrapper
}
const card = (wrapper: VueWrapper, title: string) => {
  const panel = wrapper.findAll('.card').find(panel => panel.findAll('h2,h3').some(heading => heading.text() === title))
  expect(panel, title).toBeDefined()
  return panel!
}
async function openTab(wrapper: VueWrapper, tab: string) { await wrapper.get(`#settings-tab-${tab}`).trigger('click'); await flushPromises() }

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset())
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-independent-ops-admin', user: { id: 7 } })
  api.getSettings.mockResolvedValue({ site_name: 'Synthetic operations settings', backend_mode_enabled: false })
  api.getWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] })
  api.getAdminApiKey.mockResolvedValue({ exists: false, masked_key: '' })
  api.groups.mockResolvedValue([]); api.proxies.mockResolvedValue({ items: [] }); api.providers.mockResolvedValue({ data: [] })
  api.getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: true, interval_minutes: 30 })
  api.getOllamaCloudUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 60, debounce_minutes: 1 })
  api.getOpenCodeGoUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 15, debounce_minutes: 1 })
  api.getOverloadCooldownSettings.mockResolvedValue({ enabled: true, cooldown_minutes: 10 })
  api.getPanelRateLimitSettings.mockResolvedValue({ enabled: true, user_rpm: 240, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 })
  api.getRateLimit429CooldownSettings.mockResolvedValue({ enabled: true, cooldown_seconds: 5 })
  api.getStreamTimeoutSettings.mockResolvedValue({ enabled: true, action: 'temp_unsched', temp_unsched_minutes: 5, threshold_count: 3, threshold_window_minutes: 10 })
  api.getRectifierSettings.mockResolvedValue({ enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true, apikey_signature_enabled: false, apikey_signature_patterns: [] })
  api.getBetaPolicySettings.mockResolvedValue({ rules: [] })
})
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

    describe('Independent ops save ownership', () => {
      const ops = [
        { id: 'cooldown', title: 'admin.settings.overloadCooldown.title', save: updateOverloadCooldownSettings, method: 'updateOverloadCooldownSettings', domain: 'settings',
          url: '/admin/settings/overload-cooldown', selector: 'input[type="number"]', first: '18', later: '21',
          expected: { enabled: true, cooldown_minutes: 18 }, success: 'admin.settings.overloadCooldown.saved' },
        { id: 'billing', title: '上游倍率自动探测', save: updateUpstreamBillingProbeSettings, method: 'updateUpstreamBillingProbeSettings', domain: 'accounts',
          url: '/admin/accounts/upstream-billing-probe/settings', selector: 'input[type="number"]', first: '90', later: '120',
          expected: { enabled: true, interval_minutes: 90 }, success: '上游倍率自动探测设置已保存' },
        { id: 'ollama', title: 'admin.settings.ollamaCloudUsage.title', save: updateOllamaCloudUsageSettings, method: 'updateOllamaCloudUsageSettings', domain: 'accounts', enable: true,
          url: '/admin/accounts/ollama-cloud-usage/settings', selector: 'input[type="number"]', first: '4', later: '5',
          expected: { enabled: true, interval_minutes: 60, debounce_minutes: 4 }, success: 'admin.settings.ollamaCloudUsage.saved' },
        { id: 'opencode', title: 'admin.settings.opencodeGoUsage.title', save: updateOpenCodeGoUsageSettings, method: 'updateOpenCodeGoUsageSettings', domain: 'accounts', enable: true,
          url: '/admin/accounts/opencode-go-usage/settings', selector: 'input[type="number"]', first: '3', later: '4',
          expected: { enabled: true, interval_minutes: 15, debounce_minutes: 3 }, success: 'admin.settings.opencodeGoUsage.saved' },
        { id: 'panel', title: 'admin.settings.panelRateLimit.title', save: updatePanelRateLimitSettings, method: 'updatePanelRateLimitSettings', domain: 'settings', tab: 'security',
          url: '/admin/settings/panel-rate-limit', selector: '[data-testid="panel-rate-limit-user-rpm"]', first: '120', later: '180',
          expected: { enabled: true, user_rpm: 120, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 }, success: 'admin.settings.panelRateLimit.saved' },
        { id: '429', title: 'admin.settings.rateLimit429Cooldown.title', save: updateRateLimit429CooldownSettings, method: 'updateRateLimit429CooldownSettings', domain: 'settings',
          url: '/admin/settings/rate-limit-429-cooldown', selector: 'input[type="number"]', first: '45', later: '61',
          expected: { enabled: true, cooldown_seconds: 45 }, success: 'admin.settings.rateLimit429Cooldown.saved' },
        { id: 'stream', title: 'admin.settings.streamTimeout.title', save: updateStreamTimeoutSettings, method: 'updateStreamTimeoutSettings', domain: 'settings',
          url: '/admin/settings/stream-timeout', selector: 'input[type="number"]', first: '17', later: '23',
          expected: { enabled: true, action: 'temp_unsched', temp_unsched_minutes: 17, threshold_count: 3, threshold_window_minutes: 10 }, success: 'admin.settings.streamTimeout.saved' },
        { id: 'rectifier', title: 'admin.settings.rectifier.title', save: updateRectifierSettings, method: 'updateRectifierSettings', domain: 'settings',
          url: '/admin/settings/rectifier', selector: '[placeholder="admin.settings.rectifier.apikeyPatternPlaceholder"]', first: 'synthetic-submitted-pattern', later: 'synthetic-unsaved-pattern',
          expected: { enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true, apikey_signature_enabled: true, apikey_signature_patterns: ['synthetic-submitted-pattern'] }, success: 'admin.settings.rectifier.saved',
          setup: () => getRectifierSettings.mockResolvedValueOnce({ enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true, apikey_signature_enabled: true, apikey_signature_patterns: ['synthetic-initial-pattern'] }) },
        { id: 'beta', title: 'admin.settings.betaPolicy.title', save: updateBetaPolicySettings, method: 'updateBetaPolicySettings', domain: 'settings',
          url: '/admin/settings/beta-policy', selector: '[placeholder="admin.settings.betaPolicy.errorMessagePlaceholder"]', first: 'Synthetic submitted policy message', later: 'Synthetic unsaved policy message',
          expected: { rules: [{ beta_token: 'context-1m-2025-08-07', action: 'block', scope: 'all', error_message: 'Synthetic submitted policy message', model_whitelist: ['synthetic-model'], fallback_action: 'pass' }] }, success: 'admin.settings.betaPolicy.saved',
          setup: () => getBetaPolicySettings.mockResolvedValueOnce({ rules: [{ beta_token: 'context-1m-2025-08-07', action: 'block', scope: 'all', error_message: 'Synthetic initial policy message', model_whitelist: ['synthetic-model'], fallback_action: 'pass' }] }) },
      ];
      type Ops = (typeof ops)[number];
      function pendingResponse() { let resolve!: () => void; const promise = new Promise<void>(res => { resolve = res; }); return { promise, resolve }; }
      const saveButton = (panel: ReturnType<typeof card>) => panel.findAll('button').find(node => node.text() === 'common.save' || node.text() === 'common.saving')!;
      async function prepareOps(setting: Ops) {
        replaceAuthSession({ accessToken: 'synthetic-independent-ops-admin', user: { id: 7 } });
        setting.setup?.();
        const wrapper = mountWorkflow(); await flushPromises();
        await openTab(wrapper, setting.tab ?? 'gateway');
        const panel = card(wrapper, setting.title);
        if (setting.enable) await panel.get('input[type="checkbox"]').setValue(true);
        await panel.get(setting.selector).setValue(setting.first);
        return { wrapper, panel };
      }
      async function realOpsWire(setting: Ops, run: (wire: Array<{ method?: string, url?: string, body: unknown }>, client: typeof import('@/api/client')['apiClient']) => Promise<void>) {
        const { apiClient } = await import('@/api/client');
        const actual = setting.domain === 'accounts'
          ? await vi.importActual<Record<string, (...args: any[]) => Promise<any>>>('@/api/admin/accounts')
          : await vi.importActual<Record<string, (...args: any[]) => Promise<any>>>('@/api/admin/settings');
        setting.save.mockImplementation(actual[setting.method]);
        const original = apiClient.defaults.adapter;
        try { await run([], apiClient); } finally { apiClient.defaults.adapter = original; }
      }
      const checkWire = (wire: Array<{ method?: string, url?: string, body: unknown }>, setting: Ops) => {
        expect(wire[0]).toEqual({ method: 'put', url: setting.url, body: setting.expected });
      };

      it.each(ops)('submits the actual $id endpoint and numeric/nested JSON contract', async setting => {
        const { panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data); wire.push({ method: config.method, url: config.url, body });
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          await saveButton(panel).trigger('click'); await flushPromises();
          checkWire(wire, setting);
          expect(wire).toHaveLength(1);
          expect(showSuccess).toHaveBeenCalledExactlyOnceWith(setting.success);
          expect(showError).not.toHaveBeenCalled();
          expect(updateSettings).not.toHaveBeenCalled();
        });
      });

      it.each(ops)('does not publish a same-login late $id save after its page unmounts', async setting => {
        const { wrapper, panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          const pending = pendingResponse();
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data); wire.push({ method: config.method, url: config.url, body }); await pending.promise;
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          try {
            await saveButton(panel).trigger('click'); await flushPromises(); checkWire(wire, setting);
            wrapper.unmount(); mounted.splice(mounted.indexOf(wrapper), 1);
            pending.resolve(); await flushPromises();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(showError).not.toHaveBeenCalled();
            expect(wire).toHaveLength(1);
          } finally { pending.resolve(); await flushPromises(); }
        });
      });

      it.each(ops)('does not toast a cancelled $id save after the same administrator signs in again', async setting => {
        const { panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          const pending = pendingResponse();
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data); wire.push({ method: config.method, url: config.url, body }); await pending.promise;
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          try {
            await saveButton(panel).trigger('click'); await flushPromises(); checkWire(wire, setting);
            replaceAuthSession({ accessToken: 'synthetic-independent-ops-relogin', user: { id: 7 } });
            pending.resolve(); await flushPromises();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(showError).not.toHaveBeenCalled();
            expect(wire).toHaveLength(1);
          } finally { pending.resolve(); await flushPromises(); }
        });
      });

      it.each(ops)('locks queued native $id save clicks before Vue applies the disabled state', async setting => {
        const { panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          const pending = pendingResponse();
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data); wire.push({ method: config.method, url: config.url, body }); await pending.promise;
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          try {
            const save = saveButton(panel).element as HTMLButtonElement;
            save.click(); save.click(); await flushPromises();
            checkWire(wire, setting);
            expect(wire).toHaveLength(1);
            expect(save.disabled).toBe(true);
          } finally { pending.resolve(); await flushPromises(); }
        });
      });

      it.each(ops)('keeps editable $id values typed after dispatch when the earlier response arrives', async setting => {
        const { panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          const pending = pendingResponse();
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data); wire.push({ method: config.method, url: config.url, body }); await pending.promise;
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          try {
            await saveButton(panel).trigger('click'); await flushPromises(); checkWire(wire, setting);
            expect(panel.get<HTMLInputElement>(setting.selector).element.disabled).toBe(false);
            await panel.get(setting.selector).setValue(setting.later);
            expect(wire[0].body).toEqual(setting.expected);
            pending.resolve(); await flushPromises();
            expect(panel.get<HTMLInputElement>(setting.selector).element.value).toBe(setting.later);
            expect(showSuccess).not.toHaveBeenCalled();
            expect(showError).not.toHaveBeenCalled();
            expect(saveButton(panel).attributes('disabled')).toBeUndefined();
            await saveButton(panel).trigger('click'); await flushPromises();
            expect(wire).toHaveLength(2);
            expect(wire[1]).toMatchObject({ method: 'put', url: setting.url });
            expect(wire[1].body).not.toEqual(wire[0].body);
            expect(panel.get<HTMLInputElement>(setting.selector).element.value).toBe(setting.later);
            expect(showSuccess).toHaveBeenCalledExactlyOnceWith(setting.success);
          } finally { pending.resolve(); await flushPromises(); }
        });
      });

      it.each(ops)('unlocks the $id draft after an obsolete HTTP error and submits its new value only on retry', async setting => {
        const { panel } = await prepareOps(setting);
        await realOpsWire(setting, async (wire, client) => {
          const pending = pendingResponse();
          client.defaults.adapter = async config => {
            const body = JSON.parse(config.data);
            wire.push({ method: config.method, url: config.url, body });
            const index = wire.length;
            await pending.promise;
            if (index === 1) throw new AxiosError('Synthetic obsolete conflict', AxiosError.ERR_BAD_REQUEST, config, undefined, {
              config, status: 409, statusText: 'Conflict', headers: {}, data: { message: 'Synthetic obsolete conflict' },
            });
            return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: body } };
          };
          try {
            await saveButton(panel).trigger('click'); await flushPromises(); checkWire(wire, setting);
            await panel.get(setting.selector).setValue(setting.later);
            pending.resolve(); await flushPromises();
            expect(panel.get<HTMLInputElement>(setting.selector).element.value).toBe(setting.later);
            expect(showError).not.toHaveBeenCalled();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(saveButton(panel).attributes('disabled')).toBeUndefined();
            await saveButton(panel).trigger('click'); await flushPromises();
            expect(wire).toHaveLength(2);
            expect(wire[1]).toMatchObject({ method: 'put', url: setting.url });
            expect(wire[1].body).not.toEqual(wire[0].body);
            expect(panel.get<HTMLInputElement>(setting.selector).element.value).toBe(setting.later);
            expect(showSuccess).toHaveBeenCalledExactlyOnceWith(setting.success);
          } finally { pending.resolve(); await flushPromises(); }
        });
      });
    });

