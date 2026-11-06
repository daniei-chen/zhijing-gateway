import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import VersionBadge from '../VersionBadge.vue'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({
  auth: { isAdmin: true },
  app: {} as Record<string, any>,
  performUpdate: vi.fn(), restartService: vi.fn(), getRollbackVersions: vi.fn(), rollback: vi.fn(), copy: vi.fn(), reload: vi.fn(),
  copied: {} as { value: boolean },
}))
vi.mock('@/stores', () => ({ useAuthStore: () => mocks.auth, useAppStore: () => mocks.app }))
vi.mock('@/api/admin/system', () => ({ performUpdate: mocks.performUpdate, restartService: mocks.restartService, getRollbackVersions: mocks.getRollbackVersions, rollback: mocks.rollback }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copied: mocks.copied, copyToClipboard: mocks.copy }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${Object.values(params).join(',')}` : key }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const wrappers: VueWrapper[] = []
function render(overrides: Record<string, unknown> = {}, version = '0.0.3') {
  Object.assign(mocks.app, overrides)
  const wrapper = mount(VersionBadge, { props: { version }, attachTo: document.body, global: { stubs: { Icon: true, transition: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const match = wrapper.findAll('button').find(item => item.text().includes(text))
  expect(match, `button ${text}`).toBeDefined()
  return match!
}
async function open(wrapper: VueWrapper) { await wrapper.get('button').trigger('click'); await flushPromises() }
async function chooseRollback(wrapper: VueWrapper, version = '0.0.2') {
  await open(wrapper)
  await button(wrapper, 'version.rollback').trigger('click')
  await flushPromises()
  await button(wrapper, `v${version}`).trigger('click')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.copied = ref(false)
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-version-review', user: { id: 1 } })
  mocks.auth = reactive({ isAdmin: true })
  mocks.app = reactive({ currentVersion: '', latestVersion: '0.0.4', hasUpdate: false, versionLoading: false, releaseInfo: null, buildType: 'release', fetchVersion: vi.fn().mockResolvedValue(null), clearVersionCache: vi.fn() })
  mocks.app.clearVersionCache.mockImplementation(() => { mocks.app.hasUpdate = false })
  mocks.performUpdate.mockResolvedValue({ need_restart: true })
  mocks.restartService.mockResolvedValue({ message: 'ok' })
  mocks.getRollbackVersions.mockResolvedValue({ versions: [{ version: '0.0.2', published_at: '2026-11-01T01:02:03Z', html_url: '#' }] })
  mocks.rollback.mockResolvedValue({ need_restart: true })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  vi.stubGlobal('location', { ...window.location, reload: mocks.reload })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('VersionBadge visible release workflows', () => {
  it('shows the static member version without fetching privileged metadata', () => {
    mocks.auth.isAdmin = false
    const wrapper = render()
    expect(wrapper.text()).toBe('v0.0.3')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(mocks.app.fetchVersion).not.toHaveBeenCalled()
  })
  it.each(['0.0.3', 'v0.0.3', 'V0.0.3'])('normalizes the visible version %s', async value => {
    const wrapper = render({ currentVersion: value })
    await open(wrapper)
    expect(wrapper.text()).toContain('v0.0.3')
    expect(wrapper.text()).not.toContain('vv0.0.3')
  })
  it('loads the cached administrator version and explicitly refreshes it', async () => {
    const wrapper = render()
    expect(mocks.app.fetchVersion).toHaveBeenCalledWith(false)
    await open(wrapper)
    await wrapper.get('button[title="version.refresh"]').trigger('click')
    expect(mocks.app.fetchVersion).toHaveBeenLastCalledWith(true)
  })
  it('shows the loading placeholder and cannot refresh while metadata is loading', async () => {
    const wrapper = render({ versionLoading: true }, '')
    await open(wrapper)
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(wrapper.get('button[title="version.refresh"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('version.rollback')
  })
  it('shows a source hint instead of a binary update button', async () => {
    const wrapper = render({ hasUpdate: true, buildType: 'source', releaseInfo: { html_url: 'https://example.test/release' } })
    await open(wrapper)
    expect(wrapper.text()).toContain('version.sourceModeHint')
    expect(wrapper.findAll('button').some(item => item.text() === 'version.updateNow')).toBe(false)
    expect(wrapper.get('a').attributes('rel')).toContain('noopener')
  })
  it('shows the source rollback hint without calling binary rollback APIs', async () => {
    const wrapper = render({ buildType: 'source' })
    await open(wrapper)
    await button(wrapper, 'version.rollback').trigger('click')
    expect(wrapper.text()).toContain('version.rollbackSourceHint')
    expect(mocks.getRollbackVersions).not.toHaveBeenCalled()
    expect(mocks.rollback).not.toHaveBeenCalled()
  })
  it('suppresses placeholder release links and handles blank versions', async () => {
    const wrapper = render({ releaseInfo: { html_url: '#' } }, '')
    await open(wrapper)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('--')
  })
  it('renders the release changelog link with isolation attributes', async () => {
    const wrapper = render({ hasUpdate: true, releaseInfo: { html_url: 'https://example.test/changelog' } })
    await open(wrapper)
    expect(wrapper.get('a').attributes()).toMatchObject({ href: 'https://example.test/changelog', target: '_blank', rel: 'noopener noreferrer' })
  })
  it('deduplicates update clicks and exposes the restart result', async () => {
    const pending = deferred<{ need_restart: boolean }>()
    mocks.performUpdate.mockReturnValue(pending.promise)
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    expect(button(wrapper, 'version.updating').attributes('disabled')).toBeDefined()
    expect(mocks.performUpdate).toHaveBeenCalledOnce()
    pending.resolve({ need_restart: true })
    await flushPromises()
    expect(wrapper.text()).toContain('version.updateComplete')
    expect(wrapper.text()).toContain('version.restartNow')
    expect(mocks.app.clearVersionCache).toHaveBeenCalledOnce()
  })
  it.each([{ response: { data: { message: 'synthetic server error' } } }, new Error('synthetic network error'), {}])('keeps a failed update retryable: %j', async error => {
    mocks.performUpdate.mockRejectedValueOnce(error)
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('version.updateFailed')
    expect(mocks.app.clearVersionCache).not.toHaveBeenCalled()
    await button(wrapper, 'version.retry').trigger('click')
    await flushPromises()
    expect(mocks.performUpdate).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('version.updateComplete')
  })
  it('loads, selects, deselects and changes the displayed manual rollback method', async () => {
    const wrapper = render()
    await chooseRollback(wrapper)
    expect(wrapper.get('code').text()).toContain('rollback v0.0.2')
    await button(wrapper, 'version.deployDocker').trigger('click')
    expect(wrapper.get('code').text()).toContain('image: weishaw/sub2api:0.0.2')
    await button(wrapper, 'version.copyCommand').trigger('click')
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('docker compose up -d'), undefined, expect.any(Function))
    await button(wrapper, 'v0.0.2').trigger('click')
    expect(wrapper.find('code').exists()).toBe(false)
    expect(mocks.rollback).not.toHaveBeenCalled()
  })
  it.each([[], undefined])('handles an empty rollback response without making a mutation', async versions => {
    mocks.getRollbackVersions.mockResolvedValue({ versions })
    const wrapper = render()
    await open(wrapper)
    await button(wrapper, 'version.rollback').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('version.noRollbackVersions')
    expect(mocks.rollback).not.toHaveBeenCalled()
  })
  it('shows rollback list errors and retries by reopening the panel', async () => {
    mocks.getRollbackVersions.mockRejectedValueOnce(new Error('synthetic rollback list error'))
    const wrapper = render()
    await open(wrapper)
    await button(wrapper, 'version.rollback').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('synthetic rollback list error')
    await button(wrapper, 'version.rollback').trigger('click')
    await button(wrapper, 'version.rollback').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('v0.0.2')
    expect(mocks.getRollbackVersions).toHaveBeenCalledTimes(2)
  })
  it('submits the selected rollback once and displays the rollback restart result', async () => {
    const pending = deferred<{ need_restart: boolean }>()
    mocks.rollback.mockReturnValue(pending.promise)
    const wrapper = render()
    await chooseRollback(wrapper)
    await button(wrapper, 'version.rollbackConfirm').trigger('click')
    expect(mocks.rollback).toHaveBeenCalledWith('0.0.2')
    expect(button(wrapper, 'version.rollingBack').attributes('disabled')).toBeDefined()
    pending.resolve({ need_restart: true })
    await flushPromises()
    expect(wrapper.text()).toContain('version.rollbackComplete')
    expect(mocks.app.clearVersionCache).toHaveBeenCalledOnce()
  })
  it('leaves a failed rollback selected and retryable', async () => {
    mocks.rollback.mockRejectedValueOnce({ response: { data: { message: 'synthetic rollback failure' } } })
    const wrapper = render()
    await chooseRollback(wrapper)
    await button(wrapper, 'version.rollbackConfirm').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('synthetic rollback failure')
    await button(wrapper, 'version.rollbackConfirm').trigger('click')
    await flushPromises()
    expect(mocks.rollback).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('version.rollbackComplete')
  })
  it('tolerates missing and invalid publication dates without rendering Invalid Date', async () => {
    mocks.getRollbackVersions.mockResolvedValue({ versions: [{ version: '0.0.1', published_at: '' }, { version: '0.0.2', published_at: 'invalid' }] })
    const wrapper = render()
    await open(wrapper)
    await button(wrapper, 'version.rollback').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('v0.0.1')
    expect(wrapper.text()).toContain('v0.0.2')
    expect(wrapper.text()).not.toContain('Invalid Date')
  })
})

describe('VersionBadge operation ownership and keyboard behavior', () => {
  it('provides a named disclosure and closes on Escape without losing the opener', async () => {
    const wrapper = render()
    const trigger = wrapper.get<HTMLButtonElement>('button')
    trigger.element.focus()
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const panel = document.getElementById(trigger.attributes('aria-controls'))
    expect(panel).not.toBeNull()
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
  })
  it('closes when an unrelated external button is clicked', async () => {
    const wrapper = render()
    await open(wrapper)
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.click()
    await nextTick()
    expect(wrapper.text()).not.toContain('version.currentVersion')
  })
  it.each(['unmount', 'login replacement', 'permission removed'])('ignores a late update result after %s', async boundary => {
    const pending = deferred<{ need_restart: boolean }>()
    mocks.performUpdate.mockReturnValue(pending.promise)
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    if (boundary === 'unmount') wrapper.unmount()
    else if (boundary === 'login replacement') replaceAuthSession({ accessToken: 'synthetic-new-version-session', user: { id: 2 } })
    else mocks.auth.isAdmin = false
    await nextTick()
    pending.resolve({ need_restart: true })
    await flushPromises()
    expect(mocks.app.clearVersionCache).not.toHaveBeenCalled()
    if (boundary !== 'unmount') {
      mocks.auth.isAdmin = true
      await nextTick()
      expect(wrapper.text()).not.toContain('version.updateComplete')
    }
  })
  it('disables refresh while an update result is pending', async () => {
    mocks.performUpdate.mockReturnValue(new Promise(() => {}))
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    expect(wrapper.get('button[title="version.refresh"]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[title="version.refresh"]').trigger('click')
    expect(mocks.app.fetchVersion).toHaveBeenCalledTimes(1)
  })
  it('discards a rollback list invalidated by a version refresh', async () => {
    const pending = deferred<{ versions: { version: string }[] }>()
    mocks.getRollbackVersions.mockReturnValueOnce(pending.promise)
    const wrapper = render()
    await open(wrapper)
    await button(wrapper, 'version.rollback').trigger('click')
    await wrapper.get('button[title="version.refresh"]').trigger('click')
    pending.resolve({ versions: [{ version: 'stale-list-version' }] })
    await flushPromises()
    await button(wrapper, 'version.rollback').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale-list-version')
    expect(mocks.getRollbackVersions).toHaveBeenCalledTimes(2)
  })
  it('stops a pending restart countdown when the component unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    await flushPromises()
    await button(wrapper, 'version.restartNow').trigger('click')
    await flushPromises()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })
  it('does not start a recovery timer when restart acknowledgement arrives after unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const pending = deferred<{ message: string }>()
    mocks.restartService.mockReturnValue(pending.promise)
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    await flushPromises()
    await button(wrapper, 'version.restartNow').trigger('click')
    wrapper.unmount()
    pending.resolve({ message: 'ok' })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })
})

describe('VersionBadge restart recovery through visible controls', () => {
  async function restart() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const wrapper = render({ hasUpdate: true })
    await open(wrapper)
    await button(wrapper, 'version.updateNow').trigger('click')
    await flushPromises()
    await button(wrapper, 'version.restartNow').trigger('click')
    await flushPromises()
    return wrapper
  }
  it('waits eight seconds, checks health and reloads once', async () => {
    const wrapper = await restart()
    expect(wrapper.text()).toContain('8s')
    expect(button(wrapper, 'version.restarting').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[title="version.refresh"]').attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(7999)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({ method: 'GET', cache: 'no-cache', signal: expect.any(AbortSignal) }))
    expect(mocks.reload).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.restartService).toHaveBeenCalledOnce()
  })
  it('still recovers when restart acknowledgement is lost with the connection', async () => {
    mocks.restartService.mockRejectedValueOnce(new Error('synthetic connection reset'))
    await restart()
    await vi.advanceTimersByTimeAsync(8000)
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it.each([
    { status: 403, code: 'PERMISSION_DENIED', message: 'synthetic forbidden' },
    { status: 409, message: 'synthetic operation locked' },
    { status: 503, message: 'synthetic store unavailable' },
    { response: { status: 400, data: { message: 'synthetic rejected request' } } },
  ])('keeps an explicitly rejected restart retryable: %j', async error => {
    mocks.restartService.mockRejectedValueOnce(error)
    const wrapper = await restart()
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('synthetic')
    expect(button(wrapper, 'version.restartNow').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'version.restartNow').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(8000)
    expect(mocks.restartService).toHaveBeenCalledTimes(2)
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it.each(['rejected', 'not ready'])('retries %s health responses five times and then reloads', async response => {
    if (response === 'rejected') vi.mocked(fetch).mockRejectedValue(new TypeError('synthetic offline'))
    else vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    await restart()
    await vi.advanceTimersByTimeAsync(11999)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(mocks.reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it.each(['permission', 'session'])('stops countdown recovery when the %s changes', async boundary => {
    await restart()
    if (boundary === 'permission') mocks.auth.isAdmin = false
    else replaceAuthSession({ accessToken: 'synthetic-different-session', user: { id: 2 } })
    await nextTick()
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })
  it('aborts an in-flight health request and ignores its late successful response on unmount', async () => {
    const pending = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(pending.promise)
    const wrapper = await restart()
    await vi.advanceTimersByTimeAsync(8000)
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
    pending.resolve({ ok: true } as Response)
    await flushPromises()
    expect(mocks.reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('cancels the retry delay on unmount', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('synthetic offline'))
    const wrapper = await restart()
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetch).toHaveBeenCalledOnce()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.reload).not.toHaveBeenCalled()
  })
  it('bounds a stalled health probe and proceeds to the next retry', async () => {
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('synthetic timeout', 'AbortError')), { once: true })
    }))
    await restart()
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
})
