import { authSessionDigest } from './authSessionDigest'

export const AUTH_SESSION_KEY = 'auth_session_identity_v1'
export const AUTH_SESSION_REPLACED_EVENT = 'auth-session-replaced'
const storageKeys = new Set([AUTH_SESSION_KEY, 'auth_token', 'refresh_token', 'auth_user', 'token_expires_at'])
export interface AuthSessionSnapshot { generation: string; subject: string | null }
const signalSessions = new WeakMap<AbortSignal, AuthSessionSnapshot>()
export function bindAuthSignal(signal: AbortSignal, session: AuthSessionSnapshot): void { signalSessions.set(signal, session) }
export function authSignalSession(signal?: AbortSignal | null): AuthSessionSnapshot | undefined { return signal ? signalSessions.get(signal) : undefined }
interface SessionRecord extends AuthSessionSnapshot { phase: 'ready' | 'transition'; credentials: string }
const pending = new Set<{ session: AuthSessionSnapshot; abort: () => void }>()
const subscribers = new Set<() => void>()
const receipts = new WeakMap<object, AuthSessionSnapshot>()
let documentSession: AuthSessionSnapshot | null = null
let lastDocumentSubject: string | null = null
let documentIsStale = false

export class AuthSessionChangedError extends Error {
  readonly code = 'AUTH_SESSION_CHANGED'
  readonly status = 409
  constructor(message = 'Authentication session changed. Please retry in the current session.') { super(message); this.name = 'AuthSessionChangedError' }
}

function subjectOf(user: unknown): string | null {
  const id = user && typeof user === 'object' ? (user as { id?: unknown }).id : null
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : null
}
function readUser(): unknown {
  try { return JSON.parse(localStorage.getItem('auth_user') || 'null') } catch { return null }
}
function credentialDigest(): string {
  return pairDigest(localStorage.getItem('auth_token'), localStorage.getItem('refresh_token'))
}
// Keep only the most recent pair. Requests still reread storage on every check,
// but unchanged credentials need not be SHA-256 hashed repeatedly per request or
// once for each in-flight request during a session notification.
let lastCredentialPair: string | undefined
let lastCredentialDigest = ''
function pairDigest(access: string | null, refresh: string | null): string {
  const pair = JSON.stringify([access, refresh])
  if (pair !== lastCredentialPair) {
    lastCredentialDigest = authSessionDigest(pair)
    lastCredentialPair = pair
  }
  return lastCredentialDigest
}
function newGeneration(): string {
  return crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
}
function readRecord(): SessionRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as SessionRecord | null
    if (!r || typeof r.generation !== 'string' || !r.generation || typeof r.credentials !== 'string' || !/^[a-f0-9]{64}$/.test(r.credentials)) return null
    if ((r.subject !== null && (typeof r.subject !== 'string' || !/^\d+$/.test(r.subject))) || !['ready', 'transition'].includes(r.phase)) return null
    return r
  } catch { return null }
}
function same(a: AuthSessionSnapshot, b: AuthSessionSnapshot): boolean { return a.generation === b.generation && a.subject === b.subject }

// Legacy keys remain the wire-compatible storage contract. A small, credential-
// free commit record detects incomplete/mixed writes before any bearer is used.
export function captureAuthSession(): AuthSessionSnapshot {
  let record = readRecord()
  if (!record && localStorage.getItem(AUTH_SESSION_KEY) === null) {
    record = { generation: newGeneration(), subject: subjectOf(readUser()), phase: 'ready', credentials: credentialDigest() }
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(record))
    record = readRecord()
  }
  const before = localStorage.getItem(AUTH_SESSION_KEY)
  if (!record || record.phase !== 'ready' || record.subject !== subjectOf(readUser()) || record.credentials !== credentialDigest() || before !== localStorage.getItem(AUTH_SESSION_KEY)) throw new AuthSessionChangedError()
  return Object.freeze({ generation: record.generation, subject: record.subject })
}
export function isAuthSessionCurrent(session: AuthSessionSnapshot): boolean {
  try { return same(session, captureAuthSession()) } catch { return false }
}
export function assertAuthSession(session: AuthSessionSnapshot): void { if (!isAuthSessionCurrent(session)) throw new AuthSessionChangedError() }

function invalidateDocument(): void {
  if (documentIsStale) return
  documentIsStale = true
  window.dispatchEvent(new Event(AUTH_SESSION_REPLACED_EVENT))
}
export function authDocumentIsStale(): boolean { return documentIsStale }
function notify(external = false): void {
  const transition = readRecord()
  for (const item of pending) {
    if (transition?.phase === 'transition' && transition.generation === item.session.generation) continue
    if (!isAuthSessionCurrent(item.session)) { pending.delete(item); item.abort() }
  }
  let current: AuthSessionSnapshot
  try { current = captureAuthSession() } catch {
    if (external && documentSession && transition?.phase !== 'transition') invalidateDocument()
    return
  }
  const replacedAuthenticatedView = external && documentSession && !same(documentSession, current) && (documentSession.subject !== null || current.subject !== null)
  if (replacedAuthenticatedView || (lastDocumentSubject !== null && current.subject !== null && lastDocumentSubject !== current.subject)) invalidateDocument()
  documentSession = current
  if (current.subject !== null) lastDocumentSubject = current.subject
  for (const listener of subscribers) listener()
}
if (typeof window !== 'undefined') {
  // Older clients persisted a registration password here. Remove that legacy
  // draft on startup; the current registration flow uses a one-use memory draft.
  try { sessionStorage.removeItem('register_data') } catch { /* Storage may be disabled. */ }
  window.addEventListener('storage', event => {
    if (event.key === null || storageKeys.has(event.key)) notify(true)
  })
}
export function subscribeAuthSession(listener: () => void): () => void { subscribers.add(listener); return () => subscribers.delete(listener) }
export function adoptDocumentAuthSession(session = captureAuthSession()): void {
  assertAuthSession(session)
  documentSession = session
  if (documentSession.subject !== null) lastDocumentSubject = documentSession.subject
}
export function captureRequestAuthSession(): AuthSessionSnapshot {
  if (documentIsStale) throw new AuthSessionChangedError()
  let current: AuthSessionSnapshot
  try { current = captureAuthSession() } catch (error) {
    if (documentSession && readRecord()?.phase !== 'transition') invalidateDocument()
    throw error
  }
  if (documentSession && !same(documentSession, current)) { notify(true); throw new AuthSessionChangedError() }
  documentSession = current
  if (current.subject !== null) lastDocumentSubject = current.subject
  return current
}
export function trackAuthRequest(session: AuthSessionSnapshot, abort: () => void): () => void {
  const entry = { session, abort }; pending.add(entry)
  return () => pending.delete(entry)
}

function commit(record: SessionRecord, write: () => void): AuthSessionSnapshot {
  const transition = JSON.stringify({ ...record, phase: 'transition', writer: newGeneration() })
  localStorage.setItem(AUTH_SESSION_KEY, transition)
  write()
  // Refuse any observed competing writer or mixed credential set. Read-side
  // validation also rejects a later interleaving instead of adopting its bearer.
  if (localStorage.getItem(AUTH_SESSION_KEY) !== transition || credentialDigest() !== record.credentials || subjectOf(readUser()) !== record.subject) throw new AuthSessionChangedError()
  const ready = { ...record, phase: 'ready' as const }
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(ready))
  notify()
  return { generation: ready.generation, subject: ready.subject }
}
function currentRecord(session: AuthSessionSnapshot): SessionRecord {
  const record = readRecord()
  if (!record || !same(record, session)) throw new AuthSessionChangedError()
  assertAuthSession(session)
  return record
}
export function replaceAuthSession(input: { accessToken: string; refreshToken?: string | null; expiresIn?: number; user?: unknown }, expected?: AuthSessionSnapshot): AuthSessionSnapshot {
  if (expected) assertAuthSession(expected)
  if (!input.accessToken || (input.user !== undefined && !subjectOf(input.user))) throw new Error('Invalid authentication response')
  const record: SessionRecord = { generation: newGeneration(), subject: subjectOf(input.user), phase: 'transition', credentials: pairDigest(input.accessToken, input.refreshToken || null) }
  return commit(record, () => {
    localStorage.setItem('auth_token', input.accessToken)
    if (input.refreshToken) localStorage.setItem('refresh_token', input.refreshToken); else localStorage.removeItem('refresh_token')
    if (input.expiresIn) localStorage.setItem('token_expires_at', String(Date.now() + input.expiresIn * 1000)); else localStorage.removeItem('token_expires_at')
    if (input.user) localStorage.setItem('auth_user', JSON.stringify(input.user)); else localStorage.removeItem('auth_user')
  })
}
export function commitAuthTokenRotation(session: AuthSessionSnapshot, tokens: { access_token: string; refresh_token: string; expires_in: number }): void {
  assertAuthSession(session)
  const record = { ...currentRecord(session), credentials: pairDigest(tokens.access_token, tokens.refresh_token) }
  commit(record, () => {
    localStorage.setItem('auth_token', tokens.access_token)
    localStorage.setItem('token_expires_at', String(Date.now() + tokens.expires_in * 1000))
    localStorage.setItem('refresh_token', tokens.refresh_token)
  })
}
export function setSessionRefreshToken(value: string): void {
  const session = captureAuthSession(); assertAuthSession(session)
  commit({ ...currentRecord(session), credentials: pairDigest(localStorage.getItem('auth_token'), value) }, () => localStorage.setItem('refresh_token', value))
}
export function updateAuthSessionUser(session: AuthSessionSnapshot, user: unknown): void {
  assertAuthSession(session)
  const subject = subjectOf(user)
  if (!subject || (session.subject !== null && session.subject !== subject)) throw new AuthSessionChangedError('Authenticated user does not match the active session.')
  commit({ ...currentRecord(session), subject }, () => localStorage.setItem('auth_user', JSON.stringify(user)))
}
export function clearStoredAuthSession(expected?: AuthSessionSnapshot): boolean {
  if (expected && !isAuthSessionCurrent(expected)) return false
  commit({ generation: newGeneration(), subject: null, phase: 'transition', credentials: pairDigest(null, null) }, () => {
    for (const key of ['auth_token', 'refresh_token', 'auth_user', 'token_expires_at']) localStorage.removeItem(key)
  })
  return true
}
export function markAuthResponse(response: object, session: AuthSessionSnapshot): void { receipts.set(response, session) }
export function authResponseSession(response: object): AuthSessionSnapshot | undefined { return receipts.get(response) }
