import { beforeEach, describe, expect, it } from 'vitest'
import { createSessionTasks } from '../sessionTasks'
import { replaceAuthSession } from '@/api/authSession'

function login(id = 101) { replaceAuthSession({accessToken: 'synthetic-'+id, user: {id}}) }
describe('page asynchronous ownership', () => {
  beforeEach(() => { localStorage.clear(); login() })
  it('invalidates ignored-abort results and old finally cannot remove a replacement', () => {
    const owner=createSessionTasks(), old=owner.begin('detail'), latest=owner.begin('detail')
    expect(old.signal.aborted).toBe(true); expect(old.active()).toBe(false)
    old.finish(); expect(latest.active()).toBe(true)
    latest.finish(); expect(latest.active()).toBe(false); owner.dispose()
  })
  it('cancels only the selected task family', () => {
    const owner=createSessionTasks(), preview=owner.begin('preview:a'), list=owner.begin('list')
    owner.cancel('preview:'); expect(preview.active()).toBe(false); expect(list.active()).toBe(true)
    owner.dispose(); expect(list.signal.aborted).toBe(true); expect(owner.begin('late').active()).toBe(false)
  })
  it('cannot adopt another login even with the same user', () => {
    const owner=createSessionTasks(), old=owner.begin('old')
    login(); expect(old.signal.aborted).toBe(true); expect(owner.current()).toBe(false)
    expect(owner.begin('late').active()).toBe(false); owner.dispose()
  })
})
