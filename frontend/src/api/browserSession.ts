import type { AuthSessionSnapshot } from './authSession'

export const BROWSER_SESSION_HEADER = 'X-Zhijing-Session'
const cookieHandle = /^zjs\.(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.[a-f0-9]{32}$/
export function isBrowserSessionHandle(value: string | null | undefined): boolean {
  return typeof value === 'string' && cookieHandle.test(value)
}

/** Public selectors choose HttpOnly cookies; they cannot authenticate on their own. */
export function browserSessionHeaders(token: string | null, session: AuthSessionSnapshot, requestURL: string): Record<string, string> {
  const result: Record<string, string> = {}
  const handle = isBrowserSessionHandle(token)
  let sameOrigin = false
  try {
    const page = new URL(window.location.href)
    const target = new URL(requestURL, page)
    const secure = page.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname)
    sameOrigin = secure && target.origin === page.origin
  } catch { /* Legacy non-browser clients retain bearer mode. */ }
  if (handle && !sameOrigin) throw new Error('Browser cookie sessions require the same origin')
  if (sameOrigin) result[BROWSER_SESSION_HEADER] = handle ? token! : `init.${session.generation}`
  if (token && !handle) result.Authorization = `Bearer ${token}`
  return result
}
