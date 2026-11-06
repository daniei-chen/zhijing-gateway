import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import axios from 'axios'
vi.mock('@/i18n', () => ({ getLocale: () => 'en' }))
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules() })
afterEach(() => { vi.restoreAllMocks() })
it('adopts an already rotated cookie selector when the old selector request receives a late 401', async () => {
  const cookieId='12345678-1234-4234-8234-123456789abc'
  const access=(v: string)=>`zjs.${cookieId}.${v.repeat(32)}`
  const refresh=(v: string)=>`zjr.${cookieId}.${v.repeat(32)}`
  const sessions=await import('@/api/authSession')
  const owner=sessions.replaceAuthSession({accessToken:access('a'),refreshToken:refresh('a'),expiresIn:3600,user:{id:7}})
  const {apiClient}=await import('@/api/client')
  let rejectFirst!: (reason: unknown)=>void
  const first=new Promise<never>((_,reject)=>{rejectFirst=reject})
  const seen: any[]=[]
  apiClient.defaults.adapter=async config=>{
    seen.push(config)
    if(seen.length===1) return first
    return {config,status:200,statusText:'OK',headers:{},data:{code:0,data:{accepted:true}}}
  }
  const refreshRequest=vi.spyOn(axios,'post').mockResolvedValue({data:{code:0,data:{access_token:access('c'),refresh_token:refresh('c'),expires_in:3600,token_type:'Bearer'}}})
  const request=apiClient.get('/keys')
  expect(seen[0].headers.get('X-Zhijing-Session')).toBe(access('a'))
  sessions.commitAuthTokenRotation(owner,{access_token:access('b'),refresh_token:refresh('b'),expires_in:3600})
  rejectFirst({config:seen[0],response:{status:401,data:{code:'TOKEN_EXPIRED'}}})
  await expect(request).resolves.toMatchObject({data:{accepted:true}})
  expect.soft(refreshRequest).not.toHaveBeenCalled()
  expect(seen[1].headers.get('X-Zhijing-Session')).toBe(access('b'))
})

it.each([200,401])('rejects an old cookie response after a custom adapter drops the session stamp (status=%s)', async status => {
  const idA='12345678-1234-4234-8234-123456789abc', idB='22345678-1234-4234-8234-123456789abc'
  const access=(id:string)=>`zjs.${id}.${'a'.repeat(32)}`
  const refresh=(id:string)=>`zjr.${id}.${'a'.repeat(32)}`
  const sessions=await import('@/api/authSession')
  sessions.replaceAuthSession({accessToken:access(idA),refreshToken:refresh(idA),expiresIn:3600,user:{id:7}})
  const {apiClient}=await import('@/api/client')
  let complete!:()=>void
  let calls=0
  const refreshRequest=vi.spyOn(axios,'post')
  apiClient.defaults.adapter=config=>{
    calls++
    // Some custom adapters reconstruct config and discard nonstandard stamps.
    const returnedConfig={url:config.url,headers:config.headers} as typeof config
    return new Promise((resolve,reject)=>{
      complete=()=>status===200
        ? resolve({config:returnedConfig,status,statusText:'OK',headers:{},data:{code:0,data:{owner:'old account'}}})
        : reject({config:returnedConfig,response:{status,data:{code:'TOKEN_EXPIRED'}}})
    })
  }
  const request=apiClient.get('/keys')
  sessions.replaceAuthSession({accessToken:access(idB),refreshToken:refresh(idB),expiresIn:3600,user:{id:8}})
  complete()
  await expect(request).rejects.toMatchObject({code:'AUTH_SESSION_CHANGED'})
  expect(calls).toBe(1)
  expect(refreshRequest).not.toHaveBeenCalled()
  expect(localStorage.getItem('auth_token')).toBe(access(idB))
})
