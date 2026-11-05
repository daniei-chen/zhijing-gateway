/**
 * Shared URL builder for iframe-embedded pages.
 * Used by PurchaseSubscriptionView and CustomPageView to build consistent URLs
 * with non-credential user_id, theme, lang, ui_mode and source context.
 */

const EMBEDDED_USER_ID_QUERY_KEY = 'user_id'
const CREDENTIAL_QUERY_KEYS = new Set(['token', 'auth_token', 'access_token', 'refresh_token', 'authorization'])
const EMBEDDED_THEME_QUERY_KEY = 'theme'
const EMBEDDED_LANG_QUERY_KEY = 'lang'
const EMBEDDED_UI_MODE_QUERY_KEY = 'ui_mode'
const EMBEDDED_UI_MODE_VALUE = 'embedded'
const EMBEDDED_SRC_HOST_QUERY_KEY = 'src_host'
const EMBEDDED_SRC_QUERY_KEY = 'src_url'

export function buildEmbeddedUrl(
  baseUrl: string,
  userId?: number,
  _authToken?: string | null,
  theme: 'light' | 'dark' = 'light',
  lang?: string,
): string {
  if (!baseUrl) return baseUrl
  try {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    // Original login credentials must never be an iframe/new-window contract.
    for (const key of [...url.searchParams.keys()]) {
      if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    const fragment = url.hash.slice(1)
    const fragmentQueries = [fragment, fragment.slice(fragment.indexOf('?') + 1)]
    // URLSearchParams decodes percent-encoded keys just as the embedded page does.
    if (fragmentQueries.some(query => [...new URLSearchParams(query).keys()]
      .some(key => CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())))) return ''
    if (userId) {
      url.searchParams.set(EMBEDDED_USER_ID_QUERY_KEY, String(userId))
    }
    url.searchParams.set(EMBEDDED_THEME_QUERY_KEY, theme)
    if (lang) {
      url.searchParams.set(EMBEDDED_LANG_QUERY_KEY, lang)
    }
    url.searchParams.set(EMBEDDED_UI_MODE_QUERY_KEY, EMBEDDED_UI_MODE_VALUE)
    // Source tracking: let the embedded page know where it's being loaded from
    if (typeof window !== 'undefined') {
      url.searchParams.set(EMBEDDED_SRC_HOST_QUERY_KEY, window.location.origin)
      // Callback queries/fragments may themselves contain credentials.
      const source = new URL(window.location.href)
      url.searchParams.set(EMBEDDED_SRC_QUERY_KEY, source.origin + source.pathname)
    }
    return url.toString()
  } catch {
    return ''
  }
}

export function detectTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
