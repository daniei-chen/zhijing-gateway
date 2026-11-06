import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import RedeemView from '@/views/admin/RedeemView.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Select from '@/components/common/Select.vue'
import { apiClient } from '@/api/client'
import { replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), clipboard: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: feedback.success, showError: feedback.error, showInfo: feedback.info }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
vi.mock('@/api/admin', async () => ({ adminAPI: {
  redeem: (await import('@/api/admin/redeem')).default,
  groups: { getAll: async () => [{ id: 11, name: 'Synthetic subscription', platform: 'openai', subscription_type: 'subscription', rate_multiplier: 1 }] },
} }))

// Table/layout presentation follows the author fixture; Select, BaseDialog,
// native forms, actual redeem API, and shared Axios client stay real.
const table = defineComponent({
  props: ['columns', 'data'],
  setup(props, { slots }) {
    return () => h('table', [h('tbody', props.data.map((row: { id: number; [key: string]: unknown }) => h('tr', { 'data-row': row.id },
      props.columns.map((column: { key: string }) => h('td', slots[`cell-${column.key}`]?.({ row, value: row[column.key] }))))))])
  },
})
type Wire = { method: string; path: string; body: unknown }
const requests: Wire[] = []
const wrappers: VueWrapper[] = []
const originalAdapter = apiClient.defaults.adapter
let generateReply: (() => Promise<unknown>) | undefined
let batchReply: (() => Promise<unknown>) | undefined
const syntheticCode = { id: 1, code: 'SYNTHETIC-KEYBOARD-094', type: 'balance', value: 10, status: 'unused', used_by: null, used_at: null, expires_at: null, created_at: '2026-01-01T00:00:00Z' }
const body = () => new DOMWrapper(document.body)
function namedButton(root: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  const button = root.findAll<HTMLButtonElement>('button').find(item => item.text() === label)
  expect(button, label).toBeDefined()
  return button!
}
async function click(button: HTMLButtonElement) {
  button.focus(); button.click(); await flushPromises(); await new Promise(resolve => setTimeout(resolve, 60)); await nextTick()
}
async function press(key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  document.activeElement!.dispatchEvent(event)
  await flushPromises(); await new Promise(resolve => setTimeout(resolve, 60)); await nextTick()
  return event
}
async function render() {
  const wrapper = mount(RedeemView, { attachTo: document.body, global: { stubs: {
    AppLayout: { template: '<main><slot/></main>' },
    TablePageLayout: { template: '<div><slot name="filters"/><slot name="table"/><slot name="pagination"/></div>' },
    DataTable: table, Pagination: true, GroupBadge: true, GroupOptionItem: true, Icon: true,
  } } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
async function openGenerator(wrapper: VueWrapper) {
  const opener = namedButton(wrapper, 'admin.redeem.generateCodes').element
  await click(opener)
  const form = body().findAll<HTMLFormElement>('form').find(item => item.attributes('data-test') !== 'batch-update-form')!
  expect(form.exists()).toBe(true)
  return { opener, form }
}
async function openBatch(wrapper: VueWrapper) {
  await wrapper.get('[data-test="select-code"]').setValue(true)
  const opener = wrapper.get<HTMLButtonElement>('[data-test="batch-update-open"]').element
  await click(opener)
  return { opener, form: body().get<HTMLFormElement>('[data-test="batch-update-form"]') }
}
function panelFor(form: { element: HTMLFormElement }) {
  return form.element.closest<HTMLElement>('[role="dialog"]') ?? form.element.parentElement!
}
async function openResult(wrapper: VueWrapper) {
  const { opener, form } = await openGenerator(wrapper)
  await click(namedButton(form, 'admin.redeem.generate').element)
  const textarea = body().get<HTMLTextAreaElement>('textarea[readonly]')
  return { opener, textarea, panel: textarea.element.closest<HTMLElement>('[role="dialog"]') ?? textarea.element.parentElement!.parentElement!.parentElement! }
}
const mutations = () => requests.filter(request => request.method !== 'GET')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); requests.length = 0; generateReply = undefined; batchReply = undefined
  Object.values(feedback).forEach(mock => mock.mockReset())
  feedback.clipboard.mockResolvedValue(undefined)
  replaceAuthSession({ accessToken: 'synthetic-keyboard-admin-094', user: { id: 7 } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: feedback.clipboard } })
  vi.stubGlobal('isSecureContext', true)
  // jsdom has no layout; connected and visible controls need a geometry signal
  // so the production focus trap can evaluate its ordinary visibility guard.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') && getComputedStyle(this).display !== 'none' ? [new DOMRect(0, 0, 80, 24)] : []) as unknown as DOMRectList
  })
  apiClient.defaults.adapter = async config => {
    const request = { method: String(config.method).toUpperCase(), path: String(config.url), body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    requests.push(request)
    let value: unknown
    if (request.path === '/admin/redeem-codes' && request.method === 'GET') value = { items: [syntheticCode], total: 1, page: 1, page_size: 20, pages: 1 }
    else if (request.path === '/admin/redeem-codes/generate' && request.method === 'POST') value = generateReply ? await generateReply() : [syntheticCode]
    else if (request.path === '/admin/redeem-codes/batch-update' && request.method === 'POST') value = batchReply ? await batchReply() : { updated: 1, message: 'OK' }
    else throw new Error(`Unexpected synthetic wire ${request.method} ${request.path}`)
    return { data: { code: 0, data: value }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.classList.remove('modal-open')
})

describe('Redeem manual-shell migration: actual native keyboard contracts', () => {
  it('moves focus into the named Generate dialog immediately after the toolbar trigger opens it', async () => {
    const wrapper = await render(); const { opener, form } = await openGenerator(wrapper)
    expect(panelFor(form).contains(document.activeElement)).toBe(true)
    const dialog = form.element.closest('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog!.getAttribute('aria-labelledby')!)?.textContent).toBe('admin.redeem.generateCodesTitle')
    expect(document.activeElement).not.toBe(opener)
    expect(mutations()).toEqual([])
  })

  it('cancels Generate with Escape, returns to its toolbar trigger, and sends no command', async () => {
    const wrapper = await render(); const { opener, form } = await openGenerator(wrapper)
    form.get<HTMLInputElement>('input[id$="-generate-count"]').element.focus()
    await press('Escape')
    expect(document.querySelector('input[id$="-generate-count"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(mutations()).toEqual([])
  })

  it('wraps Tab and Shift+Tab at the Generate dialog boundaries', async () => {
    const wrapper = await render(); const { form } = await openGenerator(wrapper)
    const panel = panelFor(form)
    const candidates = [...panel.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]')].filter(item => item.tabIndex >= 0 && !item.matches(':disabled'))
    const first = candidates[0], last = candidates.at(-1)!
    last.focus(); const forward = await press('Tab')
    expect(forward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
    first.focus(); const backward = await press('Tab', true)
    expect(backward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
  })

  it('moves focus into Batch and Escape returns to the selected-row batch trigger without writing', async () => {
    const wrapper = await render(); const { opener, form } = await openBatch(wrapper)
    expect(panelFor(form).contains(document.activeElement)).toBe(true)
    form.get<HTMLInputElement>('[data-test="batch-field-status"]').element.focus()
    await press('Escape')
    expect(document.querySelector('[data-test="batch-update-form"]')).toBeNull()
    expect(document.activeElement).toBe(opener); expect(mutations()).toEqual([])
  })

  it('moves focus into Result then Escape returns to the persistent Generate toolbar trigger', async () => {
    const wrapper = await render(); const { opener, textarea, panel } = await openResult(wrapper)
    expect(panel.contains(document.activeElement)).toBe(true)
    textarea.element.focus(); await press('Escape')
    expect(document.querySelector('textarea[readonly]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(mutations()).toEqual([{ method: 'POST', path: '/admin/redeem-codes/generate', body: { count: 1, type: 'balance', value: 10 } }])
  })

  it('lets Select consume the first Escape and only the second Escape dismiss Generate', async () => {
    const wrapper = await render(); const { opener, form } = await openGenerator(wrapper)
    const trigger = form.get<HTMLButtonElement>('button[id$="-generate-type"]').element
    await click(trigger)
    expect(document.activeElement?.getAttribute('role')).toBe('listbox')
    await press('Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.querySelector('input[id$="-generate-count"]')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    await press('Escape')
    expect(document.querySelector('input[id$="-generate-count"]')).toBeNull()
    expect(document.activeElement).toBe(opener); expect(mutations()).toEqual([])
  })

  it('invalidates pending Generate presentation on Escape without pretending the already-sent POST was withdrawn', async () => {
    const pending = deferred<unknown>(); generateReply = () => pending.promise
    const wrapper = await render(); const { form } = await openGenerator(wrapper)
    await click(namedButton(form, 'admin.redeem.generate').element)
    expect(mutations()).toHaveLength(1)
    form.get<HTMLInputElement>('input[id$="-generate-count"]').element.focus(); await press('Escape')
    expect(document.querySelector('input[id$="-generate-count"]')).toBeNull()
    pending.resolve([syntheticCode]); await flushPromises()
    expect(document.querySelector('textarea[readonly]')).toBeNull()
    expect(mutations()).toHaveLength(1); expect(feedback.error).not.toHaveBeenCalled()
  })

  it.each(['batch', 'result'] as const)('traps both Tab boundaries inside the %s dialog', async kind => {
    const wrapper = await render()
    const panel = kind === 'batch' ? panelFor((await openBatch(wrapper)).form) : (await openResult(wrapper)).panel
    const candidates = [...panel.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]')].filter(item => item.tabIndex >= 0 && !item.matches(':disabled'))
    const first = candidates[0], last = candidates.at(-1)!
    last.focus(); expect((await press('Tab')).defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
    first.focus(); expect((await press('Tab', true)).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
  })

  it('closes a pending Batch with Escape and leaves a newly opened draft owned by its new dialog', async () => {
    const pending = deferred<unknown>()
    batchReply = () => pending.promise
    const wrapper = await render(); const { form } = await openBatch(wrapper)
    await form.get('[data-test="batch-field-notes"]').setValue(true)
    await form.get('[data-test="batch-notes-input"]').setValue('Synthetic old batch')
    await click(form.get<HTMLButtonElement>('[data-test="batch-update-submit"]').element)
    await press('Escape')
    expect(document.querySelector('[data-test="batch-update-form"]')).toBeNull()
    const reopen = wrapper.findAll<HTMLButtonElement>('button').find(item => item.text() === 'admin.redeem.batchUpdate' && !item.element.disabled)
    expect(reopen).toBeDefined(); await click(reopen!.element)
    const reopened = body().get('[data-test="batch-update-form"]')
    await reopened.get('[data-test="batch-field-notes"]').setValue(true)
    await reopened.get('[data-test="batch-notes-input"]').setValue('Synthetic new batch draft')
    pending.resolve({ updated: 1, message: 'OK' }); await flushPromises()
    expect(reopened.get<HTMLTextAreaElement>('[data-test="batch-notes-input"]').element.value).toBe('Synthetic new batch draft')
    expect(mutations()).toEqual([{ method: 'POST', path: '/admin/redeem-codes/batch-update', body: { ids: [1], fields: { notes: 'Synthetic old batch' } } }])
    expect(feedback.success).not.toHaveBeenCalled()
  })
})

describe('three shells retain their ordinary native form wiring', () => {
  it('retains balance form fields and opens the actual generated result text after one native submit', async () => {
    const wrapper = await render(); const { form } = await openGenerator(wrapper)
    await form.get('input[id$="-generate-value"]').setValue(27.5)
    await form.get('input[id$="-generate-count"]').setValue(2)
    await click(namedButton(form, 'admin.redeem.generate').element)
    expect(mutations()).toEqual([{ method: 'POST', path: '/admin/redeem-codes/generate', body: { count: 2, type: 'balance', value: 27.5 } }])
    expect(body().get<HTMLTextAreaElement>('textarea[readonly]').element.value).toBe('SYNTHETIC-KEYBOARD-094')
    await click(namedButton(body(), 'admin.redeem.copyAll').element)
    expect(feedback.clipboard).toHaveBeenCalledWith('SYNTHETIC-KEYBOARD-094')
  })

  it('retains checked Batch fields and literal original batch-update wire payload', async () => {
    const wrapper = await render(); const { form } = await openBatch(wrapper)
    await form.get('[data-test="batch-field-status"]').setValue(true)
    await form.get('[data-test="batch-field-notes"]').setValue(true)
    await form.get('[data-test="batch-notes-input"]').setValue('Synthetic keyboard maintenance')
    await click(form.get<HTMLButtonElement>('[data-test="batch-update-submit"]').element)
    expect(mutations()).toEqual([{ method: 'POST', path: '/admin/redeem-codes/batch-update', body: { ids: [1], fields: { status: 'disabled', notes: 'Synthetic keyboard maintenance' } } }])
    expect(document.querySelector('[data-test="batch-update-form"]')).toBeNull()
  })

  it('keeps Generate cancel as a draft-preserving action without an implicit generation', async () => {
    const wrapper = await render(); const { form } = await openGenerator(wrapper)
    await form.get('input[id$="-generate-value"]').setValue(36.25)
    await click(namedButton(form, 'common.cancel').element)
    const reopened = await openGenerator(wrapper)
    expect(reopened.form.get<HTMLInputElement>('input[id$="-generate-value"]').element.value).toBe('36.25')
    expect(mutations()).toEqual([])
  })

  it('keeps Batch cancel as a no-write action and resets checked fields at the next explicit open', async () => {
    const wrapper = await render(); const { form } = await openBatch(wrapper)
    await form.get('[data-test="batch-field-notes"]').setValue(true)
    await form.get('[data-test="batch-notes-input"]').setValue('Synthetic abandoned draft')
    await click(namedButton(form, 'common.cancel').element)
    await click(wrapper.get<HTMLButtonElement>('[data-test="batch-update-open"]').element)
    expect(body().get<HTMLInputElement>('[data-test="batch-field-notes"]').element.checked).toBe(false)
    expect(document.querySelector('[data-test="batch-notes-input"]')).toBeNull(); expect(mutations()).toEqual([])
  })

  it.each(['generate', 'batch', 'result'] as const)('retains outside-click cancellation for the %s shell and returns to its opener', async kind => {
    const wrapper = await render()
    const opened = kind === 'batch' ? await openBatch(wrapper) : kind === 'result' ? await openResult(wrapper) : await openGenerator(wrapper)
    const dialog = body().get<HTMLElement>('[role="dialog"]')
    dialog.element.click(); await flushPromises(); await new Promise(resolve => setTimeout(resolve, 60))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opened.opener)
    expect(mutations()).toHaveLength(kind === 'result' ? 1 : 0)
  })
})

describe('actual BaseDialog migration controls, without page or common source edits', () => {
  async function host(withSelect: boolean) {
    const Host = defineComponent({ setup() {
      const show = ref(false), value = ref('alpha')
      return () => h('div', [h('button', { 'data-host-open': '', onClick: () => { show.value = true } }, 'Open synthetic dialog'),
        h(BaseDialog, { show: show.value, title: 'Synthetic base control', closeOnClickOutside: true, onClose: () => { show.value = false } }, {
          default: () => [withSelect ? h(Select, { id: 'synthetic-base-select-094', modelValue: value.value, options: [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }], 'onUpdate:modelValue': (next: unknown) => { value.value = String(next) } }) : h('input', { 'aria-label': 'Synthetic base input' }), h('button', { type: 'button' }, 'Last synthetic control')],
        })])
    } })
    const wrapper = mount(Host, { attachTo: document.body, global: { stubs: { Icon: true } } })
    wrappers.push(wrapper)
    const opener = wrapper.get<HTMLButtonElement>('[data-host-open]').element
    await click(opener)
    return { opener, wrapper }
  }

  it('proves BaseDialog alone focuses, traps both Tab boundaries, and returns focus after Escape', async () => {
    const { opener } = await host(false)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input')]
    expect(dialog.contains(document.activeElement)).toBe(true)
    controls.at(-1)!.focus(); expect((await press('Tab')).defaultPrevented).toBe(true); expect(document.activeElement).toBe(controls[0])
    expect((await press('Tab', true)).defaultPrevented).toBe(true); expect(document.activeElement).toBe(controls.at(-1))
    await press('Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener)
  })

  it('does not dismiss BaseDialog when its actual portalled Select consumes the first Escape', async () => {
    await host(true)
    const trigger = document.getElementById('synthetic-base-select-094') as HTMLButtonElement
    await click(trigger)
    expect(document.activeElement?.getAttribute('role')).toBe('listbox')
    const firstEscape = await press('Escape')
    expect(firstEscape.defaultPrevented).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await press('Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
