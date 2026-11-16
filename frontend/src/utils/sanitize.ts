import DOMPurify from 'dompurify'

export function sanitizeSvg(svg: string): string {
  if (!svg) return ''
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
}

/**
 * Sanitize admin-provided homepage HTML.
 *
 * The homepage setting is editable by administrators, but that does not make
 * arbitrary markup safe: a compromised or accidentally pasted script would run
 * for every visitor and could steal their session. Keep the formatting and media
 * that a marketing homepage needs, while removing executable/embedding surfaces.
 */
export function sanitizeHomeContent(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  })
}
