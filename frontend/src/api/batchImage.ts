import { assertAuthSession, authSignalSession, captureAuthSession, trackAuthRequest } from './authSession'
import { buildGatewayUrl } from './client'

export type BatchImageStatus =
  | 'queued'
  | 'running'
  | 'indexing'
  | 'processing_results'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'output_deleted'
  | string

export interface BatchImageSubmitItem {
  custom_id: string
  prompt: string
  output_count?: number
  reference_images?: BatchImageReferenceImage[]
}

export interface BatchImageReferenceImage {
  id?: string
  type?: string
  mime_type: string
  data?: string
  file_uri?: string
}

export interface BatchImageSubmitRequest {
  model: string
  task_name?: string
  parent_batch_id?: string
  provider?: '' | 'gemini_api' | 'vertex' | string
  image_size?: '1K' | '2K' | '4K' | string
  response_mime_type?: string
  aspect_ratio?: string
  items: BatchImageSubmitItem[]
  metadata?: Record<string, string>
}

export interface BatchImageJob {
  id: string
  object: string
  task_name: string
  parent_batch_id?: string | null
  status: BatchImageStatus
  model: string
  provider: string
  item_count: number
  success_count: number
  fail_count: number
  estimated_cost: number
  hold_amount: number
  actual_cost: number | null
  created_at: number
  submitted_at: number | null
  settled_at: number | null
  downloaded_at?: number | null
  output_deleted_at?: number | null
}

export interface BatchImageItem {
  batch_id?: string
  source_task_name?: string
  custom_id: string
  status: string
  prompt_preview?: string | null
  mime_type: string | null
  file_extension: string | null
  image_count: number
  error?: {
    code: string
    message: string
    source?: 'provider' | 'system' | string
  } | null
}

export interface BatchImageItemsResponse {
  object: string
  data: BatchImageItem[]
  has_more: boolean
}

export interface BatchImageRecovery {
  object: 'image.batch.recovery'
  complete: true
  batch_id: string
  root_batch_id: string
  root_custom_ids: string[]
  target_items: BatchImageItem[]
  successful_items: { batch_id: string; custom_id: string; image_count: number }[]
  pending_items: { batch_id: string; custom_id: string }[]
  input_mode: 'prompt_only'
}

export interface BatchImageJobsResponse {
  object: string
  data: BatchImageJob[]
  has_more: boolean
}

export interface BatchImageModel {
  id: string
  object: string
  provider: string
}

export interface BatchImageModelsResponse {
  object: string
  data: BatchImageModel[]
}

export interface BatchImageJobsListOptions {
  limit?: number
  cursor?: string
  status?: string
  taskName?: string
  downloaded?: '' | 'true' | 'false' | string
  from?: string
  to?: string
}

async function parseBatchImageError(response: Response): Promise<Error> {
  try {
    const body = await response.json()
    const message = body?.error?.message || body?.message || response.statusText
    const error = new Error(message)
    ;(error as any).code = body?.error?.code || response.status
    ;(error as any).status = response.status
    ;(error as any).requestId = response.headers.get('X-Request-Id') || ''
    return error
  } catch {
    const error = new Error(response.statusText || `HTTP ${response.status}`)
    ;(error as any).code = response.status
    ;(error as any).status = response.status
    ;(error as any).requestId = response.headers.get('X-Request-Id') || ''
    return error
  }
}

function authHeaders(apiKey: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  }
}

export async function submitBatchImageJob(
  apiKey: string,
  payload: BatchImageSubmitRequest,
  idempotencyKey: string, signal?: AbortSignal
): Promise<BatchImageJob> {
  return batchImageRequest<BatchImageJob>(buildGatewayUrl('/v1/images/batches'), {
    method: 'POST',
    headers: authHeaders(apiKey, {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    }),
    body: JSON.stringify(payload),
   signal }, 'json')
}

function unconfirmedBatchImageSubmission() {
  return Object.assign(new Error('The saved batch submission could not be confirmed. Check the task list before starting a new job.'), {
    code: 'BATCH_IMAGE_RESULT_UNCONFIRMED', status: 409,
  })
}

export async function replayBatchImageSubmission(
  apiKey: string,
  payload: BatchImageSubmitRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<BatchImageJob> {
  try {
    const result = await batchImageRequest<BatchImageJob>(buildGatewayUrl('/v1/images/batches/replay'), {
      method: 'POST',
      headers: authHeaders(apiKey, { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
      body: JSON.stringify(payload), signal,
    }, 'json', true)
    if (!result || typeof result.id !== 'string' || !result.id.trim()) throw unconfirmedBatchImageSubmission()
    return result
  } catch (error) {
    if ((error as { status?: number })?.status === 404) throw unconfirmedBatchImageSubmission()
    throw error
  }
}

export async function getBatchImageJob(apiKey: string, batchId: string, signal?: AbortSignal): Promise<BatchImageJob> {
  return batchImageRequest<BatchImageJob>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}`), {
    headers: authHeaders(apiKey),
   signal }, 'json')
}

export async function listBatchImageJobs(apiKey: string, options: number | BatchImageJobsListOptions = 20, signal?: AbortSignal): Promise<BatchImageJobsResponse> {
  const params = new URLSearchParams()
  if (typeof options === 'number') {
    params.set('limit', String(options))
  } else {
    params.set('limit', String(options.limit || 20))
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.status) params.set('status', options.status)
    if (options.taskName) params.set('task_name', options.taskName)
    if (options.downloaded) params.set('downloaded', options.downloaded)
    if (options.from) params.set('from', options.from)
    if (options.to) params.set('to', options.to)
  }
  return batchImageRequest<BatchImageJobsResponse>(buildGatewayUrl(`/v1/images/batches?${params.toString()}`), {
    headers: authHeaders(apiKey),
   signal }, 'json')
}

export async function listBatchImageModels(apiKey: string, signal?: AbortSignal): Promise<BatchImageModelsResponse> {
  return batchImageRequest<BatchImageModelsResponse>(buildGatewayUrl('/v1/images/batches/models'), {
    headers: authHeaders(apiKey),
   signal }, 'json')
}

export async function listBatchImageItems(
  apiKey: string,
  batchId: string,
  status = '', signal?: AbortSignal, pagination?: { limit?: number; cursor?: string }
): Promise<BatchImageItemsResponse> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit))
  if (pagination?.cursor !== undefined) params.set('cursor', pagination.cursor)
  const query = params.size ? `?${params.toString()}` : ''
  return batchImageRequest<BatchImageItemsResponse>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}/items${query}`), {
    headers: authHeaders(apiKey),
   signal }, 'json')
}

export async function getBatchImageRecovery(apiKey: string, batchId: string, signal?: AbortSignal): Promise<BatchImageRecovery> {
  const incomplete = () => Object.assign(new Error('Complete batch retry history could not be confirmed.'), { status: 409, code: 'BATCH_IMAGE_HISTORY_UNCONFIRMED' })
  try {
    const value = await batchImageRequest<BatchImageRecovery>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}/recovery`), { headers: authHeaders(apiKey), signal }, 'json')
    if (!value || value.object !== 'image.batch.recovery' || value.complete !== true || value.batch_id !== batchId || typeof value.root_batch_id !== 'string' || !value.root_batch_id || value.input_mode !== 'prompt_only' ||
        !Array.isArray(value.root_custom_ids) || !value.root_custom_ids.every(id => typeof id === 'string' && !!id) || new Set(value.root_custom_ids).size !== value.root_custom_ids.length ||
        !Array.isArray(value.target_items) || !value.target_items.every(item => item && typeof item.custom_id === 'string' && typeof item.status === 'string' && (item.prompt_preview == null || typeof item.prompt_preview === 'string')) ||
        !Array.isArray(value.successful_items) || !value.successful_items.every(item => item && typeof item.batch_id === 'string' && typeof item.custom_id === 'string' && Number.isInteger(item.image_count) && item.image_count > 0) ||
        !Array.isArray(value.pending_items) || !value.pending_items.every(item => item && typeof item.batch_id === 'string' && typeof item.custom_id === 'string')) throw incomplete()
    return value
  } catch (error) {
    if ((error as { status?: number })?.status === 404) throw incomplete()
    throw error
  }
}

export async function cancelBatchImageJob(apiKey: string, batchId: string, signal?: AbortSignal): Promise<BatchImageJob> {
  return batchImageRequest<BatchImageJob>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}/cancel`), {
    method: 'POST',
    headers: authHeaders(apiKey),
   signal }, 'json')
}

export async function downloadBatchImageZip(apiKey: string, batchId: string, signal?: AbortSignal): Promise<Blob> {
  return batchImageRequest<Blob>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}/download`), {
    headers: authHeaders(apiKey),
   signal }, 'blob')
}

export async function getBatchImageItemContent(apiKey: string, batchId: string, customId: string, imageIndex = 0, signal?: AbortSignal): Promise<Blob> {
  return batchImageRequest<Blob>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(customId)}/content?image_index=${encodeURIComponent(String(imageIndex))}`), {
    headers: authHeaders(apiKey),
   signal }, 'blob')
}

export async function deleteBatchImageJobRecord(apiKey: string, batchId: string, signal?: AbortSignal): Promise<void> {
  return batchImageRequest<void>(buildGatewayUrl(`/v1/images/batches/${encodeURIComponent(batchId)}`), {
    method: 'DELETE',
    headers: authHeaders(apiKey),
   signal }, 'none')
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  let link: HTMLAnchorElement | undefined
  try {
    link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    try { link?.remove() } finally { URL.revokeObjectURL(url) }
  }
}

async function batchImageRequest<T>(url: string, init: RequestInit, kind: 'json'|'blob'|'none', requireReplayAcknowledgement = false): Promise<T> {
  const session=authSignalSession(init.signal) || captureAuthSession(), controller=new AbortController()
  const abort=()=>controller.abort()
  if(init.signal?.aborted) abort()
  init.signal?.addEventListener('abort',abort,{once:true})
  const untrack=trackAuthRequest(session,abort)
  try {
    assertAuthSession(session)
    if(controller.signal.aborted) throw new DOMException('Request cancelled','AbortError')
    const response=await fetch(url,{...init,signal:controller.signal})
    assertAuthSession(session)
    if(controller.signal.aborted) throw new DOMException('Request cancelled','AbortError')
    if(!response.ok) {const error=await parseBatchImageError(response);assertAuthSession(session);throw error}
    if (requireReplayAcknowledgement && response.headers.get('X-Idempotency-Replayed') !== 'true') throw unconfirmedBatchImageSubmission()
    const value=kind==='none'?undefined:await (kind==='blob'?response.blob():response.json())
    assertAuthSession(session)
    if(controller.signal.aborted) throw new DOMException('Request cancelled','AbortError')
    return value as T
  } finally {untrack();init.signal?.removeEventListener('abort',abort)}
}
