import {
  assertAuthSession, captureAuthSession, isAuthSessionCurrent, subscribeAuthSession,
  type AuthSessionSnapshot
} from '@/api/authSession'

/** A single-use draft for SPA navigation. Passwords never enter Web Storage. */
export interface RegistrationDraft {
  email: string
  password: string
  turnstile_token?: string
  tencent_captcha_ticket?: string
  tencent_captcha_randstr?: string
  promo_code?: string
  invitation_code?: string
  aff_code?: string
  pending_auth_token?: string
  pending_auth_token_field?: 'pending_auth_token' | 'pending_oauth_token'
  pending_provider?: string
  pending_redirect?: string
  pending_adoption_decision?: { adopt_display_name?: boolean; adopt_avatar?: boolean }
}

const DRAFT_TTL_MS = 15 * 60 * 1000
let current: { data: RegistrationDraft; session: AuthSessionSnapshot; createdAt: number } | null = null
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null

export function clearRegistrationDraft(): void {
  current = null
  if (expiryTimer !== null) clearTimeout(expiryTimer)
  expiryTimer = null
  unsubscribe?.()
  unsubscribe = null
  // Discard pre-hardening drafts instead of recovering a password from storage.
  try { sessionStorage.removeItem('register_data') } catch { /* Storage may be disabled. */ }
}

export function saveRegistrationDraft(data: RegistrationDraft, expected = captureAuthSession()): void {
  assertAuthSession(expected)
  clearRegistrationDraft()
  if (!data.email || !data.password) throw new Error('Invalid registration draft')
  current = {
    data: { ...data, pending_adoption_decision: data.pending_adoption_decision ? { ...data.pending_adoption_decision } : undefined },
    session: expected,
    createdAt: Date.now()
  }
  unsubscribe = subscribeAuthSession(() => {
    if (current && !isAuthSessionCurrent(current.session)) clearRegistrationDraft()
  })
  expiryTimer = setTimeout(clearRegistrationDraft, DRAFT_TTL_MS)
}

export function takeRegistrationDraft(): RegistrationDraft | null {
  const draft = current
  clearRegistrationDraft()
  if (!draft || !isAuthSessionCurrent(draft.session)) return null
  const age = Date.now() - draft.createdAt
  if (age < 0 || age >= DRAFT_TTL_MS) return null
  return draft.data
}
