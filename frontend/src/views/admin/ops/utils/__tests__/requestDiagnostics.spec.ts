import { describe, expect, it } from 'vitest'
import { getAdmissionHint, getGatewayTiming, measuredNumber } from '../requestDiagnostics'

describe('request diagnostics', () => {
  const sample = { schema_version: 1, source: 'process_memory', observed_at: '2026-11-05T00:00:00Z', capacity: 4096, retention_seconds: 86400, metrics: { user_wait_ms: 0 } }

  it('preserves measured zero and leaves missing or invalid measurements unknown', () => {
    expect(measuredNumber(0)).toBe(0)
    for (const value of [undefined, null, NaN, Infinity, -1, '0', 1.5]) expect(measuredNumber(value)).toBeNull()
  })

  it('accepts only supported, bounded timing records', () => {
    expect(getGatewayTiming(sample)).toEqual(sample)
    for (const record of [undefined, {}, { ...sample, schema_version: 2 }, { ...sample, source: 'unknown' }, { ...sample, capacity: NaN }, { ...sample, retention_seconds: 0 }, { ...sample, observed_at: 'invalid' }]) expect(getGatewayTiming(record)).toBeNull()
  })

  it('uses recorded local origin for the final refusal even when earlier attempts exist', () => {
    const hint = getAdmissionHint({ status_code: 429, message: '个人并发已达上限，请稍后重试（上限 3）', error_owner: 'client', error_source: 'gateway', upstream_status_code: 503 })
    expect(hint).toEqual({ scope: 'user', basis: 'recorded', limit: 3 })
  })

  it('marks historical templates as hints without asserting a recorded origin', () => {
    expect(getAdmissionHint({ status_code: 429, error_owner: 'provider', error_source: 'upstream_http', message: '个人并发已达上限，请稍后重试' })).toEqual({ scope: 'user', basis: 'legacy', limit: null })
  })

  it('does not relabel real upstream failures from their text or local-looking code', () => {
    const base = { status_code: 429, message: '个人并发已达上限', error_owner: 'provider', error_source: 'upstream_http', error_body: '{"error":{"code":"gateway_user_concurrency_limit"}}' }
    for (const evidence of [{ account_id: 41 }, { upstream_status_code: 429 }, { upstream_errors: '[{"status":429}]' }, { upstream_error_message: 'Rate limit reached' }]) expect(getAdmissionHint({ ...base, ...evidence })).toBeNull()
    expect(getAdmissionHint({ status_code: 429, message: 'Upstream says 个人并发已达上限' })).toBeNull()
  })

  it('supports a structured local code with a translated message and tolerates truncated JSON', () => {
    expect(getAdmissionHint({ status_code: 429, error_source: 'gateway', error_owner: 'platform', message: 'Capacity reached', error_body: '{"error":{"code":"gateway_global_concurrency_limit"}}' })?.scope).toBe('global')
    expect(getAdmissionHint({ status_code: 400, message: '个人并发已达上限', error_body: '{' })).toBeNull()
    expect(getAdmissionHint({ status_code: 429, message: '个人并发已达上限', error_body: '{' })?.basis).toBe('legacy')
  })
})
