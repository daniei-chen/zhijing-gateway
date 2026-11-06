import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";

import enCommon from "@/i18n/locales/en/common";
import enSettings from "@/i18n/locales/en/admin/settings";
import zhCommon from "@/i18n/locales/zh/common";
import zhSettings from "@/i18n/locales/zh/admin/settings";
import SettingsView from "../SettingsView.vue";
import { AuthSessionChangedError, replaceAuthSession } from "@/api/authSession";

const {
  getSettings,
  updateSettings,
  getWebSearchEmulationConfig,
  updateWebSearchEmulationConfig,
  getAdminApiKey,
  getOverloadCooldownSettings,
  getRateLimit429CooldownSettings,
  updateRateLimit429CooldownSettings,
  getPanelRateLimitSettings,
  updatePanelRateLimitSettings,
  getStreamTimeoutSettings,
  getRectifierSettings,
  getBetaPolicySettings,
  getUpstreamBillingProbeSettings,
  updateUpstreamBillingProbeSettings,
  getOllamaCloudUsageSettings,
  updateOllamaCloudUsageSettings,
  getGroups,
  listProxies,
  getProviders,
  updateProvider,
  createProvider,
  deleteProvider,
  fetchPublicSettings,
  adminSettingsFetch,
  showError,
  showSuccess,
  testSmtpConnection,
  sendTestEmail,
  testWebSearchEmulation,
  resetWebSearchUsage,
  updateOverloadCooldownSettings,
  updateStreamTimeoutSettings,
  updateRectifierSettings,
  updateBetaPolicySettings,
  getOpenCodeGoUsageSettings,
  updateOpenCodeGoUsageSettings,
  totpStepUp,
} = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getWebSearchEmulationConfig: vi.fn(),
  updateWebSearchEmulationConfig: vi.fn(),
  getAdminApiKey: vi.fn(),
  getOverloadCooldownSettings: vi.fn(),
  getRateLimit429CooldownSettings: vi.fn(),
  updateRateLimit429CooldownSettings: vi.fn(),
  getPanelRateLimitSettings: vi.fn().mockResolvedValue({
    enabled: true,
    user_rpm: 240,
    heavy_rpm: 60,
    exempt_admin: true,
    public_ip_rpm: 300,
  }),
  updatePanelRateLimitSettings: vi.fn().mockImplementation(async (payload) => payload),
  getStreamTimeoutSettings: vi.fn(),
  getRectifierSettings: vi.fn(),
  getBetaPolicySettings: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({
    enabled: true,
    interval_minutes: 30,
  }),
  updateUpstreamBillingProbeSettings: vi.fn().mockImplementation(async (payload) => payload),
  getOllamaCloudUsageSettings: vi.fn().mockResolvedValue({
    enabled: false,
    interval_minutes: 60,
    debounce_minutes: 1,
  }),
  updateOllamaCloudUsageSettings: vi.fn().mockImplementation(async (payload) => payload),
  getGroups: vi.fn(),
  listProxies: vi.fn(),
  getProviders: vi.fn(),
  updateProvider: vi.fn(),
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  fetchPublicSettings: vi.fn(),
  adminSettingsFetch: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  testSmtpConnection: vi.fn(),
  sendTestEmail: vi.fn(),
  testWebSearchEmulation: vi.fn(),
  resetWebSearchUsage: vi.fn(),
  updateOverloadCooldownSettings: vi.fn(),
  updateStreamTimeoutSettings: vi.fn(),
  updateRectifierSettings: vi.fn(),
  updateBetaPolicySettings: vi.fn(),
  getOpenCodeGoUsageSettings: vi.fn(),
  updateOpenCodeGoUsageSettings: vi.fn(),
  totpStepUp: vi.fn(),
}));

const localeRef = vi.hoisted(() => ({ value: "zh-CN" }));

vi.mock("@/api", () => ({
  totpAPI: { stepUp: totpStepUp },
  adminAPI: {
    settings: {
      getSettings,
      updateSettings,
      getWebSearchEmulationConfig,
      updateWebSearchEmulationConfig,
      getAdminApiKey,
      getOverloadCooldownSettings,
      getRateLimit429CooldownSettings,
      updateRateLimit429CooldownSettings,
      getPanelRateLimitSettings,
      updatePanelRateLimitSettings,
      getStreamTimeoutSettings,
      getRectifierSettings,
      getBetaPolicySettings,
      testSmtpConnection,
      sendTestEmail,
      testWebSearchEmulation,
      resetWebSearchUsage,
      updateOverloadCooldownSettings,
      updateStreamTimeoutSettings,
      updateRectifierSettings,
      updateBetaPolicySettings,
    },
    accounts: {
      getUpstreamBillingProbeSettings,
      updateUpstreamBillingProbeSettings,
      getOllamaCloudUsageSettings,
      updateOllamaCloudUsageSettings,
      getOpenCodeGoUsageSettings,
      updateOpenCodeGoUsageSettings,
    },
    groups: {
      getAll: getGroups,
    },
    proxies: {
      list: listProxies,
    },
    payment: {
      getProviders,
      updateProvider,
      createProvider,
      deleteProvider,
    },
  },
}));

vi.mock("@/stores", () => ({
  useAppStore: () => ({
    showError,
    showSuccess,
    showWarning: vi.fn(),
    showInfo: vi.fn(),
    fetchPublicSettings,
  }),
}));

vi.mock("@/stores/adminSettings", () => ({
  useAdminSettingsStore: () => ({
    fetch: adminSettingsFetch,
  }),
}));

vi.mock("@/composables/useClipboard", () => ({
  useClipboard: () => ({
    copyToClipboard: vi.fn(),
  }),
}));

vi.mock("@/utils/apiError", () => ({
  extractApiErrorMessage: () => "error",
  extractI18nErrorMessage: () => "error",
}));

vi.mock("@/api/admin/affiliates", () => {
  const api = {
    listUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  return { default: api, affiliatesAPI: api };
});

vi.mock("vue-i18n", async () => {
  const actual = await vi.importActual<typeof import("vue-i18n")>("vue-i18n");
  const translations: Record<string, string> = {
    "admin.settings.wechatConnect.title": "微信登录",
    "admin.settings.wechatConnect.description": "用于微信开放平台或公众号/小程序的第三方登录配置。",
    "admin.settings.wechatConnect.enabledLabel": "启用微信登录",
    "admin.settings.wechatConnect.enabledHint": "开启后可使用微信第三方登录回调与授权配置。",
    "admin.settings.wechatConnect.appIdLabel": "AppID",
    "admin.settings.wechatConnect.appIdPlaceholder": "微信开放平台 AppID",
    "admin.settings.wechatConnect.appSecretLabel": "AppSecret",
    "admin.settings.wechatConnect.appSecretConfiguredPlaceholder": "密钥已配置，留空以保留当前值。",
    "admin.settings.wechatConnect.appSecretPlaceholder": "微信开放平台 AppSecret",
    "admin.settings.wechatConnect.appSecretConfiguredHint": "密钥已配置，留空以保留当前值。",
    "admin.settings.wechatConnect.appSecretHint": "填写后会覆盖当前微信密钥。",
    "admin.settings.wechatConnect.modeLabel": "模式",
    "admin.settings.wechatConnect.openModeLabel": "非微信环境使用开放平台",
    "admin.settings.wechatConnect.openModeHint": "浏览器不在微信内时，自动走开放平台扫码授权。",
    "admin.settings.wechatConnect.mpModeLabel": "微信环境使用公众号",
    "admin.settings.wechatConnect.mpModeHint": "浏览器在微信内时，自动走公众号授权。",
    "admin.settings.wechatConnect.redirectUrlLabel": "回调地址",
    "admin.settings.wechatConnect.redirectUrlPlaceholder": "https://your-site.com/api/v1/auth/oauth/wechat/callback",
    "admin.settings.wechatConnect.generateAndCopy": "使用当前站点生成并复制",
    "admin.settings.wechatConnect.redirectUrlSetAndCopied": "已使用当前站点生成回调地址并复制到剪贴板",
    "admin.settings.wechatConnect.frontendRedirectUrlLabel": "前端回调地址",
    "admin.settings.wechatConnect.frontendRedirectUrlPlaceholder": "/auth/wechat/callback",
    "admin.settings.wechatConnect.frontendRedirectUrlHint": "通常用于前端路由回调地址，需与后端配置保持一致。",
    "admin.settings.authSourceDefaults.title": "认证来源默认值",
    "admin.settings.authSourceDefaults.description": "按注册来源配置新用户默认余额、并发、订阅与授权策略。",
    "admin.settings.authSourceDefaults.requireEmailLabel": "第三方注册强制补充邮箱",
    "admin.settings.authSourceDefaults.requireEmailHint": "启用后，Linux DO、OIDC、微信注册缺少邮箱时必须先补充邮箱地址。",
    "admin.settings.authSourceDefaults.enabledHint": "以下默认值会在该来源注册新用户时发放；首次绑定时授权仅作用于已有账号绑定该来源。",
    "admin.settings.authSourceDefaults.sources.email.title": "邮箱注册",
    "admin.settings.authSourceDefaults.sources.email.description": "适用于邮箱密码注册的新用户默认配额。",
    "admin.settings.authSourceDefaults.sources.linuxdo.title": "Linux DO 登录",
    "admin.settings.authSourceDefaults.sources.linuxdo.description": "适用于 Linux DO 第三方注册的新用户默认配额。",
    "admin.settings.authSourceDefaults.sources.oidc.title": "OIDC 登录",
    "admin.settings.authSourceDefaults.sources.oidc.description": "适用于 OIDC 第三方注册的新用户默认配额。",
    "admin.settings.authSourceDefaults.sources.wechat.title": "微信登录",
    "admin.settings.authSourceDefaults.sources.wechat.description": "适用于微信第三方注册的新用户默认配额。",
    "admin.settings.authSourceDefaults.grantOnFirstBindLabel": "首次绑定时授权",
    "admin.settings.authSourceDefaults.grantOnFirstBindHint": "已有账号首次绑定该来源时发放默认权益。",
    "admin.settings.authSourceDefaults.defaultSubscriptionsLabel": "默认订阅",
    "admin.settings.authSourceDefaults.defaultSubscriptionsHint": "仅对当前认证来源生效，未配置时不追加来源专属订阅。",
    "admin.settings.authSourceDefaults.noSourceSubscriptions": "当前来源未配置专属默认订阅。",
    "admin.settings.paymentVisibleMethods.methodLabel": "{title} 可见方式",
    "admin.settings.paymentVisibleMethods.methodHint": "控制前台结算页是否展示该方式，以及展示时使用的来源键。",
    "admin.settings.paymentVisibleMethods.sourceLabel": "支付来源",
    "admin.settings.paymentVisibleMethods.sourceHint": "启用后必须明确选择一个来源；未配置状态不会对外展示该支付方式。",
    "admin.settings.paymentVisibleMethods.sourceRequiredError": "{title} 已启用，请先选择支付来源。",
    "admin.settings.payment.configGuide": "查看支付配置说明",
    "admin.settings.payment.findProvider": "查看支持的支付方式",
    "admin.settings.openaiExperimentalScheduler.title": "OpenAI 实验调度策略",
    "admin.settings.openaiExperimentalScheduler.description": "默认关闭。开启后仅影响本网关在 OpenAI 账号间的实验性调度选择逻辑，不代表上游 OpenAI 官方能力。",
    "admin.settings.openaiExperimentalScheduler.lowRatePriorityTitle": "低倍率优先",
    "admin.settings.openaiExperimentalScheduler.lowRatePriorityDescription": "开启后优先选择计费倍率较低的账号；倍率相同时，再比较账号优先级和当前负载等。启用实验调度策略后，此开关不生效。",
    "admin.settings.openaiExperimentalScheduler.oauthRateTitle": "OAuth 调度参考倍率",
    "admin.settings.openaiExperimentalScheduler.oauthRatePriorityDescription": "OAuth 账号按此参考倍率参与低倍率优先排序；留空时使用各自的账号倍率。API Key 账号优先使用有效探测倍率，无有效探测时使用账号倍率。",
    "admin.settings.openaiExperimentalScheduler.oauthRateWeightedDescription": "计算“计费倍率”得分时，OAuth 账号使用此参考倍率；留空时使用各自的账号倍率。API Key 账号优先使用有效探测倍率，无有效探测时使用账号倍率。",
    "admin.settings.openaiExperimentalScheduler.oauthRateInvalid": "OAuth 调度参考倍率必须是非负数字，或留空以使用账号倍率。",
    "admin.settings.openaiExperimentalScheduler.stickyWeightedTitle": "粘性加权",
    "admin.settings.openaiExperimentalScheduler.stickyWeightedDescription": "开启后 previous_response_id 和 session_hash 粘性进入高级调度打分；关闭时仍按旧逻辑硬命中粘性账号。",
    "admin.settings.openaiExperimentalScheduler.subscriptionPriorityTitle": "订阅优先",
    "admin.settings.openaiExperimentalScheduler.subscriptionPriorityDescription": "开启后先在 ChatGPT 订阅账号池中按权值选取；订阅池拿不到席位时再回退到非订阅账号池。",
    "admin.settings.openaiExperimentalScheduler.weightsTitle": "调度权值覆盖",
    "admin.settings.openaiExperimentalScheduler.weightsDescription": "留空时使用配置/环境变量值；配置未设置时使用内置默认值。页面非空设置优先。",
    "admin.settings.openaiExperimentalScheduler.defaultPlaceholder": "配置/默认：{value}",
    "admin.settings.openaiExperimentalScheduler.topKLabel": "TopK",
    "admin.settings.openaiExperimentalScheduler.priorityWeight": "优先级",
    "admin.settings.openaiExperimentalScheduler.loadWeight": "负载",
    "admin.settings.openaiExperimentalScheduler.queueWeight": "排队",
    "admin.settings.openaiExperimentalScheduler.errorRateWeight": "错误率",
    "admin.settings.openaiExperimentalScheduler.ttftWeight": "首包延迟",
    "admin.settings.openaiExperimentalScheduler.resetWeight": "重置窗口",
    "admin.settings.openaiExperimentalScheduler.quotaHeadroomWeight": "额度余量",
    "admin.settings.openaiExperimentalScheduler.upstreamCostWeight": "计费倍率",
    "admin.settings.openaiExperimentalScheduler.previousResponseWeight": "previous_response 粘性",
    "admin.settings.openaiExperimentalScheduler.sessionStickyWeight": "session_hash 粘性",
    "admin.settings.upstreamBillingProbe.title": "上游倍率自动探测",
    "admin.settings.upstreamBillingProbe.description": "定期获取 OpenAI API Key 所连接上游 Sub2API 站点声明的计费倍率。",
    "admin.settings.upstreamBillingProbe.enabled": "启用全局自动探测",
    "admin.settings.upstreamBillingProbe.enabledHint": "开启后，仅对账号自身已启用自动检测的账号执行定时探测。",
    "admin.settings.upstreamBillingProbe.intervalMinutes": "探测周期（分钟）",
    "admin.settings.upstreamBillingProbe.intervalHint": "范围 5–1440 分钟。",
    "admin.settings.upstreamBillingProbe.saved": "上游倍率自动探测设置已保存",
    "admin.settings.upstreamBillingProbe.saveFailed": "保存上游倍率自动探测设置失败",
    "admin.settings.openaiFastPolicy.summaryTargetModels": "目标模型",
    "admin.settings.openaiFastPolicy.summaryAllModels": "全部模型",
    "admin.settings.openaiFastPolicy.summaryOtherModels": "其他模型",
    "admin.settings.openaiFastPolicy.summaryAction.filter": "过滤",
    "admin.settings.openaiFastPolicy.summaryAction.pass": "透传",
    "admin.settings.security.passkeyDeploymentHint":
      "请由服务器运维在部署配置中将 webauthn.enabled 设为 true，填写 webauthn.rp_id（仅域名）与 webauthn.rp_origins（完整 HTTPS 来源），然后重启服务。",
    "admin.settings.site.uploadImage": "上传图片",
    "admin.settings.site.remove": "移除",
    "admin.settings.platformQuota.platform": "平台",
    "admin.settings.platformQuota.daily": "日限额 (USD)",
    "admin.settings.platformQuota.weekly": "周限额 (USD)",
    "admin.settings.platformQuota.monthly": "月限额 (USD, 30天滚动)",
    "admin.settings.platformQuota.placeholder": "不限",
    "admin.settings.defaults.defaultPlatformQuotas": "默认平台限额（注册时分配）",
    "admin.settings.defaults.defaultPlatformQuotasHint": "新用户注册时自动写入平台限额记录；已有用户不受影响。留空 = 该平台该窗口不限制。",
    "admin.settings.defaults.platformQuotaNotice": "月限额为 30 天滚动窗口，非自然月",
    "admin.settings.authSourceDefaults.platformQuotasOverride": "平台限额覆盖",
    "admin.settings.authSourceDefaults.platformQuotasOverrideHint": "留空的字段继承「系统默认平台限额」；填 0 表示禁止该窗口使用。",
  };
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, string>) =>
        (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, token) => params?.[token] ?? `{${token}}`),
      locale: localeRef,
    }),
  };
});

const AppLayoutStub = { template: "<div><slot /></div>" };
const ToggleStub = defineComponent({
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  inheritAttrs: false,
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        class: "toggle-stub",
        type: "checkbox",
        checked: props.modelValue,
        onChange: (event: Event) => {
          emit("update:modelValue", (event.target as HTMLInputElement).checked);
        },
      });
  },
});

const SelectStub = defineComponent({
  props: {
    modelValue: {
      type: [String, Number, Boolean, null],
      default: "",
    },
    options: {
      type: Array,
      default: () => [],
    },
    placeholder: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const onChange = (event: Event) => {
      const target = event.target as HTMLSelectElement;
      emit("update:modelValue", target.value);
      const option =
        (props.options as Array<Record<string, unknown>>).find(
          (item) => String(item.value ?? "") === target.value,
        ) ?? null;
      emit("change", target.value, option);
    };

    return () =>
      h(
        "select",
        {
          class: "select-stub",
          value: props.modelValue ?? "",
          "data-placeholder": props.placeholder,
          onChange,
        },
        (props.options as Array<Record<string, unknown>>).map((option) =>
          h(
            "option",
            {
              key: `${String(option.value ?? "")}:${String(option.label ?? "")}`,
              value: option.value as string,
            },
            String(option.label ?? ""),
          ),
        ),
      );
  },
});

const ImageUploadStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    uploadLabel: {
      type: String,
      default: "",
    },
    removeLabel: {
      type: String,
      default: "",
    },
    placeholder: {
      type: String,
      default: "",
    },
  },
  setup(props) {
    return () =>
      h("div", {
        class: "image-upload-stub",
        "data-model-value": props.modelValue,
        "data-upload-label": props.uploadLabel,
        "data-remove-label": props.removeLabel,
        "data-placeholder": props.placeholder,
      });
  },
});

const baseSettingsResponse = {
  registration_enabled: true,
  email_verify_enabled: false,
  registration_email_suffix_whitelist: [],
  promo_code_enabled: true,
  invitation_code_enabled: false,
  password_reset_enabled: false,
  totp_enabled: false,
  totp_encryption_key_configured: false,
  passkey_enabled: true,
  passkey_configured: true,
  passkey_rp_id: "sub3.nebula-spaces.com",
  passkey_rp_origins: ["https://sub3.nebula-spaces.com"],
  default_balance: 0,
  default_concurrency: 1,
  default_subscriptions: [],
  site_name: "Sub2API",
  site_logo: "",
  site_subtitle: "",
  api_base_url: "",
  contact_info: "",
  doc_url: "",
  home_content: "",
  compact_home_enabled: false,
  hide_ccs_import_button: false,
  table_default_page_size: 20,
  table_page_size_options: [10, 20, 50, 100],
  backend_mode_enabled: false,
  custom_menu_items: [],
  custom_endpoints: [],
  frontend_url: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password_configured: false,
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_use_tls: true,
  turnstile_enabled: false,
  turnstile_site_key: "",
  turnstile_secret_key_configured: false,
  tencent_captcha_enabled: false,
  tencent_captcha_app_id: "",
  tencent_captcha_app_secret_key_configured: false,
  tencent_captcha_cloud_secret_id_configured: false,
  tencent_captcha_cloud_secret_key_configured: false,
  api_key_acl_trust_forwarded_ip: true,
  forwarded_client_ip_headers: [],
  linuxdo_connect_enabled: false,
  linuxdo_connect_client_id: "",
  linuxdo_connect_client_secret_configured: false,
  linuxdo_connect_redirect_url: "",
  wechat_connect_enabled: true,
  wechat_connect_app_id: "wx-app-id-123",
  wechat_connect_app_secret_configured: true,
  wechat_connect_open_enabled: false,
  wechat_connect_mp_enabled: true,
  wechat_connect_mode: "mp",
  wechat_connect_scopes: "",
  wechat_connect_redirect_url:
    "https://admin.example.com/api/v1/auth/oauth/wechat/callback",
  wechat_connect_frontend_redirect_url: "/auth/wechat/callback",
  oidc_connect_enabled: false,
  oidc_connect_provider_name: "OIDC",
  oidc_connect_client_id: "",
  oidc_connect_client_secret_configured: false,
  oidc_connect_issuer_url: "",
  oidc_connect_discovery_url: "",
  oidc_connect_authorize_url: "",
  oidc_connect_token_url: "",
  oidc_connect_userinfo_url: "",
  oidc_connect_jwks_url: "",
  oidc_connect_scopes: "openid email profile",
  oidc_connect_redirect_url: "",
  oidc_connect_frontend_redirect_url: "/auth/oidc/callback",
  oidc_connect_token_auth_method: "client_secret_post",
  oidc_connect_use_pkce: true,
  oidc_connect_validate_id_token: true,
  oidc_connect_allowed_signing_algs: "RS256,ES256,PS256",
  oidc_connect_clock_skew_seconds: 120,
  oidc_connect_require_email_verified: false,
  oidc_connect_userinfo_email_path: "",
  oidc_connect_userinfo_id_path: "",
  oidc_connect_userinfo_username_path: "",
  enable_model_fallback: false,
  fallback_model_anthropic: "",
  fallback_model_openai: "",
  fallback_model_gemini: "",
  fallback_model_antigravity: "",
  grok_default_text_model: "grok-4.5",
  grok_cross_client_model_map_enabled: false,
  enable_identity_patch: false,
  identity_patch_prompt: "",
  ops_monitoring_enabled: false,
  ops_realtime_monitoring_enabled: false,
  ops_query_mode_default: "auto",
  ops_metrics_interval_seconds: 60,
  min_claude_code_version: "",
  max_claude_code_version: "",
  allow_ungrouped_key_scheduling: false,
  openai_ttft_mode: "semantic",
  enable_fingerprint_unification: true,
  enable_metadata_passthrough: false,
  enable_cch_signing: false,
  enable_claude_oauth_system_prompt_injection: true,
  claude_oauth_system_prompt: "",
  claude_oauth_system_prompt_blocks: "",
  enable_anthropic_cache_ttl_1h_injection: false,
  rewrite_message_cache_control: false,
  enable_client_dateline_normalization: true,
  antigravity_user_agent_version: "",
  openai_codex_user_agent: "",
  payment_enabled: true,
  payment_min_amount: 1,
  payment_max_amount: 10000,
  payment_daily_limit: 50000,
  payment_order_timeout_minutes: 30,
  payment_max_pending_orders: 3,
  payment_enabled_types: [],
  payment_balance_disabled: false,
  payment_balance_recharge_multiplier: 1,
  payment_subscription_usd_to_cny_rate: 0,
  payment_recharge_fee_rate: 0,
  payment_recharge_bonus_tiers: [],
  payment_recharge_bonus_mode: "bonus",
  payment_recharge_bonus_notice: "",
  payment_load_balance_strategy: "round-robin",
  payment_product_name_prefix: "",
  payment_product_name_suffix: "",
  payment_help_image_url: "",
  payment_help_text: "",
  payment_cancel_rate_limit_enabled: false,
  payment_cancel_rate_limit_max: 10,
  payment_cancel_rate_limit_window: 1,
  payment_cancel_rate_limit_unit: "day",
  payment_cancel_rate_limit_window_mode: "rolling",
  payment_visible_method_alipay_source: "alipay_direct",
  payment_visible_method_wxpay_source: "invalid-source",
  payment_visible_method_alipay_enabled: true,
  payment_visible_method_wxpay_enabled: true,
  openai_low_upstream_rate_priority_enabled: false,
  openai_oauth_scheduling_rate_multiplier: 1,
  openai_advanced_scheduler_enabled: false,
  openai_advanced_scheduler_sticky_weighted_enabled: false,
  openai_advanced_scheduler_subscription_priority_enabled: false,
  openai_advanced_scheduler_lb_top_k: "",
  openai_advanced_scheduler_weight_priority: "",
  openai_advanced_scheduler_weight_load: "",
  openai_advanced_scheduler_weight_queue: "",
  openai_advanced_scheduler_weight_error_rate: "",
  openai_advanced_scheduler_weight_ttft: "",
  openai_advanced_scheduler_weight_reset: "",
  openai_advanced_scheduler_weight_quota_headroom: "",
  openai_advanced_scheduler_weight_upstream_cost: "",
  openai_advanced_scheduler_weight_previous_response: "",
  openai_advanced_scheduler_weight_session_sticky: "",
  openai_advanced_scheduler_effective_lb_top_k: "7",
  openai_advanced_scheduler_effective_weight_priority: "1",
  openai_advanced_scheduler_effective_weight_load: "1",
  openai_advanced_scheduler_effective_weight_queue: "0.7",
  openai_advanced_scheduler_effective_weight_error_rate: "0.8",
  openai_advanced_scheduler_effective_weight_ttft: "0.5",
  openai_advanced_scheduler_effective_weight_reset: "0",
  openai_advanced_scheduler_effective_weight_quota_headroom: "0",
  openai_advanced_scheduler_effective_weight_upstream_cost: "0",
  openai_advanced_scheduler_effective_weight_previous_response: "5",
  openai_advanced_scheduler_effective_weight_session_sticky: "3",
  balance_low_notify_enabled: false,
  balance_low_notify_threshold: 0,
  balance_low_notify_recharge_url: "",
  subscription_expiry_notify_enabled: true,
  account_quota_notify_enabled: false,
  account_quota_notify_emails: [],
  // 平台限额嵌套字段（新后端契约）
  default_platform_quotas: {
    anthropic:   { daily: null, weekly: null, monthly: null },
    openai:      { daily: null, weekly: 12.5, monthly: null },
    gemini:      { daily: null, weekly: null, monthly: 200 },
    antigravity: { daily: null, weekly: null, monthly: null },
  },
};

function mountView() {
  return mount(SettingsView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        Select: SelectStub,
        Toggle: ToggleStub,
        Icon: true,
        ConfirmDialog: true,
        PaymentProviderList: true,
        PaymentProviderDialog: true,
        GroupBadge: true,
        GroupOptionItem: true,
        ProxySelector: true,
        ImageUpload: ImageUploadStub,
        BackupSettings: true,
        AdminAccessKeysSettings: true,
        EmailTemplateEditor: true,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  });
}

async function openPaymentTab(wrapper: ReturnType<typeof mountView>) {
  const paymentTabButton = wrapper
    .findAll("button")
    .find((node) => node.text().includes("admin.settings.tabs.payment"));

  expect(paymentTabButton).toBeDefined();
  await paymentTabButton?.trigger("click");
  await flushPromises();
}

async function openSecurityTab(wrapper: ReturnType<typeof mountView>) {
  const securityTabButton = wrapper
    .findAll("button")
    .find((node) => node.text().includes("admin.settings.tabs.security"));

  expect(securityTabButton).toBeDefined();
  await securityTabButton?.trigger("click");
  await flushPromises();
}

async function openGatewayTab(wrapper: ReturnType<typeof mountView>) {
  const gatewayTabButton = wrapper
    .findAll("button")
    .find((node) => node.text().includes("admin.settings.tabs.gateway"));

  expect(gatewayTabButton).toBeDefined();
  await gatewayTabButton?.trigger("click");
  await flushPromises();
}

async function openUsersTab(wrapper: ReturnType<typeof mountView>) {
  const usersTabButton = wrapper
    .findAll("button")
    .find((node) => node.text().includes("admin.settings.tabs.users"));

  expect(usersTabButton).toBeDefined();
  await usersTabButton?.trigger("click");
  await flushPromises();
}

describe("admin SettingsView email domain quota copy", () => {
  it("documents the email domain quota and empty-whitelist behavior in both locales", () => {
    expect(zhCommon.auth.emailDomainRegistrationLimit).toContain("主流邮箱");
    expect(zhCommon.auth.emailDomainRegistrationLimit).toContain("联系客服");
    expect(enCommon.auth.emailDomainRegistrationLimit).toContain("mainstream email");
    expect(enCommon.auth.emailDomainRegistrationLimit).toContain("contact support");

    // 白名单 hint 描述严格默认语义；额度语义移入独立开关的 hint。
    const zhWhitelistHint = zhSettings.settings.registration.emailSuffixWhitelistHint;
    const enWhitelistHint = enSettings.settings.registration.emailSuffixWhitelistHint;
    expect(zhWhitelistHint).toContain("留空则不限制");
    expect(enWhitelistHint).toContain("leave empty for no restriction");

    const zhQuotaHint = zhSettings.settings.registration.emailDomainQuotaHint;
    const enQuotaHint = enSettings.settings.registration.emailDomainQuotaHint;
    expect(zhQuotaHint).toContain("其他可注册主域名各限注册一个账户");
    expect(zhQuotaHint).toContain("关闭时非白名单域名直接拒绝");
    expect(enQuotaHint).toContain("one account");
    expect(enQuotaHint).toContain("When disabled");
  });
});

describe("admin SettingsView payment visible method controls", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    getWebSearchEmulationConfig.mockReset();
    updateWebSearchEmulationConfig.mockReset();
    getAdminApiKey.mockReset();
    getOverloadCooldownSettings.mockReset();
    getRateLimit429CooldownSettings.mockReset();
    updateRateLimit429CooldownSettings.mockReset();
    getStreamTimeoutSettings.mockReset();
    getRectifierSettings.mockReset();
    getBetaPolicySettings.mockReset();
    getUpstreamBillingProbeSettings.mockReset();
    updateUpstreamBillingProbeSettings.mockReset();
    getOllamaCloudUsageSettings.mockReset();
    updateOllamaCloudUsageSettings.mockReset();
    getGroups.mockReset();
    listProxies.mockReset();
    getProviders.mockReset();
    updateProvider.mockReset();
    createProvider.mockReset();
    deleteProvider.mockReset();
    fetchPublicSettings.mockReset();
    adminSettingsFetch.mockReset();
    showError.mockReset();
    showSuccess.mockReset();
    localeRef.value = "zh-CN";
    totpStepUp.mockReset().mockResolvedValue({});

    getSettings.mockResolvedValue({ ...baseSettingsResponse });
    updateSettings.mockImplementation(async (payload) => ({
      ...baseSettingsResponse,
      ...payload,
    }));
    getWebSearchEmulationConfig.mockResolvedValue({
      enabled: false,
      providers: [],
    });
    updateWebSearchEmulationConfig.mockResolvedValue({
      enabled: false,
      providers: [],
    });
    getAdminApiKey.mockResolvedValue({
      exists: false,
      masked_key: "",
    });
    getOverloadCooldownSettings.mockResolvedValue({
      enabled: true,
      cooldown_minutes: 10,
    });
    getRateLimit429CooldownSettings.mockResolvedValue({
      enabled: true,
      cooldown_seconds: 5,
    });
    updateRateLimit429CooldownSettings.mockImplementation(async (payload) => payload);
    getStreamTimeoutSettings.mockResolvedValue({
      enabled: true,
      action: "temp_unsched",
      temp_unsched_minutes: 5,
      threshold_count: 3,
      threshold_window_minutes: 10,
    });
    getRectifierSettings.mockResolvedValue({
      enabled: true,
      thinking_signature_enabled: true,
      thinking_budget_enabled: true,
      apikey_signature_enabled: false,
      apikey_signature_patterns: [],
    });
    getBetaPolicySettings.mockResolvedValue({
      rules: [],
    });
    getUpstreamBillingProbeSettings.mockResolvedValue({
      enabled: true,
      interval_minutes: 30,
    });
    updateUpstreamBillingProbeSettings.mockImplementation(async (payload) => payload);
    getOllamaCloudUsageSettings.mockResolvedValue({
      enabled: false,
      interval_minutes: 60,
      debounce_minutes: 1,
    });
    updateOllamaCloudUsageSettings.mockImplementation(async (payload) => payload);
    getGroups.mockResolvedValue([]);
    listProxies.mockResolvedValue({
      items: [],
    });
    getProviders.mockResolvedValue({
      data: [],
    });
    fetchPublicSettings.mockResolvedValue(undefined);
    adminSettingsFetch.mockResolvedValue(undefined);
  });

  it("loads and saves the open button visibility for each custom menu", async () => {
    const menuItems = [
      { id: "docs", label: "Docs", url: "https://example.com/docs", icon_svg: "", visibility: "user", sort_order: 0 },
      { id: "help", label: "Help", url: "https://example.com/help", icon_svg: "", visibility: "user", sort_order: 1, hide_open_button: true },
    ];
    getSettings.mockResolvedValue({ ...baseSettingsResponse, custom_menu_items: menuItems });
    const wrapper = mountView();
    await flushPromises();

    const toggles = wrapper.findAll<HTMLInputElement>('[data-testid="custom-menu-hide-open-button"]');
    expect(toggles.map(toggle => toggle.element.checked)).toEqual([false, true]);
    await toggles[0].setValue(true);
    await toggles[1].setValue(false);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      custom_menu_items: [
        { ...menuItems[0], hide_open_button: true },
        { ...menuItems[1], hide_open_button: false },
      ],
    }));
    wrapper.unmount();
  });

  it("submits the compact home page toggle", async () => {
    const wrapper = mountView();
    await flushPromises();

    const toggle = wrapper.get('[data-testid="compact-home-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);

    await toggle.setValue(true);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ compact_home_enabled: true }),
    );
  });

  it("renders panel rate limit card and saves settings", async () => {
    getPanelRateLimitSettings.mockClear();
    updatePanelRateLimitSettings.mockClear();
    getPanelRateLimitSettings.mockResolvedValue({
      enabled: true,
      user_rpm: 240,
      heavy_rpm: 60,
      exempt_admin: true,
      public_ip_rpm: 300,
    });
    updatePanelRateLimitSettings.mockImplementation(async (payload) => payload);

    const wrapper = mountView();
    await flushPromises();
    await wrapper.get("#settings-tab-security").trigger("click");
    await flushPromises();

    expect(getPanelRateLimitSettings).toHaveBeenCalled();
    expect(wrapper.text()).toContain("admin.settings.panelRateLimit.title");
    expect(wrapper.text()).toContain("admin.settings.panelRateLimit.proxySafeNote");

    const userRpmInput = wrapper.find('[data-testid="panel-rate-limit-user-rpm"]');
    expect(userRpmInput.exists()).toBe(true);
    await userRpmInput.setValue("120");

    const saveButton = wrapper.find('[data-testid="panel-rate-limit-save"]');
    expect(saveButton.exists()).toBe(true);
    await saveButton.trigger("click");
    await flushPromises();

    expect(updatePanelRateLimitSettings).toHaveBeenCalledWith({
      enabled: true,
      user_rpm: 120,
      heavy_rpm: 60,
      exempt_admin: true,
      public_ip_rpm: 300,
    });
    expect(showSuccess).toHaveBeenCalled();
  });

  it("does not render legacy visible payment method controls", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);

    expect(wrapper.text()).not.toContain("可见方式");
    expect(wrapper.text()).not.toContain("支付来源");
  });

  it("shows valid passkey RP configuration and persists the sign-in toggle", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    const settings = wrapper.get('[data-testid="passkey-settings"]');
    const toggle = settings.get('[data-testid="passkey-toggle"]');
    expect(toggle.attributes("disabled")).toBeUndefined();
    expect(settings.text()).toContain("sub3.nebula-spaces.com");
    expect(settings.text()).toContain("https://sub3.nebula-spaces.com");
    expect(settings.text()).not.toContain("webauthn.enabled");

    await toggle.setValue(false);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ passkey_enabled: false }),
    );
  });

  it("人机验证切换到腾讯天御并保存四项配置", async () => {
    const wrapper = mountView();
    await flushPromises();
    await openSecurityTab(wrapper);

    const masterToggle = wrapper.get('[data-testid="captcha-enabled-toggle"]');
    await masterToggle.setValue(true);
    // 默认选中 Turnstile
    expect(wrapper.text()).toContain("admin.settings.turnstile.siteKey");

    await wrapper.get('[data-testid="captcha-provider-tencent"]').trigger("click");
    await flushPromises();

    const card = wrapper
      .findAll(".card")
      .find((node) => node.text().includes("admin.settings.captcha.title"));
    expect(card).toBeDefined();
    expect(card!.text()).not.toContain("admin.settings.turnstile.siteKey");
    expect(card!.find('a[href="https://console.cloud.tencent.com/captcha"]').exists()).toBe(true);
    expect(card!.find('a[href="https://console.cloud.tencent.com/cam/capi"]').exists()).toBe(true);
    expect(
      card!.find('a[href="https://cloud.tencent.com/document/product/1110/36841"]').exists(),
    ).toBe(true);
    const inputs = card!.findAll("input").filter((input) => input.attributes("type") !== "checkbox");
    await inputs[0]!.setValue("123456789");
    await inputs[1]!.setValue("app-secret-value");
    await inputs[2]!.setValue("cloud-secret-id-value");
    await inputs[3]!.setValue("cloud-secret-key-value");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstile_enabled: false,
        tencent_captcha_enabled: true,
        aliyun_captcha_enabled: false,
        tencent_captcha_app_id: "123456789",
        tencent_captcha_app_secret_key: "app-secret-value",
        tencent_captcha_cloud_secret_id: "cloud-secret-id-value",
        tencent_captcha_cloud_secret_key: "cloud-secret-key-value",
        tencent_captcha_region: "cn",
      }),
    );
  });

  it("腾讯天御切换到国际站后保存站点并更新控制台入口", async () => {
    const wrapper = mountView();
    await flushPromises();
    await openSecurityTab(wrapper);

    await wrapper.get('[data-testid="captcha-enabled-toggle"]').setValue(true);
    await wrapper.get('[data-testid="captcha-provider-tencent"]').trigger("click");
    await wrapper.get('[data-testid="tencent-captcha-region-intl"]').trigger("click");

    const card = wrapper
      .findAll(".card")
      .find((node) => node.text().includes("admin.settings.captcha.title"));
    expect(card).toBeDefined();
    expect(card!.find('a[href="https://console.tencentcloud.com/captcha/graphical"]').exists()).toBe(
      true,
    );
    expect(card!.find('a[href="https://console.tencentcloud.com/cam/capi"]').exists()).toBe(true);

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tencent_captcha_enabled: true,
        tencent_captcha_region: "intl",
      }),
    );
  });

  it("人机验证切换到阿里云并保存配置", async () => {
    const wrapper = mountView();
    await flushPromises();
    await openSecurityTab(wrapper);

    const masterToggle = wrapper.get('[data-testid="captcha-enabled-toggle"]');
    await masterToggle.setValue(true);

    await wrapper.get('[data-testid="captcha-provider-aliyun"]').trigger("click");
    await flushPromises();

    const card = wrapper
      .findAll(".card")
      .find((node) => node.text().includes("admin.settings.captcha.title"));
    expect(card).toBeDefined();
    expect(card!.text()).toContain("admin.settings.aliyunCaptcha.region");
    expect(card!.text()).not.toContain("admin.settings.turnstile.siteKey");
    const inputs = card!.findAll("input").filter((input) => input.attributes("type") !== "checkbox");
    await inputs[0]!.setValue("prefix-1");
    await inputs[1]!.setValue("scene-1");
    await inputs[2]!.setValue("ak-id");
    await inputs[3]!.setValue("ak-secret-value");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstile_enabled: false,
        tencent_captcha_enabled: false,
        aliyun_captcha_enabled: true,
        aliyun_captcha_prefix: "prefix-1",
        aliyun_captcha_scene_id: "scene-1",
        aliyun_captcha_access_key_id: "ak-id",
        aliyun_captcha_access_key_secret: "ak-secret-value",
        aliyun_captcha_region: "cn",
      }),
    );
  });

  it("关闭人机验证总开关会同时关闭所有服务商", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: "123456789",
      tencent_captcha_app_secret_key_configured: true,
      tencent_captcha_cloud_secret_id_configured: true,
      tencent_captcha_cloud_secret_key_configured: true,
    });
    const wrapper = mountView();
    await flushPromises();
    await openSecurityTab(wrapper);

    const masterToggle = wrapper.get('[data-testid="captcha-enabled-toggle"]');
    expect((masterToggle.element as HTMLInputElement).checked).toBe(true);
    // 加载后选中项跟随已启用的服务商
    expect(wrapper.text()).toContain("admin.settings.tencentCaptcha.appId");

    await masterToggle.setValue(false);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstile_enabled: false,
        tencent_captcha_enabled: false,
        aliyun_captcha_enabled: false,
      }),
    );
  });

  it("disables passkey sign-in when the RP configuration is unavailable", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      passkey_enabled: false,
      passkey_configured: false,
      passkey_rp_id: "",
      passkey_rp_origins: [],
    });
    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    const settings = wrapper.get('[data-testid="passkey-settings"]');
    expect(settings.get('[data-testid="passkey-toggle"]').attributes("disabled")).toBeDefined();
    const status = settings.get('[data-testid="passkey-config-status"]');
    expect(status.text()).toContain(
      "admin.settings.security.passkeyNotConfigured",
    );
    expect(status.text()).toContain("webauthn.enabled");
    expect(status.text()).toContain("webauthn.rp_id");
    expect(status.text()).toContain("webauthn.rp_origins");
    expect(status.text()).toContain("然后重启服务");
  });

  it("loads, edits, validates, and saves forwarded client-IP headers", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      api_key_acl_trust_forwarded_ip: false,
      forwarded_client_ip_headers: ["cf-connecting-ip", "X-Real-IP"],
    });
    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    const card = wrapper
      .findAll(".card")
      .find((node) => node.text().includes("admin.settings.apiKeyAcl.title"));
    expect(card).toBeDefined();
    const toggle = card!.get('input[type="checkbox"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(card!.find('[data-testid="forwarded-client-ip-headers-input"]').exists()).toBe(false);

    await toggle.setValue(true);
    expect(card!.findAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(2);
    expect(card!.text()).toContain("Cf-Connecting-Ip");
    expect(card!.text()).toContain("X-Real-Ip");
    showError.mockClear();

    const input = card!.get('[data-testid="forwarded-client-ip-headers-input"]');
    await input.setValue("x-client-ip");
    await input.trigger("keydown", { key: "Enter" });
    await input.setValue("X-CLIENT-IP");
    await input.trigger("keydown", { key: "Enter" });
    await input.setValue("invalid header");
    await input.trigger("keydown", { key: "Enter" });
    expect(showError).toHaveBeenCalledTimes(1);
    expect(card!.findAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(3);

    const realIpTag = card!
      .findAll('[data-testid="forwarded-client-ip-header-tag"]')
      .find((tag) => tag.text().includes("X-Real-Ip"));
    expect(realIpTag).toBeDefined();
    await realIpTag!.get("button").trigger("click");
    expect(card!.text()).not.toContain("X-Real-Ip");

    await toggle.setValue(false);
    expect(card!.find('[data-testid="forwarded-client-ip-headers-input"]').exists()).toBe(false);
    await toggle.setValue(true);
    expect(card!.text()).toContain("X-Client-Ip");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key_acl_trust_forwarded_ip: true,
        forwarded_client_ip_headers: ["Cf-Connecting-Ip", "X-Client-Ip"],
      }),
    );
  });

  it("loads, edits, and saves recharge bonus tiers and the notice", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      payment_recharge_bonus_tiers: [
        { min_amount: 500, bonus_percent: 30 },
        { min_amount: 100, bonus_percent: 20 },
      ],
      payment_recharge_bonus_notice: "满 100 送 20%",
    });
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);

    // 回填按阈值升序，并渲染区间预览（首段为「不赠送」）
    let rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows).toHaveLength(2);
    const minValue = (row: (typeof rows)[number]) =>
      (row.get('[data-testid="recharge-bonus-tier-min-input"]').element as HTMLInputElement).value;
    expect(minValue(rows[0]!)).toBe("100");
    expect(minValue(rows[1]!)).toBe("500");
    expect(wrapper.get('[data-testid="recharge-bonus-tier-preview"]').text()).toContain(
      "admin.settings.payment.rechargeBonus.previewRangeNone",
    );

    await wrapper.get('[data-testid="recharge-bonus-tier-add"]').trigger("click");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[2]!.find('[data-testid="recharge-bonus-tier-incomplete"]').exists()).toBe(true);

    // 与已有档位重复的阈值行内报错，改成新阈值后消失
    await rows[2]!.get('[data-testid="recharge-bonus-tier-min-input"]').setValue("100");
    await rows[2]!.get('[data-testid="recharge-bonus-tier-percent-input"]').setValue("25");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows[2]!.find('[data-testid="recharge-bonus-tier-error"]').exists()).toBe(true);
    await rows[2]!.get('[data-testid="recharge-bonus-tier-min-input"]').setValue("1000");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows[2]!.find('[data-testid="recharge-bonus-tier-error"]').exists()).toBe(false);

    // 切到折扣模式：百分比 ≥ 100 行内报错，改回 < 100 后消失
    await wrapper.get('[data-testid="recharge-bonus-mode-discount"]').trigger("click");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    await rows[2]!.get('[data-testid="recharge-bonus-tier-percent-input"]').setValue("100");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows[2]!.get('[data-testid="recharge-bonus-tier-error"]').text()).toContain("invalidDiscountPercent");
    await rows[2]!.get('[data-testid="recharge-bonus-tier-percent-input"]').setValue("25");
    rows = wrapper.findAll('[data-testid="recharge-bonus-tier-row"]');
    expect(rows[2]!.find('[data-testid="recharge-bonus-tier-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="recharge-bonus-tier-preview"]').text()).toContain(
      "admin.settings.payment.rechargeBonus.previewRangeDiscount",
    );

    const notice = wrapper.get('[data-testid="recharge-bonus-notice-input"]');
    expect((notice.element as HTMLTextAreaElement).value).toBe("满 100 送 20%");
    await notice.setValue("**新活动**");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_recharge_bonus_tiers: [
          { min_amount: 100, bonus_percent: 20 },
          { min_amount: 500, bonus_percent: 30 },
          { min_amount: 1000, bonus_percent: 25 },
        ],
        payment_recharge_bonus_mode: "discount",
        payment_recharge_bonus_notice: "**新活动**",
      }),
    );
  });

  it("drops incomplete recharge bonus rows and submits an empty list when cleared", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 20 }],
    });
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);

    await wrapper.get('[data-testid="recharge-bonus-tier-remove"]').trigger("click");
    await wrapper.get('[data-testid="recharge-bonus-tier-add"]').trigger("click");
    expect(wrapper.findAll('[data-testid="recharge-bonus-tier-row"]')).toHaveLength(1);

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ payment_recharge_bonus_tiers: [] }),
    );
  });

  it("links payment guidance to README sections instead of removed payment docs", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);

    const paymentLinks = wrapper
      .findAll("a")
      .filter((node) =>
        ["查看支付配置说明", "查看支持的支付方式"].includes(node.text()),
      );

    expect(paymentLinks).toHaveLength(2);
    expect(paymentLinks[0]?.attributes("href")).toBe(
      "https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md",
    );
    expect(paymentLinks[1]?.attributes("href")).toBe(
      "https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md#支持的支付方式",
    );
    for (const link of paymentLinks) {
      expect(link.attributes("href")).toContain("docs/PAYMENT");
    }
  });

  it("does not submit legacy visible payment method settings", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    const payload = updateSettings.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("payment_visible_method_alipay_source");
    expect(payload).not.toHaveProperty("payment_visible_method_wxpay_source");
    expect(payload).not.toHaveProperty("payment_visible_method_alipay_enabled");
    expect(payload).not.toHaveProperty("payment_visible_method_wxpay_enabled");
  });

  it("submits the admin recharge affiliate rebate setting", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      affiliate_enabled: true,
      affiliate_admin_recharge_enabled: true,
    });

    const wrapper = mountView();

    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliate_admin_recharge_enabled: true,
      }),
    );
  });

  it("submits Anthropic cache TTL injection gateway setting", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      enable_anthropic_cache_ttl_1h_injection: true,
    });

    const wrapper = mountView();

    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enable_anthropic_cache_ttl_1h_injection: true,
      }),
    );
  });

  it("submits message cache_control rewrite gateway setting", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      rewrite_message_cache_control: true,
    });

    const wrapper = mountView();

    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        rewrite_message_cache_control: true,
      }),
    );
  });

  it("submits Claude OAuth system prompt injection gateway settings", async () => {
    const blocks = `[{"type":"text","text":"custom block","cache_control":true}]`;
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      enable_claude_oauth_system_prompt_injection: false,
      claude_oauth_system_prompt_blocks: blocks,
    });

    const wrapper = mountView();

    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enable_claude_oauth_system_prompt_injection: false,
      }),
    );
    const payload = updateSettings.mock.calls[0][0] as {
      claude_oauth_system_prompt_blocks: string;
    };
    expect(JSON.parse(payload.claude_oauth_system_prompt_blocks)).toEqual([
      {
        enabled: true,
        type: "text",
        text: "custom block",
        cache_control: {
          type: "ephemeral",
          ttl: "5m",
        },
      },
    ]);
  });

  it("submits Antigravity user agent version gateway setting", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      antigravity_user_agent_version: "1.23.2",
    });

    const wrapper = mountView();

    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        antigravity_user_agent_version: "1.23.2",
      }),
    );
  });

  it("updates provider enablement immediately and reloads providers", async () => {
    const provider = {
      id: 7,
      provider_key: "alipay",
      name: "Official Alipay",
      config: {},
      supported_types: ["alipay"],
      enabled: false,
      payment_mode: "",
      refund_enabled: false,
      allow_user_refund: false,
      limits: "",
      sort_order: 0,
    };
    getProviders.mockReset();
    getProviders
      .mockResolvedValueOnce({ data: [provider] })
      .mockResolvedValueOnce({ data: [{ ...provider, enabled: true }] });
    updateProvider.mockResolvedValue({ data: { ...provider, enabled: true } });

    const PaymentProviderListStub = defineComponent({
      emits: ["toggleField"],
      setup(_, { emit }) {
        return () =>
          h(
            "button",
            {
              class: "provider-toggle-stub",
              onClick: () => emit("toggleField", provider, "enabled"),
            },
            "toggle provider",
          );
      },
    });

    const wrapper = mount(SettingsView, {
      global: {
        stubs: {
          AppLayout: AppLayoutStub,
          Select: SelectStub,
          Toggle: ToggleStub,
          Icon: true,
          ConfirmDialog: true,
          PaymentProviderList: PaymentProviderListStub,
          PaymentProviderDialog: true,
          GroupBadge: true,
          GroupOptionItem: true,
          ProxySelector: true,
          ImageUpload: ImageUploadStub,
          BackupSettings: true,
        AdminAccessKeysSettings: true,
        RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });

    await flushPromises();
    await openPaymentTab(wrapper);
    await wrapper.get(".provider-toggle-stub").trigger("click");
    await flushPromises();

    expect(updateProvider).toHaveBeenCalledWith(7, { enabled: true });
    expect(getProviders).toHaveBeenCalledTimes(2);
  });

  it("renders advanced scheduler copy as local experimental gateway policy", async () => {
    const wrapper = mountView();

    await flushPromises();
    await wrapper.get("#settings-tab-gateway").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("OpenAI 实验调度策略");
    expect(wrapper.text()).toContain(
      "默认关闭。开启后仅影响本网关在 OpenAI 账号间的实验性调度选择逻辑",
    );
    expect(wrapper.text()).not.toContain("OpenAI 高级调度器");
  });

  it("summarizes target and other-model actions, then switches to all models", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_fast_policy_settings: {
        rules: [
          {
            service_tier: "all",
            action: "filter",
            scope: "all",
            model_whitelist: ["gpt-5.6-sol"],
            fallback_action: "pass",
          },
        ],
      },
    });
    const wrapper = mountView();

    await flushPromises();
    await openGatewayTab(wrapper);

    const summary = wrapper.get('[data-testid="openai-fast-policy-summary-0"]');
    expect(summary.text()).toContain("目标模型");
    expect(summary.text()).toContain("过滤");
    expect(summary.text()).toContain("其他模型");
    expect(summary.text()).toContain("透传");

    await wrapper
      .get(
        '[role="group"][aria-labelledby="openai-fast-policy-models-label-0"] input[type="text"]',
      )
      .setValue("");
    expect(summary.text()).toContain("全部模型");
    expect(summary.text()).toContain("过滤");
    expect(summary.text()).not.toContain("其他模型");
    expect(summary.text()).not.toContain("透传");
  });

  it("loads and saves upstream billing probe settings from the gateway tab", async () => {
    getUpstreamBillingProbeSettings.mockResolvedValueOnce({
      enabled: false,
      interval_minutes: 45,
    });

    const wrapper = mountView();

    await flushPromises();
    await openGatewayTab(wrapper);

    const card = wrapper.get('[data-testid="upstream-billing-probe-settings"]');
    expect(card.isVisible()).toBe(true);
    expect(card.text()).toContain("上游倍率自动探测");
    expect(
      (card.get('[data-testid="upstream-billing-probe-enabled"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(card.find('[data-testid="upstream-billing-probe-interval"]').exists()).toBe(false);

    await card.get('[data-testid="upstream-billing-probe-enabled"]').setValue(true);
    await card.get('[data-testid="upstream-billing-probe-interval"]').setValue(60);
    await card.get('[data-testid="upstream-billing-probe-save"]').trigger("click");
    await flushPromises();

    expect(updateUpstreamBillingProbeSettings).toHaveBeenCalledWith({
      enabled: true,
      interval_minutes: 60,
    });
    expect(showSuccess).toHaveBeenCalledWith("上游倍率自动探测设置已保存");
  });

  it("loads and saves configurable Grok cross-client model mapping", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      grok_default_text_model: "grok-4.1-fast",
      grok_cross_client_model_map_enabled: true,
    });
    const wrapper = mountView();

    await flushPromises();
    await openGatewayTab(wrapper);

    const modelInput = wrapper.get('[data-testid="grok-default-text-model"]');
    const mappingToggle = wrapper.get(
      '[data-testid="grok-cross-client-model-map-toggle"]',
    );
    expect((modelInput.element as HTMLInputElement).value).toBe("grok-4.1-fast");
    expect((mappingToggle.element as HTMLInputElement).checked).toBe(true);

    await modelInput.setValue("grok-custom-text");
    await mappingToggle.setValue(false);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const payload = updateSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.grok_default_text_model).toBe("grok-custom-text");
    expect(payload.grok_cross_client_model_map_enabled).toBe(false);
  });

  it("loads and saves the OpenAI Responses first-token metric mode", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_ttft_mode: "visible",
    });
    const wrapper = mountView();

    await flushPromises();
    await openGatewayTab(wrapper);

    const modeSelect = wrapper.get('[data-testid="openai-ttft-mode"]');
    expect((modeSelect.element as HTMLSelectElement).value).toBe("visible");

    await modeSelect.setValue("semantic");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const payload = updateSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.openai_ttft_mode).toBe("semantic");
  });

  it("loads fail-safe-off Ollama Cloud usage refresh settings and saves an explicit opt-in", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openGatewayTab(wrapper);

    const card = wrapper.get('[data-testid="ollama-cloud-usage-global-settings"]');
    expect(card.isVisible()).toBe(true);
    expect(
      (card.get('[data-testid="ollama-cloud-usage-global-enabled"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(card.find('[data-testid="ollama-cloud-usage-global-interval"]').exists()).toBe(false);

    await card.get('[data-testid="ollama-cloud-usage-global-enabled"]').setValue(true);
    await card.get('[data-testid="ollama-cloud-usage-global-debounce"]').setValue(3);
    await card.get('[data-testid="ollama-cloud-usage-global-interval"]').setValue(90);
    await card.get('[data-testid="ollama-cloud-usage-global-save"]').trigger("click");
    await flushPromises();

    expect(updateOllamaCloudUsageSettings).toHaveBeenCalledWith({
      enabled: true,
      interval_minutes: 90,
      debounce_minutes: 3,
    });
  });

  it.each([false, true])("clears the OAuth rate without losing zero (weighted=%s)", async (weighted) => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_low_upstream_rate_priority_enabled: !weighted,
      openai_advanced_scheduler_enabled: weighted,
      openai_oauth_scheduling_rate_multiplier: 0.7,
    });
    const wrapper = mountView();
    await flushPromises();
    await wrapper.get("#settings-tab-gateway").trigger("click");
    await flushPromises();
    const input = wrapper.get('[data-testid="openai-oauth-scheduling-rate-multiplier"]');
    expect(input.attributes("required")).toBeUndefined();
    await input.setValue("");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      openai_oauth_scheduling_rate_multiplier: null,
    }));
    await input.setValue("0");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      openai_oauth_scheduling_rate_multiplier: 0,
    }));
    updateSettings.mockClear();
    await input.setValue("-1");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("OAuth 调度参考倍率必须是非负数字，或留空以使用账号倍率。");
  });

  it("loads and preserves an explicitly cleared OAuth rate", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_advanced_scheduler_enabled: true,
      openai_oauth_scheduling_rate_multiplier: null,
    });
    const wrapper = mountView();
    await flushPromises();
    await wrapper.get("#settings-tab-gateway").trigger("click");
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('[data-testid="openai-oauth-scheduling-rate-multiplier"]');
    expect(input.element.value).toBe("");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      openai_oauth_scheduling_rate_multiplier: null,
    }));
  });

  it("places and explains rate controls for both scheduling modes", async () => {
    const wrapper = mountView();

    await flushPromises();
    await wrapper.get("#settings-tab-gateway").trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="openai-oauth-scheduling-rate-multiplier"]').exists(),
    ).toBe(false);

    const lowRateToggle = wrapper.get('[data-testid="openai-low-rate-priority-toggle"]');
    await lowRateToggle.setValue(true);
    const priorityModeText = wrapper.text();
    expect(priorityModeText).toContain(
      "OAuth 账号按此参考倍率参与低倍率优先排序；留空时使用各自的账号倍率。",
    );
    expect(priorityModeText.indexOf("低倍率优先")).toBeLessThan(
      priorityModeText.indexOf("OAuth 调度参考倍率"),
    );
    expect(priorityModeText.indexOf("OAuth 调度参考倍率")).toBeLessThan(
      priorityModeText.indexOf("OpenAI 实验调度策略"),
    );

    const oauthRateInput = wrapper.get(
      '[data-testid="openai-oauth-scheduling-rate-multiplier"]',
    );
    await oauthRateInput.setValue("0.05");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        openai_low_upstream_rate_priority_enabled: true,
        openai_oauth_scheduling_rate_multiplier: 0.05,
      }),
    );

    await wrapper
      .get('[data-testid="openai-advanced-scheduler-toggle"]')
      .setValue(true);
    expect(
      wrapper.find('[data-testid="openai-low-rate-priority-toggle"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="openai-oauth-scheduling-rate-multiplier"]').exists(),
    ).toBe(true);
    const weightedModeText = wrapper.text();
    expect(weightedModeText).toContain(
      "计算“计费倍率”得分时，OAuth 账号使用此参考倍率；留空时使用各自的账号倍率。",
    );
    expect(weightedModeText).not.toContain(
      "OAuth 账号按此参考倍率参与低倍率优先排序；",
    );
    expect(weightedModeText.indexOf("订阅优先")).toBeLessThan(
      weightedModeText.indexOf("OAuth 调度参考倍率"),
    );
    expect(weightedModeText.indexOf("OAuth 调度参考倍率")).toBeLessThan(
      weightedModeText.indexOf("调度权值覆盖"),
    );
    expect(weightedModeText).toContain("计费倍率");
  });

  it("passes translated upload and remove labels to the payment help image uploader", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openPaymentTab(wrapper);

    const imageUploads = wrapper.findAll(".image-upload-stub");
    expect(imageUploads.length).toBeGreaterThan(0);

    const paymentHelpImageUpload = imageUploads.find(
      (node) => node.attributes("data-placeholder") === "admin.settings.payment.helpImagePlaceholder",
    );

    expect(paymentHelpImageUpload).toBeDefined();
    expect(paymentHelpImageUpload?.attributes("data-upload-label")).toBe("上传图片");
    expect(paymentHelpImageUpload?.attributes("data-remove-label")).toBe("移除");
  });

  it("normalizes null supported_types from API so provider card stays visible", async () => {
    // Backend returns null for supported_types when the list is empty
    // (Go nil slice → JSON null). Without normalization, ProviderCard's
    // isSelected() throws TypeError on null.includes(), causing the card
    // to vanish from the list.
    const providerWithNullTypes = {
      id: 42,
      provider_key: "easypay",
      name: "EasyPay",
      config: {},
      supported_types: null as unknown as string[],
      enabled: true,
      payment_mode: "",
      refund_enabled: false,
      allow_user_refund: false,
      limits: "",
      sort_order: 0,
    };
    getProviders.mockReset();
    getProviders.mockResolvedValue({ data: [providerWithNullTypes] });

    let receivedProviders: Array<Record<string, unknown>> = [];
    const PaymentProviderListCapture = defineComponent({
      props: {
        providers: {
          type: Array,
          default: () => [],
        },
      },
      setup(props) {
        receivedProviders = props.providers as Array<Record<string, unknown>>;
        return () => h("div", { class: "provider-list-capture" });
      },
    });

    const wrapper = mount(SettingsView, {
      global: {
        stubs: {
          AppLayout: AppLayoutStub,
          Select: SelectStub,
          Toggle: ToggleStub,
          Icon: true,
          ConfirmDialog: true,
          PaymentProviderList: PaymentProviderListCapture,
          PaymentProviderDialog: true,
          GroupBadge: true,
          GroupOptionItem: true,
          ProxySelector: true,
          ImageUpload: ImageUploadStub,
          BackupSettings: true,
        AdminAccessKeysSettings: true,
        RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });

    await flushPromises();
    await openPaymentTab(wrapper);

    // The provider should still be in the list
    expect(receivedProviders.length).toBe(1);
    // supported_types should be normalized to an empty array, not null
    expect(Array.isArray(receivedProviders[0].supported_types)).toBe(true);
    expect(receivedProviders[0].supported_types).toEqual([]);
  });

  describe("settings workflows", () => {
    const mounted: ReturnType<typeof mountView>[] = [];
    const mountWorkflow = () => {
      const wrapper = mountView();
      mounted.push(wrapper);
      return wrapper;
    };
    const button = (wrapper: ReturnType<typeof mountView>, text: string) => {
      const result = wrapper.findAll("button").find((node) => node.text() === text);
      expect(result, `button ${text}`).toBeDefined();
      return result!;
    };
    const card = (wrapper: ReturnType<typeof mountView>, title: string) => {
      const result = wrapper.findAll(".card").find((node) =>
        node.findAll("h2, h3").some((heading) => heading.text() === title),
      );
      expect(result, `card ${title}`).toBeDefined();
      return result!;
    };
    const openTab = async (wrapper: ReturnType<typeof mountView>, key: string) => {
      await wrapper.get(`#settings-tab-${key}`).trigger("click");
      await flushPromises();
    };
    const field = (wrapper: ReturnType<typeof mountView>, label: string) => {
      const result = wrapper.findAll("label").find((node) => node.text() === label);
      expect(result, `field ${label}`).toBeDefined();
      return result!.element.parentElement!.querySelector("input, textarea")!;
    };
    const changeField = async (wrapper: ReturnType<typeof mountView>, label: string, value: string) => {
      const input = field(wrapper, label) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wrapper.vm.$nextTick();
    };
    const submit = async (wrapper: ReturnType<typeof mountView>) => {
      await wrapper.get("form").trigger("submit");
      await flushPromises();
    };

    beforeEach(() => {
      localStorage.clear();
      getSettings.mockResolvedValue({ ...baseSettingsResponse, email_verify_enabled: true });
      getPanelRateLimitSettings.mockResolvedValue({ enabled: true, user_rpm: 240, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 });
      updatePanelRateLimitSettings.mockReset().mockImplementation(async (payload) => payload);
      for (const mock of [
        testSmtpConnection, sendTestEmail, testWebSearchEmulation, resetWebSearchUsage,
        updateOverloadCooldownSettings, updateStreamTimeoutSettings, updateRectifierSettings,
        updateBetaPolicySettings, getOpenCodeGoUsageSettings, updateOpenCodeGoUsageSettings,
      ]) mock.mockReset();
      testSmtpConnection.mockResolvedValue({ message: "SMTP connected" });
      sendTestEmail.mockResolvedValue({ message: "Message delivered" });
      testWebSearchEmulation.mockResolvedValue({ provider: "brave", results: [] });
      resetWebSearchUsage.mockResolvedValue(undefined);
      getOpenCodeGoUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 15, debounce_minutes: 1 });
      for (const mock of [updateOverloadCooldownSettings, updateStreamTimeoutSettings,
        updateRectifierSettings, updateBetaPolicySettings, updateOpenCodeGoUsageSettings]) {
        mock.mockImplementation(async (payload) => payload);
      }
    });

    afterEach(() => {
      mounted.splice(0).forEach((wrapper) => wrapper.unmount());
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("keeps unsaved site and email drafts across lazy category changes and saves both together", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      expect(wrapper.find('[placeholder="admin.settings.smtp.hostPlaceholder"]').exists()).toBe(false);
      await wrapper.get('[placeholder="admin.settings.site.siteNamePlaceholder"]').setValue("Synthetic Portal");
      await openTab(wrapper, "email");
      await wrapper.get('[placeholder="admin.settings.smtp.hostPlaceholder"]').setValue("smtp.example.test");
      await openTab(wrapper, "backup");
      expect(wrapper.get(".z-admin-settings-save").isVisible()).toBe(false);
      expect(wrapper.findComponent({ name: "BackupSettings" }).exists()).toBe(true);
      await openTab(wrapper, "general");
      expect(wrapper.get<HTMLInputElement>('[placeholder="admin.settings.site.siteNamePlaceholder"]').element.value).toBe("Synthetic Portal");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ site_name: "Synthetic Portal", smtp_host: "smtp.example.test" }));
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(fetchPublicSettings).toHaveBeenCalledWith(true);
      expect(adminSettingsFetch).toHaveBeenCalledWith(true);
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
    });

    it.each([
      ["general", "ArrowRight", "agreement"], ["agreement", "ArrowDown", "features"],
      ["features", "ArrowLeft", "agreement"], ["general", "ArrowUp", "backup"],
      ["backup", "ArrowRight", "general"], ["users", "Home", "general"],
      ["users", "End", "backup"], ["users", "Escape", "users"],
    ])("selects the correct category for %s / %s", async (start, key, expected) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, start);
      await wrapper.get(`#settings-tab-${start}`).trigger("keydown", { key });
      await flushPromises();
      expect(wrapper.get(`#settings-tab-${expected}`).attributes("aria-selected")).toBe("true");
      expect(wrapper.get(`#settings-tab-${expected}`).attributes("tabindex")).toBe("0");
      expect(wrapper.findAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
    });

    it("prevents submitting fallback settings and SMTP diagnostics after the initial load fails", async () => {
      getSettings.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      expect(showError).toHaveBeenCalledWith("error");
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeDefined();
      await openTab(wrapper, "email");
      expect(wrapper.text()).toContain("admin.settings.emailTabDisabledTitle");
      expect(wrapper.find('[placeholder="admin.settings.smtp.hostPlaceholder"]').exists()).toBe(false);
      expect(testSmtpConnection).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("retains a draft after a failed save, restores the save action, and retries the same values", async () => {
      updateSettings.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      const name = wrapper.get('[placeholder="admin.settings.site.siteNamePlaceholder"]');
      await name.setValue("Retry Portal");
      await submit(wrapper);
      expect(showError).toHaveBeenCalledWith("error");
      expect(showSuccess).not.toHaveBeenCalled();
      expect(updateWebSearchEmulationConfig).not.toHaveBeenCalled();
      expect((name.element as HTMLInputElement).value).toBe("Retry Portal");
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeUndefined();
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledTimes(2);
      expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ site_name: "Retry Portal" }));
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
    });

    it.each([
      ["STEP_UP_TOTP_NOT_ENABLED", "stepUp.notEnabled"],
      ["STEP_UP_ADMIN_API_KEY_FORBIDDEN", "stepUp.adminApiKeyForbidden"],
      ["STEP_UP_ENABLE_REQUIRES_TOTP", "admin.settings.security.stepUpEnableRequiresTotp"],
    ])("reports the actionable authentication error %s without a false success", async (reason, message) => {
      updateSettings.mockRejectedValueOnce({ status: 403, reason });
      const wrapper = mountWorkflow();
      await flushPromises();
      await submit(wrapper);
      expect(showError).toHaveBeenCalledWith(message);
      expect(showSuccess).not.toHaveBeenCalled();
      expect(updateWebSearchEmulationConfig).not.toHaveBeenCalled();
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeUndefined();
    });

    it.each(["", "1", "1001", "not-a-size"])("rejects invalid default page size %s before any settings request", async (value) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await changeField(wrapper, "admin.settings.site.tableDefaultPageSize", value);
      await submit(wrapper);
      expect(updateSettings).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith("admin.settings.site.tableDefaultPageSizeRangeError");
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeUndefined();
    });

    it.each(["", "10,3", "10,1001", "10,20.5", "10,nope"])("rejects invalid page-size choices %s", async (value) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await wrapper.get('[placeholder="admin.settings.site.tablePageSizeOptionsPlaceholder"]').setValue(value);
      await submit(wrapper);
      expect(updateSettings).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith("admin.settings.site.tablePageSizeOptionsFormatError");
    });

    it("normalizes page choices and optional URLs in the submitted contract", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await changeField(wrapper, "admin.settings.site.tableDefaultPageSize", "50");
      await wrapper.get('[placeholder="admin.settings.site.tablePageSizeOptionsPlaceholder"]').setValue("50, 10, 50, 20");
      await wrapper.get('[placeholder="admin.settings.site.docUrlPlaceholder"]').setValue("javascript:alert(1)");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        table_default_page_size: 50, table_page_size_options: [10, 20, 50], doc_url: "",
      }));
      expect(wrapper.get<HTMLInputElement>('[placeholder="admin.settings.site.tablePageSizeOptionsPlaceholder"]').element.value).toBe("10, 20, 50");
    });

    it("adds, reorders, and removes menu entries without losing labels or order in the payload", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await button(wrapper, "admin.settings.customMenu.add").trigger("click");
      await wrapper.get('[placeholder="admin.settings.customMenu.namePlaceholder"]').setValue("Docs");
      await button(wrapper, "admin.settings.customMenu.add").trigger("click");
      await wrapper.findAll('[placeholder="admin.settings.customMenu.namePlaceholder"]')[1].setValue("Status");
      await wrapper.get('[title="admin.settings.customMenu.moveDown"]').trigger("click");
      expect(wrapper.findAll<HTMLInputElement>('[placeholder="admin.settings.customMenu.namePlaceholder"]').map((node) => node.element.value)).toEqual(["Status", "Docs"]);
      await wrapper.get('[title="admin.settings.customMenu.moveUp"]').trigger("click");
      await wrapper.findAll('[title="admin.settings.customMenu.remove"]')[0].trigger("click");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ custom_menu_items: [expect.objectContaining({ label: "Status", sort_order: 0, visibility: "user" })] }));
    });

    it("adds and removes a custom endpoint through its visible form", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await button(wrapper, "admin.settings.site.customEndpoints.add").trigger("click");
      await wrapper.get('[placeholder="admin.settings.site.customEndpoints.namePlaceholder"]').setValue("Lab");
      await wrapper.get('[placeholder="admin.settings.site.customEndpoints.endpointUrlPlaceholder"]').setValue("https://api.example.test/v1");
      await wrapper.get('[placeholder="admin.settings.site.customEndpoints.descriptionPlaceholder"]').setValue("Synthetic endpoint");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ custom_endpoints: [{ name: "Lab", endpoint: "https://api.example.test/v1", description: "Synthetic endpoint" }] }));
      const endpointInput = wrapper.get('[placeholder="admin.settings.site.customEndpoints.namePlaceholder"]');
      const endpointRow = endpointInput.element.closest('.rounded-lg')!;
      (endpointRow.querySelector("button") as HTMLButtonElement).click();
      await wrapper.vm.$nextTick();
      await submit(wrapper);
      expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ custom_endpoints: [] }));
    });

    it.each([false, true])("tests SMTP using only a manually entered password (edited=%s)", async (edited) => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, smtp_password_configured: true, email_verify_enabled: true });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "email");
      await wrapper.get('[placeholder="admin.settings.smtp.hostPlaceholder"]').setValue("smtp.example.test");
      await wrapper.get('[placeholder="admin.settings.smtp.portPlaceholder"]').setValue("2525");
      await wrapper.get('[placeholder="admin.settings.smtp.usernamePlaceholder"]').setValue("mailer");
      const password = wrapper.get('[autocomplete="new-password"]');
      if (edited) await password.trigger("keydown", { key: "s" });
      await password.setValue("synthetic-password");
      await button(wrapper, "admin.settings.smtp.testConnection").trigger("click");
      await flushPromises();
      expect(testSmtpConnection).toHaveBeenCalledWith({
        smtp_host: "smtp.example.test", smtp_port: 2525, smtp_username: "mailer",
        smtp_password: edited ? "synthetic-password" : "", smtp_use_tls: true,
      });
      expect(showSuccess).toHaveBeenCalledWith("SMTP connected");
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("keeps the SMTP action disabled in flight, reports an error, and permits retry", async () => {
      let reject!: (error: Error) => void;
      testSmtpConnection.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise; }));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "email");
      await button(wrapper, "admin.settings.smtp.testConnection").trigger("click");
      expect(button(wrapper, "admin.settings.smtp.testing").attributes("disabled")).toBeDefined();
      reject(new Error("offline"));
      await flushPromises();
      expect(showError).toHaveBeenCalledWith("error");
      await button(wrapper, "admin.settings.smtp.testConnection").trigger("click");
      await flushPromises();
      expect(testSmtpConnection).toHaveBeenCalledTimes(2);
      expect(showSuccess).toHaveBeenCalledWith("SMTP connected");
    });

    it("sends a test message with the current unsaved sender and restores the action after a failure", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, email_verify_enabled: true });
      sendTestEmail.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "email");
      expect(button(wrapper, "admin.settings.testEmail.sendTestEmail").attributes("disabled")).toBeDefined();
      await wrapper.get('[placeholder="admin.settings.testEmail.recipientEmailPlaceholder"]').setValue("recipient@example.test");
      await wrapper.get('[placeholder="admin.settings.smtp.fromEmailPlaceholder"]').setValue("sender@example.test");
      await wrapper.get('[placeholder="admin.settings.smtp.fromNamePlaceholder"]').setValue("Synthetic Sender");
      await button(wrapper, "admin.settings.testEmail.sendTestEmail").trigger("click");
      await flushPromises();
      expect(sendTestEmail).toHaveBeenCalledWith(expect.objectContaining({ email: "recipient@example.test", smtp_from_email: "sender@example.test", smtp_from_name: "Synthetic Sender", smtp_password: "" }));
      expect(showError).toHaveBeenCalledWith("error");
      expect(button(wrapper, "admin.settings.testEmail.sendTestEmail").attributes("disabled")).toBeUndefined();
      await button(wrapper, "admin.settings.testEmail.sendTestEmail").trigger("click");
      await flushPromises();
      expect(showSuccess).toHaveBeenCalledWith("Message delivered");
    });

    it("clears a manually edited SMTP secret after a successful save", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "email");
      const password = wrapper.get('[autocomplete="new-password"]');
      await password.trigger("paste");
      await password.setValue("synthetic-password");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ smtp_password: "synthetic-password" }));
      expect((password.element as HTMLInputElement).value).toBe("");
      await button(wrapper, "admin.settings.smtp.testConnection").trigger("click");
      await flushPromises();
      expect(testSmtpConnection).toHaveBeenCalledWith(expect.objectContaining({ smtp_password: "" }));
    });

    it("normalizes agreement slugs, trims content, and preserves the selected confirmation mode", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, login_agreement_enabled: true,
        login_agreement_documents: [{ id: "Terms !! of Use", title: " Terms ", content_md: " # Rules " }] });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "agreement");
      await button(wrapper, "复选框").trigger("click");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ login_agreement_mode: "checkbox", login_agreement_documents: [{ id: "terms-of-use", title: "Terms", content_md: "# Rules" }] }));
    });

    it.each([
      [[{ id: "a", title: "", content_md: "Content" }], "登录条款文档名称不能为空。"],
      [[{ id: "Terms", title: "One", content_md: "" }, { id: "terms", title: "Two", content_md: "" }], "登录条款文档路由不能重复：/legal/terms"],
      [[{ id: "a", title: "", content_md: "" }], "启用登录条款确认时，至少需要保留一份文档。"],
    ])("blocks invalid agreement documents before saving (%j)", async (documents, message) => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, login_agreement_enabled: true, login_agreement_documents: documents });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "agreement");
      await submit(wrapper);
      expect(updateSettings).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith(message);
    });

    it("protects the final required agreement and allows adding and removing an extra document", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, login_agreement_enabled: true,
        login_agreement_documents: [{ id: "terms", title: "Terms", content_md: "# Terms" }] });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "agreement");
      const agreement = wrapper.findAll(".card").find((node) => node.text().includes("协议文档"))!;
      const removeButtons = () => agreement.findAll("button").filter((node) => node.find('icon-stub[name="trash"]').exists());
      expect(removeButtons()[0].attributes("disabled")).toBeDefined();
      await button(wrapper, "添加文档").trigger("click");
      expect(wrapper.findAll('input[placeholder="usage-policy"]')).toHaveLength(2);
      await removeButtons()[1].trigger("click");
      expect(wrapper.findAll('input[placeholder="usage-policy"]')).toHaveLength(1);
      expect(removeButtons()[0].attributes("disabled")).toBeDefined();
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ login_agreement_documents: [{ id: "terms", title: "Terms", content_md: "# Terms" }] }));
    });

    it("adds eligible subscription defaults only and saves the edited validity", async () => {
      getGroups.mockResolvedValueOnce([
        { id: 3, name: "Active Plan", platform: "openai", subscription_type: "subscription", status: "active", rate_multiplier: 1 },
        { id: 4, name: "Inactive Plan", platform: "openai", subscription_type: "subscription", status: "inactive", rate_multiplier: 1 },
        { id: 5, name: "Standard", platform: "openai", subscription_type: "standard", status: "active", rate_multiplier: 1 },
      ]);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "users");
      await button(wrapper, "admin.settings.defaults.addDefaultSubscription").trigger("click");
      const group = wrapper.get(".default-sub-group-select");
      expect(group.findAll("option").map((node) => node.text())).toEqual(["Active Plan"]);
      await changeField(wrapper, "admin.settings.defaults.subscriptionValidityDays", "45");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ default_subscriptions: [{ group_id: 3, validity_days: 45 }] }));
      await wrapper.get(".default-sub-delete-btn").trigger("click");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ default_subscriptions: [] }));
    });

    it("edits Web Search provider fields and sends numeric quota, UTC date, and the selected provider type", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const search = card(wrapper, "admin.settings.webSearchEmulation.title");
      await search.get('input[type="checkbox"]').setValue(true);
      await button(wrapper, "admin.settings.webSearchEmulation.addProvider").trigger("click");
      await search.get("select").setValue("tavily");
      await search.get('input[type="password"]').setValue("synthetic-search-key");
      await search.get('input[type="number"]').setValue("250");
      await search.get('input[type="date"]').setValue("2026-02-03");
      await submit(wrapper);
      expect(updateWebSearchEmulationConfig).toHaveBeenCalledWith({ enabled: true, providers: [expect.objectContaining({ type: "tavily", api_key: "synthetic-search-key", quota_limit: 250, subscribed_at: Date.UTC(2026, 1, 3) / 1000 })] });
      await button(wrapper, "admin.settings.webSearchEmulation.removeProvider").trigger("click");
      await submit(wrapper);
      expect(updateWebSearchEmulationConfig).toHaveBeenLastCalledWith({ enabled: true, providers: [] });
    });

    it.each(["0", ""])("serializes Web Search quota %s as unlimited", async (quota) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const search = card(wrapper, "admin.settings.webSearchEmulation.title");
      await search.get('input[type="checkbox"]').setValue(true);
      await button(wrapper, "admin.settings.webSearchEmulation.addProvider").trigger("click");
      await search.get('input[type="number"]').setValue(quota);
      await submit(wrapper);
      expect(updateWebSearchEmulationConfig).toHaveBeenCalledWith(expect.objectContaining({ providers: [expect.objectContaining({ quota_limit: null })] }));
    });

    it("reports a partial save when Web Search fails and allows retry without losing the configuration", async () => {
      updateWebSearchEmulationConfig.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledWith("error");
      expect(showSuccess).not.toHaveBeenCalled();
      expect(fetchPublicSettings).toHaveBeenCalledWith(true);
      await submit(wrapper);
      expect(updateWebSearchEmulationConfig).toHaveBeenCalledTimes(2);
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
    });

    it("opens search diagnostics, renders the response, resets stale results on reopen, and retries an error", async () => {
      testWebSearchEmulation
        .mockResolvedValueOnce({ provider: "tavily", results: [{ title: "Synthetic result", url: "https://example.test/result", snippet: "Search preview" }] })
        .mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const search = card(wrapper, "admin.settings.webSearchEmulation.title");
      await search.get('input[type="checkbox"]').setValue(true);
      await button(wrapper, "admin.settings.webSearchEmulation.addProvider").trigger("click");
      await button(wrapper, "admin.settings.webSearchEmulation.test").trigger("click");
      const query = wrapper.get('[placeholder="admin.settings.webSearchEmulation.testDefaultQuery"]');
      await query.setValue("  gateway status  ");
      await query.trigger("keyup", { key: "Enter" });
      await flushPromises();
      expect(testWebSearchEmulation).toHaveBeenCalledWith("gateway status");
      expect(wrapper.get('a[href="https://example.test/result"]').text()).toBe("Synthetic result");
      expect(wrapper.text()).toContain("Search preview");
      await button(wrapper, "common.close").trigger("click");
      expect(wrapper.find('[placeholder="admin.settings.webSearchEmulation.testDefaultQuery"]').exists()).toBe(false);
      await button(wrapper, "admin.settings.webSearchEmulation.test").trigger("click");
      expect(wrapper.find('a[href="https://example.test/result"]').exists()).toBe(false);
      await wrapper.get('[placeholder="admin.settings.webSearchEmulation.testDefaultQuery"]').setValue("");
      const dialog = wrapper.get('[placeholder="admin.settings.webSearchEmulation.testDefaultQuery"]').element.closest(".fixed")!;
      (dialog.querySelector("button") as HTMLButtonElement).click();
      await flushPromises();
      expect(testWebSearchEmulation).toHaveBeenLastCalledWith("admin.settings.webSearchEmulation.testDefaultQuery");
      expect(showError).toHaveBeenCalledWith("error");
      expect(dialog.querySelector("button")!.disabled).toBe(false);
    });

    const independentSettings = [
      { title: "admin.settings.overloadCooldown.title", get: getOverloadCooldownSettings, save: updateOverloadCooldownSettings,
        value: "18", expected: { enabled: true, cooldown_minutes: 18 }, success: "admin.settings.overloadCooldown.saved" },
      { title: "admin.settings.rateLimit429Cooldown.title", get: getRateLimit429CooldownSettings, save: updateRateLimit429CooldownSettings,
        value: "45", expected: { enabled: true, cooldown_seconds: 45 }, success: "admin.settings.rateLimit429Cooldown.saved" },
      { title: "admin.settings.panelRateLimit.title", get: getPanelRateLimitSettings, save: updatePanelRateLimitSettings,
        tab: "security", value: "120", expected: { enabled: true, user_rpm: 120, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 }, success: "admin.settings.panelRateLimit.saved" },
      { title: "admin.settings.streamTimeout.title", get: getStreamTimeoutSettings, save: updateStreamTimeoutSettings,
        value: "17", expected: { enabled: true, action: "temp_unsched", temp_unsched_minutes: 17, threshold_count: 3, threshold_window_minutes: 10 }, success: "admin.settings.streamTimeout.saved" },
      { title: "上游倍率自动探测", get: getUpstreamBillingProbeSettings, save: updateUpstreamBillingProbeSettings,
        value: "90", expected: { enabled: true, interval_minutes: 90 }, success: "上游倍率自动探测设置已保存" },
      { title: "admin.settings.ollamaCloudUsage.title", get: getOllamaCloudUsageSettings, save: updateOllamaCloudUsageSettings,
        enable: true, value: "4", expected: { enabled: true, interval_minutes: 60, debounce_minutes: 4 }, success: "admin.settings.ollamaCloudUsage.saved" },
      { title: "admin.settings.opencodeGoUsage.title", get: getOpenCodeGoUsageSettings, save: updateOpenCodeGoUsageSettings,
        enable: true, value: "3", expected: { enabled: true, interval_minutes: 15, debounce_minutes: 3 }, success: "admin.settings.opencodeGoUsage.saved" },
    ];

    it.each(independentSettings)("saves and retries the independent $title card using its own request contract", async (setting) => {
      let reject!: (error: Error) => void;
      setting.save.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise; }));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, setting.tab ?? "gateway");
      const panel = card(wrapper, setting.title);
      if (setting.enable) await panel.get('input[type="checkbox"]').setValue(true);
      await panel.findAll('input[type="number"]')[0].setValue(setting.value);
      const save = () => panel.findAll("button").find((node) => node.text() === "common.save")!;
      await save().trigger("click");
      expect(setting.save).toHaveBeenCalledWith(setting.expected);
      expect(panel.findAll("button").find((node) => node.text() === "common.saving")!.attributes("disabled")).toBeDefined();
      reject(new Error("offline"));
      await flushPromises();
      expect(showError).toHaveBeenCalledWith("error");
      expect(save().attributes("disabled")).toBeUndefined();
      await save().trigger("click");
      await flushPromises();
      expect(setting.save).toHaveBeenCalledTimes(2);
      expect(setting.save).toHaveBeenLastCalledWith(setting.expected);
      expect(showSuccess).toHaveBeenCalledWith(setting.success);
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it.each(independentSettings.filter((setting) => setting.enable))("keeps $title disabled when its optional load fails", async (setting) => {
      setting.get.mockRejectedValueOnce(new Error("unsupported"));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const panel = card(wrapper, setting.title);
      expect(panel.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(false);
      expect(panel.find('input[type="number"]').exists()).toBe(false);
      expect(showError).not.toHaveBeenCalled();
      expect(setting.save).not.toHaveBeenCalled();
    });

    it("normalizes legacy rectifier patterns, edits its controls, and filters empty patterns before saving", async () => {
      getRectifierSettings.mockResolvedValueOnce({ enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true, apikey_signature_enabled: true, apikey_signature_patterns: null });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const panel = card(wrapper, "admin.settings.rectifier.title");
      expect(panel.find('[placeholder="admin.settings.rectifier.apikeyPatternPlaceholder"]').exists()).toBe(false);
      await button(wrapper, "+ admin.settings.rectifier.addPattern").trigger("click");
      await panel.get('[placeholder="admin.settings.rectifier.apikeyPatternPlaceholder"]').setValue("synthetic-signature");
      await button(wrapper, "+ admin.settings.rectifier.addPattern").trigger("click");
      await panel.findAll('input[type="checkbox"]')[1].setValue(false);
      await panel.findAll("button").find((node) => node.text() === "common.save")!.trigger("click");
      await flushPromises();
      expect(updateRectifierSettings).toHaveBeenCalledWith({ enabled: true, thinking_signature_enabled: false, thinking_budget_enabled: true, apikey_signature_enabled: true, apikey_signature_patterns: ["synthetic-signature"] });
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.rectifier.saved");
    });

    const provider = { id: 11, provider_key: "easypay", name: "Synthetic Provider", supported_types: ["alipay"], enabled: true, refund_enabled: true, allow_user_refund: true, sort_order: 10 };
    const providerList = (wrapper: ReturnType<typeof mountView>) => wrapper.findComponent({ name: "PaymentProviderList" });

    it.each([
      ["refund_enabled", { refund_enabled: false, allow_user_refund: false }],
      ["allow_user_refund", { allow_user_refund: false }],
      ["enabled", { enabled: false }],
    ])("updates provider %s immediately with the required cascading fields", async (name, payload) => {
      getProviders.mockResolvedValue({ data: [provider] });
      updateProvider.mockResolvedValue(undefined);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "payment");
      providerList(wrapper).vm.$emit("toggle-field", provider, name);
      await flushPromises();
      expect(updateProvider).toHaveBeenCalledWith(11, payload);
      expect(getProviders).toHaveBeenCalledTimes(2);
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("prevents a second provider from enabling an already active payment method", async () => {
      const other = { ...provider, id: 12, name: "Second Provider", provider_key: "alipay", enabled: false, supported_types: [] };
      getProviders.mockResolvedValue({ data: [provider, other] });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "payment");
      providerList(wrapper).vm.$emit("toggle-field", other, "enabled");
      await flushPromises();
      expect(updateProvider).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith("admin.settings.payment.enableConflict");
      expect(getProviders).toHaveBeenCalledTimes(1);
    });

    it("creates a provider from its dialog, closes on success, and auto-saves the parent settings", async () => {
      createProvider.mockResolvedValue(undefined);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "payment");
      providerList(wrapper).vm.$emit("create");
      await wrapper.vm.$nextTick();
      const dialog = wrapper.findComponent({ name: "PaymentProviderDialog" });
      expect(dialog.exists()).toBe(true);
      const payload = { provider_key: "easypay", name: "Draft Provider", supported_types: ["alipay"], enabled: false };
      dialog.vm.$emit("save", payload);
      await flushPromises();
      expect(createProvider).toHaveBeenCalledWith(payload);
      expect(wrapper.findComponent({ name: "PaymentProviderDialog" }).exists()).toBe(false);
      expect(getProviders).toHaveBeenCalledTimes(2);
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
    });

    it("retains a failed provider edit, then saves the same provider instead of creating another", async () => {
      getProviders.mockResolvedValue({ data: [provider] });
      updateProvider.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "payment");
      providerList(wrapper).vm.$emit("edit", provider);
      await wrapper.vm.$nextTick();
      const dialog = wrapper.findComponent({ name: "PaymentProviderDialog" });
      const payload = { name: "Renamed Provider" };
      dialog.vm.$emit("save", payload);
      await flushPromises();
      expect(showError).toHaveBeenCalledWith("error");
      expect(dialog.attributes("saving")).toBe("false");
      expect(wrapper.findComponent({ name: "PaymentProviderDialog" }).exists()).toBe(true);
      dialog.vm.$emit("save", payload);
      await flushPromises();
      expect(updateProvider).toHaveBeenLastCalledWith(11, payload);
      expect(createProvider).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "PaymentProviderDialog" }).exists()).toBe(false);
    });

    it("cancels step-up verification silently and allows an explicit retry of the settings save", async () => {
      updateSettings.mockRejectedValueOnce({ status: 403, reason: "STEP_UP_REQUIRED" });
      const wrapper = mountWorkflow();
      await flushPromises();
      await submit(wrapper);
      expect(wrapper.find('.z-stepup-panel[role="dialog"]').exists()).toBe(true);
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeDefined();
      await wrapper.get('.z-stepup-panel button').trigger("click");
      await flushPromises();
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
      expect(wrapper.get('.z-admin-settings-save button').attributes("disabled")).toBeUndefined();
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledTimes(2);
      expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
    });

    it("does not replay a pending sensitive save after the authentication session changes", async () => {
      updateSettings.mockRejectedValueOnce({ status: 403, reason: "STEP_UP_REQUIRED" });
      const wrapper = mountWorkflow();
      await flushPromises();
      await submit(wrapper);
      expect(wrapper.find('.z-stepup-panel[role="dialog"]').exists()).toBe(true);
      replaceAuthSession({ accessToken: "synthetic-next-session", user: { id: 202 } });
      await flushPromises();
      expect(wrapper.find('.z-stepup-panel[role="dialog"]').exists()).toBe(false);
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateWebSearchEmulationConfig).not.toHaveBeenCalled();
      expect(fetchPublicSettings).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
      expect(showError).not.toHaveBeenCalled();
    });

    it("discards a sensitive settings response from the prior session before updating the form or caches", async () => {
      let resolveSave!: (result: typeof baseSettingsResponse) => void;
      updateSettings.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
      const wrapper = mountWorkflow();
      await flushPromises();
      const name = wrapper.get('[placeholder="admin.settings.site.siteNamePlaceholder"]');
      await name.setValue("Current draft");
      await wrapper.get("form").trigger("submit");
      replaceAuthSession({ accessToken: "synthetic-replacement-session", user: { id: 303 } });
      resolveSave({ ...baseSettingsResponse, site_name: "Stale server response" });
      await flushPromises();
      expect((name.element as HTMLInputElement).value).toBe("Current draft");
      expect(updateWebSearchEmulationConfig).not.toHaveBeenCalled();
      expect(fetchPublicSettings).not.toHaveBeenCalled();
      expect(adminSettingsFetch).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
    });

    const labeledControl = (wrapper: ReturnType<typeof mountView>, text: string) => {
      const label = wrapper.findAll<HTMLLabelElement>("label").find((node) => node.text() === text);
      expect(label, `label ${text}`).toBeDefined();
      expect(label!.attributes("for"), `target ${text}`).toBeTruthy();
      expect(label!.element.control, `associated control ${text}`).toBeTruthy();
      return new DOMWrapper(label!.element.control!);
    };

    it("keeps label targets valid and unique when every settings category has been visited", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, email_verify_enabled: true, dingtalk_connect_enabled: true, dingtalk_connect_corp_restriction_policy: "internal_only",
        github_oauth_enabled: true, google_oauth_enabled: true, oidc_connect_enabled: true, channel_monitor_enabled: true,
        custom_menu_items: [{ id: "one", label: "Docs", url: "https://example.test", visibility: "user", icon_svg: "", sort_order: 0 }, { id: "two", label: "Status", url: "https://status.example.test", visibility: "admin", icon_svg: "", sort_order: 1 }],
        custom_endpoints: [{ name: "Main", endpoint: "https://api.example.test", description: "Main endpoint" }],
      });
      const wrapper = mountWorkflow();
      await flushPromises();
      for (const category of ["general", "agreement", "features", "security", "users", "gateway", "payment", "email"]) await openTab(wrapper, category);
      const ids = wrapper.findAll("[id]").map((node) => node.attributes("id"));
      expect(new Set(ids).size).toBe(ids.length);
      const labels = wrapper.findAll<HTMLLabelElement>("label[for]");
      expect(labels.length).toBeGreaterThan(100);
      for (const label of labels) expect(label.element.control, `${label.text()} / ${label.attributes("for")}`).toBeTruthy();
      expect(wrapper.get<HTMLLabelElement>('label[for="settings-form-smtp-port"]').element.control).toBe(wrapper.get("#settings-form-smtp-port").element);
    });

    it("associates SMTP labels with the fields that are submitted and the TLS control", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "email");
      const entries = [
        ["host", "smtp.example.test"], ["port", "2525"], ["username", "synthetic-mailer"],
        ["fromEmail", "mail@example.test"], ["fromName", "Test sender"],
      ];
      for (const [name, value] of entries) await labeledControl(wrapper, `admin.settings.smtp.${name}`).setValue(value);
      await labeledControl(wrapper, "admin.settings.smtp.useTls").setValue(false);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ smtp_host: "smtp.example.test", smtp_port: 2525, smtp_username: "synthetic-mailer", smtp_from_email: "mail@example.test", smtp_from_name: "Test sender", smtp_use_tls: false }));
    });

    it("keeps dynamic subscription and agreement labels unique when rows are removed", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse,
        default_subscriptions: [{ group_id: 3, validity_days: 30 }, { group_id: 4, validity_days: 60 }],
        login_agreement_documents: [{ id: "terms", title: "Terms", content_md: "Terms content" }, { id: "privacy", title: "Privacy", content_md: "Privacy content" }],
      });
      getGroups.mockResolvedValueOnce([
        { id: 3, name: "Plan 3", platform: "openai", subscription_type: "subscription", status: "active" },
        { id: 4, name: "Plan 4", platform: "openai", subscription_type: "subscription", status: "active" },
      ]);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "users");
      await wrapper.get('[data-testid="auth-source-email-enabled"]').setValue(true);
      await wrapper.get('[data-testid="auth-source-oidc-enabled"]').setValue(true);
      await openTab(wrapper, "agreement");
      const ids = wrapper.findAll("[id]").map((node) => node.attributes("id"));
      expect(new Set(ids).size).toBe(ids.length);
      wrapper.findAll<HTMLLabelElement>("label[for]").forEach((label) => {
        expect(label.element.control, label.text()).toBeTruthy();
      });
      await openTab(wrapper, "users");
      await wrapper.get(".default-sub-delete-btn").trigger("click");
      const days = labeledControl(wrapper, "admin.settings.defaults.subscriptionValidityDays");
      expect((days.element as HTMLInputElement).value).toBe("60");
      await days.setValue("75");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ default_subscriptions: [{ group_id: 4, validity_days: 75 }] }));
    });

    it("names every quota cell by platform and time window and submits the selected cell", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "users");
      const daily = wrapper.get('[aria-label="openai: 日限额 (USD)"]');
      await daily.setValue("0");
      await wrapper.get('[aria-label="gemini: 周限额 (USD)"]').setValue("9.5");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ default_platform_quotas: expect.objectContaining({ openai: expect.objectContaining({ daily: 0 }), gemini: expect.objectContaining({ weekly: 9.5 }) }) }));
    });

    it("keeps policy pattern groups separate from each uniquely named pattern input", async () => {
      getBetaPolicySettings.mockResolvedValueOnce({ rules: [
        { beta_token: "context-1m-2025-08-07", action: "filter", scope: "all", model_whitelist: ["model-a", "model-b"] },
        { beta_token: "fast-mode-2026-02-01", action: "filter", scope: "all", model_whitelist: ["model-c"] },
      ] });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const policy = card(wrapper, "admin.settings.betaPolicy.title");
      const patterns = policy.findAll('input[placeholder="admin.settings.betaPolicy.modelPatternPlaceholder"]');
      expect(patterns).toHaveLength(3);
      expect(new Set(patterns.map((input) => input.attributes("id"))).size).toBe(3);
      expect(patterns.map((input) => input.attributes("aria-label"))).toEqual([
        "admin.settings.betaPolicy.modelWhitelist 1.1", "admin.settings.betaPolicy.modelWhitelist 1.2", "admin.settings.betaPolicy.modelWhitelist 2.1",
      ]);
      policy.findAll<HTMLLabelElement>("label[for]").forEach((label) => expect(label.element.control).toBeTruthy());
      expect(policy.findAll("label").filter((label) => label.text() === "admin.settings.betaPolicy.modelWhitelist").every((label) => !label.attributes("for"))).toBe(true);
      await patterns[1].setValue("updated-model");
      await policy.findAll("button").find((node) => node.text() === "common.save")!.trigger("click");
      await flushPromises();
      expect(updateBetaPolicySettings).toHaveBeenCalledWith({ rules: [
        expect.objectContaining({ model_whitelist: ["model-a", "updated-model"] }), expect.objectContaining({ model_whitelist: ["model-c"] }),
      ] });
    });

    it("turns off internal DingTalk grants and profile synchronization when the organization restriction is removed", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, dingtalk_connect_enabled: true, dingtalk_connect_corp_restriction_policy: "internal_only",
        dingtalk_connect_bypass_registration: true, dingtalk_connect_sync_display_name: true, dingtalk_connect_sync_corp_email: true, dingtalk_connect_sync_dept: true });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      expect((labeledControl(wrapper, "admin.settings.dingtalk.bypassRegistration").element as HTMLInputElement).checked).toBe(true);
      await wrapper.get('input[type="radio"][value="none"]').setValue();
      expect(wrapper.find("#settings-form-dingtalk-connect-bypass-registration").exists()).toBe(false);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ dingtalk_connect_corp_restriction_policy: "none", dingtalk_connect_bypass_registration: false, dingtalk_connect_sync_display_name: false, dingtalk_connect_sync_corp_email: false, dingtalk_connect_sync_dept: false }));
      await wrapper.get('input[type="radio"][value="internal_only"]').setValue();
      expect((labeledControl(wrapper, "admin.settings.dingtalk.bypassRegistration").element as HTMLInputElement).checked).toBe(false);
    });

    it.each([
      ["linuxdo_connect", "linuxdo_connect_enabled"], ["github_oauth", "github_oauth_enabled"], ["google_oauth", "google_oauth_enabled"],
      ["oidc_connect", "oidc_connect_enabled"], ["dingtalk_connect", "dingtalk_connect_enabled"],
    ])("saves a new %s secret once and leaves subsequent saves blank to preserve the configured credential", async (prefix, enabled) => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, [enabled]: true });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      const id = prefix.replace(/_/g, "-");
      await wrapper.get(`#settings-form-${id}-client-id`).setValue("synthetic-client");
      const secret = wrapper.get(`#settings-form-${id}-client-secret`);
      await secret.setValue("synthetic-secret");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ [`${prefix}_client_id`]: "synthetic-client", [`${prefix}_client_secret`]: "synthetic-secret" }));
      expect((secret.element as HTMLInputElement).value).toBe("");
      await submit(wrapper);
      expect(updateSettings.mock.calls.at(-1)![0][`${prefix}_client_secret`]).toBeUndefined();
    });

    it.each(["mobile", "mp"])("keeps WeChat %s mutually exclusive with the other mobile sign-in mode", async (mode) => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, wechat_connect_mp_enabled: mode === "mobile", wechat_connect_mobile_enabled: mode === "mp", wechat_connect_mode: mode === "mobile" ? "mp" : "mobile" });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      await wrapper.get(`[data-testid="wechat-connect-${mode}-enabled"]`).setValue(true);
      const other = mode === "mobile" ? "mp" : "mobile";
      expect(wrapper.get<HTMLInputElement>(`[data-testid="wechat-connect-${other}-enabled"]`).element.checked).toBe(false);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ wechat_connect_mode: mode, wechat_connect_mp_enabled: mode === "mp", wechat_connect_mobile_enabled: mode === "mobile" }));
    });

    it.each([
      ["recharge_and_subscription", true, false], ["recharge_only", false, false], ["subscription_only", true, true],
    ])("maps the visible site billing mode %s to the actual subscription and recharge flags", async (mode, subscription, disabled) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "features");
      const modeSelect = wrapper.findAll("select").find((node) => node.find('option[value="subscription_only"]').exists())!;
      expect(wrapper.findAll<HTMLLabelElement>("label[for]").some((label) => label.element.control === modeSelect.element)).toBe(true);
      await modeSelect.setValue(mode);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ subscription_enabled: subscription, payment_balance_disabled: disabled }));
    });

    it("disables cancellation-limit fields until its named switch is enabled and persists the edited limits", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "payment");
      const toggle = wrapper.get('[role="switch"][aria-label="admin.settings.payment.cancelRateLimit"]');
      const window = wrapper.get('[aria-label="admin.settings.payment.cancelRateLimitWindow"]');
      expect(toggle.attributes("aria-checked")).toBe("false");
      expect(window.attributes("disabled")).toBeDefined();
      await toggle.trigger("click");
      expect(toggle.attributes("aria-checked")).toBe("true");
      expect(window.attributes("disabled")).toBeUndefined();
      await window.setValue("2");
      await wrapper.get('[aria-label="admin.settings.payment.cancelRateLimitUnit"]').setValue("hour");
      await wrapper.get('[aria-label="admin.settings.payment.cancelRateLimitMax"]').setValue("7");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ payment_cancel_rate_limit_enabled: true, payment_cancel_rate_limit_window: 2, payment_cancel_rate_limit_unit: "hour", payment_cancel_rate_limit_max: 7 }));
    });

    it.each([["", 180], ["0", 0], ["90", 90]])("submits audit log retention %s using the integer backend contract", async (value, expected) => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      await wrapper.get("#settings-form-audit-log-retention-days").setValue(value);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ audit_log_retention_days: expected }));
    });

    it("normalizes pasted registration domains, handles IME composition and removes the latest tag with Backspace", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      const input = wrapper.get('[aria-label="admin.settings.registration.emailSuffixWhitelist"]');
      await input.trigger("paste", { clipboardData: { getData: () => "@Example.com, example.com; *.Example.org" } });
      await input.trigger("keydown", { key: "Backspace" });
      await input.setValue("@sub.example.net");
      await input.trigger("keydown", { key: "Enter", isComposing: true });
      expect((input.element as HTMLInputElement).value).toBe("sub.example.net");
      await input.trigger("keydown", { key: "Enter" });
      expect((input.element as HTMLInputElement).value).toBe("");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ registration_email_suffix_whitelist: ["@example.com", "@sub.example.net"] }));
    });

    it("clears Tencent CAPTCHA credentials after saving so later unrelated saves preserve the configured secrets", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, tencent_captcha_enabled: true, tencent_captcha_app_id: "synthetic-app" });
      const fields = ["app_secret_key", "cloud_secret_id", "cloud_secret_key"];
      updateSettings.mockImplementation(async (payload) => {
        const response = { ...baseSettingsResponse, ...payload };
        for (const field of fields) {
          delete response[`tencent_captcha_${field}`];
          response[`tencent_captcha_${field}_configured`] = true;
        }
        return response;
      });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "security");
      for (const field of fields) await wrapper.get(`#settings-form-tencent-captcha-${field.replace(/_/g, "-")}`).setValue(`synthetic-${field}`);
      await submit(wrapper);
      for (const field of fields) {
        expect(updateSettings.mock.calls[0][0][`tencent_captcha_${field}`]).toBe(`synthetic-${field}`);
        expect(wrapper.get<HTMLInputElement>(`#settings-form-tencent-captcha-${field.replace(/_/g, "-")}`).element.value).toBe("");
      }
      await submit(wrapper);
      for (const field of fields) expect(updateSettings.mock.calls[1][0][`tencent_captcha_${field}`]).toBeUndefined();
    });

    it("rejects duplicate default subscription groups and permits correction through the associated selectors", async () => {
      getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, default_subscriptions: [{ group_id: 3, validity_days: 30 }, { group_id: 4, validity_days: 60 }] });
      getGroups.mockResolvedValueOnce([
        { id: 3, name: "Plan 3", platform: "openai", subscription_type: "subscription", status: "active" },
        { id: 4, name: "Plan 4", platform: "openai", subscription_type: "subscription", status: "active" },
      ]);
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "users");
      const second = wrapper.findAll(".default-sub-group-select")[1];
      await second.setValue("3");
      await submit(wrapper);
      expect(updateSettings).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith("admin.settings.defaults.defaultSubscriptionsDuplicate");
      await second.setValue("4");
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ default_subscriptions: [{ group_id: 3, validity_days: 30 }, { group_id: 4, validity_days: 60 }] }));
    });

    it.each(["pass", "block"])("cleans beta whitelist rows and submits only the applicable %s fallback message", async (fallback) => {
      getBetaPolicySettings.mockResolvedValueOnce({ rules: [{ beta_token: "context-1m-2025-08-07", action: "filter", scope: "all", model_whitelist: ["", "model-a"], fallback_action: "block", fallback_error_message: "Synthetic fallback block" }] });
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const policy = card(wrapper, "admin.settings.betaPolicy.title");
      await policy.get('[aria-label="admin.settings.betaPolicy.fallbackAction"]').setValue(fallback);
      const chip = policy.findAll("button").find((node) => node.text() === "claude-opus-*")!;
      await chip.trigger("click");
      await chip.trigger("click");
      await policy.findAll("button").find((node) => node.text() === "common.save")!.trigger("click");
      await flushPromises();
      expect(updateBetaPolicySettings).toHaveBeenCalledWith({ rules: [expect.objectContaining({ model_whitelist: ["model-a", "claude-opus-*"], fallback_action: fallback, fallback_error_message: fallback === "block" ? "Synthetic fallback block" : undefined })] });
    });

    it("retains a beta preset after a failed save, then removes its fallback when the whitelist is cleared", async () => {
      getBetaPolicySettings.mockResolvedValueOnce({ rules: [{ beta_token: "context-1m-2025-08-07", action: "filter", scope: "all", model_whitelist: [] }] });
      updateBetaPolicySettings.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "gateway");
      const policy = card(wrapper, "admin.settings.betaPolicy.title");
      await button(wrapper, "admin.settings.betaPolicy.presetOpusOnly").trigger("click");
      const save = () => policy.findAll("button").find((node) => node.text() === "common.save")!;
      await save().trigger("click");
      await flushPromises();
      expect(showError).toHaveBeenCalledWith("error");
      expect(policy.get<HTMLInputElement>("#settings-beta-policy-pattern-0-0").element.value).toBe("claude-opus-4-6");
      await save().trigger("click");
      await flushPromises();
      expect(updateBetaPolicySettings).toHaveBeenLastCalledWith({ rules: [expect.objectContaining({ action: "pass", model_whitelist: ["claude-opus-4-6"], fallback_action: "filter" })] });
      await policy.get("#settings-beta-policy-pattern-0-0").setValue("");
      await save().trigger("click");
      await flushPromises();
      expect(updateBetaPolicySettings).toHaveBeenLastCalledWith({ rules: [expect.objectContaining({ model_whitelist: undefined, fallback_action: undefined, fallback_error_message: undefined })] });
    });

    describe("Settings security and notification transactions", () => {
      function deferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      }

      const replaceOwner = (wrapper: ReturnType<typeof mountView>, change: "login" | "unmount") => {
        if (change === "login") replaceAuthSession({ accessToken: "synthetic-settings-new-login", user: { id: 7 } });
        else {
          wrapper.unmount();
          mounted.splice(mounted.indexOf(wrapper), 1);
        }
      };

      it("submits independent registration, recovery and session-security controls through their actual fields", async () => {
        getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, email_verify_enabled: true, totp_encryption_key_configured: true });
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "security");
        await wrapper.get("#settings-form-registration-enabled").setValue(false);
        await wrapper.get("#settings-form-invitation-code-enabled").setValue(true);
        await wrapper.get("#settings-form-promo-code-enabled").setValue(false);
        await wrapper.get("#settings-form-registration-email-domain-quota-enabled").setValue(true);
        await wrapper.get("#settings-form-password-reset-enabled").setValue(true);
        await wrapper.get("#settings-form-frontend-url").setValue("https://synthetic.example.invalid");
        await wrapper.get("#settings-form-totp-enabled").setValue(true);
        await wrapper.get("#settings-form-step-up-enabled").setValue(true);
        await wrapper.get("#settings-form-session-binding-enabled").setValue(true);
        await submit(wrapper);
        expect(updateSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          registration_enabled: false, email_verify_enabled: true, invitation_code_enabled: true,
          promo_code_enabled: false, registration_email_domain_quota_enabled: true,
          password_reset_enabled: true, frontend_url: "https://synthetic.example.invalid",
          totp_enabled: true, step_up_enabled: true, session_binding_enabled: true,
        }));
        expect(showSuccess).toHaveBeenCalledWith("admin.settings.settingsSaved");
      });

      it("keeps a recovery URL draft while email verification hides and restores its dependent fields", async () => {
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "security");
        await wrapper.get("#settings-form-password-reset-enabled").setValue(true);
        await wrapper.get("#settings-form-frontend-url").setValue("https://recovery.example.invalid");
        await wrapper.get("#settings-form-email-verify-enabled").setValue(false);
        expect(wrapper.find("#settings-form-password-reset-enabled").exists()).toBe(false);
        expect(wrapper.find("#settings-form-frontend-url").exists()).toBe(false);
        await openTab(wrapper, "email");
        expect(wrapper.find("#settings-form-smtp-host").exists()).toBe(false);
        await openTab(wrapper, "security");
        await wrapper.get("#settings-form-email-verify-enabled").setValue(true);
        expect(wrapper.get<HTMLInputElement>("#settings-form-password-reset-enabled").element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>("#settings-form-frontend-url").element.value).toBe("https://recovery.example.invalid");
        await submit(wrapper);
        expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ password_reset_enabled: true, frontend_url: "https://recovery.example.invalid" }));
      });

      it("submits notification thresholds, disabled recipients and removal of blank recipient rows", async () => {
        getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, email_verify_enabled: true,
          balance_low_notify_enabled: true, balance_low_notify_threshold: 4.5,
          account_quota_notify_enabled: true,
          account_quota_notify_emails: [{ email: "existing@example.invalid", disabled: false }],
        });
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "email");
        expect(wrapper.get<HTMLInputElement>("#settings-form-balance-low-notify-threshold").element.value).toBe("4.5");
        await wrapper.get("#settings-form-balance-low-notify-threshold").setValue("2.75");
        await wrapper.get("#settings-form-balance-low-notify-recharge-url").setValue("https://recharge.example.invalid");
        await wrapper.get("#settings-form-subscription-expiry-notify-enabled").setValue(false);
        const quota = card(wrapper, "admin.settings.quotaNotify.title");
        await quota.get('input[type="checkbox"]:not([id])').setValue(false);
        await quota.findAll("button").find(node => node.text().includes("admin.settings.quotaNotify.addEmail"))!.trigger("click");
        await quota.findAll('input[type="email"]')[1].setValue("new@example.invalid");
        await quota.findAll("button").find(node => node.text().includes("admin.settings.quotaNotify.addEmail"))!.trigger("click");
        await submit(wrapper);
        expect(updateSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          balance_low_notify_enabled: true, balance_low_notify_threshold: 2.75,
          balance_low_notify_recharge_url: "https://recharge.example.invalid", subscription_expiry_notify_enabled: false,
          account_quota_notify_enabled: true,
          account_quota_notify_emails: [{ email: "existing@example.invalid", disabled: true }, { email: "new@example.invalid", disabled: false, verified: true }],
        }));
      });

      it.each(["login", "unmount"] as const)("does not install a late initial settings response after %s", async change => {
        const pending = deferred<typeof baseSettingsResponse>();
        getSettings.mockReturnValueOnce(pending.promise);
        const wrapper = mountWorkflow();
        await flushPromises();
        replaceOwner(wrapper, change);
        pending.resolve({ ...baseSettingsResponse, site_name: "Old login settings" });
        await flushPromises();
        expect(getWebSearchEmulationConfig).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        if (change === "login") expect(wrapper.find('[placeholder="admin.settings.site.siteNamePlaceholder"]').exists()).toBe(false);
      });

      it.each([
        ["connection", "success", "login"], ["connection", "failure", "unmount"],
        ["email", "success", "unmount"], ["email", "failure", "login"],
      ] as const)("ignores an old %s diagnostic %s after %s", async (kind, outcome, change) => {
        const pending = deferred<{ message: string }>();
        const diagnostic = kind === "connection" ? testSmtpConnection : sendTestEmail;
        diagnostic.mockReturnValueOnce(pending.promise);
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "email");
        await wrapper.get("#settings-form-smtp-host").setValue("smtp.synthetic.invalid");
        if (kind === "email") await wrapper.get("#settings-test-email-address").setValue("recipient@example.invalid");
        await button(wrapper, kind === "connection" ? "admin.settings.smtp.testConnection" : "admin.settings.testEmail.sendTestEmail").trigger("click");
        expect(diagnostic).toHaveBeenCalledOnce();
        replaceOwner(wrapper, change);
        if (outcome === "success") pending.resolve({ message: "Obsolete diagnostic" });
        else pending.reject(new Error("Obsolete diagnostic failure"));
        await flushPromises();
        expect(showSuccess).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
      });

      it.each(["search", "public-cache"] as const)("stops later save stages after replacing the login during %s", async stage => {
        const pending = deferred<undefined>();
        if (stage === "search") updateWebSearchEmulationConfig.mockReturnValueOnce(pending.promise);
        else fetchPublicSettings.mockReturnValueOnce(pending.promise);
        const wrapper = mountWorkflow();
        await flushPromises();
        await wrapper.get('[placeholder="admin.settings.site.siteNamePlaceholder"]').setValue("Saved synthetic name");
        await wrapper.get("form").trigger("submit");
        await flushPromises();
        expect(updateSettings).toHaveBeenCalledOnce();
        replaceOwner(wrapper, "login");
        pending.resolve(undefined);
        await flushPromises();
        if (stage === "search") expect(fetchPublicSettings).not.toHaveBeenCalled();
        expect(adminSettingsFetch).not.toHaveBeenCalled();
        expect(showSuccess).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
      });
    });

    describe("Settings immutable notification and cooldown saves", () => {
      it.each(["unmount", "login"] as const)("does not publish the old independent cooldown save after %s", async change => {
        let resolve!: (value: { enabled: boolean, cooldown_minutes: number }) => void;
        let reject!: (error: unknown) => void;
        const pending = new Promise<{ enabled: boolean, cooldown_minutes: number }>((res, rej) => { resolve = res; reject = rej; });
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "gateway");
        const cooldown = card(wrapper, "admin.settings.overloadCooldown.title");
        await cooldown.get('input[type="number"]').setValue("17");
        updateOverloadCooldownSettings.mockReturnValueOnce(pending);
        await cooldown.findAll("button").find(node => node.text() === "common.save")!.trigger("click");
        expect(updateOverloadCooldownSettings).toHaveBeenCalledExactlyOnceWith({ enabled: true, cooldown_minutes: 17 });
        if (change === "unmount") { wrapper.unmount(); mounted.splice(mounted.indexOf(wrapper), 1); }
        else replaceAuthSession({ accessToken: "synthetic-settings-independent-relogin", user: { id: 7 } });
        if (change === "unmount") resolve({ enabled: true, cooldown_minutes: 17 });
        else reject(new AuthSessionChangedError());
        await flushPromises();
        expect(showSuccess).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
      });

      it("retries exactly the submitted notification recipients after step-up and retains later edits for the next manual save", async () => {
        getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, email_verify_enabled: true, account_quota_notify_enabled: true,
          account_quota_notify_emails: [{ email: "initial@example.invalid", disabled: false }],
        });
        const wirePayloads: Array<{ account_quota_notify_emails: Array<{ email: string, disabled: boolean }> }> = [];
        updateSettings.mockImplementation(payload => {
          wirePayloads.push(JSON.parse(JSON.stringify(payload)));
          if (wirePayloads.length === 1) return Promise.reject({ reason: "STEP_UP_REQUIRED" });
          return Promise.resolve({ ...baseSettingsResponse, ...payload });
        });
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "email");
        const recipient = card(wrapper, "admin.settings.quotaNotify.title").get('input[type="email"]');
        await recipient.setValue("submitted@example.invalid");
        await submit(wrapper);
        expect(wrapper.find('.z-stepup-panel[role="dialog"]').exists()).toBe(true);
        await recipient.setValue("new-unsaved@example.invalid");
        await card(wrapper, "admin.settings.quotaNotify.title").get('input[type="checkbox"]:not([id])').setValue(false);
        await wrapper.get('.z-stepup-code-grid input').trigger("paste", { clipboardData: { getData: () => "123456" } });
        await flushPromises();
        expect(totpStepUp).toHaveBeenCalledExactlyOnceWith("123456");
        expect(wirePayloads[0].account_quota_notify_emails).toEqual([{ email: "submitted@example.invalid", disabled: false }]);
        expect(wirePayloads[1].account_quota_notify_emails).toEqual(wirePayloads[0].account_quota_notify_emails);
        expect((recipient.element as HTMLInputElement).value).toBe("new-unsaved@example.invalid");
        await submit(wrapper);
        expect(wirePayloads).toHaveLength(3);
        expect(wirePayloads[2].account_quota_notify_emails).toEqual([{ email: "new-unsaved@example.invalid", disabled: true }]);
      });

      it("locks queued cooldown saves and retains a failed operation for one explicit retry", async () => {
        let reject!: (error: unknown) => void;
        const pending = new Promise((_, rej) => { reject = rej; });
        const wrapper = mountWorkflow();
        await flushPromises();
        await openTab(wrapper, "gateway");
        const cooldown = card(wrapper, "admin.settings.overloadCooldown.title");
        await cooldown.get('input[type="number"]').setValue("17");
        updateOverloadCooldownSettings.mockReturnValueOnce(pending);
        const save = cooldown.findAll("button").find(node => node.text() === "common.save")!;
        (save.element as HTMLButtonElement).click();
        (save.element as HTMLButtonElement).click();
        await flushPromises();
        expect(updateOverloadCooldownSettings).toHaveBeenCalledOnce();
        expect(save.attributes("disabled")).toBeDefined();
        reject(new Error("Synthetic cooldown conflict"));
        await flushPromises();
        expect(showError).toHaveBeenCalledExactlyOnceWith("error");
        expect(showSuccess).not.toHaveBeenCalled();
        expect(cooldown.get<HTMLInputElement>('input[type="number"]').element.value).toBe("17");
        expect(save.attributes("disabled")).toBeUndefined();
        await save.trigger("click");
        await flushPromises();
        expect(updateOverloadCooldownSettings.mock.calls).toEqual([
          [{ enabled: true, cooldown_minutes: 17 }], [{ enabled: true, cooldown_minutes: 17 }],
        ]);
        expect(showSuccess).toHaveBeenCalledExactlyOnceWith("admin.settings.overloadCooldown.saved");
      });
    });

    it("switches channel monitor modes, preserves the edited visibility controls and uses a valid default interval", async () => {
      const wrapper = mountWorkflow();
      await flushPromises();
      await openTab(wrapper, "features");
      await labeledControl(wrapper, "admin.settings.features.channelMonitor.enabled").setValue(true);
      await wrapper.get("#settings-form-channel-monitor-default-interval-seconds").setValue("");
      await wrapper.get('[aria-label="admin.settings.features.channelMonitor.showQuota"]').setValue(true);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ channel_monitor_enabled: true, channel_monitor_mode: "v1", channel_monitor_default_interval_seconds: 60, channel_monitor_show_quota: true }));
      await button(wrapper, "admin.settings.features.channelMonitor.modeV2").trigger("click");
      expect(wrapper.find("#settings-form-channel-monitor-default-interval-seconds").exists()).toBe(false);
      await wrapper.get('[aria-label="admin.settings.features.channelMonitor.hideThroughput"]').setValue(true);
      await wrapper.get('[aria-label="admin.settings.features.channelMonitor.hideUserRanking"]').setValue(true);
      await submit(wrapper);
      expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ channel_monitor_mode: "v2", channel_monitor_hide_throughput: true, channel_monitor_hide_user_ranking: true }));
    });
  });
});

describe("admin SettingsView wechat connect controls", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    getWebSearchEmulationConfig.mockReset();
    updateWebSearchEmulationConfig.mockReset();
    getAdminApiKey.mockReset();
    getOverloadCooldownSettings.mockReset();
    getRateLimit429CooldownSettings.mockReset();
    updateRateLimit429CooldownSettings.mockReset();
    getStreamTimeoutSettings.mockReset();
    getRectifierSettings.mockReset();
    getBetaPolicySettings.mockReset();
    getGroups.mockReset();
    listProxies.mockReset();
    getProviders.mockReset();
    updateProvider.mockReset();
    createProvider.mockReset();
    deleteProvider.mockReset();
    fetchPublicSettings.mockReset();
    adminSettingsFetch.mockReset();
    showError.mockReset();
    showSuccess.mockReset();

    getSettings.mockResolvedValue({
      ...baseSettingsResponse,
      payment_visible_method_wxpay_source: "official_wxpay",
    });
    updateSettings.mockImplementation(async (payload) => ({
      ...baseSettingsResponse,
      payment_visible_method_wxpay_source: "official_wxpay",
      ...payload,
    }));
    getWebSearchEmulationConfig.mockResolvedValue({
      enabled: false,
      providers: [],
    });
    updateWebSearchEmulationConfig.mockResolvedValue({
      enabled: false,
      providers: [],
    });
    getAdminApiKey.mockResolvedValue({
      exists: false,
      masked_key: "",
    });
    getOverloadCooldownSettings.mockResolvedValue({
      enabled: true,
      cooldown_minutes: 10,
    });
    getRateLimit429CooldownSettings.mockResolvedValue({
      enabled: true,
      cooldown_seconds: 5,
    });
    updateRateLimit429CooldownSettings.mockImplementation(async (payload) => payload);
    getStreamTimeoutSettings.mockResolvedValue({
      enabled: true,
      action: "temp_unsched",
      temp_unsched_minutes: 5,
      threshold_count: 3,
      threshold_window_minutes: 10,
    });
    getRectifierSettings.mockResolvedValue({
      enabled: true,
      thinking_signature_enabled: true,
      thinking_budget_enabled: true,
      apikey_signature_enabled: false,
      apikey_signature_patterns: [],
    });
    getBetaPolicySettings.mockResolvedValue({
      rules: [],
    });
    getGroups.mockResolvedValue([]);
    listProxies.mockResolvedValue({
      items: [],
    });
    getProviders.mockResolvedValue({
      data: [],
    });
    fetchPublicSettings.mockResolvedValue(undefined);
    adminSettingsFetch.mockResolvedValue(undefined);
  });

  it("loads and echoes WeChat Connect fields from the backend payload", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    expect(
      (
        wrapper.get('[data-testid="wechat-connect-mp-app-id"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("wx-app-id-123");
    expect(
      (
        wrapper.get('[data-testid="wechat-connect-open-enabled"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-testid="wechat-connect-mp-enabled"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(wrapper.find('[data-testid="wechat-connect-scopes"]').exists()).toBe(
      false,
    );
    expect(
      wrapper
        .get('[data-testid="wechat-connect-mp-app-secret"]')
        .attributes("placeholder"),
    ).toContain("密钥已配置");
    expect(
      (
        wrapper.get('[data-testid="wechat-connect-frontend-redirect-url"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("/auth/wechat/callback");
  });

  it("links GitHub OAuth Apps guide to GitHub developer settings", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      github_oauth_enabled: true,
    });

    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    const link = wrapper.get('[data-testid="github-oauth-apps-guide-link"]');
    expect(link.text()).toContain("OAuth Apps");
    expect(link.attributes("href")).toBe("https://github.com/settings/developers");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toContain("noopener");
  });

  it("saves WeChat Connect fields using the backend contract and clears the secret after save", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);

    await wrapper
      .get('[data-testid="wechat-connect-mp-app-id"]')
      .setValue("wx-app-id-updated");
    await wrapper
      .get('[data-testid="wechat-connect-mp-app-secret"]')
      .setValue("new-secret");
    await wrapper
      .get('[data-testid="wechat-connect-open-enabled"]')
      .setValue(true);
    await wrapper
      .get('[data-testid="wechat-connect-mp-enabled"]')
      .setValue(true);
    await wrapper
      .get('[data-testid="wechat-connect-redirect-url"]')
      .setValue("https://admin.example.com/api/v1/auth/oauth/wechat/callback");
    await wrapper
      .get('[data-testid="wechat-connect-frontend-redirect-url"]')
      .setValue("/auth/wechat/callback");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        wechat_connect_enabled: true,
        wechat_connect_app_id: "wx-app-id-updated",
        wechat_connect_open_enabled: true,
        wechat_connect_mp_enabled: true,
        wechat_connect_mp_app_id: "wx-app-id-updated",
        wechat_connect_mp_app_secret: "new-secret",
        wechat_connect_redirect_url:
          "https://admin.example.com/api/v1/auth/oauth/wechat/callback",
        wechat_connect_frontend_redirect_url: "/auth/wechat/callback",
      }),
    );
    expect(
      (
        wrapper.get('[data-testid="wechat-connect-mp-app-secret"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      wrapper
        .get('[data-testid="wechat-connect-mp-app-secret"]')
        .attributes("placeholder"),
    ).toContain("密钥已配置");
  });

  it("collapses auth source defaults until the source is enabled", async () => {
    const wrapper = mountView();

    await flushPromises();
    await openUsersTab(wrapper);

    expect(
      (
        wrapper.get('[data-testid="auth-source-email-enabled"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="auth-source-email-panel"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain("注册即授权");

    await wrapper
      .get('[data-testid="auth-source-email-enabled"]')
      .setValue(true);

    expect(
      wrapper.find('[data-testid="auth-source-email-panel"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain("首次绑定时授权");
  });

  it("preserves optional OIDC compatibility flags instead of forcing them on save", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      oidc_connect_enabled: true,
      oidc_connect_use_pkce: false,
      oidc_connect_validate_id_token: false,
    });

    const wrapper = mountView();

    await flushPromises();
    await openSecurityTab(wrapper);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        oidc_connect_use_pkce: false,
        oidc_connect_validate_id_token: false,
      }),
    );
  });
});

describe("admin SettingsView platform quota matrix", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    getWebSearchEmulationConfig.mockReset();
    updateWebSearchEmulationConfig.mockReset();
    getAdminApiKey.mockReset();
    getOverloadCooldownSettings.mockReset();
    getRateLimit429CooldownSettings.mockReset();
    updateRateLimit429CooldownSettings.mockReset();
    getStreamTimeoutSettings.mockReset();
    getRectifierSettings.mockReset();
    getBetaPolicySettings.mockReset();
    getGroups.mockReset();
    listProxies.mockReset();
    getProviders.mockReset();
    updateProvider.mockReset();
    createProvider.mockReset();
    deleteProvider.mockReset();
    fetchPublicSettings.mockReset();
    adminSettingsFetch.mockReset();
    showError.mockReset();
    showSuccess.mockReset();
    localeRef.value = "zh-CN";

    getSettings.mockResolvedValue({ ...baseSettingsResponse });
    updateSettings.mockImplementation(async (payload) => ({
      ...baseSettingsResponse,
      ...payload,
    }));
    getWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] });
    updateWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] });
    getAdminApiKey.mockResolvedValue({ exists: false, masked_key: "" });
    getOverloadCooldownSettings.mockResolvedValue({});
    getRateLimit429CooldownSettings.mockResolvedValue({});
    updateRateLimit429CooldownSettings.mockResolvedValue({});
    getStreamTimeoutSettings.mockResolvedValue({});
    getRectifierSettings.mockResolvedValue({});
    getBetaPolicySettings.mockResolvedValue({});
    getGroups.mockResolvedValue([]);
    listProxies.mockResolvedValue({ items: [] });
    getProviders.mockResolvedValue({ data: [] });
  });

  it("从 baseSettings 加载默认平台配额数据并在 Users tab 渲染 6 平台行", async () => {
    const wrapper = mountView();
    await flushPromises();
    await openUsersTab(wrapper);

    expect(getSettings).toHaveBeenCalled();

    const html = wrapper.html();
    // 表格行的平台字段：font-mono 渲染纯英文 platform key
    expect(html).toContain("anthropic");
    expect(html).toContain("openai");
    expect(html).toContain("gemini");
    expect(html).toContain("antigravity");
    expect(html).toContain("typesafe");
  });

  it("保存时 updateSettings payload 应包含嵌套 default_platform_quotas 对象（含全 6 平台）", async () => {
    const wrapper = mountView();
    await flushPromises();
    await openUsersTab(wrapper);

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalled();
    const lastCallArgs = updateSettings.mock.calls.at(-1);
    expect(lastCallArgs).toBeDefined();
    const payload = lastCallArgs![0] as Record<string, unknown>;

    // 应携带嵌套对象，而非扁平字段
    expect(payload).toHaveProperty("default_platform_quotas");
    const quotas = payload["default_platform_quotas"] as Record<string, unknown>;
    const platforms = ["anthropic", "openai", "gemini", "antigravity", "grok", "typesafe"];
    for (const p of platforms) {
      expect(quotas).toHaveProperty(p);
      const pq = quotas[p] as Record<string, unknown>;
      expect(pq).toHaveProperty("daily");
      expect(pq).toHaveProperty("weekly");
      expect(pq).toHaveProperty("monthly");
    }

    // 不应存在旧扁平字段
    expect(payload).not.toHaveProperty("default_platform_quota_anthropic_daily");
    expect(payload).not.toHaveProperty("default_platform_quota_openai_weekly");
  });

  it("加载后 form.default_platform_quotas 含全 6 平台，从嵌套 JSON 正确读取数值", async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      default_platform_quotas: {
        anthropic: { daily: 5, weekly: null, monthly: null },
        openai:    { daily: null, weekly: 12.5, monthly: null },
        // gemini / antigravity 缺失 → 应被归一化为全 null
      },
    });

    const wrapper = mountView();
    await flushPromises();
    await openUsersTab(wrapper);

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const payload = updateSettings.mock.calls.at(-1)![0] as Record<string, unknown>;
    const quotas = payload["default_platform_quotas"] as Record<string, Record<string, unknown>>;

    expect(quotas["anthropic"]?.["daily"]).toBe(5);
    expect(quotas["openai"]?.["weekly"]).toBe(12.5);
    // 缺失平台应补全为 null
    expect(quotas["gemini"]).toEqual({ daily: null, weekly: null, monthly: null });
    expect(quotas["antigravity"]).toEqual({ daily: null, weekly: null, monthly: null });
    expect(quotas["typesafe"]).toEqual({ daily: null, weekly: null, monthly: null });
  });

  it("空输入（v-model.number 产出 \"\"）在提交时清洗为 null 而非空字符串", async () => {
    // 模拟后端返回带有 anthropic daily 值的配额
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      default_platform_quotas: {
        anthropic: { daily: 10, weekly: null, monthly: null },
        openai:    { daily: null, weekly: null, monthly: null },
        gemini:    { daily: null, weekly: null, monthly: null },
        antigravity: { daily: null, weekly: null, monthly: null },
      },
    });

    const wrapper = mountView();
    await flushPromises();
    await openUsersTab(wrapper);

    // 找到 anthropic daily 输入框并清空（模拟用户删除值）
    const inputs = wrapper.findAll('input[type="number"]');
    const anthropicDailyInput = inputs.find((i) => {
      const parent = i.element.closest("tr");
      return parent?.textContent?.includes("anthropic");
    });

    if (anthropicDailyInput) {
      // 设置为空字符串，模拟 v-model.number 在清空时产出 ""
      await anthropicDailyInput.setValue("");
    }

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const payload = updateSettings.mock.calls.at(-1)![0] as Record<string, unknown>;
    const quotas = payload["default_platform_quotas"] as Record<string, Record<string, unknown>>;
    // 不管输入是什么，提交值应为 null（而非 "" 或 NaN）
    expect(quotas["anthropic"]?.["daily"]).toBe(null);
  });
});
