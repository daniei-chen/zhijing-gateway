/** JSON embedded in an HTML script must not contain HTML parser delimiters. */
export function serializePublicSettings(settings: unknown): string {
  const escapes: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  }
  return (JSON.stringify(settings) ?? 'null').replace(/[<>&\u2028\u2029]/g, character => escapes[character])
}
