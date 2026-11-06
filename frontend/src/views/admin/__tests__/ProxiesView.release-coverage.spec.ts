import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProxiesView from '../ProxiesView.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const notices = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }))
const clipboard = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin', async () => ({ adminAPI: {
  proxies: (await vi.importActual<typeof import('@/api/admin/proxies')>('@/api/admin/proxies')).proxiesAPI
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => notices }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: clipboard }) }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual('vue-i18n'),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (params?.days !== undefined) return `${key}:${params.days}`
    if (params?.count !== undefined) return `${key}:${params.count}`
    return key
  } })
}))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

type Wire = {
  method: string
  path: string
  body: Record<string, any>
  params: Record<string, unknown>
  config: InternalAxiosRequestConfig
}
const originalAdapter = apiClient.defaults.adapter
let view: VueWrapper | undefined
let wire: Wire[] = []
let unexpected: string[] = []
let route: (request: Wire) => Promise<unknown>
const dom = () => new DOMWrapper(document.body)
const rows = () => [
  { id: 84, name: 'Synthetic native relay', protocol: 'socks5', host: '2001:db8::84', port: 1080,
    username: 'synthetic user', password: null, status: 'active', account_count: 1,
    created_at: '2026-11-06T00:00:00Z', expires_at: '2099-11-09T00:00:00Z', fallback_mode: 'none', expiry_warn_days: 7 },
  { id: 85, name: 'Synthetic backup relay', protocol: 'http', host: 'backup.example.test', port: 8080,
    username: null, password: null, status: 'inactive', account_count: 0,
    created_at: '2026-11-06T00:00:00Z', expires_at: null, fallback_mode: 'none' }
]
const normal = async (request: Wire): Promise<unknown> => {
  if (request.method === 'get' && request.path === '/admin/proxies') return { items: rows(), total: 2, pages: 1 }
  if (request.path === '/admin/proxies/all') return rows()
  if (request.path === '/admin/proxies' && request.method === 'post') return { id: 86, ...request.body }
  if (request.path === '/admin/proxies/84' && request.method === 'put') return { ...rows()[0], ...request.body }
  if (request.path === '/admin/proxies/batch') return { created: 2, skipped: 0 }
  if (request.path === '/admin/proxies/84/accounts') return [{ id: 841, name: 'Synthetic linked account', platform: 'openai', type: 'oauth' }]
  unexpected.push(`${request.method} ${request.path}`)
  throw new Error('Unexpected synthetic native proxy endpoint')
}
function rejected(request: Wire) {
  return new AxiosError('Synthetic unavailable', 'ERR_BAD_RESPONSE', request.config, undefined, {
    status: 503, statusText: 'Synthetic', headers: {}, config: request.config, data: { message: 'Synthetic unavailable' }
  })
}
async function open() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  await router.isReady()
  view = mount(ProxiesView, {
    attachTo: document.body,
    global: {
      plugins: [router],
      mocks: { $t: (key: string) => key },
      stubs: {
        AppLayout: { template: '<main><slot /></main>' },
        ImportDataModal: true, Icon: true, ProxyAdBanner: true, Transition: true
      }
    }
  })
  await flushPromises()
}
function button(text: string, root: DOMWrapper<Element> = dom()) {
  const found = root.findAll('button').find(node => node.text() === text)
  expect(found, `native button ${text}`).toBeDefined()
  return found!
}
async function click(text: string, root: DOMWrapper<Element> = dom()) {
  const target = button(text, root).element as HTMLButtonElement
  target.click()
  await flushPromises()
}
function row() {
  const found = dom().findAll('tbody tr').find(node => node.text().includes('Synthetic native relay'))
  expect(found, 'real DataTable row').toBeDefined()
  return found!
}
async function option(selector: string, text: string) {
  await dom().get(selector).trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const found = dom().findAll('[role="option"]').find(node => node.text() === text || node.text().startsWith(`${text} (`))
  expect(found, `real Select option ${text}`).toBeDefined()
  ;(found!.element as HTMLElement).click()
  await flushPromises()
}
async function form(kind: 'create' | 'edit') {
  if (kind === 'create') {
    await click('admin.proxies.createProxy')
    await dom().get('#proxy-create-name').setValue(' Synthetic configured relay ')
    await dom().get('#proxy-create-host').setValue(' relay.example.test ')
  } else await click('common.edit', row())
  return dom().get(`#${kind}-proxy-form`)
}
async function save(kind: 'create' | 'edit') {
  const native = dom().get(`#${kind}-proxy-form`).element as HTMLFormElement
  expect(native.checkValidity()).toBe(true)
  ;(dom().get(`button[form="${kind}-proxy-form"]`).element as HTMLButtonElement).click()
  await flushPromises()
}
const writes = (kind: 'create' | 'edit') => wire.filter(request => request.method === (kind === 'create' ? 'post' : 'put')
  && request.path === (kind === 'create' ? '/admin/proxies' : '/admin/proxies/84'))

beforeEach(() => {
  wire = []
  unexpected = []
  route = normal
  Object.values(notices).forEach(mock => mock.mockReset())
  clipboard.mockReset()
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-proxy-release-admin', user: { id: 84, role: 'admin' } })
  apiClient.defaults.adapter = async config => {
    const request: Wire = {
      method: config.method ?? 'get', path: String(config.url),
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {}, params: config.params ?? {}, config
    }
    wire.push(request)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: await route(request) } }
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  view?.unmount()
  view = undefined
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  expect(unexpected).toEqual([])
})

describe.each(['create', 'edit'] as const)('native proxy %s configuration and actual JSON payload', kind => {
  it.each(['none', 'direct', 'proxy'])('saves deliberate %s fallback and excludes an obsolete backup target when appropriate', async mode => {
    await open()
    await form(kind)
    await dom().get(`#proxy-${kind}-name`).setValue(' Synthetic edited relay ')
    await dom().get(`#proxy-${kind}-host`).setValue(' edited.example.test ')
    await dom().get(`#proxy-${kind}-port`).setValue('8443')
    await option(`#proxy-${kind}-protocol`, 'admin.proxies.protocols.https')
    await option(`#proxy-${kind}-fallback-mode`, 'admin.proxies.fallbackProxy')
    await option(`#proxy-${kind}-backup-proxy-id`, 'Synthetic backup relay')
    if (mode !== 'proxy') await option(`#proxy-${kind}-fallback-mode`, mode === 'direct' ? 'admin.proxies.fallbackDirect' : 'admin.proxies.fallbackNone')
    await dom().get(`#proxy-${kind}-expires-at`).setValue('2099-12-01')
    if (kind === 'edit') await option('#proxy-edit-status', 'admin.accounts.status.inactive')
    await save(kind)
    expect(writes(kind)).toHaveLength(1)
    expect(writes(kind)[0]!.body).toMatchObject({
      name: 'Synthetic edited relay', host: 'edited.example.test', port: 8443, protocol: 'https',
      fallback_mode: mode, backup_proxy_id: mode === 'proxy' ? 85 : null,
      expires_at: Math.floor(new Date('2099-12-01').getTime() / 1000)
    })
    if (kind === 'edit') expect(writes(kind)[0]!.body.status).toBe('inactive')
    expect(dom().find(`#${kind}-proxy-form`).exists()).toBe(false)
    expect(notices.showSuccess).toHaveBeenCalledWith(kind === 'create' ? 'admin.proxies.proxyCreated' : 'admin.proxies.proxyUpdated')
  })
  it('changes password visibility and explicitly replaces the credential using the native input', async () => {
    await open()
    await form(kind)
    const input = dom().get(`#proxy-${kind}-password`)
    const visibility = dom().get(`button[aria-label="admin.proxies.password"]`)
    expect(input.attributes('type')).toBe('password')
    await visibility.trigger('click')
    expect(input.attributes('type')).toBe('text')
    expect(visibility.attributes('aria-pressed')).toBe('true')
    await visibility.trigger('click')
    expect(input.attributes('type')).toBe('password')
    await input.setValue(' synthetic replacement secret ')
    await dom().get(`#proxy-${kind}-username`).setValue(' synthetic user ')
    await save(kind)
    expect(writes(kind)[0]!.body).toMatchObject({ username: 'synthetic user', password: 'synthetic replacement secret' })
  })
  it('removes a draft expiry through the days control instead of keeping the hidden previous date', async () => {
    await open()
    await form(kind)
    await dom().get(`#proxy-${kind}-expires-at`).setValue('2099-12-01')
    await dom().get('input[aria-label="admin.proxies.expiryDaysPlaceholder"]').setValue('0')
    expect((dom().get(`#proxy-${kind}-expires-at`).element as HTMLInputElement).value).toBe('')
    await save(kind)
    expect(writes(kind)[0]!.body.expires_at).toBeNull()
  })
})

describe('native proxy table and batch URL import', () => {
  it('previews invalid and duplicate URL rows then submits only normalized unique IPv6/auth targets', async () => {
    await open()
    await click('admin.proxies.createProxy')
    await click('admin.proxies.batchAdd')
    await dom().get('#proxy-batch-input').setValue([
      'socks5://user%20name:pass%3Aword@[2001:db8::99]:1080',
      'socks5://user%20name:pass%3Aword@[2001:db8::99]:1080',
      'https://%ZZ:password@edge.example.test:8443',
      'http://invalid.example.test:70000', 'invalid URL'
    ].join('\n'))
    expect(dom().text()).toContain('admin.proxies.parsedCount:2')
    expect(dom().text()).toContain('admin.proxies.invalidCount:2')
    expect(dom().text()).toContain('admin.proxies.duplicateCount:1')
    await click('admin.proxies.importProxies:2')
    const request = wire.find(request => request.path === '/admin/proxies/batch')
    expect(request?.body).toEqual({ proxies: [
      { protocol: 'socks5', host: '2001:db8::99', port: 1080, username: 'user name', password: 'pass:word' },
      { protocol: 'https', host: 'edge.example.test', port: 8443, username: '%ZZ', password: 'password' }
    ] })
    expect(notices.showSuccess).toHaveBeenCalledWith('admin.proxies.batchImportSuccess')
  })
  it('reports an all-skipped batch as informational and resets its input for the next import', async () => {
    route = async request => request.path === '/admin/proxies/batch' ? { created: 0, skipped: 1 } : normal(request)
    await open()
    await click('admin.proxies.createProxy')
    await click('admin.proxies.batchAdd')
    await dom().get('#proxy-batch-input').setValue('http://skipped.example.test:8080')
    await click('admin.proxies.importProxies:1')
    expect(notices.showInfo).toHaveBeenCalledWith('admin.proxies.batchImportAllSkipped')
    await click('admin.proxies.createProxy')
    await click('admin.proxies.batchAdd')
    expect((dom().get('#proxy-batch-input').element as HTMLTextAreaElement).value).toBe('')
  })
  it.each([
    [true, 124, 'admin.proxies.proxyWorkingWithLatency'],
    [true, 0, 'admin.proxies.proxyWorking'],
    [false, undefined, 'Synthetic connectivity refused']
  ] as const)('renders the current connection result success=%s latency=%s through the real row action', async (success, latency, notice) => {
    route = async request => request.path === '/admin/proxies/84/test'
      ? { success, latency_ms: latency, message: 'Synthetic connectivity refused', ip_address: '192.0.2.84', country: 'Japan', country_code: 'JP', city: 'Tokyo' }
      : normal(request)
    await open()
    await click('admin.proxies.testConnection', row())
    expect(success ? notices.showSuccess : notices.showError).toHaveBeenCalledWith(notice)
    expect(wire.filter(request => request.path === '/admin/proxies/84/test')).toHaveLength(1)
    if (success) {
      expect(row().text()).toContain('Japan · Tokyo')
      expect(row().text()).toContain(`${latency}ms`)
      expect(row().get('img').attributes('src')).toContain('/jp.svg')
    } else expect(row().text()).toContain('admin.proxies.latencyFailed')
  })
  it('recovers a rejected connection check and re-enables the same actual row action', async () => {
    let attempts = 0
    route = async request => {
      if (request.path === '/admin/proxies/84/test') {
        if (attempts++ === 0) throw rejected(request)
        return { success: true, latency_ms: 45 }
      }
      return normal(request)
    }
    await open()
    await click('admin.proxies.testConnection', row())
    expect(notices.showError).toHaveBeenCalledWith('admin.proxies.failedToTest')
    expect((button('admin.proxies.testConnection', row()).element as HTMLButtonElement).disabled).toBe(false)
    await click('admin.proxies.testConnection', row())
    expect(row().text()).toContain('45ms')
  })
  it('opens and dismisses a detailed quality report with distinct checks without changing proxy credentials', async () => {
    const report = {
      score: 75, grade: 'B', summary: 'Synthetic quality summary', checked_at: 1793923200,
      exit_ip: '192.0.2.84', country: 'Japan', country_code: 'JP', base_latency_ms: 80,
      challenge_count: 1, failed_count: 1, warn_count: 1,
      items: [
        { target: 'base_connectivity', status: 'pass', latency_ms: 80, message: 'Synthetic base passed' },
        { target: 'openai', status: 'warn', http_status: 429, message: 'Synthetic warning' },
        { target: 'anthropic', status: 'challenge', http_status: 403, message: 'Synthetic challenge', cf_ray: 'synthetic-ray' },
        { target: 'gemini', status: 'fail', message: 'Synthetic failed' }
      ]
    }
    route = async request => request.path === '/admin/proxies/84/quality-check' ? report : normal(request)
    await open()
    await click('admin.proxies.qualityCheck', row())
    const dialog = dom().findAll('[role="dialog"]').find(node => node.text().includes('admin.proxies.qualityReportTitle'))
    expect(dialog).toBeDefined()
    expect(dialog!.text()).toContain('Synthetic quality summary')
    expect(dialog!.text()).toContain('Synthetic challenge')
    expect(dialog!.text()).toContain('synthetic-ray')
    expect(dialog!.text()).toContain('429')
    expect(dialog!.findAll('tbody tr')).toHaveLength(4)
    expect(wire.filter(request => request.method === 'put')).toEqual([])
    await click('common.close', dialog!)
    expect(dom().text()).not.toContain('Synthetic quality summary')
  })
  it('shows the requested proxy account list through the real count button and dismisses it cleanly', async () => {
    await open()
    await click('admin.groups.accountsCount:1', row())
    expect(dom().text()).toContain('Synthetic linked account')
    expect(wire.filter(request => request.path === '/admin/proxies/84/accounts')).toHaveLength(1)
    await click('common.close')
    expect(dom().text()).not.toContain('Synthetic linked account')
  })
  it.each([
    ['both', 'test user', 'pass:@', 'socks5://test%20user:pass%3A%40@[2001:db8::84]:1080'],
    ['username', 'test user', null, 'socks5://test%20user@[2001:db8::84]:1080'],
    ['password', null, 'pass:@', 'socks5://:pass%3A%40@[2001:db8::84]:1080'],
    ['anonymous', null, null, 'socks5://[2001:db8::84]:1080']
  ])('copies the actual %s-auth row in the requested native URL format', async (_label, username, password, expected) => {
    route = async request => request.path === '/admin/proxies' && request.method === 'get'
      ? { items: [{ ...rows()[0], username, password }], total: 1, pages: 1 }
      : normal(request)
    await open()
    const copy = row().get('button[title="admin.proxies.copyProxyUrl"]')
    await copy.trigger('click')
    expect(clipboard).toHaveBeenLastCalledWith(expected, 'admin.proxies.urlCopied')
    await copy.trigger('contextmenu')
    await click('[2001:db8::84]:1080', row())
    expect(clipboard).toHaveBeenLastCalledWith('[2001:db8::84]:1080', 'admin.proxies.urlCopied')
    expect(row().findAll('button').some(node => node.text() === expected)).toBe(false)
  })
})

describe('proxy release matrix: sparse data and actual quality actions', () => {
  it.each([
    ['healthy', 0, 0, 'admin.proxies.qualityStatusHealthy', 'badge-success'],
    ['warn', 0, 1, 'admin.proxies.qualityStatusWarn', 'badge-warning'],
    ['failed', 1, 0, 'admin.proxies.qualityStatusFail', 'badge-danger']
  ])('renders and retains a %s quality result after a normal synthetic provider check', async (_state, failed_count, warn_count, label, color) => {
    route = async request => request.path === '/admin/proxies/84/quality-check' ? {
      score: failed_count ? 20 : warn_count ? 70 : 100, grade: failed_count ? 'D' : warn_count ? 'B' : 'A',
      summary: 'Synthetic matrix quality', checked_at: 1793937600, challenge_count: 0, failed_count, warn_count,
      items: [{ target: 'base_connectivity', status: failed_count ? 'fail' : 'pass', message: '' }, { target: 'gemini', status: warn_count ? 'warn' : 'pass' }]
    } : normal(request)
    await open()
    await click('admin.proxies.qualityCheck', row())
    expect(row().text()).toContain(label)
    expect(row().find(`.${color}`).exists()).toBe(true)
    expect(dom().text()).toContain('Synthetic matrix quality')
    const dialog = dom().findAll('[role="dialog"]').find(node => node.text().includes('admin.proxies.qualityReportTitle'))!
    expect(dialog.text()).toContain('Gemini')
    expect(dialog.findAll('tbody tr')).toHaveLength(2)
    await click('common.close', dialog)
    expect(row().text()).toContain(label)
    expect(wire.filter(request => request.path === '/admin/proxies/84/quality-check')).toHaveLength(1)
  })
  it('includes all result classes in a paginated, unselected batch without issuing duplicate proxy checks', async () => {
    const entries = [84, 85, 86, 87, 88].map(id => ({ ...rows()[id === 85 ? 1 : 0], id }))
    route = async request => {
      if (request.path === '/admin/proxies' && request.params.page_size === 200) return {
        items: request.params.page === 1 ? entries.slice(0, 3) : entries.slice(3), total: 5, pages: 2
      }
      if (/\/quality-check$/.test(request.path)) {
        const id = Number(request.path.split('/')[3])
        if (id === 88) throw rejected(request)
        return { score: id === 84 ? 100 : 50, grade: 'B', summary: 'Synthetic batch quality', checked_at: 1793937600,
          challenge_count: Number(id === 85), failed_count: Number(id === 86), warn_count: Number(id === 87),
          items: [{ target: 'base_connectivity', status: id === 86 ? 'fail' : 'pass' }] }
      }
      return normal(request)
    }
    await open()
    await click('admin.proxies.batchQualityCheck')
    const checked = wire.filter(request => /\/quality-check$/.test(request.path))
    expect(checked.map(request => request.path).sort()).toEqual(entries.map(entry => `/admin/proxies/${entry.id}/quality-check`))
    expect(checked.every(request => request.method === 'post')).toBe(true)
    expect(wire.filter(request => request.params.page_size === 200).map(request => request.params.page)).toEqual([1, 2])
    expect(notices.showSuccess).toHaveBeenCalledWith('admin.proxies.batchQualityDone:5')
    expect((button('admin.proxies.batchQualityCheck').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('tests only selected rows and recovers their selection after a normal batch connection run', async () => {
    route = async request => /\/test$/.test(request.path) ? { success: true, latency_ms: 75, message: 'Synthetic selected relay' } : normal(request)
    await open()
    await row().get('input[type="checkbox"]').setValue(true)
    await click('admin.proxies.testConnection')
    expect(wire.filter(request => /\/test$/.test(request.path)).map(request => request.path)).toEqual(['/admin/proxies/84/test'])
    expect(wire.filter(request => request.params.page_size === 200)).toHaveLength(0)
    expect(notices.showSuccess).toHaveBeenCalledWith('admin.proxies.batchTestDone:1')
    expect((button('admin.proxies.testConnection').element as HTMLButtonElement).disabled).toBe(false)
  })
  it.each([
    ['admin.proxies.testConnection', 'admin.proxies.batchTestEmpty'],
    ['admin.proxies.batchQualityCheck', 'admin.proxies.batchQualityEmpty']
  ])('reports no matching results for %s without starting a connection request', async (action, message) => {
    route = async request => request.path === '/admin/proxies' && request.params.page_size === 200 ? { items: [], total: 0, pages: 0 } : normal(request)
    await open()
    await click(action)
    expect(notices.showInfo).toHaveBeenCalledWith(message)
    expect(wire.filter(request => /\/(test|quality-check)$/.test(request.path))).toHaveLength(0)
    expect((button(action).element as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps an expired proxy disabled on edit until the administrator explicitly chooses active', async () => {
    route = async request => request.path === '/admin/proxies' && request.method === 'get'
      ? { items: [{ ...rows()[0], status: 'expired', username: null, password: null, expires_at: null }], total: 1, pages: 1 }
      : normal(request)
    await open()
    await form('edit')
    await save('edit')
    expect(writes('edit')[0]!.body).toMatchObject({ status: 'inactive', expires_at: null, username: '' })
    expect(writes('edit')[0]!.body).not.toHaveProperty('password')
  })
})

