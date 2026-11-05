import { bindAuthSignal, captureAuthSession, isAuthSessionCurrent, trackAuthRequest } from '@/api/authSession'

/** Own asynchronous work by page instance, login session and operation name. */
export function createSessionTasks() {
  const session = captureAuthSession()
  const running = new Map<string, { abort: () => void }>()
  let disposed = false
  const current = () => !disposed && isAuthSessionCurrent(session)
  function cancel(prefix = '') {
    for (const [name, task] of running) if (name.startsWith(prefix)) task.abort()
  }
  function begin(name: string, contextIsCurrent = () => true) {
    running.get(name)?.abort()
    const controller = new AbortController()
    bindAuthSignal(controller.signal, session)
    const task = {
      abort() {
        controller.abort()
        untrack?.()
        if (running.get(name) === task) running.delete(name)
      }
    }
    running.set(name, task)
    const untrack = trackAuthRequest(session, task.abort)
    if (!current() || !contextIsCurrent()) task.abort()
    const owned = () => current() && !controller.signal.aborted && running.get(name) === task
    return {
      session, signal: controller.signal,
      owned, active: () => owned() && contextIsCurrent(),
      finish() {
        untrack?.()
        if (running.get(name) === task) running.delete(name)
      }
    }
  }
  return { session, begin, cancel, current, dispose() { disposed = true; cancel() } }
}
