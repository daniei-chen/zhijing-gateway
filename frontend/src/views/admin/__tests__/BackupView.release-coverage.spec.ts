import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import BackupView from '../BackupView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { BackupRecord } from '@/api/admin/backup'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('@/api', async () => ({ adminAPI: { backup: (await vi.importActual<typeof import('@/api/admin/backup')>('@/api/admin/backup')).default } }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: feedback.error, showSuccess: feedback.success, showWarning: feedback.warning }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? `:${JSON.stringify(values)}` : '') }) }))
interface Wire { method: string; path: string; params: Record<string, unknown>; body: Record<string, unknown> }
const originalAdapter = apiClient.defaults.adapter
const mounted: VueWrapper[] = []
let wires: Wire[]
let rows: BackupRecord[]
let schedule: Record<string, unknown>
let image: Record<string, unknown>
let poll: BackupRecord
let connection: { ok: boolean; message: string }
let fail: string
let failureStatus: number
let failureReason: string
let unexpected: string[]
const record = (patch: Partial<BackupRecord> = {}): BackupRecord => ({ id: 'synthetic-backup', status: 'completed', backup_type: 'postgres', file_name: 'synthetic.sql.gz', s3_key: 'synthetic/backup.sql.gz', size_bytes: 4096, triggered_by: 'manual', started_at: '2026-11-06T00:00:00Z', ...patch })
function button(root: Pick<VueWrapper, 'findAll'>, label: string) { const found = root.findAll<HTMLButtonElement>('button').find(node => node.text() === label); expect(found, label).toBeDefined(); return found! }
function card(view: VueWrapper, heading: string) { const title = view.findAll('h3').find(node => node.text() === heading); expect(title, heading).toBeDefined(); return new DOMWrapper(title!.element.closest('.card')!) }
function field(root: DOMWrapper<Element>, label: string) { const item = root.findAll('label').find(node => node.text() === label); expect(item, label).toBeDefined(); return new DOMWrapper(item!.element.querySelector<HTMLInputElement>('input') ?? item!.element.parentElement!.querySelector<HTMLInputElement>('input')!) }
async function click(item: { element: HTMLButtonElement }) { item.element.click(); await flushPromises() }
async function render() { const view = mount(BackupView, { attachTo: document.body, global: { stubs: { Icon: true, transition: true } } }); mounted.push(view); await flushPromises(); return view }
const writes = () => wires.filter(wire => wire.method !== 'get')
const backupRow = (view: VueWrapper) => view.get('tbody tr')
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); replaceAuthSession({ accessToken: 'synthetic-backup-release', user: { id: 7, role: 'admin' } })
  wires = []; rows = [record()]; poll = record(); connection = { ok: true, message: '' }; fail = ''; failureStatus = 400; failureReason = ''; unexpected = []
  schedule = { enabled: false, cron_expr: '0 2 * * *', retain_days: 14, retain_count: 10, monthly_archive: { enabled: false, days: [1], include_month_end: false, retain_count: 0 } }
  image = { enabled: false, reuse_backup_s3: false, bucket: 'synthetic-images', prefix: 'images/', public_base_url: '', presign_expiry_hours: 24, max_download_bytes: 33554432, endpoint: 'https://storage.invalid', region: 'auto', access_key_id: 'SYNTHETIC-ONLY', force_path_style: false }
  Object.values(feedback).forEach(mock => mock.mockReset()); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'prompt').mockReturnValue('synthetic-not-real-password'); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const wire = { method: config.method ?? 'get', path: String(config.url), params: { ...config.params }, body: config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {} }; wires.push(wire)
    if (fail === `${wire.method} ${wire.path}`) { fail = ''; throw new AxiosError('Synthetic backup refusal', 'ERR_BAD_RESPONSE', config, undefined, { config, status: failureStatus, statusText: 'Synthetic failure', headers: {}, data: { code: failureStatus, reason: failureReason, message: 'Synthetic backup refusal' } }) }
    let data: unknown
    if (wire.path === '/admin/backups/s3-config') data = { endpoint: 'https://storage.invalid', region: 'auto', bucket: 'synthetic-backups', access_key_id: 'SYNTHETIC-ONLY', prefix: 'backups/', force_path_style: false, secret_access_key: '***' }
    else if (wire.path === '/admin/backups/image-storage') data = wire.method === 'get' ? { config: image, secret_configured: false } : image
    else if (wire.path === '/admin/backups/schedule') data = wire.method === 'get' ? schedule : wire.body
    else if (['/admin/backups/s3-config/test', '/admin/backups/image-storage/test'].includes(wire.path) && wire.method === 'post') data = connection
    else if (wire.path === '/admin/backups' && wire.method === 'get') data = { items: rows }
    else if (wire.path === '/admin/backups' && wire.method === 'post') data = record({ status: 'running' })
    else if (wire.path === '/admin/backups/synthetic-backup' && wire.method === 'get') { data = poll; rows = [poll] }
    else if (wire.path === '/admin/backups/synthetic-backup' && wire.method === 'delete') { rows = []; data = { deleted: true } }
    else if (wire.path === '/admin/backups/synthetic-backup/restore' && wire.method === 'post') data = record({ restore_status: 'running' })
    else if (wire.path === '/admin/backups/synthetic-backup/download-url' && wire.method === 'get') data = {}
    else { unexpected.push(`${wire.method} ${wire.path}`); throw new Error(`Unexpected synthetic backup request ${wire.path}`) }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } }
  }
})
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); apiClient.defaults.adapter = originalAdapter; if (vi.isFakeTimers()) vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; expect(unexpected).toEqual([]) })

describe('Backup rendering, terminal failures and retention boundaries through native DOM and real API transport', () => {
  it.each([
    { status: 'pending' as const, size: 0, sizeText: '-', tone: 'bg-gray-100', downloads: false, deletion: true },
    { status: 'running' as const, size: 512, sizeText: '512 B', tone: 'bg-blue-100', downloads: false, deletion: false },
    { status: 'failed' as const, size: 4096, sizeText: '4.0 KB', tone: 'bg-red-100', downloads: false, deletion: true },
    { status: 'completed' as const, size: 2097152, sizeText: '2.0 MB', tone: 'bg-green-100', downloads: true, deletion: true },
  ])('renders $status with correct size, terminal actions and status tone', async ({ status, size, sizeText, tone, downloads, deletion }) => {
    rows = [record({ status, size_bytes: size, started_at: '', expires_at: undefined })]
    const view = await render(); const row = backupRow(view)
    expect(row.get(`.${tone}`).text()).toBe(`admin.backup.status.${status}`); expect(row.findAll('td')[3].text()).toBe(sizeText)
    expect(row.text()).toContain('admin.backup.neverExpire'); expect(row.findAll('button').some(node => node.text() === 'admin.backup.actions.download')).toBe(downloads)
    expect(row.findAll('button').some(node => node.text() === 'common.delete')).toBe(deletion); expect(writes()).toEqual([])
  })

  it.each([0, 3])('shows the scheduled archive dates and retain-count %i meaning instead of the ordinary expiry', async count => {
    rows = [record({ triggered_by: 'scheduled', expires_at: '2030-01-01T00:00:00Z', monthly_archive: { dates: ['2026-11-01', '2026-11-30'], retain_count: count }, started_at: 'legacy timestamp', progress: undefined })]
    const view = await render(); const row = backupRow(view)
    expect(row.text()).toContain('admin.backup.trigger.scheduled'); expect(row.text()).toContain('2026-11-01 / 2026-11-30'); expect(row.text()).toContain('legacy timestamp')
    expect(row.text()).toContain(count === 0 ? 'admin.backup.archive.forever' : 'admin.backup.archive.retainLatest:{"count":3}')
    await click(button(row, 'common.delete')); expect(window.confirm).toHaveBeenCalledWith('admin.backup.archive.deleteConfirm')
    expect(writes()).toEqual([{ method: 'delete', path: '/admin/backups/synthetic-backup', params: { delete_archived: true }, body: {} }])
  })

  it('renders a running backup’s progress and handles a small negative-size legacy record without inventing downloadable output', async () => {
    rows = [record({ status: 'running', progress: 'uploading', size_bytes: -1, parts: [] })]
    const view = await render(); const row = backupRow(view)
    expect(row.text()).toContain('admin.backup.progress.uploading'); expect(row.findAll('td')[3].text()).toBe('-'); expect(row.findAll('td')[4].text()).toBe('-'); expect(writes()).toEqual([])
  })

  it.each([{ days: 14, count: 0, key: 'previewDays' }, { days: 0, count: 5, key: 'previewCount' }, { days: 0, count: 0, key: 'previewUnlimited' }])('previews and saves the $days-day/$count-count retention policy with literal zeros', async ({ days, count, key }) => {
    schedule = { ...schedule, retain_days: days, retain_count: count }; const view = await render(); const panel = card(view, 'admin.backup.schedule.title')
    expect(panel.text()).toContain(`admin.backup.schedule.${key}`); await click(button(panel, 'common.save'))
    expect(writes()[0]).toMatchObject({ method: 'put', path: '/admin/backups/schedule', body: { retain_days: days, retain_count: count, monthly_archive: { enabled: false, days: [1], include_month_end: false, retain_count: 0 } } })
  })

  it.each(['s3', 'image'])('shows fallback connection success and failure messages for %s without saving any credential configuration', async kind => {
    const view = await render(); const panel = card(view, kind === 's3' ? 'admin.backup.s3.title' : 'admin.backup.imageStorage.title')
    if (kind === 'image') expect(field(panel, 'admin.backup.s3.secretAccessKey').attributes('placeholder')).toBe('')
    await click(button(panel, 'admin.backup.s3.testConnection')); expect(feedback.success).toHaveBeenCalledWith('admin.backup.s3.testSuccess')
    connection = { ok: false, message: '' }; await click(button(panel, 'admin.backup.s3.testConnection')); expect(feedback.error).toHaveBeenCalledWith('admin.backup.s3.testFailed')
    expect(writes().map(wire => wire.path)).toEqual(Array(2).fill(`/admin/backups/${kind === 's3' ? 's3-config' : 'image-storage'}/test`)); expect(writes().some(wire => wire.method === 'put')).toBe(false)
  })

  it.each(['s3', 'image'])('reports a rejected %s connection test, releases its control and tests the corrected draft on explicit retry', async kind => {
    const path = `/admin/backups/${kind === 's3' ? 's3-config' : 'image-storage'}/test`; fail = `post ${path}`
    const view = await render(); const panel = card(view, kind === 's3' ? 'admin.backup.s3.title' : 'admin.backup.imageStorage.title')
    await click(button(panel, 'admin.backup.s3.testConnection')); expect(feedback.error).toHaveBeenCalledWith('Synthetic backup refusal')
    await field(panel, kind === 's3' ? 'admin.backup.s3.bucket' : 'admin.backup.imageStorage.bucket').setValue('synthetic-corrected-bucket')
    connection = { ok: true, message: 'Synthetic corrected storage reachable' }; await click(button(panel, 'admin.backup.s3.testConnection'))
    expect(feedback.success).toHaveBeenCalledWith('Synthetic corrected storage reachable'); expect(writes().at(-1)?.body.bucket).toBe('synthetic-corrected-bucket')
  })

  it.each(['', 'Synthetic snapshot failed'])('stops creation polling on a failed backup and displays the stored error %j or its fallback', async error_message => {
    const view = await render(); vi.useFakeTimers(); poll = record({ status: 'failed', error_message })
    await click(button(view, 'admin.backup.operations.createBackup')); await vi.advanceTimersByTimeAsync(2001); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith(error_message || 'admin.backup.operations.backupFailed'); expect(button(view, 'admin.backup.operations.createBackup').attributes('disabled')).toBeUndefined()
    const calls = wires.filter(wire => wire.path === '/admin/backups/synthetic-backup').length; await vi.advanceTimersByTimeAsync(10000); expect(wires.filter(wire => wire.path === '/admin/backups/synthetic-backup')).toHaveLength(calls)
    expect(writes().filter(wire => wire.path === '/admin/backups')).toHaveLength(1)
  })

  it('continues read-only polling after a transient read error and reports completion without a second create', async () => {
    const view = await render(); vi.useFakeTimers(); fail = 'get /admin/backups/synthetic-backup'
    await click(button(view, 'admin.backup.operations.createBackup')); await vi.advanceTimersByTimeAsync(2001); expect(feedback.error).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000); await flushPromises(); expect(feedback.success).toHaveBeenCalledWith('admin.backup.operations.backupCreated'); expect(writes().filter(wire => wire.path === '/admin/backups')).toHaveLength(1)
  })

  it('warns after thirty minutes of still-running creation and releases only the local busy state without resubmitting', async () => {
    const view = await render(); vi.useFakeTimers(); poll = record({ status: 'running' })
    await click(button(view, 'admin.backup.operations.createBackup')); await vi.advanceTimersByTimeAsync(1802000); await flushPromises()
    expect(feedback.warning).toHaveBeenCalledWith('admin.backup.operations.backupRunning'); expect(button(view, 'admin.backup.operations.createBackup').attributes('disabled')).toBeUndefined(); expect(writes().filter(wire => wire.path === '/admin/backups')).toHaveLength(1)
  })

  it.each(['', 'Synthetic restore failed'])('reports a terminal restore error %j or fallback and releases its target control', async restore_error => {
    const view = await render(); vi.useFakeTimers(); poll = record({ restore_status: 'failed', restore_error })
    await click(button(backupRow(view), 'admin.backup.actions.restore')); await vi.advanceTimersByTimeAsync(2001); await flushPromises()
    expect(feedback.error).toHaveBeenCalledWith(restore_error || 'admin.backup.operations.restoreFailed'); expect(button(backupRow(view), 'admin.backup.actions.restore').attributes('disabled')).toBeUndefined()
    expect(writes()).toEqual([{ method: 'post', path: '/admin/backups/synthetic-backup/restore', params: {}, body: { password: 'synthetic-not-real-password' } }])
  })

  it('finishes successful restore polling after a transient read failure, with no second restore command', async () => {
    const view = await render(); vi.useFakeTimers(); fail = 'get /admin/backups/synthetic-backup'; poll = record({ restore_status: 'completed' })
    await click(button(backupRow(view), 'admin.backup.actions.restore')); await vi.advanceTimersByTimeAsync(4001); await flushPromises()
    expect(feedback.success).toHaveBeenCalledWith('admin.backup.actions.restoreSuccess'); expect(writes()).toHaveLength(1)
  })

  it('warns on a prolonged restore without claiming rollback or automatically issuing another restore', async () => {
    const view = await render(); vi.useFakeTimers(); poll = record({ restore_status: 'running' })
    await click(button(backupRow(view), 'admin.backup.actions.restore')); await vi.advanceTimersByTimeAsync(1802000); await flushPromises()
    expect(feedback.warning).toHaveBeenCalledWith('admin.backup.operations.restoreRunning'); expect(button(backupRow(view), 'admin.backup.actions.restore').attributes('disabled')).toBeUndefined(); expect(writes()).toHaveLength(1)
  })

  it.each([409, 400])('keeps an HTTP%i restore refusal as its appropriate warning or error and allows a later deliberate retry', async status => {
    failureStatus = status; fail = 'post /admin/backups/synthetic-backup/restore'; const view = await render()
    await click(button(backupRow(view), 'admin.backup.actions.restore'))
    if (status === 409) expect(feedback.warning).toHaveBeenCalledWith('admin.backup.operations.restoreRunning')
    else expect(feedback.error).toHaveBeenCalledWith('Synthetic backup refusal')
    expect(button(backupRow(view), 'admin.backup.actions.restore').attributes('disabled')).toBeUndefined(); expect(writes()).toHaveLength(1)
  })

  it.each(['STEP_UP_TOTP_NOT_ENABLED', 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'])('shows the %s sensitive-operation refusal on download without activating an anchor', async reason => {
    failureStatus = 403; failureReason = reason; fail = 'get /admin/backups/synthetic-backup/download-url'; const view = await render()
    await click(button(backupRow(view), 'admin.backup.actions.download')); expect(feedback.error).toHaveBeenCalledWith(reason === 'STEP_UP_TOTP_NOT_ENABLED' ? 'stepUp.notEnabled' : 'stepUp.adminApiKeyForbidden'); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('rejects a download response without a URL or parts instead of claiming a file was downloaded', async () => {
    const view = await render(); await click(button(backupRow(view), 'admin.backup.actions.download'))
    expect(feedback.error).toHaveBeenCalledWith('admin.backup.actions.downloadFailed'); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(writes()).toEqual([])
  })

  it('opens the R2 setup instructions and closes them through both the native close action and backdrop', async () => {
    const view = await render(); await click(button(view, 'Cloudflare R2'))
    let guide = new DOMWrapper(document.body).get('.fixed.inset-0'); expect(guide.text()).toContain('https://<account_id>.r2.cloudflarestorage.com'); expect(guide.text()).toContain('admin.backup.r2Guide.step4.unchecked')
    await click(button(guide, 'common.close')); expect(new DOMWrapper(document.body).find('.fixed.inset-0').exists()).toBe(false)
    await click(button(view, 'Cloudflare R2')); guide = new DOMWrapper(document.body).get('.fixed.inset-0'); await guide.get('[class~="bg-black/50"]').trigger('click'); expect(new DOMWrapper(document.body).find('.fixed.inset-0').exists()).toBe(false); expect(writes()).toEqual([])
  })
})
