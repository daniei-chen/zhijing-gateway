import type { OpsGatewayTiming } from '@/api/admin/ops'

export type AdmissionScope = 'user' | 'global' | 'account' | 'queue'
export type AdmissionHint = { scope: AdmissionScope; basis: 'recorded' | 'legacy'; limit: number | null }
type ErrorLike = {
  status_code?: number | null
  message?: string
  error_source?: string
  error_owner?: string
  account_id?: number | null
  upstream_status_code?: number | null
  upstream_error_message?: string
  upstream_errors?: string | unknown[]
  error_body?: string
}

export function measuredNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(value) ? value : null
}

export function getGatewayTiming(value: unknown): OpsGatewayTiming | null {
  if (!value || typeof value !== 'object') return null
  const timing = value as OpsGatewayTiming
  if (timing.schema_version !== 1 || timing.source !== 'process_memory' || !timing.metrics || typeof timing.metrics !== 'object' || Array.isArray(timing.metrics)) return null
  if (measuredNumber(timing.capacity) === null || timing.capacity < 1 || timing.capacity > 4096) return null
  if (measuredNumber(timing.retention_seconds) === null || timing.retention_seconds < 1 || timing.retention_seconds > 86400) return null
  if (typeof timing.observed_at !== 'string' || !Number.isFinite(Date.parse(timing.observed_at))) return null
  return timing
}

// A legacy template is a display hint, never a rewrite of stored attribution or SLA.
// Upstream evidence blocks inference from text alone. A recorded local final
// outcome can still retain evidence from earlier upstream attempts.
export function getAdmissionHint(row: ErrorLike): AdmissionHint | null {
  if (row.status_code !== 429) return null
  let code = ''
  if (row.error_body && row.error_body.length <= 65536) {
    try {
      const body = JSON.parse(row.error_body)
      if (typeof body?.error?.code === 'string') code = body.error.code
    } catch { /* Error bodies may be plain text or truncated; retain the recorded message. */ }
  }
  const codes: Record<string, AdmissionScope> = {
    gateway_user_concurrency_limit: 'user', gateway_global_concurrency_limit: 'global',
    gateway_concurrency_limit: 'account', gateway_queue_full: 'queue',
  }
  const message = (row.message || '').trim()
  const limitMatch = message.match(/[（(]上限\s+(\d+)[）)]/u)
  const limit = limitMatch ? measuredNumber(Number(limitMatch[1])) : null
  const recorded = row.error_source === 'gateway' && ['client', 'platform'].includes(row.error_owner || '')
  if (recorded && codes[code]) {
    const scope = code === 'gateway_concurrency_limit' && /^Concurrency limit exceeded for user,/i.test(message) ? 'user' : codes[code]
    return { scope, basis: 'recorded', limit }
  }
  let scope: AdmissionScope | null = null
  if (message.startsWith('个人并发已达上限')) scope = 'user'
  else if (message.startsWith('网关并发已达上限')) scope = 'global'
  else if (/^Concurrency limit exceeded for user,/i.test(message)) scope = 'user'
  else if (/^Concurrency limit exceeded for /i.test(message)) scope = 'account'
  else if (message === 'Too many pending requests, please retry later') scope = 'queue'
  if (recorded && scope) return { scope, basis: 'recorded', limit }
  // A final local refusal can retain earlier attempt evidence. Inference from an
  // old message alone, however, requires an unassigned account and no upstream evidence.
  if (row.account_id || (row.upstream_status_code ?? 0) > 0 || row.upstream_error_message?.trim()) return null
  if (Array.isArray(row.upstream_errors) && row.upstream_errors.length > 0) return null
  if (typeof row.upstream_errors === 'string' && !['', '[]', 'null'].includes(row.upstream_errors.trim())) return null
  return scope ? { scope, basis: 'legacy', limit } : null
}

export const durationStages = [
  { key: 'body_read_block_ms', label: 'upload' },
  { key: 'body_normalize_ms', label: 'normalize' },
  { key: 'user_wait_ms', label: 'userWait' },
  { key: 'account_wait_ms', label: 'accountWait' },
  { key: 'connection_wait_ms', label: 'connection' },
] as const

export const ingressMilestones = [
  { key: 'body_ready_ingress_ms', label: 'bodyReady' },
  { key: 'routing_start_ingress_ms', label: 'routing' },
  { key: 'chat_first_event_ingress_ms', label: 'firstEvent' },
  { key: 'upstream_semantic_ingress_ms', label: 'semantic' },
  { key: 'downstream_semantic_flush_ingress_ms', label: 'flush' },
] as const
