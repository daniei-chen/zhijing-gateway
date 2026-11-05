/** Only the browser-bound server exchange may establish an OAuth login. */
export function readOAuthCallbackFragment(restartMessage: string): URLSearchParams {
  const raw = typeof window === 'undefined' ? '' : window.location.hash
  const params = new URLSearchParams(raw.startsWith('#') ? raw.slice(1) : raw)
  if (params.has('access_token') || params.has('refresh_token')) {
    for (const key of ['access_token','refresh_token','expires_in','token_type']) params.delete(key)
    params.set('error','oauth_session_required')
    params.set('error_description',restartMessage)
  }
  if (raw) {
    try {
      const url = new URL(window.location.href)
      window.history.replaceState(window.history.state,'',url.pathname+url.search)
    } catch { /* An inaccessible history must not make a credential acceptable. */ }
  }
  return params
}
