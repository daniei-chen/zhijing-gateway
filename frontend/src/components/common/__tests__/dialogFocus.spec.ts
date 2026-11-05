import { afterEach, describe, expect, it, vi } from 'vitest'
import { trapDialogFocus } from '../dialogFocus'

function fixture() {
  document.body.innerHTML = '<div id="panel" tabindex="-1"><button id="first">Close</button><button disabled>Disabled</button><button id="hidden">Hidden</button><input tabindex="-1"><input id="middle"><button id="last">Save</button></div><button id="portal">Portalled listbox</button>'
  for (const el of document.querySelectorAll<HTMLElement>('#panel *')) {
    vi.spyOn(el, 'getClientRects').mockReturnValue((el.id === 'hidden' ? [] : [{}]) as unknown as DOMRectList)
  }
  return document.querySelector<HTMLElement>('#panel')!
}
const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('dialog keyboard boundary', () => {
  it('wraps first/last and skips disabled, hidden and negative-tabindex fields', () => {
    const panel = fixture()
    document.querySelector<HTMLElement>('#first')!.focus()
    const backwards = tab(true)
    trapDialogFocus(backwards, panel, true)
    expect(document.activeElement?.id).toBe('last')
    expect(backwards.defaultPrevented).toBe(true)
    const forwards = tab()
    trapDialogFocus(forwards, panel, true)
    expect(document.activeElement?.id).toBe('first')
    expect(forwards.defaultPrevented).toBe(true)
  })

  it('allows ordinary navigation within the panel', () => {
    const panel = fixture()
    document.querySelector<HTMLElement>('#middle')!.focus()
    const event = tab()
    trapDialogFocus(event, panel, true)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement?.id).toBe('middle')
  })

  it('leaves child portals and inactive parent dialogs in control', () => {
    const panel = fixture()
    document.querySelector<HTMLElement>('#portal')!.focus()
    const outside = tab()
    trapDialogFocus(outside, panel, true)
    expect(outside.defaultPrevented).toBe(false)
    document.querySelector<HTMLElement>('#last')!.focus()
    const parent = tab()
    trapDialogFocus(parent, panel, false)
    expect(parent.defaultPrevented).toBe(false)
    const handled = tab()
    handled.preventDefault()
    trapDialogFocus(handled, panel, true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('keeps a content-only panel focused and enters a populated panel', () => {
    const panel = fixture()
    panel.focus()
    trapDialogFocus(tab(true), panel, true)
    expect(document.activeElement?.id).toBe('last')
    panel.innerHTML = '<p>Loading</p>'
    panel.focus()
    const event = tab()
    trapDialogFocus(event, panel, true)
    expect(document.activeElement).toBe(panel)
    expect(event.defaultPrevented).toBe(true)
  })
})
