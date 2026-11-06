import {afterEach,describe,expect,it,vi} from 'vitest'
import {readOAuthCallbackFragment} from '../oauthCallbackFragment'

describe('OAuth fragment credentials are untrusted',()=>{
 afterEach(()=>{vi.restoreAllMocks();window.history.replaceState(null,'','/')})
 it.each(['access_token=synthetic-attacker','refresh_token=synthetic-refresh','%61ccess_token=synthetic-encoded'])('rejects %s and scrubs browser history',fragment=>{
  window.history.replaceState(null,'','/auth/oauth/callback#'+fragment)
  const params=readOAuthCallbackFragment('restart sign-in')
  expect(params.get('error')).toBe('oauth_session_required');expect(params.has('access_token')).toBe(false)
  expect(params.has('refresh_token')).toBe(false);expect(window.location.hash).toBe('')
 })
 it('preserves non-login completion fields and errors in memory',()=>{
  window.history.replaceState(null,'','/auth/wechat/callback#error=invitation_required&pending_oauth_token=synthetic-single-use')
  const params=readOAuthCallbackFragment('restart')
  expect(params.get('pending_oauth_token')).toBe('synthetic-single-use');expect(params.get('error')).toBe('invitation_required')
  expect(window.location.hash).toBe('')
 })
 it('still rejects credentials when history is unavailable',()=>{
  window.history.replaceState(null,'','/auth/oauth/callback#access_token=synthetic')
  const replace=vi.spyOn(window.history,'replaceState').mockImplementation(()=>{throw Error('history disabled')})
  expect(readOAuthCallbackFragment('restart').get('error')).toBe('oauth_session_required');replace.mockRestore()
 })
})
