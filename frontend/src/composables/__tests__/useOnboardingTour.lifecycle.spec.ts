import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { replaceAuthSession } from '@/api/authSession'
import { useOnboardingStore } from '@/stores/onboarding'
import { useOnboardingTour } from '../useOnboardingTour'

const fixtures=vi.hoisted(()=>({
  user:{id:7,role:'admin'}, simple:false, driver:vi.fn(),
  steps:[{element:'#tour-start',popover:{showButtons:['next','previous','close']}},{element:'#tour-next',popover:{showButtons:['close']}},{popover:{showButtons:['close']}}]
}))
vi.mock('driver.js',()=>({driver:fixtures.driver}))
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({get user(){return fixtures.user},get isSimpleMode(){return fixtures.simple}})}))
vi.mock('vue-i18n',()=>({useI18n:()=>({t:(key:string)=>key})}))
vi.mock('@/components/Guide/steps',()=>({getAdminSteps:()=>fixtures.steps,getUserSteps:()=>fixtures.steps}))

type FakeDriver={config:Record<string,any>;isActive:()=>boolean;drive:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>;moveNext:ReturnType<typeof vi.fn>;movePrevious:ReturnType<typeof vi.fn>;getActiveIndex:()=>number;getActiveElement:()=>Element|null}
let drivers:FakeDriver[]=[]
let wrappers:Array<ReturnType<typeof host>>=[]
function host(autoStart=false) {
  const wrapper=mount(defineComponent({setup(){return{tour:useOnboardingTour({autoStart})}},template:'<div/>'}))
  wrappers.push(wrapper)
  return wrapper
}
function anchor(id:string) {const node=document.createElement('button');node.id=id;document.body.appendChild(node);return node}
beforeEach(()=>{
  localStorage.clear();sessionStorage.clear();vi.useFakeTimers();setActivePinia(createPinia())
  fixtures.user={id:7,role:'admin'};fixtures.simple=false;drivers=[]
  replaceAuthSession({accessToken:'SYNTHETIC-TOUR',user:fixtures.user})
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,top:0,left:0,bottom:30,right:100,width:100,height:30,toJSON:()=>({})})
  fixtures.driver.mockImplementation(config=>{
    let active=true,index=0
    const driver:FakeDriver={config,isActive:()=>active,getActiveIndex:()=>index,
      getActiveElement:()=>document.querySelector(fixtures.steps[index]?.element||'no-element'),
      drive:vi.fn((at=0)=>{index=at}),moveNext:vi.fn(()=>{index++}),movePrevious:vi.fn(()=>{index--}),
      destroy:vi.fn(()=>{active=false;config.onDestroyed?.()})}
    drivers.push(driver);return driver
  })
})
afterEach(()=>{
  wrappers.forEach(wrapper=>wrapper.unmount());wrappers=[]
  drivers.forEach(driver=>driver.destroy())
  document.body.innerHTML='';vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();fixtures.driver.mockReset()
})

describe('onboarding ownership and user navigation',()=>{
  it('does not create an overlay after the starting page unmounts while waiting for its anchor',async()=>{
    const wrapper=host();const start=wrapper.vm.tour.startTour()
    await flushPromises();wrapper.unmount();wrappers=[]
    anchor('tour-start');await vi.advanceTimersByTimeAsync(200);await start
    expect(fixtures.driver).not.toHaveBeenCalled()
  })

  it('lets the latest replay win while an earlier start is waiting for the DOM',async()=>{
    const wrapper=host();const older=wrapper.vm.tour.startTour()
    await flushPromises();anchor('tour-next')
    await wrapper.vm.tour.startTour(1)
    anchor('tour-start');await vi.advanceTimersByTimeAsync(200);await older
    expect(fixtures.driver).toHaveBeenCalledTimes(1)
    expect(drivers[0].drive).toHaveBeenCalledWith(1)
  })

  it('does not let a delayed advance move a replacement tour',async()=>{
    anchor('tour-start');anchor('tour-next');const wrapper=host()
    await wrapper.vm.tour.startTour()
    const advance=wrapper.vm.tour.nextStep(300)
    await wrapper.vm.tour.startTour(1)
    await vi.advanceTimersByTimeAsync(300);await advance
    expect(drivers[0].destroy).toHaveBeenCalled()
    expect(drivers[1].moveNext).not.toHaveBeenCalled()
  })

  it('does not advance an active tour after the scheduled step changed',async()=>{
    anchor('tour-start');const wrapper=host();await wrapper.vm.tour.startTour()
    const advance=wrapper.vm.tour.nextStep(300)
    drivers[0].moveNext();drivers[0].moveNext.mockClear()
    await vi.advanceTimersByTimeAsync(300);await advance
    expect(drivers[0].moveNext).not.toHaveBeenCalled()
  })

  it('supports next/previous keyboard navigation and Escape completion without blocking input editing',async()=>{
    anchor('tour-start');anchor('tour-next');const wrapper=host();await wrapper.vm.tour.startTour()
    const driver=drivers[0]
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))
    expect(driver.moveNext).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))
    expect(driver.movePrevious).toHaveBeenCalledTimes(1)
    const input=document.createElement('input');document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))
    expect(driver.moveNext).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
    expect(driver.destroy).toHaveBeenCalled()
    expect(wrapper.vm.tour.hasSeen()).toBe(true)
    expect(useOnboardingStore().getDriverInstance()).toBeNull()
  })

  it('only auto-starts unseen administrator tours in standard mode',async()=>{
    anchor('tour-start');host(true);await vi.advanceTimersByTimeAsync(1000)
    expect(fixtures.driver).toHaveBeenCalledTimes(1)
    drivers[0].config.onCloseClick()
    host(true);await vi.advanceTimersByTimeAsync(1000)
    expect(fixtures.driver).toHaveBeenCalledTimes(1)
  })

  it('does not auto-start for a member or simplified workspace',async()=>{
    fixtures.user={id:7,role:'user'};host(true)
    fixtures.simple=true;fixtures.user={id:7,role:'admin'};host(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixtures.driver).not.toHaveBeenCalled()
  })

  it('keeps the newer mounted page controls when an older page unmounts',async()=>{
    anchor('tour-start');const older=host();const newer=host()
    await newer.vm.tour.startTour()
    older.unmount();wrappers=wrappers.filter(wrapper=>wrapper!==older)
    await useOnboardingStore().nextStep(0)
    expect(drivers[0].moveNext).toHaveBeenCalledTimes(1)
  })

  it('ignores late destroy notifications belonging to a replaced tour',async()=>{
    anchor('tour-start');anchor('tour-next');const wrapper=host()
    await wrapper.vm.tour.startTour();await wrapper.vm.tour.startTour(1)
    drivers[0].config.onDestroyed()
    expect(useOnboardingStore().getDriverInstance()).toBe(drivers[1])
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))
    expect(drivers[1].movePrevious).toHaveBeenCalledTimes(1)
  })

  it('does not mark another login as having completed the previous tour',async()=>{
    anchor('tour-start');const wrapper=host();await wrapper.vm.tour.startTour()
    fixtures.user={id:8,role:'user'}
    replaceAuthSession({accessToken:'SYNTHETIC-NEXT-TOUR',user:fixtures.user})
    drivers[0].config.onCloseClick()
    expect(wrapper.vm.tour.hasSeen()).toBe(false)
  })
})
