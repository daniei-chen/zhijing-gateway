import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { getBatchImageJob, getBatchImageItemContent, deleteBatchImageJobRecord } from '../batchImage'
import { replaceAuthSession } from '../authSession'
import { createSessionTasks } from '@/utils/sessionTasks'

function deferred<T>() { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve} }
const login=(id=101)=>replaceAuthSession({accessToken:'synthetic-access-'+id,user:{id}})
describe('raw API-key batch requests retain their initiating session',()=>{
 beforeEach(()=>{localStorage.clear();login()})
 afterEach(()=>vi.unstubAllGlobals())
 it('rejects an ignored abort after response headers while JSON is still loading',async()=>{
  const body=deferred<{id:string}>(), fetch=vi.fn().mockResolvedValue({ok:true,json:()=>body.promise})
  vi.stubGlobal('fetch',fetch)
  const owner=createSessionTasks(), task=owner.begin('job')
  const request=getBatchImageJob('synthetic-api-key','job-a',task.signal)
  const rejection=expect(request).rejects.toMatchObject({code:'AUTH_SESSION_CHANGED'})
  await Promise.resolve();login(102);body.resolve({id:'old-job'})
  await rejection;expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);owner.dispose()
 })
 it('does not send an old API key when a signal belongs to another login',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  const owner=createSessionTasks(),task=owner.begin('job');login(102)
  await expect(getBatchImageJob('synthetic-old-key','job',task.signal)).rejects.toMatchObject({code:'AUTH_SESSION_CHANGED'})
  expect(fetch).not.toHaveBeenCalled();owner.dispose()
 })
 it('rejects late binary content after page disposal even when fetch ignores abort',async()=>{
  const body=deferred<Blob>();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:()=>body.promise}))
  const owner=createSessionTasks(),task=owner.begin('preview')
  const request=getBatchImageItemContent('synthetic-key','job','item',0,task.signal)
  const rejection=expect(request).rejects.toMatchObject({name:'AbortError'})
  await Promise.resolve();owner.dispose();body.resolve(new Blob(['synthetic-image']))
  await rejection
 })
 it('keeps method, escaped identifiers, API-key auth and empty deletion responses',async()=>{
  const json=vi.fn(),fetch=vi.fn().mockResolvedValue({ok:true,json});vi.stubGlobal('fetch',fetch)
  await deleteBatchImageJobRecord('synthetic-key','a/b')
  expect(fetch.mock.calls[0][0]).toContain('a%2Fb')
  expect(fetch.mock.calls[0][1]).toMatchObject({method:'DELETE',headers:{Authorization:'Bearer synthetic-key'}})
  expect(json).not.toHaveBeenCalled()
 })
 it('preserves error status and request reference',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403,headers:new Headers({'X-Request-Id':'synthetic-reference'}),json:async()=>({error:{code:'DENIED',message:'forbidden'}})}))
  await expect(getBatchImageJob('synthetic-key','job')).rejects.toMatchObject({code:'DENIED',status:403,requestId:'synthetic-reference'})
 })
})
