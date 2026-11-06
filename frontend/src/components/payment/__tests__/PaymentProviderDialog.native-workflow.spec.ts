import { defineComponent, h, onMounted, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { ProviderInstance } from '@/types/payment'
import PaymentProviderDialog from '@/components/payment/PaymentProviderDialog.vue'

const localeState = vi.hoisted(() => ({ value: 'en' }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref(localeState.value) }) }))
const showError = vi.fn()
vi.mock('@/stores', () => ({ useAppStore: () => ({ showError }) }))

type Key = 'easypay' | 'alipay' | 'wxpay' | 'stripe' | 'airwallex'
interface SavePayload {
  provider_key: string; name: string; supported_types: string[]; enabled: boolean; payment_mode: string
  refund_enabled: boolean; allow_user_refund: boolean; config: Record<string, string>; limits: string
}
interface PublicDialog { reset(key: string): void; loadProvider(provider: ProviderInstance): void }
const providerKeys = [
  { value: 'easypay', label: 'EasyPay' }, { value: 'alipay', label: 'Alipay' },
  { value: 'wxpay', label: 'Wxpay' }, { value: 'stripe', label: 'Stripe' }, { value: 'airwallex', label: 'Airwallex' }
]
const types = ['alipay', 'wxpay', 'card', 'link', 'airwallex'].map(value => ({ value, label: value }))
const fixtures: Record<Key, { supplied: Record<string, string>; publicConfig: Record<string, string>; expected: Record<string, string>; supported: string[]; mode: string }> = {
  easypay: {
    supplied: { PID: 'synthetic-pid', PKey: 'synthetic-pkey', 'admin.settings.payment.field_apiBase': 'https://pay.synthetic.test' },
    publicConfig: { pid: 'synthetic-pid', apiBase: 'https://pay.synthetic.test' },
    expected: { pid: 'synthetic-pid', pkey: 'synthetic-pkey', apiBase: 'https://pay.synthetic.test', customMethods: '', notifyUrl: `${window.location.origin}/api/v1/payment/webhook/easypay`, returnUrl: `${window.location.origin}/payment/result` },
    supported: ['alipay', 'wxpay'], mode: 'qrcode'
  },
  alipay: {
    supplied: { 'App ID': 'synthetic-app', 'admin.settings.payment.field_privateKey': 'synthetic-private', 'admin.settings.payment.field_publicKey': 'synthetic-public' },
    publicConfig: { appId: 'synthetic-app' },
    expected: { appId: 'synthetic-app', privateKey: 'synthetic-private', publicKey: 'synthetic-public', notifyUrl: `${window.location.origin}/api/v1/payment/webhook/alipay`, returnUrl: `${window.location.origin}/payment/result` },
    supported: ['alipay'], mode: ''
  },
  wxpay: {
    supplied: { 'App ID': 'synthetic-app', 'admin.settings.payment.field_mchId': 'synthetic-merchant', 'admin.settings.payment.field_privateKey': 'synthetic-private', 'admin.settings.payment.field_apiV3Key': 'synthetic-api-v3', 'admin.settings.payment.field_certSerial': 'synthetic-serial', 'admin.settings.payment.field_publicKey': 'synthetic-public', 'admin.settings.payment.field_publicKeyId': 'synthetic-public-id' },
    publicConfig: { appId: 'synthetic-app', mchId: 'synthetic-merchant', certSerial: 'synthetic-serial', publicKeyId: 'synthetic-public-id' },
    expected: { appId: 'synthetic-app', mchId: 'synthetic-merchant', privateKey: 'synthetic-private', apiV3Key: 'synthetic-api-v3', certSerial: 'synthetic-serial', publicKey: 'synthetic-public', publicKeyId: 'synthetic-public-id', notifyUrl: `${window.location.origin}/api/v1/payment/webhook/wxpay` },
    supported: ['wxpay'], mode: ''
  },
  stripe: {
    supplied: { 'admin.settings.payment.field_secretKey': 'synthetic-stripe-secret', 'admin.settings.payment.field_publishableKey': 'synthetic-publishable', 'admin.settings.payment.field_webhookSecret': 'synthetic-webhook' },
    publicConfig: { publishableKey: 'synthetic-publishable', currency: 'CNY' },
    expected: { secretKey: 'synthetic-stripe-secret', publishableKey: 'synthetic-publishable', webhookSecret: 'synthetic-webhook', currency: 'CNY' },
    supported: ['card', 'alipay', 'wxpay', 'link'], mode: ''
  },
  airwallex: {
    supplied: { 'admin.settings.payment.field_clientId': 'synthetic-client', 'admin.settings.payment.field_apiKey': 'synthetic-airwallex-key', 'admin.settings.payment.field_webhookSecret': 'synthetic-webhook', 'admin.settings.payment.field_accountId': 'synthetic-account' },
    publicConfig: { clientId: 'synthetic-client', apiBase: 'https://api.airwallex.com/api/v1', countryCode: 'CN', currency: 'CNY', accountId: 'synthetic-account' },
    expected: { clientId: 'synthetic-client', apiKey: 'synthetic-airwallex-key', webhookSecret: 'synthetic-webhook', apiBase: 'https://api.airwallex.com/api/v1', countryCode: 'CN', currency: 'CNY', accountId: 'synthetic-account' },
    supported: ['airwallex'], mode: ''
  }
}

const mounted: VueWrapper[] = []
function provider(key: Key, name: string, id = 1): ProviderInstance {
  return { id, provider_key: key, name, config: { ...fixtures[key].publicConfig }, supported_types: [...fixtures[key].supported], enabled: true, payment_mode: fixtures[key].mode, refund_enabled: false, allow_user_refund: false, limits: '', sort_order: 0 }
}
function host(key: Key, editing: ProviderInstance | null, onSave: (value: SavePayload) => void, onClose?: () => void) {
  return defineComponent({
    props: { saving: { type: Boolean, default: false }, show: { type: Boolean, default: true } },
    setup(props) {
      const dialog = ref<PublicDialog | null>(null)
      onMounted(() => editing ? dialog.value?.loadProvider(editing) : dialog.value?.reset(key))
      return () => h(PaymentProviderDialog, { ref: dialog, show: props.show, saving: props.saving, editing, allKeyOptions: providerKeys, enabledKeyOptions: providerKeys, allPaymentTypes: types, redirectLabel: 'Redirect', onSave, onClose })
    }
  })
}
async function render(key: Key, mode: 'create' | 'edit' = 'create', name = `Synthetic ${key}`) {
  const saved: SavePayload[] = []
  const closed = vi.fn()
  const existing = new Set(document.body.querySelectorAll('[role="dialog"]'))
  const view = mount(host(key, mode === 'edit' ? provider(key, name) : null, payload => saved.push(payload), closed), { attachTo: document.body })
  mounted.push(view); await flushPromises()
  const element = Array.from(document.body.querySelectorAll<HTMLElement>('[role="dialog"]')).find(element => !existing.has(element))
  expect(element).toBeDefined()
  const dialog = new DOMWrapper(element!)
  return { view, dialog, saved, closed }
}
type NativeRoot = Pick<DOMWrapper<Element>, 'findAll'>
function field(dialog: NativeRoot, text: string) {
  const label = dialog.findAll<HTMLLabelElement>('label').find(label => label.text().replaceAll('*', '').replace('(common.optional)', '').trim() === text)
  expect(label, text).toBeDefined()
  const control = label!.element.control
  expect(control, text).toBeTruthy()
  return new DOMWrapper(control!)
}
async function fillCreate(dialog: DOMWrapper<Element>, key: Key, name = `Synthetic ${key}`) {
  await field(dialog, 'admin.settings.payment.providerName').setValue(name)
  for (const [label, value] of Object.entries(fixtures[key].supplied)) await field(dialog, label).setValue(value)
}
function footerSave(dialog: DOMWrapper<Element>) { return dialog.get<HTMLButtonElement>('button[type="submit"]') }
function button(root: NativeRoot, text: string) {
  const found = root.findAll('button').find(button => button.text() === text)
  expect(found, text).toBeDefined()
  return found!
}
function methodFields(dialog: DOMWrapper<Element>, label: string) {
  return dialog.findAll<HTMLLabelElement>('label')
    .filter(node => node.text() === label)
    .map(node => { expect(node.element.control).toBeTruthy(); return new DOMWrapper(node.element.control!) })
}
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; showError.mockClear(); localeState.value = 'en' })

describe('native payment provider output contracts', () => {
  it.each(['easypay', 'alipay', 'wxpay', 'stripe', 'airwallex'] as const)('creates %s through real inputs and a native footer submit', async key => {
    const { dialog, saved } = await render(key)
    await fillCreate(dialog, key)
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toEqual([{
      provider_key: key, name: `Synthetic ${key}`, config: fixtures[key].expected,
      supported_types: fixtures[key].supported, payment_mode: fixtures[key].mode,
      enabled: true, refund_enabled: false, allow_user_refund: false, limits: ''
    }])
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['easypay', 'alipay', 'wxpay', 'stripe', 'airwallex'] as const)('edits %s while preserving stored secrets by omitting blank secret fields', async key => {
    const { dialog, saved } = await render(key, 'edit')
    await field(dialog, 'admin.settings.payment.providerName').setValue(`Edited ${key}`)
    footerSave(dialog).element.click(); await flushPromises()
    const expectedConfig = { ...fixtures[key].publicConfig }
    if (key === 'easypay' || key === 'alipay') {
      expectedConfig.notifyUrl = `${window.location.origin}/api/v1/payment/webhook/${key}`
      expectedConfig.returnUrl = `${window.location.origin}/payment/result`
    }
    if (key === 'wxpay') expectedConfig.notifyUrl = `${window.location.origin}/api/v1/payment/webhook/wxpay`
    if (key === 'easypay') expectedConfig.customMethods = ''
    expect(saved).toEqual([{
      provider_key: key, name: `Edited ${key}`, config: expectedConfig,
      supported_types: fixtures[key].supported, payment_mode: fixtures[key].mode,
      enabled: true, refund_enabled: false, allow_user_refund: false, limits: ''
    }])
  })

  it('shows pending save state while preserving an editable draft for the next explicit save', async () => {
    const { view, dialog, saved } = await render('stripe')
    await fillCreate(dialog, 'stripe')
    await view.setProps({ saving: true })
    expect(footerSave(dialog).element.disabled).toBe(true)
    await field(dialog, 'admin.settings.payment.providerName').setValue('Later pending draft')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toEqual([])
    await view.setProps({ saving: false })
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ provider_key: 'stripe', name: 'Later pending draft', config: fixtures.stripe.expected })
  })
})

describe('native payment dialog semantics and form ownership', () => {
  it('associates intended input labels with their exact controls, including dynamic method rows and limits', async () => {
    const { dialog } = await render('easypay')
    const add = dialog.findAll('button').find(button => button.text() === 'admin.settings.payment.addCustomMethod')!
    await add.trigger('click'); await add.trigger('click')
    const missing = dialog.findAll<HTMLLabelElement>('label').filter(label => !label.element.control).map(label => label.text())
    expect(missing).toEqual([])
  })

  it('gives password visibility controls a field-specific accessible name', async () => {
    const { dialog } = await render('easypay')
    const pkey = field(dialog, 'PKey')
    const visibility = pkey.element.parentElement!.querySelector<HTMLButtonElement>('button')!
    expect(visibility.getAttribute('aria-label')).toContain('PKey')
  })

  it('submits B when two dialog instances share one Vue host and B footer is clicked natively', async () => {
    const savedA: SavePayload[] = [], savedB: SavePayload[] = []
    const A = host('stripe', provider('stripe', 'Synthetic A', 1), payload => savedA.push(payload))
    const B = host('stripe', provider('stripe', 'Synthetic B', 2), payload => savedB.push(payload))
    const view = mount(defineComponent({ setup: () => () => h('div', [h(A), h(B)]) }), { attachTo: document.body })
    mounted.push(view); await flushPromises()
    const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]')
    dialogs[1].querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flushPromises()
    expect(savedA).toEqual([])
    expect(savedB).toHaveLength(1)
    expect(savedB[0]).toMatchObject({ provider_key: 'stripe', name: 'Synthetic B', config: fixtures.stripe.publicConfig })
  })

  it('keeps native footer form ownership independent across two Vue apps in the same document', async () => {
    const savedA: SavePayload[] = [], savedB: SavePayload[] = []
    const a = mount(host('stripe', provider('stripe', 'Synthetic A'), payload => savedA.push(payload)), { attachTo: document.body })
    const b = mount(host('stripe', provider('stripe', 'Synthetic B'), payload => savedB.push(payload)), { attachTo: document.body })
    mounted.push(a, b); await flushPromises()
    const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]')
    dialogs[1].querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flushPromises()
    expect(savedA).toEqual([])
    expect(savedB).toHaveLength(1)
    expect(savedB[0].name).toBe('Synthetic B')
  })
})

describe('native provider choices, limits and corrections', () => {
  it('keeps the user-refund dependency explicit and sends the visible enabled choice', async () => {
    const { dialog, saved } = await render('stripe', 'edit')
    const refund = field(dialog, 'admin.settings.payment.refundEnabled')
    expect(refund.attributes('aria-checked')).toBe('false')
    await refund.trigger('click')
    const userRefund = field(dialog, 'admin.settings.payment.allowUserRefund')
    await userRefund.trigger('click')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0]).toMatchObject({ refund_enabled: true, allow_user_refund: true, enabled: true })

    await refund.trigger('click')
    expect(dialog.findAll('label').some(label => label.text() === 'admin.settings.payment.allowUserRefund')).toBe(false)
    await field(dialog, 'common.enabled').trigger('click')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[1]).toMatchObject({ refund_enabled: false, allow_user_refund: false, enabled: false })
  })

  it('combines an explicit EasyPay mode, selected type, optional channel id and custom method', async () => {
    const { dialog, saved } = await render('easypay')
    await fillCreate(dialog, 'easypay')
    await field(dialog, 'admin.settings.payment.field_cidAlipay').setValue('synthetic-channel')
    await button(dialog, 'admin.settings.payment.modePopup').trigger('click')
    await button(dialog, 'payment.methods.wxpay').trigger('click')
    expect(button(dialog, 'admin.settings.payment.modePopup').attributes('aria-pressed')).toBe('true')
    expect(button(dialog, 'payment.methods.wxpay').attributes('aria-pressed')).toBe('false')
    await button(dialog, 'admin.settings.payment.addCustomMethod').trigger('click')
    await field(dialog, 'admin.settings.payment.customMethodType').setValue(' voucher ')
    await field(dialog, 'admin.settings.payment.customMethodUpstreamType').setValue(' USDT.TRC20 ')
    await field(dialog, 'admin.settings.payment.customMethodDisplayName').setValue(' Gift ')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ payment_mode: 'popup', supported_types: ['alipay', 'voucher'], config: { cidAlipay: 'synthetic-channel' } })
    expect(JSON.parse(saved[0].config.customMethods)).toEqual([{ type: 'voucher', upstreamType: 'usdt.trc20', displayName: 'Gift' }])
  })

  it('saves Alipay redirect mode and retains its independent callback bases', async () => {
    const { dialog, saved } = await render('alipay')
    await fillCreate(dialog, 'alipay')
    await button(dialog, 'admin.settings.payment.modeRedirect').trigger('click')
    await field(dialog, 'admin.settings.payment.field_notifyUrl').setValue(' https://notify.synthetic.test/path/ ')
    await field(dialog, 'admin.settings.payment.field_returnUrl').setValue('https://return.synthetic.test/site///')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0]).toMatchObject({ payment_mode: 'redirect', config: {
      notifyUrl: 'https://notify.synthetic.test/path/api/v1/payment/webhook/alipay',
      returnUrl: 'https://return.synthetic.test/site/payment/result'
    } })
  })

  it('edits and clears the shared Stripe limits using raw decimal amount units', async () => {
    const initial = provider('stripe', 'Synthetic limited Stripe')
    initial.limits = JSON.stringify({ stripe: { singleMin: 1.25, singleMax: 150, dailyLimit: 450 } })
    const saved: SavePayload[] = []
    const view = mount(host('stripe', initial, payload => saved.push(payload)), { attachTo: document.body })
    mounted.push(view); await flushPromises()
    const dialog = new DOMWrapper(document.body.querySelector<HTMLElement>('[role="dialog"]')!)
    const min = field(dialog, 'admin.settings.payment.limitSingleMin')
    const max = field(dialog, 'admin.settings.payment.limitSingleMax')
    const daily = field(dialog, 'admin.settings.payment.limitDaily')
    expect((min.element as HTMLInputElement).value).toBe('1.25')
    expect((max.element as HTMLInputElement).value).toBe('150')
    expect((daily.element as HTMLInputElement).value).toBe('450')
    await min.setValue('2.75'); await max.setValue(''); await daily.setValue('900')
    footerSave(dialog).element.click(); await flushPromises()
    expect(JSON.parse(saved[0].limits)).toEqual({ stripe: { singleMin: 2.75, dailyLimit: 900 } })
    expect(max.attributes('placeholder')).toBe('admin.settings.payment.limitsNoLimit')
    await min.setValue(''); await daily.setValue('')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[1].limits).toBe('')
    expect(min.attributes('placeholder')).toBe('admin.settings.payment.limitsUseGlobal')
  })

  it('keeps EasyPay type-specific limits in their own JSON entries', async () => {
    const { dialog, saved } = await render('easypay')
    await fillCreate(dialog, 'easypay')
    await button(dialog, 'admin.settings.payment.limitsTitle').trigger('click')
    const card = (type: string) => {
      const heading = dialog.findAll('p').find(p => p.text() === type)
      expect(heading, type).toBeDefined()
      return new DOMWrapper(heading!.element.parentElement!)
    }
    await field(card('alipay'), 'admin.settings.payment.limitSingleMin').setValue('2.5')
    await field(card('alipay'), 'admin.settings.payment.limitSingleMax').setValue('200')
    await field(card('alipay'), 'admin.settings.payment.limitDaily').setValue('600')
    await field(card('wxpay'), 'admin.settings.payment.limitDaily').setValue('300')
    footerSave(dialog).element.click(); await flushPromises()
    expect(JSON.parse(saved[0].limits)).toEqual({ alipay: { singleMin: 2.5, singleMax: 200, dailyLimit: 600 }, wxpay: { dailyLimit: 300 } })
  })

  it('uses native amount validity to block an out-of-range limit, then accepts a corrected amount', async () => {
    const { dialog, saved } = await render('stripe', 'edit')
    await button(dialog, 'admin.settings.payment.limitsTitle').trigger('click')
    const min = field(dialog, 'admin.settings.payment.limitSingleMin')
    await min.setValue('0.5')
    footerSave(dialog).element.click(); await flushPromises()
    expect((min.element as HTMLInputElement).validity.rangeUnderflow).toBe(true)
    expect(saved).toEqual([])
    await min.setValue('1.5')
    footerSave(dialog).element.click(); await flushPromises()
    expect(JSON.parse(saved[0].limits)).toEqual({ stripe: { singleMin: 1.5 } })
  })

  it('keeps remaining dynamic method values and distinct label targets after deleting and adding a row', async () => {
    const { dialog, saved } = await render('easypay')
    await fillCreate(dialog, 'easypay')
    const add = button(dialog, 'admin.settings.payment.addCustomMethod')
    await add.trigger('click'); await add.trigger('click')
    let names = methodFields(dialog, 'admin.settings.payment.customMethodType')
    let upstream = methodFields(dialog, 'admin.settings.payment.customMethodUpstreamType')
    await names[0].setValue('first'); await upstream[0].setValue('x.first')
    await names[1].setValue('second'); await upstream[1].setValue('x.second')
    const firstRow = new DOMWrapper(names[0].element.closest('div.grid')!)
    await button(firstRow, 'common.delete').trigger('click')
    await add.trigger('click')
    names = methodFields(dialog, 'admin.settings.payment.customMethodType')
    upstream = methodFields(dialog, 'admin.settings.payment.customMethodUpstreamType')
    expect((names[0].element as HTMLInputElement).value).toBe('second')
    await names[1].setValue('third'); await upstream[1].setValue('x.third')
    const ids = dialog.findAll('[id]').map(node => node.attributes('id'))
    expect(new Set(ids).size).toBe(ids.length)
    for (const label of dialog.findAll<HTMLLabelElement>('label')) expect(label.element.control).toBeTruthy()
    footerSave(dialog).element.click(); await flushPromises()
    expect(JSON.parse(saved[0].config.customMethods)).toEqual([
      { type: 'second', upstreamType: 'x.second', displayName: '' },
      { type: 'third', upstreamType: 'x.third', displayName: '' }
    ])
    expect(saved[0].supported_types).toEqual(['alipay', 'wxpay', 'second', 'third'])
  })

  it('names and describes the real currency selector and accepts a keyboard-selected currency', async () => {
    const { dialog, saved } = await render('stripe')
    await fillCreate(dialog, 'stripe')
    const currency = field(dialog, 'admin.settings.payment.field_currency')
    const hintId = currency.attributes('aria-describedby')
    expect(document.getElementById(hintId!)?.textContent).toBe('admin.settings.payment.field_paymentCurrencyHint')
    ;(currency.element as HTMLButtonElement).focus()
    await currency.trigger('keydown', { key: 'ArrowDown' }); await flushPromises()
    const listbox = new DOMWrapper(document.body.querySelector<HTMLElement>('[role="listbox"]')!)
    await listbox.get('input').setValue('USD'); await flushPromises()
    await listbox.trigger('keydown', { key: 'ArrowDown' })
    await listbox.trigger('keydown', { key: 'Enter' }); await flushPromises()
    expect(currency.text()).toContain('USD')
    expect(document.activeElement).toBe(currency.element)
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0].config.currency).toBe('USD')
  })

  it('clears foreign provider config when the real provider selector changes before create', async () => {
    const { dialog, saved } = await render('stripe')
    await fillCreate(dialog, 'stripe')
    const key = field(dialog, 'admin.settings.payment.providerKey')
    await key.trigger('click'); await flushPromises()
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent?.trim() === 'Alipay')!
    option.click(); await flushPromises()
    for (const [name, value] of Object.entries(fixtures.alipay.supplied)) await field(dialog, name).setValue(value)
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0]).toMatchObject({ provider_key: 'alipay', payment_mode: '', config: fixtures.alipay.expected })
    expect(saved[0].config).not.toHaveProperty('secretKey')
    expect(saved[0].config).not.toHaveProperty('publishableKey')
  })

  it('keeps edit provider identity disabled and permits an explicit non-secret clear plus secret replacement', async () => {
    const { dialog, saved } = await render('airwallex', 'edit')
    expect((field(dialog, 'admin.settings.payment.providerKey').element as HTMLButtonElement).disabled).toBe(true)
    await field(dialog, 'admin.settings.payment.field_accountId').setValue('')
    await field(dialog, 'admin.settings.payment.field_apiKey').setValue('synthetic-replacement-key')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0].config).toEqual({ ...fixtures.airwallex.publicConfig, accountId: '', apiKey: 'synthetic-replacement-key' })
    expect(saved[0].config).not.toHaveProperty('webhookSecret')
  })

  it('reports a missing create credential and allows a corrected explicit submit', async () => {
    const { dialog, saved } = await render('alipay')
    await field(dialog, 'admin.settings.payment.providerName').setValue('Synthetic correction')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toEqual([])
    expect(showError).toHaveBeenCalledWith('admin.settings.payment.validationFieldRequired')
    for (const [name, value] of Object.entries(fixtures.alipay.supplied)) await field(dialog, name).setValue(value)
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Synthetic correction', config: fixtures.alipay.expected })
  })

  it('closes through its public cancel event without saving and opens a fresh parent-owned draft', async () => {
    const { view, dialog, saved, closed } = await render('airwallex')
    await fillCreate(dialog, 'airwallex')
    await button(dialog, 'common.cancel').trigger('click')
    expect(closed).toHaveBeenCalledTimes(1)
    expect(saved).toEqual([])
    await view.setProps({ show: false }); await flushPromises()
    view.unmount(); mounted.splice(mounted.indexOf(view), 1)
    const current = await render('airwallex')
    expect((field(current.dialog, 'admin.settings.payment.providerName').element as HTMLInputElement).value).toBe('')
    expect((field(current.dialog, 'admin.settings.payment.field_apiKey').element as HTMLTextAreaElement).value).toBe('')
    expect(current.saved).toEqual([])
  })

  it.each(['en', 'zh'])('identifies the secret visibility action and field in %s while preserving its value', async locale => {
    localeState.value = locale
    const { dialog, saved } = await render('easypay')
    await fillCreate(dialog, 'easypay')
    const secret = field(dialog, 'PKey')
    const toggle = new DOMWrapper(secret.element.parentElement!.querySelector<HTMLButtonElement>('button')!)
    expect(toggle.attributes('aria-label')).toBe(locale === 'zh' ? '显示 PKey' : 'Show PKey')
    expect(toggle.attributes('aria-controls')).toBe(secret.attributes('id'))
    await toggle.trigger('click')
    expect(secret.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe(locale === 'zh' ? '隐藏 PKey' : 'Hide PKey')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(secret.attributes('type')).toBe('password')
    footerSave(dialog).element.click(); await flushPromises()
    expect(saved[0].config.pkey).toBe('synthetic-pkey')
  })
})
