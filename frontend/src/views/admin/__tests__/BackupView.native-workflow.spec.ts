import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError } from 'axios'
import BackupView from '@/views/admin/BackupView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { BackupRecord } from '@/api/admin/backup'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, showWarning: feedback.warning }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({
  t: (key: string, values?: Record<string, unknown>) => values?.index === undefined ? key : `${key}:${values.index}`, locale: ref('en'),
}) }))
vi.mock('@/api', async () => ({ adminAPI: { backup: (await import('@/api/admin/backup')).default }, totpAPI: (await import('@/api/totp')).default }))

// Real BackupView, archive and step-up children, useStepUp, exported APIs and
// Axios client. Only the transport below and feedback/i18n are synthetic.
type Wire = { method: string; path: string; body: Record<string, unknown> | undefined; params: Record<string, unknown> }
type Reply = { value: unknown; status?: number; reason?: string; message?: string }
const wire: Wire[] = []
const wrappers: VueWrapper[] = []
const originalAdapter = apiClient.defaults.adapter
let respond: ((request: Wire) => Reply | Promise<Reply>) | undefined
const initialS3 = { endpoint: 'https://s3.synthetic.invalid', region: 'auto', bucket: 'synthetic-backups', access_key_id: 'SYNTHETIC-ACCESS-100', prefix: 'backups/', force_path_style: false }
const initialImage = { enabled: false, reuse_backup_s3: true, bucket: '', prefix: 'images/', public_base_url: '', presign_expiry_hours: 24, max_download_bytes: 33554432, endpoint: '', region: 'auto', access_key_id: '', force_path_style: false }
const initialSchedule = { enabled: false, cron_expr: '0 2 * * *', retain_days: 14, retain_count: 10, monthly_archive: { enabled: false, days: [1], include_month_end: false, retain_count: 0 } }
let s3: Record<string, unknown>, image: Record<string, unknown>, schedule: Record<string, unknown>, rows: BackupRecord[]
const record = (id: string, patch: Partial<BackupRecord> = {}): BackupRecord => ({ id, status: 'completed', backup_type: 'postgres', file_name: `${id}.sql.gz`, s3_key: `synthetic/${id}.sql.gz`, size_bytes: 4096, triggered_by: 'manual', started_at: '2026-01-01T00:00:00Z', ...patch })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
function defaultReply(request: Wire): Reply {
  if (request.path === '/user/totp/step-up') return { value: { verified: true, expires_in: 300 } }
  const base = '/admin/backups'
  if (request.path === base && request.method === 'GET') return { value: { items: structuredClone(rows) } }
  if (request.path === `${base}/s3-config`) {
    if (request.method === 'PUT') s3 = { ...request.body, secret_access_key: '' }
    return { value: structuredClone(s3) }
  }
  if (request.path === `${base}/image-storage`) {
    if (request.method === 'PUT') image = { ...request.body, secret_access_key: '' }
    return { value: request.method === 'GET' ? { config: structuredClone(image), secret_configured: true } : structuredClone(image) }
  }
  if (request.path === `${base}/schedule`) {
    if (request.method === 'PUT') schedule = structuredClone(request.body!)
    return { value: structuredClone(schedule) }
  }
  if (request.path.endsWith('/test')) return { value: { ok: true, message: 'Synthetic storage reachable' } }
  if (request.path === base && request.method === 'POST') {
    const item = record('new-backup', { status: 'running' }); rows.unshift(item)
    return { value: item, status: 202 }
  }
  if (request.path.endsWith('/download-url')) return { value: { url: `https://download.synthetic.invalid/${request.path.split('/').at(-2)}.sql.gz` } }
  const id = request.path.split('/')[3]
  if (request.method === 'DELETE') { rows = rows.filter(item => item.id !== id); return { value: { deleted: true } } }
  if (request.path.endsWith('/restore')) {
    const item = record(id, { restore_status: 'running' }); rows = rows.map(existing => existing.id === id ? item : existing)
    return { value: item, status: 202 }
  }
  if (request.method === 'GET') {
    const item = record(id, { restore_status: rows.find(existing => existing.id === id)?.restore_status ? 'completed' : undefined })
    rows = rows.map(existing => existing.id === id ? item : existing)
    return { value: item }
  }
  throw new Error(`Unexpected synthetic backup request ${request.method} ${request.path}`)
}
async function render() {
  const view = mount(BackupView, { attachTo: document.body, global: { stubs: { Icon: true } } })
  wrappers.push(view); await flushPromises(); return view
}
const body = () => new DOMWrapper(document.body)
function button(root: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  const found = root.findAll<HTMLButtonElement>('button').find(item => item.text() === label)
  expect(found, label).toBeDefined(); return found!
}
function card(view: VueWrapper, heading: string) {
  const title = view.findAll('h3').find(item => item.text() === heading)
  expect(title, heading).toBeDefined()
  return new DOMWrapper(title!.element.closest<HTMLElement>('.card')!)
}
function field(root: DOMWrapper<Element>, label: string) {
  const visibleLabel = root.findAll('label').find(item => item.text() === label)
  expect(visibleLabel, label).toBeDefined()
  const input = visibleLabel!.element.querySelector<HTMLInputElement>('input') ?? visibleLabel!.element.parentElement!.querySelector<HTMLInputElement>('input')
  expect(input).not.toBeNull(); return new DOMWrapper(input!)
}
function row(view: VueWrapper, id: string) {
  const found = view.findAll('tbody tr').find(item => item.find('td').text() === id)
  expect(found, id).toBeDefined(); return found!
}
const writes = (path?: string) => wire.filter(request => request.method !== 'GET' && (!path || request.path === path))
const reads = () => wire.filter(request => request.method === 'GET')
async function click(item: { element: HTMLButtonElement }) { item.element.click(); await flushPromises() }
async function verifyStepUp() {
  const inputs = body().get('[role="dialog"][aria-label="stepUp.title"]').findAll<HTMLInputElement>('input[maxlength="1"]')
  for (const [index, digit] of [...'123456'].entries()) await inputs[index].setValue(digit)
  await flushPromises()
}
function clearFeedback() { Object.values(feedback).forEach(mock => mock.mockClear()) }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); wire.length = 0; respond = undefined
  clearFeedback()
  replaceAuthSession({ accessToken: 'synthetic-backup-admin-100', user: { id: 7 } })
  s3 = structuredClone(initialS3); image = structuredClone(initialImage); schedule = structuredClone(initialSchedule)
  rows = [record('backup-A'), record('backup-B')]
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'prompt').mockReturnValue('SYNTHETIC-NOT-REAL-PASSWORD-100')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  apiClient.defaults.adapter = async config => {
    const request: Wire = { method: String(config.method).toUpperCase(), path: String(config.url), body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, params: { ...config.params } }
    wire.push(request)
    const result = respond ? await respond(request) : defaultReply(request)
    const status = result.status ?? 200
    const response = { config, status, statusText: 'Synthetic response', headers: {}, data: status < 400 ? { code: 0, data: result.value } : { code: status, reason: result.reason, message: result.message } }
    if (status >= 400) throw new AxiosError(result.message, AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
    return response
  }
})
afterEach(() => {
  wrappers.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''
})

describe('ordinary backup workflows through native DOM and actual Axios transport', () => {
  it('loads the redacted S3 config and saves explicit fields with an empty secret preserving the existing server-side secret contract', async () => {
    const view = await render(); const s3Card = card(view, 'admin.backup.s3.title')
    expect(field(s3Card, 'admin.backup.s3.secretAccessKey').element.value).toBe('')
    await field(s3Card, 'admin.backup.s3.bucket').setValue('synthetic-new-bucket')
    await field(s3Card, 'admin.backup.s3.forcePathStyle').setValue(true)
    await click(button(s3Card, 'common.save'))
    expect(writes('/admin/backups/s3-config')).toEqual([{ method: 'PUT', path: '/admin/backups/s3-config', body: { endpoint: 'https://s3.synthetic.invalid', region: 'auto', bucket: 'synthetic-new-bucket', access_key_id: 'SYNTHETIC-ACCESS-100', secret_access_key: '', prefix: 'backups/', force_path_style: true }, params: {} }])
    expect(feedback.success).toHaveBeenCalledWith('admin.backup.s3.saved')
    expect(field(s3Card, 'admin.backup.s3.secretAccessKey').element.value).toBe('')
  })

  it('saves independent image storage with the real Go DTO field names and hours/byte units', async () => {
    const view = await render(); const imageCard = card(view, 'admin.backup.imageStorage.title')
    await field(imageCard, 'admin.backup.imageStorage.enabled').setValue(true)
    await field(imageCard, 'admin.backup.imageStorage.reuseBackupS3').setValue(false)
    await field(imageCard, 'admin.backup.imageStorage.bucket').setValue('synthetic-images')
    await field(imageCard, 'admin.backup.s3.endpoint').setValue('https://image.synthetic.invalid')
    await field(imageCard, 'admin.backup.s3.accessKeyId').setValue('SYNTHETIC-IMAGE-100')
    await field(imageCard, 'admin.backup.s3.secretAccessKey').setValue('SYNTHETIC-NOT-REAL-SECRET-100')
    await field(imageCard, 'admin.backup.imageStorage.presignExpiryHours').setValue(12)
    await click(button(imageCard, 'common.save'))
    expect(writes('/admin/backups/image-storage')[0].body).toEqual({ enabled: true, reuse_backup_s3: false, bucket: 'synthetic-images', prefix: 'images/', public_base_url: '', presign_expiry_hours: 12, max_download_bytes: 33554432, endpoint: 'https://image.synthetic.invalid', region: 'auto', access_key_id: 'SYNTHETIC-IMAGE-100', secret_access_key: 'SYNTHETIC-NOT-REAL-SECRET-100', force_path_style: false })
    expect(field(imageCard, 'admin.backup.s3.secretAccessKey').element.value).toBe('')
  })

  it('surfaces an unsuccessful connection result and tests the corrected visible draft without saving it', async () => {
    let healthy = false
    respond = request => request.path.endsWith('/test') ? { value: { ok: healthy, message: healthy ? 'Synthetic healthy endpoint' : 'Synthetic endpoint rejected' } } : defaultReply(request)
    const view = await render(); const s3Card = card(view, 'admin.backup.s3.title')
    await click(button(s3Card, 'admin.backup.s3.testConnection'))
    expect(feedback.error).toHaveBeenCalledWith('Synthetic endpoint rejected')
    healthy = true; await field(s3Card, 'admin.backup.s3.endpoint').setValue('https://fixed.synthetic.invalid')
    await click(button(s3Card, 'admin.backup.s3.testConnection'))
    expect(feedback.success).toHaveBeenCalledWith('Synthetic healthy endpoint')
    expect(writes().every(request => request.method === 'POST' && request.path === '/admin/backups/s3-config/test')).toBe(true)
    expect(writes().at(-1)!.body?.endpoint).toBe('https://fixed.synthetic.invalid')
  })

  it('saves cron and integer retention with the literal schedule contract while retaining legitimate zero', async () => {
    const view = await render(); const scheduleCard = card(view, 'admin.backup.schedule.title')
    await field(scheduleCard, 'admin.backup.schedule.enabled').setValue(true)
    await field(scheduleCard, 'admin.backup.schedule.cronExpr').setValue('30 3 * * *')
    await scheduleCard.get('[data-testid="backup-retain-days"]').setValue(0)
    await scheduleCard.get('[data-testid="backup-retain-count"]').setValue(6)
    await click(button(scheduleCard, 'common.save'))
    expect(writes('/admin/backups/schedule')[0].body).toEqual({ enabled: true, cron_expr: '30 3 * * *', retain_days: 0, retain_count: 6, monthly_archive: { enabled: false, days: [1], include_month_end: false, retain_count: 0 } })
  })

  it('creates an unlimited-retention manual backup and completes it through the existing read-only poll', async () => {
    const view = await render(); vi.useFakeTimers()
    const operations = card(view, 'admin.backup.operations.title')
    await field(operations, 'admin.backup.operations.expireDays').setValue(0)
    await click(button(operations, 'admin.backup.operations.createBackup'))
    expect(writes('/admin/backups')[0].body).toEqual({ expire_days: 0 })
    expect(view.text()).toContain('new-backup')
    await vi.advanceTimersByTimeAsync(2000); await flushPromises()
    expect(wire.some(request => request.method === 'GET' && request.path === '/admin/backups/new-backup')).toBe(true)
    expect(feedback.success).toHaveBeenCalledWith('admin.backup.operations.backupCreated')
  })

  it('cancels native restore confirmation/password without a request, then submits the confirmed password only to the chosen ID', async () => {
    const view = await render(); const restore = button(row(view, 'backup-B'), 'admin.backup.actions.restore')
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click(restore); expect(writes()).toEqual([])
    vi.mocked(window.prompt).mockReturnValueOnce(null); await click(restore); expect(writes()).toEqual([])
    await click(restore)
    expect(writes()).toEqual([{ method: 'POST', path: '/admin/backups/backup-B/restore', body: { password: 'SYNTHETIC-NOT-REAL-PASSWORD-100' }, params: {} }])
    expect(button(row(view, 'backup-B'), 'common.loading').element.disabled).toBe(true)
  })

  it('keeps delete confirmation cancellable and sends the ordinary DELETE target without archive elevation', async () => {
    const view = await render(); const remove = button(row(view, 'backup-A'), 'common.delete')
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click(remove); expect(writes()).toEqual([])
    await click(remove)
    expect(writes()).toEqual([{ method: 'DELETE', path: '/admin/backups/backup-A', body: undefined, params: {} }])
    expect(view.text()).not.toContain('backup-A'); expect(view.text()).toContain('backup-B')
  })

  it('downloads a single signed URL through the native anchor without a window or provider request', async () => {
    const view = await render(); await click(button(row(view, 'backup-A'), 'admin.backup.actions.download'))
    expect(wire.at(-1)!.path).toBe('/admin/backups/backup-A/download-url')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement
    expect(anchor).toBeInstanceOf(HTMLAnchorElement)
    expect(anchor.href).toBe('https://download.synthetic.invalid/backup-A.sql.gz')
    expect(writes()).toEqual([])
  })

  it('lets a definitive rejected create be corrected and explicitly retried through the same command endpoint', async () => {
    let ready = false
    respond = request => request.method === 'POST' && request.path === '/admin/backups' && !ready ? { value: null, status: 400, reason: 'BACKUP_S3_NOT_CONFIGURED', message: 'Synthetic storage not configured' } : defaultReply(request)
    const view = await render(); const operations = card(view, 'admin.backup.operations.title')
    await click(button(operations, 'admin.backup.operations.createBackup'))
    expect(feedback.error).toHaveBeenCalledWith('Synthetic storage not configured')
    ready = true; await click(button(operations, 'admin.backup.operations.createBackup'))
    expect(writes('/admin/backups').map(request => request.body)).toEqual([{ expire_days: 14 }, { expire_days: 14 }])
    expect(view.text()).toContain('new-backup')
  })

  it('cancels real step-up without replaying or saving S3 configuration', async () => {
    respond = request => request.method === 'PUT' ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic step-up required' } : defaultReply(request)
    const view = await render(); await click(button(card(view, 'admin.backup.s3.title'), 'common.save'))
    await click(button(body().get('[role="dialog"][aria-label="stepUp.title"]'), 'common.cancel'))
    expect(writes('/admin/backups/s3-config')).toHaveLength(1)
    expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'login'] as const)('does not continue a step-up challenged create after %s changes the pending intent', async boundary => {
    respond = request => request.method === 'POST' && request.path === '/admin/backups' ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic step-up required' } : defaultReply(request)
    const view = await render()
    await click(button(card(view, 'admin.backup.operations.title'), 'admin.backup.operations.createBackup'))
    expect(body().find('[role="dialog"][aria-label="stepUp.title"]').exists()).toBe(true)
    if (boundary === 'cancel') await click(button(body().get('[role="dialog"][aria-label="stepUp.title"]'), 'common.cancel'))
    else { replaceAuthSession({ accessToken: 'synthetic-backup-new-session-before-grant-100', user: { id: 7 } }); await flushPromises() }
    expect(writes('/admin/backups')).toHaveLength(1)
    expect(writes('/user/totp/step-up')).toHaveLength(0)
    expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.success).not.toHaveBeenCalled()
  })
})

describe('backup page ownership and immutable confirmed intents', () => {
  it.each(['', '-1', '1.5'])('blocks an invalid manual retention value %j before any backup command and permits a corrected integer', async invalid => {
    const view = await render(); const operations = card(view, 'admin.backup.operations.title')
    const days = field(operations, 'admin.backup.operations.expireDays')
    await days.setValue(invalid)
    const confirm = button(operations, 'admin.backup.operations.createBackup')
    await click(confirm)
    expect(confirm.element.type).toBe('button'); expect(confirm.element.form).toBeNull()
    expect(writes('/admin/backups')).toEqual([])
    expect(days.element.checkValidity()).toBe(false); expect(days.element.validationMessage).not.toBe('')
    await days.setValue(3)
    await click(button(operations, 'admin.backup.operations.createBackup'))
    expect(writes('/admin/backups').map(request => request.body)).toEqual([{ expire_days: 3 }])
  })

  it('replays the originally submitted S3 snapshot after real step-up while retaining newer unsubmitted input', async () => {
    let attempts = 0
    respond = request => request.method === 'PUT' && request.path === '/admin/backups/s3-config' && ++attempts === 1 ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic step-up required' } : defaultReply(request)
    const view = await render(); const s3Card = card(view, 'admin.backup.s3.title')
    await field(s3Card, 'admin.backup.s3.bucket').setValue('confirmed-bucket-A')
    await click(button(s3Card, 'common.save'))
    expect(body().find('[role="dialog"][aria-label="stepUp.title"]').exists()).toBe(true)
    await field(s3Card, 'admin.backup.s3.bucket').setValue('unsubmitted-bucket-B')
    await verifyStepUp()
    expect(writes('/admin/backups/s3-config').map(request => request.body?.bucket)).toEqual(['confirmed-bucket-A', 'confirmed-bucket-A'])
    expect(field(s3Card, 'admin.backup.s3.bucket').element.value).toBe('unsubmitted-bucket-B')
  })

  it('replays the original manual retention after step-up instead of issuing a changed backup command', async () => {
    let attempts = 0
    respond = request => request.method === 'POST' && request.path === '/admin/backups' && ++attempts === 1 ? { value: null, status: 403, reason: 'STEP_UP_REQUIRED', message: 'Synthetic step-up required' } : defaultReply(request)
    const view = await render(); const operations = card(view, 'admin.backup.operations.title')
    await field(operations, 'admin.backup.operations.expireDays').setValue(14)
    await click(button(operations, 'admin.backup.operations.createBackup'))
    await field(operations, 'admin.backup.operations.expireDays').setValue(0)
    await verifyStepUp()
    expect(writes('/admin/backups').map(request => request.body)).toEqual([{ expire_days: 14 }, { expire_days: 14 }])
    expect(field(operations, 'admin.backup.operations.expireDays').element.value).toBe('0')
  })

  it.each(['s3', 'image'] as const)('retains a newly typed %s draft when a slow initial config load finishes', async kind => {
    const initial = deferred<Reply>(), endpoint = kind === 's3' ? '/admin/backups/s3-config' : '/admin/backups/image-storage'
    respond = request => request.path === endpoint && request.method === 'GET' ? initial.promise : defaultReply(request)
    const view = await render(); const settings = card(view, kind === 's3' ? 'admin.backup.s3.title' : 'admin.backup.imageStorage.title')
    const label = kind === 's3' ? 'admin.backup.s3.prefix' : 'admin.backup.imageStorage.prefix'
    await field(settings, label).setValue('unsubmitted-during-initial-load/')
    initial.resolve({ value: kind === 's3' ? initialS3 : { config: initialImage, secret_configured: true } }); await flushPromises()
    expect(field(settings, label).element.value).toBe('unsubmitted-during-initial-load/')
    expect(writes()).toEqual([])
  })

  it.each(['s3', 'image'] as const)('keeps a newer %s draft after an earlier save finishes instead of reloading persisted fields over it', async kind => {
    const pending = deferred<Reply>(), endpoint = kind === 's3' ? '/admin/backups/s3-config' : '/admin/backups/image-storage'
    respond = request => request.method === 'PUT' && request.path === endpoint ? pending.promise : defaultReply(request)
    const view = await render(); const settings = card(view, kind === 's3' ? 'admin.backup.s3.title' : 'admin.backup.imageStorage.title')
    const label = kind === 's3' ? 'admin.backup.s3.prefix' : 'admin.backup.imageStorage.prefix'
    await field(settings, label).setValue('confirmed-prefix-A/')
    await click(button(settings, 'common.save'))
    await field(settings, label).setValue('unsubmitted-prefix-B/')
    pending.resolve({ value: {} }); await flushPromises()
    expect(writes(endpoint)[0].body?.prefix).toBe('confirmed-prefix-A/')
    expect(field(settings, label).element.value).toBe('unsubmitted-prefix-B/')
  })

  it.each(['schedule', 'delete', 'test'] as const)('does not publish old %s success after page disposal', async kind => {
    const pending = deferred<Reply>()
    const endpoint = kind === 'schedule' ? '/admin/backups/schedule' : kind === 'delete' ? '/admin/backups/backup-A' : '/admin/backups/s3-config/test'
    respond = request => request.method !== 'GET' && request.path === endpoint ? pending.promise : defaultReply(request)
    const view = await render()
    await click(kind === 'schedule' ? button(card(view, 'admin.backup.schedule.title'), 'common.save') : kind === 'delete' ? button(row(view, 'backup-A'), 'common.delete') : button(card(view, 'admin.backup.s3.title'), 'admin.backup.s3.testConnection'))
    const readCount = reads().length; view.unmount()
    pending.resolve({ value: kind === 'test' ? { ok: true, message: 'Synthetic old test result' } : {} }); await flushPromises()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled()
    expect(reads()).toHaveLength(readCount)
  })

  it.each(['s3', 'schedule', 'download', 'restore'] as const)('ignores old %s feedback when the same administrator logs in again', async kind => {
    const pending = deferred<Reply>()
    const endpoint = kind === 's3' ? '/admin/backups/s3-config' : kind === 'schedule' ? '/admin/backups/schedule' : kind === 'download' ? '/admin/backups/backup-A/download-url' : '/admin/backups/backup-A/restore'
    respond = request => request.path === endpoint && (kind === 'download' || request.method !== 'GET') ? pending.promise : defaultReply(request)
    const view = await render()
    await click(kind === 's3' ? button(card(view, 'admin.backup.s3.title'), 'common.save') : kind === 'schedule' ? button(card(view, 'admin.backup.schedule.title'), 'common.save') : button(row(view, 'backup-A'), kind === 'download' ? 'admin.backup.actions.download' : 'admin.backup.actions.restore'))
    replaceAuthSession({ accessToken: 'synthetic-backup-admin-new-login-100', user: { id: 7 } })
    pending.resolve({ value: kind === 'download' ? { url: 'https://download.synthetic.invalid/old-session.sql.gz' } : record('backup-A') }); await flushPromises()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.warning).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('keeps the newest selected download parts when an older backup URL lookup arrives later', async () => {
    const older = deferred<Reply>()
    respond = request => request.path.endsWith('/backup-A/download-url') ? older.promise : request.path.endsWith('/backup-B/download-url') ? { value: { parts: [{ index: 1, size_bytes: 4096, url: 'https://download.synthetic.invalid/B-1' }] } } : defaultReply(request)
    const view = await render()
    await click(button(row(view, 'backup-A'), 'admin.backup.actions.download'))
    await click(button(row(view, 'backup-B'), 'admin.backup.actions.download'))
    expect(document.querySelector('a[href="https://download.synthetic.invalid/B-1"]')).not.toBeNull()
    older.resolve({ value: { parts: [{ index: 1, size_bytes: 4096, url: 'https://download.synthetic.invalid/A-1' }] } }); await flushPromises()
    expect(document.querySelector('a[href="https://download.synthetic.invalid/B-1"]')).not.toBeNull()
    expect(document.querySelector('a[href="https://download.synthetic.invalid/A-1"]')).toBeNull()
  })

  it('does not let an older restore rejection clear a newer target still waiting for its response', async () => {
    const a = deferred<Reply>(), b = deferred<Reply>()
    respond = request => request.path.endsWith('/restore') ? request.path.includes('/backup-A/') ? a.promise : b.promise : defaultReply(request)
    const view = await render()
    await click(button(row(view, 'backup-A'), 'admin.backup.actions.restore'))
    await click(button(row(view, 'backup-B'), 'admin.backup.actions.restore'))
    expect(button(row(view, 'backup-B'), 'common.loading').element.disabled).toBe(true)
    a.resolve({ value: null, status: 400, message: 'Synthetic rejected restore A' }); await flushPromises()
    expect(button(row(view, 'backup-B'), 'common.loading').element.disabled).toBe(true)
    b.resolve({ value: record('backup-B', { restore_status: 'running' }) }); await flushPromises()
  })

  it('admits at most one native delete request for the same pending target', async () => {
    const pending = deferred<Reply>()
    respond = request => request.method === 'DELETE' ? pending.promise : defaultReply(request)
    const view = await render(); const remove = button(row(view, 'backup-A'), 'common.delete').element
    remove.click(); await flushPromises(); remove.click(); await flushPromises()
    expect(writes('/admin/backups/backup-A')).toHaveLength(1)
    pending.resolve({ value: { deleted: true } }); await flushPromises()
  })

  it.each(['s3', 'download', 'restore'] as const)('retains the real step-up scope guard for a pending %s command when its component is unmounted', async kind => {
    const pending = deferred<Reply>()
    const endpoint = kind === 's3' ? '/admin/backups/s3-config' : kind === 'download' ? '/admin/backups/backup-A/download-url' : '/admin/backups/backup-A/restore'
    respond = request => request.path === endpoint && (kind === 'download' || request.method !== 'GET') ? pending.promise : defaultReply(request)
    const view = await render()
    await click(kind === 's3' ? button(card(view, 'admin.backup.s3.title'), 'common.save') : button(row(view, 'backup-A'), kind === 'download' ? 'admin.backup.actions.download' : 'admin.backup.actions.restore'))
    const beforeReads = reads().length
    view.unmount()
    pending.resolve({ value: kind === 'download' ? { url: 'https://download.synthetic.invalid/disposed.sql.gz' } : record('backup-A') }); await flushPromises()
    expect(feedback.success).not.toHaveBeenCalled(); expect(feedback.error).not.toHaveBeenCalled(); expect(feedback.warning).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(reads()).toHaveLength(beforeReads)
  })

  it.each(['s3', 'image'] as const)('hydrates untouched persisted %s fields while preserving and explicitly saving the edited prefix', async kind => {
    const initial = deferred<Reply>(), endpoint = kind === 's3' ? '/admin/backups/s3-config' : '/admin/backups/image-storage'
    let loadingInitial = true
    const persistedImage = { ...initialImage, bucket: 'persisted-image-bucket', presign_expiry_hours: 36 }
    respond = request => loadingInitial && request.path === endpoint && request.method === 'GET' ? initial.promise : defaultReply(request)
    const view = await render(); const settings = card(view, kind === 's3' ? 'admin.backup.s3.title' : 'admin.backup.imageStorage.title')
    const prefix = field(settings, kind === 's3' ? 'admin.backup.s3.prefix' : 'admin.backup.imageStorage.prefix')
    expect(prefix.element.disabled).toBe(false); expect(button(settings, 'common.save').element.disabled).toBe(true)
    await prefix.setValue('edited-during-load/')
    loadingInitial = false
    initial.resolve({ value: kind === 's3' ? initialS3 : { config: persistedImage, secret_configured: true } }); await flushPromises()
    expect(prefix.element.value).toBe('edited-during-load/')
    expect(button(settings, 'common.save').element.disabled).toBe(false)
    await click(button(settings, 'common.save'))
    expect(writes(endpoint)[0].body).toEqual(kind === 's3' ? { ...initialS3, prefix: 'edited-during-load/', secret_access_key: '' } : { ...persistedImage, prefix: 'edited-during-load/', secret_access_key: '' })
  })

  it('does not let a closed old download release a newer request for the same ID', async () => {
    const first = deferred<Reply>(), second = deferred<Reply>(); let aRequests = 0
    respond = request => request.path.endsWith('/backup-A/download-url') ? (++aRequests === 1 ? first.promise : second.promise) : request.path.endsWith('/backup-B/download-url') ? { value: { parts: [{ index: 1, size_bytes: 4, url: 'https://download.synthetic.invalid/B-visible' }] } } : defaultReply(request)
    const view = await render()
    await click(button(row(view, 'backup-A'), 'admin.backup.actions.download'))
    await click(button(row(view, 'backup-B'), 'admin.backup.actions.download'))
    await click(button(body(), 'common.close'))
    await click(button(row(view, 'backup-A'), 'admin.backup.actions.download'))
    first.resolve({ value: { parts: [{ index: 1, size_bytes: 4, url: 'https://download.synthetic.invalid/A-old' }] } }); await flushPromises()
    const current = button(row(view, 'backup-A'), 'admin.backup.actions.download')
    expect(current.element.disabled).toBe(true)
    await click(current); expect(aRequests).toBe(2)
    expect(document.querySelector('a[href="https://download.synthetic.invalid/A-old"]')).toBeNull()
    second.resolve({ value: { parts: [{ index: 1, size_bytes: 4, url: 'https://download.synthetic.invalid/A-new' }] } }); await flushPromises()
    expect(document.querySelector('a[href="https://download.synthetic.invalid/A-new"]')).not.toBeNull()
  })
})


describe('manual backup create HTTP error compatibility111', () => {
  it('keeps a real-client backup-in-progress409 as its existing business warning', async () => {
    respond = request => request.method === 'POST' && request.path === '/admin/backups'
      ? { value: null, status: 409, reason: 'BACKUP_IN_PROGRESS', message: 'Synthetic current backup conflict111' }
      : defaultReply(request)
    const view = await render()
    await click(button(card(view, 'admin.backup.operations.title'), 'admin.backup.operations.createBackup'))
    expect(writes('/admin/backups')).toHaveLength(1)
    expect(writes('/admin/backups')[0].body).toEqual({ expire_days: 14 })
    expect(feedback.warning).toHaveBeenCalledExactlyOnceWith('admin.backup.operations.alreadyInProgress')
    expect(feedback.error).not.toHaveBeenCalled()
    expect(button(card(view, 'admin.backup.operations.title'), 'admin.backup.operations.createBackup').element.disabled).toBe(false)
  })

  it.each([400, 503])('keeps a current HTTP%i creation failure as an error and releases its retry control', async status => {
    respond = request => request.method === 'POST' && request.path === '/admin/backups'
      ? { value: null, status, message: `Synthetic current creation failure111-${status}` }
      : defaultReply(request)
    const view = await render()
    await click(button(card(view, 'admin.backup.operations.title'), 'admin.backup.operations.createBackup'))
    expect(writes('/admin/backups')).toHaveLength(1)
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith(`Synthetic current creation failure111-${status}`)
    expect(feedback.warning).not.toHaveBeenCalled()
    expect(button(card(view, 'admin.backup.operations.title'), 'admin.backup.operations.createBackup').element.disabled).toBe(false)
  })
})
