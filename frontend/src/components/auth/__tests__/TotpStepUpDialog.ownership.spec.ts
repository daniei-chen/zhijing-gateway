/**
 * Public OTP inputs and parent lifecycle props drive the real dialog/useStepUp,
 * settingsAPI/totpAPI and Axios. All HTTP responses are synthetic; no credential,
 * provider, real login, grant revocation or production action is exercised.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import TotpStepUpDialog from '../TotpStepUpDialog.vue'
import { useStepUp } from '@/composables/useStepUp'
import { apiClient } from '@/api/client'
import { settingsAPI } from '@/api/admin/settings'
import { captureAuthSession, commitAuthTokenRotation, replaceAuthSession } from '@/api/authSession'

const feedback = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError: feedback.error }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: feedback.error }) }))
vi.mock('@/i18n', () => ({ getLocale: () => 'en', i18n: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
type Reply = { status: number; message?: string }
type Wire = { path: string; body: Record<string, unknown>; config: InternalAxiosRequestConfig }
let requests: Wire[]
let otpPending: ReturnType<typeof deferred<Reply>>[]
let settingsSuccesses: number
let host: VueWrapper | undefined
const previousAdapter = apiClient.defaults.adapter
const otpCalls = () => requests.filter(request => request.path === '/user/totp/step-up')
const settingsCalls = () => requests.filter(request => request.path === '/admin/settings')
function envelope(config: InternalAxiosRequestConfig, data: unknown, status = 200, message = '', reason = '') {
  const reply = { status, statusText: String(status), data: { code: status >= 400 ? 400 : 0, data, ...(message ? { message } : {}), ...(reason ? { reason } : {}) }, headers: {}, config }
  if (status >= 400) throw new AxiosError('Synthetic response', 'ERR_BAD_RESPONSE', config, undefined, reply)
  return reply
}
const Host = defineComponent({
  props: { target: { type: String, default: 'A' }, dialogMounted: { type: Boolean, default: true }, closeRevision: { type: Number, default: 0 }, openRawOnTarget: { type: Boolean, default: false } },
  setup(props) {
    const a = useStepUp(); const b = useStepUp()
    const stateA = ref('idle'); const stateB = ref('idle')
    const selected = computed(() => props.target === 'A' ? a : b)
    const stateFor = (name: string) => name === 'A' ? stateA : stateB
    function open(name: string, raw = false) {
      const controller = name === 'A' ? a : b; const state = stateFor(name); state.value = 'waiting'
      if (raw) void controller.prompt().then(value => { state.value = value ? 'verified' : 'cancelled' })
      else void controller.run(() => settingsAPI.updateSettings({ site_name: `110 synthetic ${name}` }))
        .then(() => { state.value = 'done' }, () => { state.value = 'cancelled' })
    }
    watch(() => props.closeRevision, () => selected.value.onCancel(), { flush: 'sync' })
    watch(() => [props.target, props.openRawOnTarget] as const, ([name, openRaw]) => { if (openRaw) open(name, true) })
    return () => h('main', [
      h('button', { id: 'open-a', onClick: () => open('A') }, 'Open A'),
      h('button', { id: 'open-b', onClick: () => open('B') }, 'Open B'),
      h('button', { id: 'raw-a', onClick: () => open('A', true) }, 'Raw A'),
      h('input', { id: 'outside', 'aria-label': 'Outside focus target' }),
      h('output', { id: 'status-a' }, stateA.value), h('output', { id: 'status-b' }, stateB.value),
      props.dialogMounted ? h(TotpStepUpDialog, { controller: selected.value }) : null,
    ])
  },
})
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); feedback.error.mockReset()
  replaceAuthSession({ accessToken: '110-synthetic-access', refreshToken: '110-synthetic-refresh', user: { id: 110 } })
  requests = []; otpPending = []; settingsSuccesses = 0
  apiClient.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(String(config.data)) as Record<string, unknown> : {}
    requests.push({ path: String(config.url), body, config })
    if (config.url === '/admin/settings') {
      if (settingsSuccesses > 0) { settingsSuccesses -= 1; return envelope(config, { site_name: body.site_name }) }
      return envelope(config, null, 403, '110 synthetic verification required', 'STEP_UP_REQUIRED')
    }
    if (config.url !== '/user/totp/step-up') throw new Error(`Unexpected synthetic endpoint ${config.url}`)
    const pending = deferred<Reply>(); otpPending.push(pending); const reply = await pending.promise
    return envelope(config, { verified: true, expires_in: 300 }, reply.status, reply.message)
  }
})
afterEach(async () => {
  host?.unmount(); host = undefined
  otpPending.forEach(pending => pending.resolve({ status: 200 })); await flushPromises()
  apiClient.defaults.adapter = previousAdapter; vi.restoreAllMocks(); document.body.innerHTML = ''
})
async function render(props: Record<string, unknown> = {}) { host = mount(Host, { props, attachTo: document.body }); await flushPromises(); return host }
async function open(name = 'a', raw = false) {
  await host!.get(`#${raw ? 'raw' : 'open'}-${name}`).trigger('click'); await flushPromises()
  expect(host!.find('[role="dialog"]').exists()).toBe(true)
}
const cells = () => host!.findAll<HTMLInputElement>('.z-stepup-code-grid input')
async function paste(code = '123456') {
  expect(cells()[0].element.matches(':disabled')).toBe(false)
  await cells()[0].trigger('paste', { clipboardData: { getData: () => code } }); await flushPromises()
}
async function reply(index: number, status: number, currentSuccess = false) {
  if (currentSuccess) settingsSuccesses += 1
  otpPending[index].resolve({ status, message: status >= 400 ? '110 synthetic OTP unavailable' : '' }); await flushPromises()
}
const contents = () => cells().map(input => input.element.value).join('')
const busy = () => cells().every(input => input.element.disabled)
function relogin() { replaceAuthSession({ accessToken: '110-synthetic-new-access', refreshToken: '110-synthetic-new-refresh', user: { id: 110 } }) }

describe('TOTP prompt ownership through real controllers and transport', () => {
  it('accepts six ordinary digit inputs once and retries the original action only after success', async () => {
    await render(); await open()
    for (const [index, value] of [...'123456'].entries()) await cells()[index].setValue(value)
    await flushPromises(); expect(otpCalls()).toHaveLength(1); expect(otpCalls()[0].body).toEqual({ code: '123456' }); expect(busy()).toBe(true)
    expect(host!.get('.z-stepup-panel button').attributes('disabled')).toBeDefined()
    await host!.get('.z-stepup-backdrop').trigger('click'); expect(host!.get('#status-a').text()).toBe('waiting')
    await reply(0, 200, true)
    expect(host!.get('#status-a').text()).toBe('done'); expect(settingsCalls()).toHaveLength(2); expect(host!.find('[role="dialog"]').exists()).toBe(false); expect(feedback.error).not.toHaveBeenCalled()
  })
  it('accepts paste and a one-time-code autofill without duplicate submissions', async () => {
    await render(); await open(); await paste('12 34-56'); expect(otpCalls()).toHaveLength(1)
    const hidden = host!.get<HTMLInputElement>('input[autocomplete="one-time-code"]')
    expect(hidden.element.disabled).toBe(false); await hidden.setValue('654321'); await flushPromises()
    expect(otpCalls()).toHaveLength(1); await reply(0, 200, true); expect(host!.get('#status-a').text()).toBe('done')
  })
  it('accepts a fresh one-time-code autofill as its ordinary input path', async () => {
    await render(); await open(); await host!.get('input[autocomplete="one-time-code"]').setValue('654321'); await flushPromises()
    expect(otpCalls().map(request => request.body)).toEqual([{ code: '654321' }]); await reply(0, 200, true)
    expect(host!.get('#status-a').text()).toBe('done')
  })
  it('shows a current 503, clears its own code, then allows refill and a successful explicit retry', async () => {
    await render(); await open(); await paste(); await reply(0, 503)
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith('110 synthetic OTP unavailable'); expect(contents()).toBe(''); expect(busy()).toBe(false); expect(document.activeElement).toBe(cells()[0].element)
    await paste('654321'); expect(otpCalls()).toHaveLength(2); await reply(1, 200, true)
    expect(host!.get('#status-a').text()).toBe('done'); expect(settingsCalls()).toHaveLength(2)
  })
  it('moves focus between partial cells and supports Backspace without posting incomplete codes', async () => {
    await render(); await open(); await cells()[0].setValue('8'); await flushPromises()
    expect(document.activeElement).toBe(cells()[1].element); await cells()[1].trigger('keydown', { key: 'Backspace' })
    expect(document.activeElement).toBe(cells()[0].element); expect(otpCalls()).toHaveLength(0)
  })
  it.each([200, 503])('drops an old same-ID session OTP response %i without a toast or old action replay', async status => {
    await render(); await open(); await paste(); relogin(); await flushPromises(); await reply(0, status)
    expect(host!.find('[role="dialog"]').exists()).toBe(false); expect(host!.get('#status-a').text()).toBe('cancelled')
    expect(settingsCalls()).toHaveLength(1); expect(feedback.error).not.toHaveBeenCalled()
  })
  it('drops a 503 after the dialog alone unmounts while its controller host survives', async () => {
    await render(); await open(); await paste(); await host!.setProps({ dialogMounted: false }); host!.get<HTMLInputElement>('#outside').element.focus(); await reply(0, 503)
    expect(feedback.error).not.toHaveBeenCalled(); expect(host!.get('#status-a').text()).toBe('cancelled'); expect(settingsCalls()).toHaveLength(1); expect(document.activeElement).toBe(host!.get('#outside').element)
  })
  it('cancels an unmounted raw prompt that is still waiting in the surviving host', async () => {
    await render(); await open('a', true); await host!.setProps({ dialogMounted: false }); await flushPromises()
    expect(host!.get('#status-a').text()).toBe('cancelled'); expect(otpCalls()).toHaveLength(0)
  })
  it.each([200, 503])('keeps a replacement login prompt locked and intact when the old OTP returns %i', async status => {
    await render(); await open(); await paste(); relogin(); await flushPromises(); await open(); await paste('654321')
    expect(otpCalls()).toHaveLength(2); await reply(0, status)
    expect(busy()).toBe(true); expect(contents()).toBe('654321'); expect(host!.get('#status-a').text()).toBe('waiting'); expect(feedback.error).not.toHaveBeenCalled()
    await reply(1, 200, true); expect(host!.get('#status-a').text()).toBe('done'); expect(settingsCalls()).toHaveLength(3)
  })
  it.each([200, 503])('does not act on a replacement controller after an old OTP returns %i', async status => {
    await render(); await open(); await paste(); await host!.setProps({ target: 'B', openRawOnTarget: true }); await flushPromises()
    expect(host!.get('#status-a').text()).toBe('cancelled'); expect(host!.get('#status-b').text()).toBe('waiting'); expect(busy()).toBe(false)
    await cells()[0].setValue('8'); await flushPromises(); const focused = cells()[1].element
    expect(document.activeElement).toBe(focused); await reply(0, status)
    expect(host!.get('#status-b').text()).toBe('waiting'); expect(contents()).toBe('8'); expect(document.activeElement).toBe(focused); expect(feedback.error).not.toHaveBeenCalled()
  })
  it.each([200, 503])('does not verify or report an error into an already-visible replacement controller on late %i', async status => {
    await render(); await open(); await paste(); await host!.setProps({ target: 'B', openRawOnTarget: true }); await flushPromises()
    // A public parent lifecycle replacement can happen even while the old
    // dialog is busy. No disabled new input is edited in this before proof.
    await reply(0, status)
    expect(host!.get('#status-b').text()).toBe('waiting'); expect(feedback.error).not.toHaveBeenCalled()
    expect(host!.find('[role="dialog"]').exists()).toBe(true)
  })
  it.each([200, 503])('does not clear or unlock a closed-and-reopened same-controller prompt after old response %i', async status => {
    await render(); await open(); await paste(); await host!.setProps({ closeRevision: 1 }); await flushPromises(); await open(); await paste('654321')
    expect(otpCalls()).toHaveLength(2); await reply(0, status)
    expect(busy()).toBe(true); expect(contents()).toBe('654321'); expect(host!.get('#status-a').text()).toBe('waiting'); expect(feedback.error).not.toHaveBeenCalled()
    await reply(1, 200, true); expect(host!.get('#status-a').text()).toBe('done')
  })
  it('allows an in-flight prompt to complete across an ordinary same-generation token rotation', async () => {
    await render(); await open(); await paste(); const original = captureAuthSession()
    commitAuthTokenRotation(original, { access_token: '110-synthetic-rotated-access', refresh_token: '110-synthetic-rotated-refresh', expires_in: 3600 })
    expect(captureAuthSession()).toEqual(original); await reply(0, 200, true)
    expect(host!.get('#status-a').text()).toBe('done'); expect(settingsCalls()).toHaveLength(2); expect(feedback.error).not.toHaveBeenCalled()
  })
})
