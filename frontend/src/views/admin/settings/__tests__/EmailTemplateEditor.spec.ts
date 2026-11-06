import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import EmailTemplateEditor from '../EmailTemplateEditor.vue'
import { replaceAuthSession } from '@/api/authSession'

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), preview: vi.fn(), restore: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/api', () => ({ adminAPI: { settings: { getEmailTemplates: api.list, getEmailTemplate: api.get, updateEmailTemplate: api.update, previewEmailTemplate: api.preview, restoreOfficialEmailTemplate: api.restore } } }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showSuccess: api.success, showError: api.error }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
const views: VueWrapper[] = []
const template = (event: string, subject = `Official ${event}`) => ({ event, locale: 'en', subject, html: `<p>${subject}</p>`, is_custom: false, placeholders: [] })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
async function render() { const view = mount(EmailTemplateEditor); views.push(view); await flushPromises(); return view }
async function click(view: VueWrapper, key: string) { await view.findAll('button').find(button => button.text() === `admin.settings.emailTemplates.${key}`)!.trigger('click'); await flushPromises() }
beforeEach(() => {
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-template-session', user: { id: 7 } })
  Object.values(api).forEach(mock => mock.mockReset())
  api.list.mockResolvedValue({ events: ['verification_code', 'password_reset'], locales: ['en'] })
  api.get.mockImplementation((event: string) => Promise.resolve(template(event)))
  api.preview.mockImplementation((request: { subject: string, html: string }) => Promise.resolve({ subject: request.subject, html: request.html }))
  api.update.mockImplementation((event: string, _locale: string, request: { subject: string }) => Promise.resolve(template(event, request.subject)))
  api.restore.mockImplementation((event: string) => Promise.resolve(template(event)))
})
afterEach(() => { views.splice(0).forEach(view => view.unmount()); vi.restoreAllMocks() })

describe('EmailTemplateEditor request ownership', () => {
  it('does not apply an old save result to the newly selected event', async () => {
    const pending = deferred<ReturnType<typeof template>>()
    const view = await render()
    api.update.mockReturnValueOnce(pending.promise)
    await view.get('#email-template-subject').setValue('Synthetic old event draft')
    await click(view, 'save')
    expect(view.get<HTMLSelectElement>('#email-template-event').element.disabled).toBe(false)
    await view.get('#email-template-event').setValue('password_reset')
    await flushPromises()
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Official password_reset')
    pending.resolve(template('verification_code', 'Obsolete saved event'))
    await flushPromises()
    expect(view.get<HTMLSelectElement>('#email-template-event').element.value).toBe('password_reset')
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Official password_reset')
    expect(api.update).toHaveBeenCalledExactlyOnceWith('verification_code', 'en', expect.objectContaining({ subject: 'Synthetic old event draft' }))
  })

  it('does not let an old manual preview replace the newer saved draft preview', async () => {
    const pending = deferred<{ subject: string, html: string }>()
    const view = await render()
    api.preview.mockReturnValueOnce(pending.promise)
    await view.get('#email-template-subject').setValue('Synthetic old preview')
    await click(view, 'preview')
    await view.get('#email-template-subject').setValue('Synthetic current saved draft')
    await view.get('#email-template-html').setValue('<p>Synthetic current saved draft</p>')
    await click(view, 'save')
    expect(view.get('iframe').attributes('srcdoc')).toBe('<p>Synthetic current saved draft</p>')
    pending.resolve({ subject: 'Obsolete preview', html: '<p>Obsolete preview</p>' })
    await flushPromises()
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Synthetic current saved draft')
    expect(view.get('iframe').attributes('srcdoc')).toBe('<p>Synthetic current saved draft</p>')
  })

  it.each(['locale', 'draft', 'round-trip', 'login', 'unmount'] as const)('keeps the current editor when a save completes after changing %s', async change => {
    api.list.mockResolvedValue({ events: ['verification_code', 'password_reset'], locales: ['en', 'zh'] })
    const pending = deferred<ReturnType<typeof template>>()
    const view = await render()
    api.update.mockReturnValueOnce(pending.promise)
    await view.get('#email-template-subject').setValue('Submitted synthetic draft')
    await click(view, 'save')
    if (change === 'locale') { await view.get('#email-template-locale').setValue('zh'); await flushPromises() }
    if (change === 'draft') await view.get('#email-template-subject').setValue('New unsaved synthetic draft')
    if (change === 'round-trip') {
      await view.get('#email-template-event').setValue('password_reset')
      await flushPromises()
      await view.get('#email-template-event').setValue('verification_code')
      await flushPromises()
    }
    if (change === 'login') replaceAuthSession({ accessToken: 'synthetic-template-relogin', user: { id: 7 } })
    if (change === 'unmount') { view.unmount(); views.splice(views.indexOf(view), 1) }
    const currentSubject = change === 'unmount' ? '' : view.get<HTMLInputElement>('#email-template-subject').element.value
    const previewCount = api.preview.mock.calls.length
    pending.resolve(template('verification_code', 'Obsolete server canonical subject'))
    await flushPromises()
    if (change !== 'unmount') expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe(currentSubject)
    expect(api.preview).toHaveBeenCalledTimes(previewCount)
    expect(api.success).not.toHaveBeenCalled()
    expect(api.error).not.toHaveBeenCalled()
    if (change === 'draft') expect(view.findAll('button').find(button => button.text() === 'admin.settings.emailTemplates.save')!.attributes('disabled')).toBeUndefined()
  })

  it.each(['login', 'unmount'] as const)('does not continue template initialization after %s', async change => {
    const pending = deferred<{ events: string[], locales: string[] }>()
    api.list.mockReturnValueOnce(pending.promise)
    const view = await render()
    if (change === 'login') replaceAuthSession({ accessToken: 'synthetic-template-new-login', user: { id: 7 } })
    else { view.unmount(); views.splice(views.indexOf(view), 1) }
    pending.resolve({ events: ['verification_code'], locales: ['en'] })
    await flushPromises()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.error).not.toHaveBeenCalled()
  })

  it('does not toast an old save failure after the same user signs in again', async () => {
    const pending = deferred<ReturnType<typeof template>>()
    const view = await render()
    api.update.mockReturnValueOnce(pending.promise)
    await click(view, 'save')
    replaceAuthSession({ accessToken: 'synthetic-template-relogin-after-write', user: { id: 7 } })
    pending.reject(new Error('Obsolete write error'))
    await flushPromises()
    expect(api.error).not.toHaveBeenCalled()
    expect(api.success).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('ignores placeholder copy %s from the previous template selection', async outcome => {
    const pending = deferred<void>()
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockReturnValueOnce(pending.promise)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const view = await render()
      await view.findAll('button').find(button => button.text() === '{{site_name}}')!.trigger('click')
      expect(writeText).toHaveBeenCalledExactlyOnceWith('{{site_name}}')
      await view.get('#email-template-event').setValue('password_reset')
      await flushPromises()
      if (outcome === 'success') pending.resolve()
      else pending.reject(new Error('Obsolete clipboard rejection'))
      await flushPromises()
      expect(api.success).not.toHaveBeenCalled()
      expect(api.error).not.toHaveBeenCalled()
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})

describe('EmailTemplateEditor visible workflow contracts', () => {
  it('loads the selected language, edits the native fields, previews safely and saves the captured content', async () => {
    api.list.mockResolvedValue({ events: [{ value: 'verification_code', label: 'Synthetic verification', category: 'auth' }], locales: ['zh', 'en'] })
    const view = await render()
    expect(api.get).toHaveBeenCalledExactlyOnceWith('verification_code', 'en')
    expect(view.get<HTMLSelectElement>('#email-template-locale').element.value).toBe('en')
    await view.get('#email-template-subject').setValue('Synthetic subject {{site_name}}')
    await view.get('#email-template-html').setValue('<p>Synthetic {{verification_code}}</p>')
    await click(view, 'preview')
    expect(api.preview).toHaveBeenLastCalledWith({ event: 'verification_code', locale: 'en', subject: 'Synthetic subject {{site_name}}', html: '<p>Synthetic {{verification_code}}</p>' })
    expect(view.get('iframe').attributes()).toMatchObject({ sandbox: '', srcdoc: '<p>Synthetic {{verification_code}}</p>', title: 'admin.settings.emailTemplates.livePreview' })
    expect(api.update).not.toHaveBeenCalled()
    await click(view, 'save')
    expect(api.update).toHaveBeenCalledExactlyOnceWith('verification_code', 'en', { subject: 'Synthetic subject {{site_name}}', html: '<p>Synthetic {{verification_code}}</p>' })
    expect(api.success).toHaveBeenCalledExactlyOnceWith('admin.settings.emailTemplates.saveSuccess')
    expect(api.error).not.toHaveBeenCalled()
  })

  it('retains a failed save draft and lets the same captured payload be retried', async () => {
    const view = await render()
    api.update.mockRejectedValueOnce(new Error('Synthetic write failure'))
    await view.get('#email-template-subject').setValue('Synthetic retry subject')
    await click(view, 'save')
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Synthetic retry subject')
    expect(api.error).toHaveBeenCalledOnce()
    expect(api.success).not.toHaveBeenCalled()
    await click(view, 'save')
    expect(api.update.mock.calls[1]).toEqual(api.update.mock.calls[0])
    expect(api.success).toHaveBeenCalledExactlyOnceWith('admin.settings.emailTemplates.saveSuccess')
  })

  it('keeps preview failures retryable without saving or restoring a template', async () => {
    const view = await render()
    api.preview.mockRejectedValueOnce(new Error('Synthetic preview failure'))
    await view.get('#email-template-html').setValue('<p>Synthetic preview retry</p>')
    await click(view, 'preview')
    expect(api.error).toHaveBeenCalledOnce()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.restore).not.toHaveBeenCalled()
    await click(view, 'preview')
    expect(view.get('iframe').attributes('srcdoc')).toBe('<p>Synthetic preview retry</p>')
  })

  it('cancels restoration before any mutation, then restores the currently selected locale and preview', async () => {
    api.list.mockResolvedValue({ events: ['verification_code'], locales: ['en', 'zh'] })
    const view = await render()
    await view.get('#email-template-locale').setValue('zh')
    await flushPromises()
    await view.get('#email-template-subject').setValue('Synthetic unsaved draft')
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    await click(view, 'restoreOfficial')
    expect(api.restore).not.toHaveBeenCalled()
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Synthetic unsaved draft')
    await click(view, 'restoreOfficial')
    expect(api.restore).toHaveBeenCalledExactlyOnceWith('verification_code', 'zh')
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Official verification_code')
    expect(view.get('iframe').attributes('srcdoc')).toBe('<p>Official verification_code</p>')
    expect(api.success).toHaveBeenCalledExactlyOnceWith('admin.settings.emailTemplates.restoreSuccess')
  })

  it('retains a restore failure and ignores the previous restore response after switching events', async () => {
    const view = await render()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.restore.mockRejectedValueOnce(new Error('Synthetic restore failure'))
    await click(view, 'restoreOfficial')
    expect(api.error).toHaveBeenCalledOnce()
    api.error.mockClear()
    const pending = deferred<ReturnType<typeof template>>()
    api.restore.mockReturnValueOnce(pending.promise)
    await click(view, 'restoreOfficial')
    await view.get('#email-template-event').setValue('password_reset')
    await flushPromises()
    pending.resolve(template('verification_code', 'Obsolete restored template'))
    await flushPromises()
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Official password_reset')
    expect(api.success).not.toHaveBeenCalled()
    expect(api.error).not.toHaveBeenCalled()
  })

  it('clears the previous content after a locale load fails, then reloads explicitly by selecting another locale', async () => {
    api.list.mockResolvedValue({ events: ['verification_code'], locales: ['en', 'zh'] })
    const view = await render()
    api.get.mockRejectedValueOnce(new Error('Synthetic missing translation'))
    await view.get('#email-template-locale').setValue('zh')
    await flushPromises()
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('')
    expect(view.findAll('button').find(button => button.text() === 'admin.settings.emailTemplates.save')!.attributes('disabled')).toBeDefined()
    expect(api.error).toHaveBeenCalledOnce()
    await view.get('#email-template-locale').setValue('en')
    await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('verification_code', 'en')
    expect(view.get<HTMLInputElement>('#email-template-subject').element.value).toBe('Official verification_code')
    expect(api.update).not.toHaveBeenCalled()
  })
})
