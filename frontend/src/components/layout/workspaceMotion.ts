type VisualDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => {
    finished: Promise<void>
    ready?: Promise<void>
  }
}

let latestTransition = 0

/** Visual enhancement only: false leaves the original RouterLink click intact. */
export function startWorkspaceTransition(document: Document, update: () => Promise<void>, direction = 1): boolean {
  const visualDocument = document as VisualDocument
  if (!visualDocument.startViewTransition) return false

  const sequence = ++latestTransition
  const root = document.documentElement
  root.classList.add('z-route-transition')
  root.style.setProperty('--z-route-distance', `${direction < 0 ? -7 : 7}px`)
  const cleanup = () => {
    if (sequence !== latestTransition) return
    root.classList.remove('z-route-transition')
    root.style.removeProperty('--z-route-distance')
  }

  try {
    const transition = visualDocument.startViewTransition(update)
    // A skipped/interrupted capture must not prevent navigation or leave motion state behind.
    void transition.ready?.catch(() => {})
    void transition.finished.then(cleanup, cleanup)
    return true
  } catch {
    cleanup()
    return false
  }
}
