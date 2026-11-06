import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import * as groups from '@/api/admin/groups'
import * as dashboard from '@/api/admin/dashboard'
import * as data from '@/api/admin/dataManagement'
import * as plugins from '@/api/admin/plugins'
import * as attributes from '@/api/admin/userAttributes'
import * as tls from '@/api/admin/tlsFingerprintProfile'
import * as rules from '@/api/admin/errorPassthrough'
import * as access from '@/api/admin/adminAccessKeys'
import payment from '@/api/admin/payment'
import type { CompositeModelRouteInput } from '@/types'

vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

// Literal HTTP contracts checked against the matching Go route registrations.
// These tests exercise actual Axios serialization/interceptors, not apiClient
// method mocks. The adapter is a closed synthetic boundary: no HTTP is sent.
type Wire = { method: string; path: string; query: Record<string, string>; body: unknown; auth: string; admin: string; key: string; timeout: number }
type Contract = { name: string; call: () => Promise<unknown>; method?: string; path: string; query?: Record<string, string>; body?: unknown; response?: unknown; result?: unknown; void?: boolean; key?: string }
const oldAdapter = apiClient.defaults.adapter
let wires: Wire[] = []
let responseValue: unknown
let rejectWrite = false
const accepted = { message: 'Synthetic accepted', id: 41, enabled: false, items: [] }
const groupInput = { name: 'Synthetic group', platform: 'openai' as const, rate_multiplier: 0, is_exclusive: false, daily_limit_usd: null }
const route: CompositeModelRouteInput = { public_model: 'synthetic-public', match_type: 'exact', target_platform: 'openai', endpoint: 'responses', upstream_model: 'synthetic-upstream', priority: 0, enabled: false }
const sourceConfig: data.DataManagementSourceConfig = { host: 'database.synthetic.invalid', port: 5432, user: 'synthetic', database: 'synthetic', ssl_mode: 'require', addr: 'cache.synthetic.invalid:6379', username: '', db: 0, container_name: '' }
const sourceProfile = { profile_id: 'synthetic-profile', name: 'Synthetic profile', config: sourceConfig, set_active: false }
const s3 = { name: 'Synthetic S3', enabled: false, endpoint: 'https://objects.synthetic.invalid', region: 'synthetic', bucket: 'synthetic', access_key_id: 'SYNTHETIC-NON-CREDENTIAL', use_ssl: true, force_path_style: false }
const fullConfig: data.DataManagementConfig = {
  source_mode: 'direct', backup_root: '/synthetic/backups', retention_days: 0, keep_last: 1,
  postgres: { host: sourceConfig.host, port: 5432, user: 'synthetic', database: 'synthetic', ssl_mode: 'require', container_name: '' },
  redis: { addr: sourceConfig.addr, username: '', db: 0, container_name: '' }, s3: { ...s3, prefix: '' },
}
const keyInput: access.AdminKeyInput = { name: 'Synthetic limited key', description: '', enabled: false, expires_at: null, allowed_ips: [], policy: { rules: [], global_permissions: [] } }
const reportQuery = { start_date: '2030-01-01', end_date: '2030-01-02', stream: false, billing_type: 0, native_compaction_v2: false }
const reportWire = { start_date: '2030-01-01', end_date: '2030-01-02', stream: 'false', billing_type: '0', native_compaction_v2: 'false' }
const contracts: Contract[] = [
  { name: 'group list defaults', call: () => groups.list(), path: '/admin/groups', query: { page: '1', page_size: '20' } },
  { name: 'group filters preserve false and escaped search', call: () => groups.list(2, 10, { platform: 'openai', is_exclusive: false, search: '中文 + &', sort_by: 'name', sort_order: 'asc' }), path: '/admin/groups', query: { page: '2', page_size: '10', platform: 'openai', is_exclusive: 'false', search: '中文 + &', sort_by: 'name', sort_order: 'asc' } },
  { name: 'active groups', call: () => groups.getAll(), path: '/admin/groups/all' },
  { name: 'platform groups', call: () => groups.getByPlatform('openai'), path: '/admin/groups/all', query: { platform: 'openai' } },
  { name: 'inactive groups remain queryable', call: () => groups.getAllIncludingInactive(), path: '/admin/groups/all', query: { include_inactive: 'true' } },
  { name: 'live capability', call: () => groups.getLiveCapability(), path: '/admin/groups/live-capability' },
  { name: 'group detail', call: () => groups.getById(41), path: '/admin/groups/41' },
  { name: 'create group preserves free and unlimited fields', call: () => groups.create(groupInput), method: 'POST', path: '/admin/groups', body: groupInput },
  { name: 'update group clears nullable description', call: () => groups.update(41, { description: null, daily_limit_usd: 0 }), method: 'PUT', path: '/admin/groups/41', body: { description: null, daily_limit_usd: 0 } },
  { name: 'disable group', call: () => groups.toggleStatus(41, 'inactive'), method: 'PUT', path: '/admin/groups/41', body: { status: 'inactive' } },
  { name: 'delete group', call: () => groups.deleteGroup(41), method: 'DELETE', path: '/admin/groups/41' },
  { name: 'group statistics', call: () => groups.getStats(41), path: '/admin/groups/41/stats' },
  { name: 'group keys default pagination', call: () => groups.getGroupApiKeys(41), path: '/admin/groups/41/api-keys', query: { page: '1', page_size: '20' } },
  { name: 'group keys explicit pagination', call: () => groups.getGroupApiKeys(41, 3, 5), path: '/admin/groups/41/api-keys', query: { page: '3', page_size: '5' } },
  { name: 'composite routes list', call: () => groups.listCompositeRoutes(41), path: '/admin/groups/41/composite-routes' },
  { name: 'create disabled composite route', call: () => groups.createCompositeRoute(41, route), method: 'POST', path: '/admin/groups/41/composite-routes', body: route },
  { name: 'update composite route', call: () => groups.updateCompositeRoute(41, 8, route), method: 'PUT', path: '/admin/groups/41/composite-routes/8', body: route },
  { name: 'delete composite route', call: () => groups.deleteCompositeRoute(41, 8), method: 'DELETE', path: '/admin/groups/41/composite-routes/8' },
  { name: 'preview composite selection', call: () => groups.previewCompositeRoute(41, { model: 'synthetic-public', endpoint: 'responses' }), method: 'POST', path: '/admin/groups/41/composite-routes/preview', body: { model: 'synthetic-public', endpoint: 'responses' } },
  { name: 'group rate overrides', call: () => groups.getGroupRateMultipliers(41), path: '/admin/groups/41/rate-multipliers' },
  { name: 'save a zero rate override', call: () => groups.batchSetGroupRateMultipliers(41, [{ user_id: 7, rate_multiplier: 0 }]), method: 'PUT', path: '/admin/groups/41/rate-multipliers', body: { entries: [{ user_id: 7, rate_multiplier: 0 }] } },
  { name: 'clear rate overrides only', call: () => groups.clearGroupRateMultipliers(41), method: 'DELETE', path: '/admin/groups/41/rate-multipliers' },
  { name: 'save a zero RPM override', call: () => groups.batchSetGroupRPMOverrides(41, [{ user_id: 7, rpm_override: 0 }]), method: 'PUT', path: '/admin/groups/41/rpm-overrides', body: { entries: [{ user_id: 7, rpm_override: 0 }] } },
  { name: 'clear RPM overrides only', call: () => groups.clearGroupRPMOverrides(41), method: 'DELETE', path: '/admin/groups/41/rpm-overrides' },
  { name: 'group sorting preserves explicit zero', call: () => groups.updateSortOrder([{ id: 41, sort_order: 0 }]), method: 'PUT', path: '/admin/groups/sort-order', body: { updates: [{ id: 41, sort_order: 0 }] } },
  { name: 'group usage summary', call: () => groups.getUsageSummary(), path: '/admin/groups/usage-summary' },
  { name: 'group capacity summary', call: () => groups.getCapacitySummary(), path: '/admin/groups/capacity-summary' },
  { name: 'dashboard statistics', call: () => dashboard.getStats(), path: '/admin/dashboard/stats' },
  { name: 'dashboard realtime', call: () => dashboard.getRealtimeMetrics(), path: '/admin/dashboard/realtime' },
  { name: 'dashboard daily total tokens filter', call: () => dashboard.getUsageTrend({ ...reportQuery, granularity: 'day' }), path: '/admin/dashboard/trend', query: { ...reportWire, granularity: 'day' } },
  { name: 'dashboard requested model statistics', call: () => dashboard.getModelStats({ ...reportQuery, model_source: 'requested' }), path: '/admin/dashboard/models', query: { ...reportWire, model_source: 'requested' } },
  { name: 'dashboard group statistics', call: () => dashboard.getGroupStats({ ...reportQuery }), path: '/admin/dashboard/groups', query: reportWire },
  { name: 'dashboard snapshot can omit heavy sections', call: () => dashboard.getSnapshotV2({ ...reportQuery, include_stats: true, include_trend: false }), path: '/admin/dashboard/snapshot-v2', query: { ...reportWire, include_stats: 'true', include_trend: 'false' } },
  { name: 'dashboard key trend', call: () => dashboard.getApiKeyUsageTrend({ ...reportQuery, limit: 5 }), path: '/admin/dashboard/api-keys-trend', query: { ...reportWire, limit: '5' } },
  { name: 'dashboard user trend', call: () => dashboard.getUserUsageTrend({ ...reportQuery, metric: 'tokens' }), path: '/admin/dashboard/users-trend', query: { ...reportWire, metric: 'tokens' } },
  { name: 'dashboard spending rank', call: () => dashboard.getUserSpendingRanking({ start_date: reportQuery.start_date, limit: 10 }), path: '/admin/dashboard/users-ranking', query: { start_date: '2030-01-01', limit: '10' } },
  { name: 'dashboard user breakdown', call: () => dashboard.getUserBreakdown({ ...reportQuery, endpoint_type: 'inbound', sort_by: 'total_tokens' }), path: '/admin/dashboard/user-breakdown', query: { ...reportWire, endpoint_type: 'inbound', sort_by: 'total_tokens' } },
  { name: 'dashboard users usage batch', call: () => dashboard.getBatchUsersUsage([7, 8]), method: 'POST', path: '/admin/dashboard/users-usage', body: { user_ids: [7, 8] } },
  { name: 'dashboard keys usage batch', call: () => dashboard.getBatchApiKeysUsage([4, 5]), method: 'POST', path: '/admin/dashboard/api-keys-usage', body: { api_key_ids: [4, 5] } },
  { name: 'backup agent health', call: () => data.getAgentHealth(), path: '/admin/data-management/agent/health' },
  { name: 'backup config', call: () => data.getConfig(), path: '/admin/data-management/config' },
  { name: 'backup config preserves no-retention value and disabled S3', call: () => data.updateConfig(fullConfig), method: 'PUT', path: '/admin/data-management/config', body: fullConfig },
  { name: 'test S3 config', call: () => data.testS3({ ...s3, secret_access_key: 'SYNTHETIC-NON-CREDENTIAL' }), method: 'POST', path: '/admin/data-management/s3/test', body: { ...s3, secret_access_key: 'SYNTHETIC-NON-CREDENTIAL' } },
  { name: 'postgres profiles list', call: () => data.listSourceProfiles('postgres'), path: '/admin/data-management/sources/postgres/profiles' },
  { name: 'redis profiles list', call: () => data.listSourceProfiles('redis'), path: '/admin/data-management/sources/redis/profiles' },
  { name: 'create inactive source profile', call: () => data.createSourceProfile('postgres', sourceProfile), method: 'POST', path: '/admin/data-management/sources/postgres/profiles', body: sourceProfile },
  { name: 'update source profile', call: () => data.updateSourceProfile('redis', 'synthetic-profile', { name: sourceProfile.name, config: sourceConfig }), method: 'PUT', path: '/admin/data-management/sources/redis/profiles/synthetic-profile', body: { name: sourceProfile.name, config: sourceConfig } },
  { name: 'delete source profile returns void', call: () => data.deleteSourceProfile('redis', 'synthetic-profile'), method: 'DELETE', path: '/admin/data-management/sources/redis/profiles/synthetic-profile', void: true },
  { name: 'activate a source profile', call: () => data.setActiveSourceProfile('postgres', 'synthetic-profile'), method: 'POST', path: '/admin/data-management/sources/postgres/profiles/synthetic-profile/activate' },
  { name: 'S3 profiles list', call: () => data.listS3Profiles(), path: '/admin/data-management/s3/profiles' },
  { name: 'create S3 profile', call: () => data.createS3Profile({ ...s3, profile_id: 'synthetic-profile', set_active: false }), method: 'POST', path: '/admin/data-management/s3/profiles', body: { ...s3, profile_id: 'synthetic-profile', set_active: false } },
  { name: 'update S3 profile', call: () => data.updateS3Profile('synthetic-profile', s3), method: 'PUT', path: '/admin/data-management/s3/profiles/synthetic-profile', body: s3 },
  { name: 'delete S3 profile returns void', call: () => data.deleteS3Profile('synthetic-profile'), method: 'DELETE', path: '/admin/data-management/s3/profiles/synthetic-profile', void: true },
  { name: 'activate S3 profile', call: () => data.setActiveS3Profile('synthetic-profile'), method: 'POST', path: '/admin/data-management/s3/profiles/synthetic-profile/activate' },
  { name: 'create backup preserves explicit no-upload', call: () => data.createBackupJob({ backup_type: 'full', upload_to_s3: false }), method: 'POST', path: '/admin/data-management/backups', body: { backup_type: 'full', upload_to_s3: false } },
  { name: 'backup operation key is carried in body and header', call: () => data.createBackupJob({ backup_type: 'redis', idempotency_key: 'synthetic-operation' }), method: 'POST', path: '/admin/data-management/backups', body: { backup_type: 'redis', idempotency_key: 'synthetic-operation' }, key: 'synthetic-operation' },
  { name: 'backup job pagination', call: () => data.listBackupJobs({ page_size: 5, page_token: 'opaque + token', status: 'failed', backup_type: 'full' }), path: '/admin/data-management/backups', query: { page_size: '5', page_token: 'opaque + token', status: 'failed', backup_type: 'full' } },
  { name: 'backup jobs default query', call: () => data.listBackupJobs(), path: '/admin/data-management/backups' },
  { name: 'backup job detail', call: () => data.getBackupJob('synthetic-job'), path: '/admin/data-management/backups/synthetic-job' },
  { name: 'plugins list', call: () => plugins.list(), path: '/admin/plugins' },
  { name: 'enable plugin at zero rollout without accepting untested', call: () => plugins.enable(41, 0, false), method: 'POST', path: '/admin/plugins/41/enable', body: { rollout_percent: 0, accept_untested: false } },
  { name: 'disable plugin', call: () => plugins.disable(41), method: 'POST', path: '/admin/plugins/41/disable' },
  { name: 'remove plugin returns void', call: () => plugins.remove(41), method: 'DELETE', path: '/admin/plugins/41', void: true },
  { name: 'plugin config', call: () => plugins.getConfig(41), path: '/admin/plugins/41/config' },
  { name: 'plugin config preserves empty arrays and false', call: () => plugins.saveConfig(41, { enabled: false, routes: [], limit: 0 }), method: 'PUT', path: '/admin/plugins/41/config', body: { enabled: false, routes: [], limit: 0 } },
  { name: 'plugin test', call: () => plugins.test(41), method: 'POST', path: '/admin/plugins/41/test' },
  { name: 'plugin status', call: () => plugins.status(41), path: '/admin/plugins/41/status' },
  { name: 'scoped plugin UI session', call: () => plugins.createUISession(41), method: 'POST', path: '/admin/plugins/41/ui-session' },
  { name: 'all attribute definitions', call: () => attributes.listDefinitions(), path: '/admin/user-attributes' },
  { name: 'enabled attribute definitions', call: () => attributes.listEnabledDefinitions(), path: '/admin/user-attributes', query: { enabled: 'true' } },
  { name: 'create optional disabled text attribute', call: () => attributes.createDefinition({ key: 'synthetic', name: 'Synthetic', type: 'text', required: false, enabled: false }), method: 'POST', path: '/admin/user-attributes', body: { key: 'synthetic', name: 'Synthetic', type: 'text', required: false, enabled: false } },
  { name: 'update attribute to empty options', call: () => attributes.updateDefinition(41, { options: [], required: false }), method: 'PUT', path: '/admin/user-attributes/41', body: { options: [], required: false } },
  { name: 'delete attribute', call: () => attributes.deleteDefinition(41), method: 'DELETE', path: '/admin/user-attributes/41' },
  { name: 'reorder attributes', call: () => attributes.reorderDefinitions([41, 8]), method: 'PUT', path: '/admin/user-attributes/reorder', body: { ids: [41, 8] } },
  { name: 'user attributes', call: () => attributes.getUserAttributeValues(7), path: '/admin/users/7/attributes' },
  { name: 'clear a user attribute value', call: () => attributes.updateUserAttributeValues(7, { 41: '' }), method: 'PUT', path: '/admin/users/7/attributes', body: { values: { 41: '' } } },
  { name: 'batch user attributes', call: () => attributes.getBatchUserAttributes([7, 8]), method: 'POST', path: '/admin/user-attributes/batch', body: { user_ids: [7, 8] } },
  { name: 'TLS profile list', call: () => tls.list(), path: '/admin/tls-fingerprint-profiles' },
  { name: 'TLS profile detail', call: () => tls.getById(41), path: '/admin/tls-fingerprint-profiles/41' },
  { name: 'create TLS profile', call: () => tls.create({ name: 'Synthetic TLS', enable_grease: false, cipher_suites: [] }), method: 'POST', path: '/admin/tls-fingerprint-profiles', body: { name: 'Synthetic TLS', enable_grease: false, cipher_suites: [] } },
  { name: 'clear optional TLS profile fields', call: () => tls.update(41, { description: null, enable_grease: false, alpn_protocols: [] }), method: 'PUT', path: '/admin/tls-fingerprint-profiles/41', body: { description: null, enable_grease: false, alpn_protocols: [] } },
  { name: 'delete TLS profile', call: () => tls.deleteProfile(41), method: 'DELETE', path: '/admin/tls-fingerprint-profiles/41' },
  { name: 'error passthrough list', call: () => rules.list(), path: '/admin/error-passthrough-rules' },
  { name: 'error passthrough detail', call: () => rules.getById(41), path: '/admin/error-passthrough-rules/41' },
  { name: 'create disabled error rule', call: () => rules.create({ name: 'Synthetic rule', enabled: false, priority: 0, error_codes: [429], response_code: null }), method: 'POST', path: '/admin/error-passthrough-rules', body: { name: 'Synthetic rule', enabled: false, priority: 0, error_codes: [429], response_code: null } },
  { name: 'clear error rule message', call: () => rules.update(41, { custom_message: null, keywords: [] }), method: 'PUT', path: '/admin/error-passthrough-rules/41', body: { custom_message: null, keywords: [] } },
  { name: 'disable error rule', call: () => rules.toggleEnabled(41, false), method: 'PUT', path: '/admin/error-passthrough-rules/41', body: { enabled: false } },
  { name: 'delete error rule', call: () => rules.deleteRule(41), method: 'DELETE', path: '/admin/error-passthrough-rules/41' },
  { name: 'scoped admin key list', call: () => access.list(), path: '/admin/settings/admin-api-keys' },
  { name: 'create scoped disabled admin key', call: () => access.create(keyInput), method: 'POST', path: '/admin/settings/admin-api-keys', body: keyInput },
  { name: 'admin key update encodes identifier', call: () => access.update('synthetic / +', keyInput), method: 'PUT', path: '/admin/settings/admin-api-keys/synthetic%20%2F%20%2B', body: keyInput },
  { name: 'admin key rotation encodes identifier', call: () => access.rotate('synthetic / +'), method: 'POST', path: '/admin/settings/admin-api-keys/synthetic%20%2F%20%2B/rotate' },
  { name: 'revoke admin key', call: () => access.revoke('synthetic / +'), method: 'DELETE', path: '/admin/settings/admin-api-keys/synthetic%20%2F%20%2B' },
  { name: 'delete admin key record', call: () => access.deleteRecord('synthetic / +'), method: 'DELETE', path: '/admin/settings/admin-api-keys/synthetic%20%2F%20%2B/record' },
  { name: 'payment config', call: async () => (await payment.getConfig()).data, path: '/admin/payment/config' },
  { name: 'disable recharge without dropping zero fee', call: async () => (await payment.updateConfig({ enabled: false, recharge_fee_rate: 0, enabled_payment_types: [] })).data, method: 'PUT', path: '/admin/payment/config', body: { enabled: false, recharge_fee_rate: 0, enabled_payment_types: [] } },
  { name: 'payment dashboard default days', call: async () => (await payment.getDashboard()).data, path: '/admin/payment/dashboard' },
  { name: 'payment dashboard selected days', call: async () => (await payment.getDashboard(7)).data, path: '/admin/payment/dashboard', query: { days: '7' } },
  { name: 'payment order filters', call: async () => (await payment.getOrders({ page: 2, page_size: 5, status: 'failed', user_id: 7, keyword: '中文 +', order_type: 'subscription' })).data, path: '/admin/payment/orders', query: { page: '2', page_size: '5', status: 'failed', user_id: '7', keyword: '中文 +', order_type: 'subscription' } },
  { name: 'payment order detail', call: async () => (await payment.getOrder(41)).data, path: '/admin/payment/orders/41' },
  { name: 'cancel payment order', call: async () => (await payment.cancelOrder(41)).data, method: 'POST', path: '/admin/payment/orders/41/cancel' },
  { name: 'retry payment recharge', call: async () => (await payment.retryRecharge(41)).data, method: 'POST', path: '/admin/payment/orders/41/retry' },
  { name: 'refund does not silently force or deduct', call: async () => (await payment.refundOrder(41, { amount: 1, reason: 'Synthetic refund', deduct_balance: false, force: false })).data, method: 'POST', path: '/admin/payment/orders/41/refund', body: { amount: 1, reason: 'Synthetic refund', deduct_balance: false, force: false } },
  { name: 'query pending refund', call: async () => (await payment.queryRefund(41)).data, method: 'POST', path: '/admin/payment/orders/41/refund/query' },
  { name: 'payment channels', call: async () => (await payment.getChannels()).data, path: '/admin/payment/channels' },
  { name: 'create payment channel', call: async () => (await payment.createChannel({ name: 'Synthetic channel', enabled: false })).data, method: 'POST', path: '/admin/payment/channels', body: { name: 'Synthetic channel', enabled: false } },
  { name: 'update payment channel', call: async () => (await payment.updateChannel(41, { enabled: false })).data, method: 'PUT', path: '/admin/payment/channels/41', body: { enabled: false } },
  { name: 'delete payment channel', call: async () => (await payment.deleteChannel(41)).data, method: 'DELETE', path: '/admin/payment/channels/41' },
  { name: 'subscription plans', call: async () => (await payment.getPlans()).data, path: '/admin/payment/plans' },
  { name: 'create a disabled subscription plan', call: async () => (await payment.createPlan({ name: 'Synthetic plan', enabled: false, price: 0 })).data, method: 'POST', path: '/admin/payment/plans', body: { name: 'Synthetic plan', enabled: false, price: 0 } },
  { name: 'update subscription plan', call: async () => (await payment.updatePlan(41, { enabled: false })).data, method: 'PUT', path: '/admin/payment/plans/41', body: { enabled: false } },
  { name: 'delete subscription plan', call: async () => (await payment.deletePlan(41)).data, method: 'DELETE', path: '/admin/payment/plans/41' },
  { name: 'payment providers', call: async () => (await payment.getProviders()).data, path: '/admin/payment/providers' },
  { name: 'create a disabled payment provider', call: async () => (await payment.createProvider({ name: 'Synthetic provider', enabled: false })).data, method: 'POST', path: '/admin/payment/providers', body: { name: 'Synthetic provider', enabled: false } },
  { name: 'update payment provider', call: async () => (await payment.updateProvider(41, { enabled: false })).data, method: 'PUT', path: '/admin/payment/providers/41', body: { enabled: false } },
  { name: 'delete payment provider', call: async () => (await payment.deleteProvider(41)).data, method: 'DELETE', path: '/admin/payment/providers/41' },
]

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-release-contract', user: { id: 7, role: 'admin' } })
  wires = []; rejectWrite = false; responseValue = accepted
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = new URL(apiClient.getUri(config), 'https://synthetic.invalid')
    const query = Object.fromEntries(url.searchParams)
    if (config.method === 'get') { expect(query.timezone).toBeTruthy(); delete query.timezone }
    wires.push({ method: String(config.method).toUpperCase(), path: url.pathname, query,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      auth: String(config.headers.Authorization || ''), admin: String(config.headers['X-Admin-UI-Request'] || ''),
      key: String(config.headers['X-Idempotency-Key'] || ''), timeout: Number(config.timeout),
    })
    const response = { config, status: rejectWrite ? 422 : 200, statusText: 'Synthetic contract result', headers: {},
      data: rejectWrite ? { code: 422, message: 'Synthetic validation refused' } : { code: 0, data: responseValue } }
    if (rejectWrite) throw new AxiosError('Synthetic validation refused', AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => { apiClient.defaults.adapter = oldAdapter })

describe('admin release HTTP compatibility through the actual Axios boundary', () => {
  for (const contract of contracts) {
    it(`${contract.name}: preserves the wire command and response envelope`, async () => {
      responseValue = contract.response ?? accepted
      const result = await contract.call()
      expect(result).toEqual(contract.void ? undefined : contract.result ?? responseValue)
      expect(wires).toHaveLength(1)
      expect(wires[0]).toMatchObject({ method: contract.method ?? 'GET', path: `/api/v1${contract.path}`,
        query: contract.query ?? {}, body: contract.body,
        auth: 'Bearer synthetic-release-contract', admin: '1', key: contract.key ?? '' })
    })
    it(`${contract.name}: propagates a definitive backend rejection without replay`, async () => {
      rejectWrite = true
      await expect(contract.call()).rejects.toMatchObject({ status: 422, message: 'Synthetic validation refused' })
      expect(wires).toHaveLength(1)
    })
  }

  it('candidate models unwraps the list and treats a missing list as empty', async () => {
    responseValue = { models: ['synthetic-model'] }
    await expect(groups.getModelAllowlistCandidates(0, 'openai')).resolves.toEqual(['synthetic-model'])
    expect(wires[0]).toMatchObject({ path: '/api/v1/admin/groups/0/model-allowlist-candidates', query: { platform: 'openai' } })
    responseValue = {}
    await expect(groups.getModelAllowlistCandidates(41)).resolves.toEqual([])
    expect(wires[1].query).toEqual({})
  })

  it('RPM projection keeps explicit zero, drops missing/null, and omits rate multipliers', async () => {
    const user = { user_id: 7, user_name: 'Synthetic', user_email: 'synthetic@example.invalid', user_notes: '', user_status: 'active' }
    responseValue = [{ ...user, rpm_override: 0, rate_multiplier: 2 }, { ...user, user_id: 8, rpm_override: 25 }, { ...user, user_id: 9, rpm_override: null }, { ...user, user_id: 10 }]
    await expect(groups.getGroupRPMOverrides(41)).resolves.toEqual([{ ...user, rpm_override: 0 }, { ...user, user_id: 8, rpm_override: 25 }])
    expect(wires[0].path).toBe('/api/v1/admin/groups/41/rate-multipliers')
  })

  it('plugin upload retains the named file and bounded upload timeout', async () => {
    const file = new File(['synthetic plugin archive'], 'synthetic-plugin.zip', { type: 'application/zip' })
    await expect(plugins.upload(file)).resolves.toEqual(accepted)
    expect(wires).toHaveLength(1)
    expect(wires[0]).toMatchObject({ method: 'POST', path: '/api/v1/admin/plugins/upload', timeout: 120000 })
    const form = wires[0].body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.getAll('plugin')).toEqual([file])
  })
})
