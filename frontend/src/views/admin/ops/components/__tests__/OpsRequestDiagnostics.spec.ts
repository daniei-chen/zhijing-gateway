import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { OpsRequestDetail } from '@/api/admin/ops'
import zhOps from '@/i18n/locales/zh/admin/ops'
import OpsRequestDiagnostics from '../OpsRequestDiagnostics.vue'

const messages = { zh: { admin: zhOps } }
function render(request: OpsRequestDetail) {
  return mount(OpsRequestDiagnostics, { props: { request }, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
}

describe('Ops request timing panel', () => {
  it('shows measured zero independently from missing stages and retains forwarding TTFT', () => {
    const wrapper = render({ kind: 'success', created_at: '2026-11-05T00:00:00Z', request_id: 'synthetic', first_token_ms: 823,
      gateway_timing: { schema_version: 1, source: 'process_memory', observed_at: '2026-11-05T00:00:00Z', capacity: 4096, retention_seconds: 86400,
        metrics: { body_read_block_ms: 12000, user_wait_ms: 0, upstream_semantic_ingress_ms: 15000 } } })
    expect(wrapper.get('[data-stage="body_read_block_ms"]').text()).toContain('12.00 s')
    expect(wrapper.get('[data-stage="user_wait_ms"]').text()).toContain('0 ms')
    expect(wrapper.get('[data-stage="account_wait_ms"]').text()).toContain('未采集')
    expect(wrapper.text()).toContain('823 ms')
    expect(wrapper.text()).toContain('15.00 s')
    expect(wrapper.text()).toContain('4096')
    wrapper.unmount()
  })

  it('supports old backends and reports unavailable stages instead of zero', () => {
    const wrapper = render({ kind: 'success', created_at: '2026-11-05T00:00:00Z', request_id: 'old', first_token_ms: 0 })
    expect(wrapper.text()).toContain('阶段未采集')
    expect(wrapper.text()).toContain('未采集不代表零等待')
    expect(wrapper.get('[data-stage="body_read_block_ms"]').text()).toContain('未采集')
    expect(wrapper.text()).toContain('0 ms')
    wrapper.unmount()
  })

  it('labels the historical hint and leaves the input record intact', () => {
    const request: OpsRequestDetail = { kind: 'error', created_at: '2026-11-05T00:00:00Z', request_id: 'legacy', status_code: 429, phase: 'upstream', message: '个人并发已达上限，请稍后重试（上限 3）' }
    const before = JSON.stringify(request)
    const wrapper = render(request)
    expect(wrapper.text()).toContain('模板识别')
    expect(wrapper.text()).toContain('上限 3')
    expect(wrapper.text()).toContain('原始归因和历史统计保持')
    expect(JSON.stringify(request)).toBe(before)
    wrapper.unmount()
  })
})
