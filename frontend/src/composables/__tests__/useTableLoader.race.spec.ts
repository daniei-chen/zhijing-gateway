import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTableLoader } from '../useTableLoader'

type Result = { items: { id: number }[]; total: number; pages: number }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fixture(fetchFn: ReturnType<typeof vi.fn>) {
  let table!: ReturnType<typeof useTableLoader<{ id: number }, { search: string }>>
  const wrapper = mount(defineComponent({
    setup() {
      table = useTableLoader({ fetchFn, initialParams: { search: '' } })
      return () => h('div')
    },
  }))
  return { table, wrapper }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('table loader request ownership', () => {
  it('does not let an adapter that ignores cancellation overwrite the latest page', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const fetchFn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { table, wrapper } = fixture(fetchFn)
    const oldLoad = table.load()
    table.params.search = 'new query'
    const newLoad = table.load()
    second.resolve({ items: [{ id: 2 }], total: 20, pages: 2 })
    await newLoad
    first.resolve({ items: [{ id: 1 }], total: 100, pages: 10 })
    await oldLoad
    expect(table.items.value).toEqual([{ id: 2 }])
    expect(table.pagination.total).toBe(20)
    expect(table.pagination.pages).toBe(2)
    expect(fetchFn.mock.calls[0][2]).toEqual({ search: '' })
    expect(fetchFn.mock.calls[0][3].signal.aborted).toBe(true)
    wrapper.unmount()
  })

  it('ignores an obsolete error without clearing the new request loading state', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const { table, wrapper } = fixture(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    const oldLoad = table.load()
    const newLoad = table.load()
    first.reject(new Error('late stale failure'))
    await expect(oldLoad).resolves.toBeUndefined()
    expect(table.loading.value).toBe(true)
    second.resolve({ items: [{ id: 2 }], total: 1, pages: 1 })
    await newLoad
    expect(table.loading.value).toBe(false)
    wrapper.unmount()
  })

  it('does not write a late result or start a queued search after unmount', async () => {
    vi.useFakeTimers()
    const response = deferred<Result>()
    const fetchFn = vi.fn().mockReturnValue(response.promise)
    const { table, wrapper } = fixture(fetchFn)
    const load = table.load()
    table.debouncedReload()
    wrapper.unmount()
    response.resolve({ items: [{ id: 1 }], total: 1, pages: 1 })
    await load
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(table.items.value).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(table.loading.value).toBe(false)
  })
})
