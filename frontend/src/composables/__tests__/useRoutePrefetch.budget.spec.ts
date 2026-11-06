import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {RouteLocationNormalized,Router} from 'vue-router'
import {canPrefetchRoute,useRoutePrefetch} from '../useRoutePrefetch'

describe('speculative route budget',()=>{
 beforeEach(()=>{vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.spyOn(navigator,'onLine','get').mockReturnValue(true)})
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();delete (navigator as Navigator &{connection?:unknown}).connection})
 it.each([{saveData:true},{effectiveType:'2g'},{effectiveType:'3g'},{downlink:1},{rtt:400}])('respects constrained connection %j',connection=>{
  Object.defineProperty(navigator,'connection',{value:connection,configurable:true});expect(canPrefetchRoute()).toBe(false)
 })
 it('does no speculative work in hidden or offline pages',()=>{
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');expect(canPrefetchRoute()).toBe(false)
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.spyOn(navigator,'onLine','get').mockReturnValue(false);expect(canPrefetchRoute()).toBe(false)
 })
 it('starts at most one route and rechecks connectivity at idle execution',async()=>{
  const imports=[vi.fn().mockResolvedValue({}),vi.fn().mockResolvedValue({})]
  let idle!:IdleRequestCallback
  vi.stubGlobal('requestIdleCallback',(cb:IdleRequestCallback)=>{idle=cb;return 1});vi.stubGlobal('cancelIdleCallback',vi.fn())
  const router={getRoutes:()=>[{path:'/keys',components:{default:imports[0]}},{path:'/usage',components:{default:imports[1]}}]} as unknown as Router
  const prefetch=useRoutePrefetch(router),route={path:'/dashboard'} as RouteLocationNormalized
  prefetch.triggerPrefetch(route);idle({didTimeout:false,timeRemaining:()=>50});await Promise.resolve()
  expect(imports[0]).toHaveBeenCalledOnce();expect(imports[1]).not.toHaveBeenCalled()
  prefetch.resetPrefetchState();prefetch.triggerPrefetch(route)
  Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true})
  idle({didTimeout:false,timeRemaining:()=>50});expect(imports[0]).toHaveBeenCalledOnce()
 })
})
