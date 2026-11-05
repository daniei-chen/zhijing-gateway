/** Keep keyboard navigation in the top modal while respecting portalled child controls. */
export function trapDialogFocus(event: KeyboardEvent, panel: HTMLElement | null, active: boolean) {
  if (!active || !panel || event.key !== 'Tab' || event.defaultPrevented) return
  const current = document.activeElement
  // Portalled listboxes manage their own keyboard navigation and return focus themselves.
  if (current !== panel && !panel.contains(current)) return
  const candidates = [...panel.querySelectorAll<HTMLElement>(
    'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]'
  )].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
  candidates.sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) -
    (b.tabIndex > 0 ? b.tabIndex : Infinity))
  if (!candidates.length) {
    event.preventDefault()
    panel.focus()
    return
  }
  const first = candidates[0]
  const last = candidates[candidates.length - 1]
  if (event.shiftKey && (current === first || current === panel)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (current === last || current === panel)) {
    event.preventDefault()
    first.focus()
  }
}
