/**
 * Admin Subscriptions API endpoints
 * Handles user subscription management for administrators
 */

import { apiClient } from '../client'
import { authSessionDigest } from '../authSessionDigest'
import type {
  UserSubscription,
  SubscriptionProgress,
  AssignSubscriptionRequest,
  BulkAssignSubscriptionRequest,
  ExtendSubscriptionRequest,
  PaginatedResponse
} from '@/types'

export type SubscriptionBulkAction = 'extend' | 'reset_quota' | 'revoke' | 'restore'

export interface SubscriptionBulkActionRequest {
  subscription_ids: number[]
  action: SubscriptionBulkAction
  days?: number
  daily?: boolean
  weekly?: boolean
  monthly?: boolean
}

export interface SubscriptionBulkActionResult {
  success_count: number
  failed_count: number
  results: Array<{ subscription_id: number; success: boolean; error?: string }>
}

export interface BulkAssignSubscriptionResult {
  success_count: number
  created_count: number
  reused_count: number
  failed_count: number
  subscriptions: UserSubscription[]
  errors: string[]
  statuses?: Record<string, 'created' | 'reused' | 'failed'>
}

export async function bulkAction(
  request: SubscriptionBulkActionRequest,
  idempotencyKey: string,
  replayOnly = false
): Promise<SubscriptionBulkActionResult> {
  try {
    const response = await apiClient.post<SubscriptionBulkActionResult>(
      `/admin/subscriptions/bulk-action${replayOnly ? '/replay' : ''}`,
      request,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    )
    if (replayOnly && String(response.headers?.['x-idempotency-replayed'] ?? response.headers?.['X-Idempotency-Replayed'] ?? '').toLowerCase() !== 'true') {
      throw unconfirmedExtendResult()
    }
    return response.data
  } catch (error) {
    const failure = error as { status?: number; response?: { status?: number } } | null
    if (replayOnly && (failure?.status ?? failure?.response?.status) === 404) throw unconfirmedExtendResult()
    throw error
  }
}

/**
 * List all subscriptions with pagination
 * @param page - Page number (default: 1)
 * @param pageSize - Items per page (default: 20)
 * @param filters - Optional filters (status, user_id, group_id, sort_by, sort_order)
 * @returns Paginated list of subscriptions
 */
export async function list(
  page: number = 1,
  pageSize: number = 20,
  filters?: {
    status?: 'active' | 'expired' | 'revoked' | 'suspended'
    user_id?: number
    group_id?: number
    platform?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
  },
  options?: {
    signal?: AbortSignal
  }
): Promise<PaginatedResponse<UserSubscription>> {
  const { data } = await apiClient.get<PaginatedResponse<UserSubscription>>(
    '/admin/subscriptions',
    {
      params: {
        page,
        page_size: pageSize,
        ...filters
      },
      signal: options?.signal
    }
  )
  return data
}

/**
 * Get subscription by ID
 * @param id - Subscription ID
 * @returns Subscription details
 */
export async function getById(id: number): Promise<UserSubscription> {
  const { data } = await apiClient.get<UserSubscription>(`/admin/subscriptions/${id}`)
  return data
}

/**
 * Get subscription progress
 * @param id - Subscription ID
 * @returns Subscription progress with usage stats
 */
export async function getProgress(id: number): Promise<SubscriptionProgress> {
  const { data } = await apiClient.get<SubscriptionProgress>(`/admin/subscriptions/${id}/progress`)
  return data
}

/**
 * Assign subscription to user
 * @param request - Assignment request
 * @returns Created subscription
 */
export async function assign(request: AssignSubscriptionRequest): Promise<UserSubscription> {
  const { data } = await apiClient.post<UserSubscription>('/admin/subscriptions/assign', request)
  return data
}

/**
 * Bulk assign subscriptions to multiple users
 * @param request - Bulk assignment request
 * @returns Per-user assignment outcomes and created or reused subscriptions
 */
export async function bulkAssign(
  request: BulkAssignSubscriptionRequest
): Promise<BulkAssignSubscriptionResult> {
  const { data } = await apiClient.post<BulkAssignSubscriptionResult>(
    '/admin/subscriptions/bulk-assign',
    request
  )
  return data
}

const extendOperationKeys = new Map<string, string>()

function extendOperationScope(id: number, request: ExtendSubscriptionRequest) {
  try {
    const user: unknown = JSON.parse(globalThis.localStorage?.getItem('auth_user') ?? 'null')
    const adminID = user && typeof user === 'object' ? (user as { id?: unknown }).id : null
    if (typeof adminID !== 'number' || !Number.isSafeInteger(adminID) || adminID <= 0) return null
    return { adminID, key: `sub2api:admin:subscription-extend:${adminID}:${id}:${authSessionDigest(JSON.stringify(request))}` }
  } catch {
    return null
  }
}

function getStoredExtendOperationKey(storageKey: string): string | null {
  try { return globalThis.sessionStorage?.getItem(storageKey) ?? null } catch { return null }
}

function storeExtendOperationKey(storageKey: string, key: string | null): void {
  try {
    if (key) globalThis.sessionStorage?.setItem(storageKey, key)
    else globalThis.sessionStorage?.removeItem(storageKey)
  } catch {
    // Retain same-page retry identity in memory when browser storage is denied.
  }
}

function unconfirmedExtendResult() {
  return { status: 409, reason: 'IDEMPOTENCY_RESULT_UNCONFIRMED', message: 'The previous subscription adjustment result cannot be confirmed.' }
}

/**
 * Extend subscription validity. An uncertain write is checked through a
 * read-only replay endpoint; it is never executed again after retention expiry.
 * @param id - Subscription ID
 * @param request - Extension request with days
 * @returns Updated subscription
 */
export async function extend(
  id: number,
  request: ExtendSubscriptionRequest
): Promise<UserSubscription> {
  const payload = { days: request.days }
  const scope = extendOperationScope(id, payload)
  let idempotencyKey = scope ? extendOperationKeys.get(scope.key) ?? getStoredExtendOperationKey(scope.key) : null
  const replayOnly = Boolean(idempotencyKey)
  if (!idempotencyKey) {
    const requestID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    idempotencyKey = `subscription-extend-${scope?.adminID ?? 'unknown-admin'}-${id}-${requestID}`
  }
  if (scope) {
    extendOperationKeys.set(scope.key, idempotencyKey)
    storeExtendOperationKey(scope.key, idempotencyKey)
  }
  let data: UserSubscription
  try {
    const response = await apiClient.post<UserSubscription>(`/admin/subscriptions/${id}/extend${replayOnly ? '/replay' : ''}`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    if (replayOnly && String(response.headers?.['x-idempotency-replayed'] ?? response.headers?.['X-Idempotency-Replayed'] ?? '').toLowerCase() !== 'true') {
      throw unconfirmedExtendResult()
    }
    data = response.data
  } catch (error) {
    if (replayOnly && (error as { status?: number })?.status === 404) throw unconfirmedExtendResult()
    throw error
  }
  if (scope) {
    if (extendOperationKeys.get(scope.key) === idempotencyKey) extendOperationKeys.delete(scope.key)
    if (getStoredExtendOperationKey(scope.key) === idempotencyKey) storeExtendOperationKey(scope.key, null)
  }
  return data
}

/**
 * Revoke subscription
 * @param id - Subscription ID
 * @returns Success confirmation
 */
export async function revoke(id: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/admin/subscriptions/${id}/revoke`)
  return data
}

/**
 * Restore revoked subscription
 * @param id - Subscription ID
 * @returns Restored subscription
 */
export async function restore(id: number): Promise<UserSubscription> {
  const { data } = await apiClient.post<UserSubscription>(`/admin/subscriptions/${id}/restore`)
  return data
}

/**
 * Reset daily, weekly, and/or monthly usage quota for a subscription
 * @param id - Subscription ID
 * @param options - Which windows to reset
 * @returns Updated subscription
 */
export async function resetQuota(
  id: number,
  options: { daily: boolean; weekly: boolean; monthly: boolean }
): Promise<UserSubscription> {
  const { data } = await apiClient.post<UserSubscription>(
    `/admin/subscriptions/${id}/reset-quota`,
    options
  )
  return data
}

/**
 * List subscriptions by group
 * @param groupId - Group ID
 * @param page - Page number
 * @param pageSize - Items per page
 * @returns Paginated list of subscriptions in the group
 */
export async function listByGroup(
  groupId: number,
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedResponse<UserSubscription>> {
  const { data } = await apiClient.get<PaginatedResponse<UserSubscription>>(
    `/admin/groups/${groupId}/subscriptions`,
    {
      params: { page, page_size: pageSize }
    }
  )
  return data
}

/**
 * List subscriptions by user
 * @param userId - User ID
 * @param page - Page number
 * @param pageSize - Items per page
 * @returns Paginated list of user's subscriptions
 */
export async function listByUser(
  userId: number,
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedResponse<UserSubscription>> {
  const { data } = await apiClient.get<PaginatedResponse<UserSubscription>>(
    `/admin/users/${userId}/subscriptions`,
    {
      params: { page, page_size: pageSize }
    }
  )
  return data
}

export const subscriptionsAPI = {
  list,
  getById,
  getProgress,
  assign,
  bulkAssign,
  bulkAction,
  extend,
  revoke,
  restore,
  resetQuota,
  listByGroup,
  listByUser
}

export default subscriptionsAPI
