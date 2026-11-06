import { beforeEach, describe, expect, it, vi } from 'vitest'

const { list, auth } = vi.hoisted(() => ({ list: vi.fn(), auth: { isAuthenticated: true } }))
vi.mock('@/api/keys', () => ({ keysAPI: { list } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))

const eligible = { status: 'active', group: { platform: 'gemini', allow_batch_image_generation: true } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { resolve, promise }
}
async function setup() {
  const sessions = await import('@/api/authSession')
  sessions.replaceAuthSession({ accessToken: 'synthetic-a', user: { id: 1 } })
  const { useBatchImageAccess } = await import('../useBatchImageAccess')
  return { sessions, access: useBatchImageAccess() }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  list.mockReset()
  auth.isAuthenticated = true
})

describe('batch image access session ownership', () => {
  it('clears cached access synchronously when the login session is replaced', async () => {
    const { sessions, access } = await setup()
    list.mockResolvedValueOnce({ items: [eligible], pages: 1 })
    expect(await access.refreshBatchImageAccess()).toBe(true)
    sessions.replaceAuthSession({ accessToken: 'synthetic-b', user: { id: 2 } })
    expect(access.canUseBatchImage.value).toBe(false)
    expect(access.batchImageAccessLoaded.value).toBe(false)
    list.mockResolvedValueOnce({ items: [], pages: 1 })
    expect(await access.refreshBatchImageAccess()).toBe(false)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not continue an old paginated lookup using the new login', async () => {
    const { sessions, access } = await setup()
    const oldPage = deferred<{ items: unknown[]; pages: number }>()
    list.mockReturnValueOnce(oldPage.promise)
    const oldLoad = access.refreshBatchImageAccess()
    sessions.replaceAuthSession({ accessToken: 'synthetic-b', user: { id: 2 } })
    oldPage.resolve({ items: [{ status: 'active', group: { platform: 'openai' } }], pages: 2 })
    expect(await oldLoad).toBe(false)
    expect(list).toHaveBeenCalledTimes(1)
    expect(access.batchImageAccessLoaded.value).toBe(false)
  })

  it('does not let the old lookup clear a new lookup or publish its result', async () => {
    const { sessions, access } = await setup()
    const oldPage = deferred<{ items: unknown[]; pages: number }>()
    const newPage = deferred<{ items: unknown[]; pages: number }>()
    list.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(newPage.promise)
    const oldLoad = access.refreshBatchImageAccess()
    sessions.replaceAuthSession({ accessToken: 'synthetic-new-session', user: { id: 1 } })
    const newLoad = access.refreshBatchImageAccess()
    oldPage.resolve({ items: [eligible], pages: 1 })
    await oldLoad
    expect(access.canUseBatchImage.value).toBe(false)
    expect(access.batchImageAccessLoading.value).toBe(true)
    const duplicateLoad = access.refreshBatchImageAccess(true)
    expect(list).toHaveBeenCalledTimes(2)
    newPage.resolve({ items: [], pages: 1 })
    expect(await newLoad).toBe(false)
    expect(await duplicateLoad).toBe(false)
    expect(access.batchImageAccessLoading.value).toBe(false)
    expect(access.batchImageAccessLoaded.value).toBe(true)
  })

  it('clears the feature affordance on logout without another API call', async () => {
    const { sessions, access } = await setup()
    list.mockResolvedValue({ items: [eligible], pages: 1 })
    await access.refreshBatchImageAccess()
    sessions.clearStoredAuthSession()
    expect(access.canUseBatchImage.value).toBe(false)
    auth.isAuthenticated = false
    expect(await access.refreshBatchImageAccess()).toBe(false)
    expect(list).toHaveBeenCalledTimes(1)
  })
})
