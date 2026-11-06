import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import VersionBadge from '@/components/common/VersionBadge.vue'
import { replaceAuthSession } from '@/api/authSession'

const mocks = vi.hoisted(() => ({ auth: { isAdmin: true }, app: {} as Record<string, any>, showSuccess: vi.fn(), showError: vi.fn() }))
vi.mock('@/stores', () => ({ useAuthStore: () => mocks.auth, useAppStore: () => mocks.app }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }) }))
vi.mock('@/api/admin/system', () => ({
  performUpdate: vi.fn(), restartService: vi.fn(), rollback: vi.fn(),
  getRollbackVersions: vi.fn().mockResolvedValue({ versions: [
    { version: '0.0.2', published_at: '2026-11-01T00:00:00Z', html_url: '#' },
    { version: '0.0.1', published_at: '2026-10-01T00:00:00Z', html_url: '#' },
  ] }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

let wrapper: VueWrapper | undefined
let resolveCopy!: () => void
async function commandPanel() {
  wrapper = mount(VersionBadge, { props: { version: '0.0.3' }, attachTo: document.body, global: { stubs: { Icon: true, transition: true } } })
  await wrapper.get('button').trigger('click')
  await button('version.rollback').trigger('click')
  await flushPromises()
  await button('v0.0.2').trigger('click')
  return wrapper
}
const button = (text: string) => {
  const found = wrapper!.findAll('button').find(item => item.text().includes(text))
  expect(found, `DOM button ${text}`).toBeDefined()
  return found!
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-version-copy', user: { id: 7 } })
  mocks.auth = reactive({ isAdmin: true })
  mocks.app = reactive({ currentVersion: '0.0.3', latestVersion: '0.0.3', hasUpdate: false, versionLoading: false,
    buildType: 'release', releaseInfo: null, fetchVersion: vi.fn().mockResolvedValue(null), clearVersionCache: vi.fn() })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveCopy = resolve })),
  } })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('VersionBadge real clipboard command ownership', () => {
  it.each(['version', 'method'] as const)('clears already successful copy feedback when the displayed %s changes', async boundary => {
    vi.mocked(navigator.clipboard.writeText).mockResolvedValueOnce(undefined)
    wrapper = mount(VersionBadge, { props: { version: '0.0.3' }, attachTo: document.body, global: { stubs: { Icon: true, transition: true } } })
    await wrapper.get('button').trigger('click')
    await button('version.rollback').trigger('click')
    await flushPromises()
    await button('v0.0.2').trigger('click')
    await button('version.copyCommand').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('version.copied')
    if (boundary === 'version') await button('v0.0.1').trigger('click')
    else await button('version.deployDocker').trigger('click')
    expect(wrapper.text()).not.toContain('version.copied')
    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
  })

  it.each(['version', 'method', 'permission'] as const)('does not mark an obsolete rollback command copied after %s changes', async boundary => {
    await commandPanel()
    expect(wrapper.get('code').text()).toContain('rollback v0.0.2')
    await button('version.copyCommand').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
    if (boundary === 'version') await button('v0.0.1').trigger('click')
    else if (boundary === 'method') await button('version.deployDocker').trigger('click')
    else { mocks.auth.isAdmin = false; await nextTick() }
    resolveCopy()
    await flushPromises()
    expect.soft(mocks.showSuccess).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('version.copied')
    // The already accepted native write remains a single OS operation.
    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
  })
  it.each(['version', 'method', 'panel'] as const)('clears completed feedback immediately when the %s changes', async boundary => {
    await commandPanel()
    await button('version.copyCommand').trigger('click')
    resolveCopy()
    await flushPromises()
    expect(wrapper!.text()).toContain('version.copied')
    if (boundary === 'version') await button('v0.0.1').trigger('click')
    else if (boundary === 'method') await button('version.deployDocker').trigger('click')
    else {
      await button('version.rollback').trigger('click')
      await button('version.rollback').trigger('click')
    }
    expect(wrapper!.text()).not.toContain('version.copied')
    expect(mocks.showSuccess).toHaveBeenCalledOnce()
  })
  it('keeps an obsolete completion from overwriting a new command copy', async () => {
    await commandPanel()
    await button('version.copyCommand').trigger('click')
    const oldFinish = resolveCopy
    await button('v0.0.1').trigger('click')
    await button('version.copyCommand').trigger('click')
    const newFinish = resolveCopy
    oldFinish()
    await flushPromises()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(wrapper!.text()).not.toContain('version.copied')
    newFinish()
    await flushPromises()
    expect(mocks.showSuccess).toHaveBeenCalledOnce()
    expect(wrapper!.text()).toContain('version.copied')
    expect(wrapper!.get('code').text()).toContain('rollback v0.0.1')
  })
  it('suppresses a pending copy notification when the dropdown closes', async () => {
    await commandPanel()
    await button('version.copyCommand').trigger('click')
    await wrapper!.get('button').trigger('click')
    resolveCopy()
    await flushPromises()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    await wrapper!.get('button').trigger('click')
    expect(wrapper!.text()).not.toContain('version.copied')
  })
})
