import {
  assertAuthSession, AuthSessionChangedError, captureAuthSession,
  isAuthSessionCurrent, type AuthSessionSnapshot,
} from '@/api/authSession'
import { persistOAuthTokenContext, type OAuthTokenResponse } from '@/api/auth'

/** An OAuth page may finish its own login, but may never adopt another page's login. */
export function createOAuthCallbackSession() {
  let owner = captureAuthSession()
  let disposed = false
  const isCurrent = () => !disposed && isAuthSessionCurrent(owner)
  const assertCurrent = () => {
    if (!isCurrent()) throw new AuthSessionChangedError()
  }
  return {
    isCurrent,
    assertCurrent,
    dispose: () => { disposed = true },
    async wait<T>(operation: Promise<T>): Promise<T> {
      const result = await operation
      assertCurrent()
      return result
    },
    async login(tokens: OAuthTokenResponse, setToken: (token: string, expected?: AuthSessionSnapshot) => Promise<unknown>) {
      assertCurrent()
      owner = persistOAuthTokenContext(tokens, owner)
      const generation = owner.generation
      await setToken(tokens.access_token, owner)
      const established = captureAuthSession()
      if (disposed || established.generation !== generation) throw new AuthSessionChangedError()
      // /auth/me resolves the subject of this same generation.
      owner = established
      assertAuthSession(owner)
    },
  }
}
