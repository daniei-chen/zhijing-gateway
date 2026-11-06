type Drawer = { root: () => HTMLElement | null }
type DrawerState = { owners: Drawer[]; opener: HTMLElement | null }
const drawers = new WeakMap<Document, DrawerState>()

/** Keep scroll locking and the external opener across overlapping layouts. */
export function createMobileDrawerOwner(document: Document, root: () => HTMLElement | null) {
  const owner: Drawer = { root }
  return {
    activate() {
      let state = drawers.get(document)
      if (!state) {
        state = { owners: [], opener: document.activeElement instanceof HTMLElement ? document.activeElement : null }
        drawers.set(document, state)
      }
      if (!state.owners.includes(owner)) state.owners.push(owner)
      document.body.classList.add('z-mobile-nav-open')
    },
    isTop() { return drawers.get(document)?.owners.at(-1) === owner },
    release() {
      const state = drawers.get(document)
      if (!state || !state.owners.includes(owner)) return
      const wasTop = state.owners.at(-1) === owner
      const focusedInside = !!root()?.contains(document.activeElement)
      state.owners = state.owners.filter(drawer => drawer !== owner)
      if (state.owners.length) {
        if (wasTop && focusedInside) state.owners.at(-1)?.root()?.querySelector<HTMLElement>('.z-mobile-close')?.focus()
        return
      }
      drawers.delete(document)
      document.body.classList.remove('z-mobile-nav-open')
      if ((focusedInside || document.activeElement === document.body) && state.opener?.isConnected && !state.opener.closest('[inert]')) state.opener.focus()
    }
  }
}
