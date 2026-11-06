import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AccountTestModal from '../AccountTestModal.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'
import type { Account } from '@/types'

const copy = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin', async () => ({ adminAPI: {
  accounts: (await vi.importActual<typeof import('@/api/admin/accounts')>('@/api/admin/accounts')).accountsAPI
} }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: copy }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({
  t: (key: string, values?: Record<string, unknown>) => key === 'common.selectedFile' ? `${key}:${values?.name}` : key
}) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))

const views: VueWrapper[] = []
const originalAdapter = apiClient.defaults.adapter
let models: Array<{ id: string; display_name: string }>
let modelReads: string[] = []
let fetches: Array<{ path: string; body: Record<string, unknown>; signal?: AbortSignal | null }> = []
let events: Array<Record<string, unknown>> = []
let modelReply: (path: string) => Promise<typeof models>
let responseStatus = 200
let fetchFailure: unknown
const dom = () => new DOMWrapper(document.body)
function account(platform = 'openai', id = 404): Account {
  return { id, name: 'Synthetic native probe', platform, type: 'apikey', status: 'active', credentials: {}, extra: {} } as Account
}
async function render(platform = 'openai', show = true) {
  models = models.filter(model => platform === 'grok' ? model.id.startsWith('grok')
    : platform === 'gemini' ? model.id.startsWith('gemini') : model.id.startsWith('gpt'))
  const view = mount(AccountTestModal, {
    attachTo: document.body, props: { show, account: account(platform) },
    global: { stubs: { Icon: true, Transition: true }, mocks: { $t: (key: string) => key } }
  })
  views.push(view)
  if (!show) await view.setProps({ show: true })
  await flushPromises()
  return view
}
function start() {
  const found = dom().findAll('.modal-footer button').at(-1)
  expect(found, 'public start/retry button').toBeDefined()
  return found!
}
async function run() {
  expect((start().element as HTMLButtonElement).disabled).toBe(false)
  ;(start().element as HTMLButtonElement).click()
  await flushPromises()
}
async function mode(label: string) {
  const trigger = dom().findAll('button[aria-haspopup="true"]').find(node => node.text().startsWith('admin.accounts.grok.testMode'))
  expect(trigger).toBeDefined()
  await trigger!.trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const option = dom().findAll('[role="option"]').find(node => node.text() === `admin.accounts.grok.${label}`)
  expect(option).toBeDefined()
  ;(option!.element as HTMLElement).click()
  await flushPromises()
}
async function upload(kind: 'image' | 'audio', file?: File) {
  const input = dom().get(`input[type="file"][accept${kind === 'image' ? '^="image/' : '^="audio/'}"]`).element as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}
async function chooseModel(label: string) {
  const trigger = dom().get('button[aria-label="admin.accounts.selectTestModel"]')
  await trigger.trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  const option = dom().findAll('[role="option"]').find(node => node.text() === label)
  expect(option, `model option ${label}`).toBeDefined()
  ;(option!.element as HTMLElement).click()
  await flushPromises()
}
beforeEach(() => {
  modelReads = []
  fetches = []
  copy.mockReset()
  models = [
    { id: 'grok-4.5', display_name: 'Synthetic Grok text' },
    { id: 'grok-imagine-image', display_name: 'Synthetic Grok image' },
    { id: 'grok-imagine-video', display_name: 'Synthetic Grok video' },
    { id: 'gpt-6.1-sol', display_name: 'Synthetic OpenAI text' },
    { id: 'gpt-image-2', display_name: 'Synthetic OpenAI image' },
    { id: 'gemini-2.5-flash', display_name: 'Synthetic Gemini text' },
    { id: 'gemini-3.1-flash-image', display_name: 'Synthetic Gemini image' }
  ]
  modelReply = async () => models
  responseStatus = 200
  fetchFailure = undefined
  events = [{ type: 'test_start', model: 'synthetic-stream-model' },
    { type: 'content', text: 'Synthetic streamed result' }, { type: 'test_complete', success: true }]
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-probe-release-admin', user: { id: 404, role: 'admin' } })
  apiClient.defaults.adapter = async config => {
    modelReads.push(String(config.url))
    expect(String(config.url)).toMatch(/^\/admin\/accounts\/40[45]\/models$/)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: await modelReply(String(config.url)) } }
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    fetches.push({ path, body: JSON.parse(String(init.body)), signal: init.signal })
    if (fetchFailure !== undefined) throw fetchFailure
    const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    return new Response(text, { status: responseStatus, headers: { 'Content-Type': 'text/event-stream' } })
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('native administrator account probe with a synthetic actual stream transport', () => {
  it('loads available models on the first visible conditional mount used by AccountsView and enables a normal text probe', async () => {
    await render('openai')
    expect.soft(modelReads).toEqual(['/admin/accounts/404/models'])
    expect((start().element as HTMLButtonElement).disabled).toBe(false)
    await run()
    expect(fetches).toHaveLength(1)
    expect(dom().text()).toContain('Synthetic streamed result')
    expect(dom().text()).toContain('admin.accounts.testCompleted')
  })
  it.each([
    ['testModeSearch', 'search'], ['testModeTTS', 'tts'], ['testModeRealtime', 'realtime']
  ])('submits the standalone %s mode without inventing a model dependency', async (label, expectedMode) => {
    await render('grok')
    await mode(label!)
    const prompt = dom().find('textarea')
    if (prompt.exists()) await prompt.setValue(' Synthetic standalone request ')
    await run()
    expect(fetches).toHaveLength(1)
    expect(fetches[0]!.path).toContain('/admin/accounts/404/test')
    expect(fetches[0]!.body).toEqual({
      mode: expectedMode, model_id: '', prompt: expectedMode === 'realtime' ? '' : 'Synthetic standalone request'
    })
    expect(dom().text()).toContain('Synthetic streamed result')
    expect(dom().text()).toContain('admin.accounts.testCompleted')
    expect(fetches[0]!.signal?.aborted).toBe(true)
  })
  it('retains the normal public false-to-true reopening contract without issuing duplicate model reads', async () => {
    const view = await render('openai', false)
    expect(modelReads).toEqual(['/admin/accounts/404/models'])
    await view.setProps({ show: false })
    await view.setProps({ show: true })
    await flushPromises()
    expect(modelReads).toEqual(['/admin/accounts/404/models', '/admin/accounts/404/models'])
    await run()
    expect(fetches[0]!.body).toEqual({ model_id: 'gpt-6.1-sol', prompt: '', mode: 'default' })
  })
  it('discards a model list that arrives after the visible close command', async () => {
    let resolve!: (value: typeof models) => void
    modelReply = () => new Promise(a => { resolve = a })
    const view = await render()
    const close = dom().findAll('.modal-footer button')[0]!.element as HTMLButtonElement
    close.click()
    await view.setProps({ show: false })
    resolve([{ id: 'gpt-stale', display_name: 'Synthetic obsolete model' }])
    await flushPromises()
    expect(view.emitted('close')).toHaveLength(1)
    expect(dom().text()).not.toContain('Synthetic obsolete model')
    expect(fetches).toEqual([])
  })
  it('keeps the newest target model choices when an older account list completes last', async () => {
    let resolve!: (value: typeof models) => void
    modelReply = path => path.includes('/404/') ? new Promise(a => { resolve = a })
      : Promise.resolve([{ id: 'gpt-new', display_name: 'Synthetic newest model' }])
    const view = await render()
    await view.setProps({ account: account('openai', 405) })
    await flushPromises()
    expect(dom().text()).toContain('Synthetic newest model')
    resolve([{ id: 'gpt-stale', display_name: 'Synthetic obsolete model' }])
    await flushPromises()
    expect(dom().text()).not.toContain('Synthetic obsolete model')
    await run()
    expect(fetches[0]!.path).toContain('/admin/accounts/405/test')
    expect(fetches[0]!.body.model_id).toBe('gpt-new')
  })
  it.each(['image', 'video'])('sends a native Grok %s request with its selected model, edited prompt and uploaded image', async selectedMode => {
    await render('grok')
    await mode(selectedMode === 'image' ? 'testModeImage' : 'testModeVideo')
    await dom().get('textarea').setValue(' Synthetic media prompt ')
    await upload('image', new File(['synthetic image'], 'synthetic.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(true))
    await run()
    expect(fetches[0]!.body).toMatchObject({ mode: selectedMode, prompt: 'Synthetic media prompt',
      model_id: selectedMode === 'image' ? 'grok-imagine-image' : 'grok-imagine-video' })
    expect(String(fetches[0]!.body.image_data_url)).toMatch(/^data:image\/png;base64,/)
    expect(fetches[0]!.body).not.toHaveProperty('audio_data_url')
    expect(dom().text()).toContain(selectedMode === 'image' ? 'admin.accounts.sendingImageRequest' : 'admin.accounts.sendingVideoRequest')
  })
  it('sends native transcription audio without a model or unrelated prompt and clears the upload when the mode changes', async () => {
    await render('grok')
    await mode('testModeSTT')
    await upload('audio', new File(['synthetic audio'], 'synthetic.wav', { type: 'audio/wav' }))
    await vi.waitFor(() => expect(dom().text()).toContain('common.selectedFile:synthetic.wav'))
    await run()
    expect(fetches[0]!.body).toMatchObject({ mode: 'stt', model_id: '', prompt: '' })
    expect(String(fetches[0]!.body.audio_data_url)).toMatch(/^data:audio\/wav;base64,/)
    await mode('testModeSearch')
    expect(dom().text()).not.toContain('synthetic.wav')
    await run()
    expect(fetches[1]!.body).not.toHaveProperty('audio_data_url')
  })
  it('honors a deliberately selected OpenAI compact mode in the actual stream request', async () => {
    await render('openai')
    const trigger = dom().findAll('button[aria-haspopup="true"]').find(node => node.text() === 'admin.accounts.openai.testModeDefault')!
    await trigger.trigger('click')
    await flushPromises()
    await dom().findAll('[role="option"]').find(node => node.text() === 'admin.accounts.openai.testModeCompact')!.trigger('click')
    await run()
    expect(fetches[0]!.body).toEqual({ model_id: 'gpt-6.1-sol', prompt: '', mode: 'compact' })
  })
  it.each(['openai', 'gemini'])('lets an administrator choose a real %s image model, edit the prompt and inspect the returned image lightbox', async platform => {
    await render(platform)
    await chooseModel(platform === 'openai' ? 'Synthetic OpenAI image' : 'Synthetic Gemini image')
    await dom().get('textarea').setValue(' Synthetic edited illustration ')
    events = [{ type: 'test_start' }, { type: 'image', image_url: 'data:image/png;base64,U1lOVEhFVElD', mime_type: 'image/png' }, { type: 'test_complete', success: true }]
    await run()
    expect(fetches[0]!.body.prompt).toBe('Synthetic edited illustration')
    expect(fetches[0]!.body.model_id).toBe(platform === 'openai' ? 'gpt-image-2' : 'gemini-3.1-flash-image')
    expect(dom().get('img[alt="admin.accounts.imagePreviewAlt"]').attributes('src')).toBe('data:image/png;base64,U1lOVEhFVElD')
    await dom().get('img[alt="admin.accounts.imagePreviewAlt"]').trigger('click')
    expect(dom().find('img[alt="admin.accounts.imageLightboxAlt"]').exists()).toBe(true)
    const overlay = dom().get('img[alt="admin.accounts.imageLightboxAlt"]').element.parentElement!
    ;(overlay.querySelector('button') as HTMLButtonElement).click()
    await flushPromises()
    expect(dom().find('img[alt="admin.accounts.imageLightboxAlt"]').exists()).toBe(false)
  })
  it('renders audio and video stream records with playable synthetic sources and copies the complete textual transcript', async () => {
    await render('grok')
    events = [
      { type: 'test_start', model: 'synthetic-grok' }, { type: 'status', text: 'Synthetic processing' },
      { type: 'content', text: 'Synthetic answer' },
      { type: 'audio', audio_url: 'data:audio/wav;base64,U1lO', mime_type: 'audio/wav' },
      { type: 'video', video_url: 'https://video.example.test/synthetic.mp4', mime_type: 'video/mp4' },
      { type: 'test_complete', success: true }
    ]
    await run()
    expect(dom().get('audio').attributes('src')).toBe('data:audio/wav;base64,U1lO')
    expect(dom().get('video').attributes('src')).toBe('https://video.example.test/synthetic.mp4')
    expect(dom().text()).toContain('Synthetic processing')
    await dom().get('button[title="admin.accounts.copyOutput"]').trigger('click')
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Synthetic answer'), 'admin.accounts.outputCopied')
  })
  it.each([
    [{ type: 'test_complete', success: false, error: 'Synthetic test rejected' }, 'Synthetic test rejected'],
    [{ type: 'test_complete', success: false }, 'admin.accounts.testFailed'],
    [{ type: 'error' }, 'common.unknownError']
  ])('retains partial text when the terminal stream event reports failure %#', async (terminal, message) => {
    await render('openai')
    events = [{ type: 'content', text: 'Synthetic partial output' }, terminal]
    await run()
    expect(dom().text()).toContain(message)
    expect(dom().text()).toContain('Synthetic partial output')
    expect(start().text()).toBe('admin.accounts.retry')
    expect((start().element as HTMLButtonElement).disabled).toBe(false)
  })
  it('recovers an HTTP stream failure through the public retry button without rereading model choices', async () => {
    await render()
    responseStatus = 503
    await run()
    expect(dom().text()).toContain('HTTP error! status: 503')
    responseStatus = 200
    await run()
    expect(fetches).toHaveLength(2)
    expect(modelReads).toHaveLength(1)
    expect(dom().text()).toContain('admin.accounts.testCompleted')
  })
  it.each(['image', 'audio'] as const)('shows a local oversize %s upload error before any stream request', async kind => {
    await render('grok')
    await mode(kind === 'image' ? 'testModeImage' : 'testModeSTT')
    await upload(kind, new File([new Uint8Array(6 * 1024 * 1024 + 1)], `synthetic.${kind}`, { type: `${kind}/${kind === 'image' ? 'png' : 'wav'}` }))
    expect(dom().text()).toContain('admin.accounts.grok.mediaTooLarge')
    expect(fetches).toEqual([])
    expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(false)
  })
  it('shows a browser file-read failure and accepts a corrected image without retaining a broken preview', async () => {
    await render('grok')
    await mode('testModeImage')
    const failed = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent('error'))
    })
    await upload('image', new File(['synthetic'], 'broken.png', { type: 'image/png' }))
    expect(dom().text()).toContain('admin.accounts.grok.fileReadFailed')
    expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(false)
    failed.mockRestore()
    await upload('image', new File(['synthetic'], 'corrected.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(true))
    await run()
    expect(String(fetches[0]!.body.image_data_url)).toMatch(/^data:image\/png;base64,/)
  })
  it('clears a native file selection and does not send the previously uploaded image on a later text-to-image request', async () => {
    await render('grok')
    await mode('testModeImage')
    await upload('image', new File(['synthetic'], 'removed.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(true))
    await upload('image')
    expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(false)
    await run()
    expect(fetches[0]!.body).not.toHaveProperty('image_data_url')
  })
  it('resets the image and prompt when the user deliberately changes to video mode', async () => {
    await render('grok')
    await mode('testModeImage')
    await dom().get('textarea').setValue('Previous image prompt')
    await upload('image', new File(['synthetic'], 'old-frame.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(dom().find('img[alt="admin.accounts.grok.uploadPreviewAlt"]').exists()).toBe(true))
    await mode('testModeVideo')
    expect((dom().get('textarea').element as HTMLTextAreaElement).value).toBe('admin.accounts.videoPromptDefault')
    expect(dom().text()).toContain('admin.accounts.grok.videoFirstFrameLabel')
    expect(dom().text()).not.toContain('old-frame.png')
    await run()
    expect(fetches[0]!.body.mode).toBe('video')
    expect(fetches[0]!.body).not.toHaveProperty('image_data_url')
  })
  it('ignores empty media/status records while retaining a successful final result', async () => {
    await render()
    events = [{ type: 'test_start' }, { type: 'image' }, { type: 'audio' }, { type: 'video' }, { type: 'status' }, { type: 'test_complete', success: true }]
    await run()
    expect(dom().find('audio').exists()).toBe(false)
    expect(dom().find('video').exists()).toBe(false)
    expect(dom().find('img[alt="admin.accounts.imagePreviewAlt"]').exists()).toBe(false)
    expect(dom().text()).toContain('admin.accounts.testCompleted')
  })
  it('renders the established unknown-error message for a transport rejection that has no Error object', async () => {
    await render()
    fetchFailure = 'synthetic non-Error rejection'
    await run()
    expect(dom().text()).toContain('common.unknownError')
    expect((start().element as HTMLButtonElement).disabled).toBe(false)
  })
})
