import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRegistrationDraft, saveRegistrationDraft, takeRegistrationDraft } from '../registrationDraft'
import { captureAuthSession, replaceAuthSession } from '@/api/authSession'

const draft = { email: 'signup@example.test', password: 'SYNTHETIC-private-password' }
beforeEach(() => {
  vi.useFakeTimers()
  clearRegistrationDraft()
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => { clearRegistrationDraft(); vi.useRealTimers() })

describe('one-use registration draft', () => {
  it('hands the password to the next SPA page once without writing it to storage', () => {
    saveRegistrationDraft(draft)
    expect(sessionStorage.length).toBe(0)
    const persisted = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!)).join('')
    expect(persisted).not.toContain(draft.password)
    expect(takeRegistrationDraft()).toMatchObject(draft)
    expect(takeRegistrationDraft()).toBeNull()
  })

  it('discards pre-hardening drafts instead of restoring a stored password', () => {
    sessionStorage.setItem('register_data', JSON.stringify(draft))
    expect(takeRegistrationDraft()).toBeNull()
    expect(sessionStorage.getItem('register_data')).toBeNull()
  })

  it('expires an abandoned draft after fifteen minutes', async () => {
    saveRegistrationDraft(draft)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(takeRegistrationDraft()).toBeNull()
  })

  it('discards an abandoned draft when the authentication session changes', () => {
    saveRegistrationDraft(draft)
    replaceAuthSession({ accessToken: 'SYNTHETIC-new-session', user: { id: 29 } })
    expect(takeRegistrationDraft()).toBeNull()
  })

  it('does not allow callers to mutate the queued draft', () => {
    const input = { ...draft, pending_adoption_decision: { adopt_avatar: true } }
    saveRegistrationDraft(input)
    input.password = 'SYNTHETIC-replaced'
    input.pending_adoption_decision.adopt_avatar = false
    expect(takeRegistrationDraft()).toMatchObject({ ...draft, pending_adoption_decision: { adopt_avatar: true } })
  })

  it('does not let an obsolete action overwrite a newer session\'s draft', () => {
    const oldSession = captureAuthSession()
    replaceAuthSession({ accessToken: 'SYNTHETIC-new-session', user: { id: 30 } })
    saveRegistrationDraft({ email: 'new@example.test', password: 'SYNTHETIC-new-password' })
    expect(() => saveRegistrationDraft(draft, oldSession)).toThrow()
    expect(takeRegistrationDraft()).toMatchObject({ email: 'new@example.test', password: 'SYNTHETIC-new-password' })
  })
})
