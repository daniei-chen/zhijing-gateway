import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageThumbnail } from '../imageThumbnail'

describe('thumbnail resource ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('closes a bitmap that completes after the owning page was cancelled', async () => {
    const controller = new AbortController()
    let finish!: (bitmap: ImageBitmap) => void
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => { finish = resolve })))
    const task = createImageThumbnail(new Blob(['fixture']), controller.signal)
    controller.abort()
    finish({ close, width: 100, height: 100 } as unknown as ImageBitmap)
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('closes the bitmap when the canvas cannot be created', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close, width: 100, height: 100 }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(createImageThumbnail(new Blob())).rejects.toThrow('Canvas unavailable')
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('releases a pending fallback image URL immediately on cancellation', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:fixture'); static revokeObjectURL = revoke })
    const controller = new AbortController()
    const task = createImageThumbnail(new Blob(), controller.signal)
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fixture')
  })
  it('cancels a canvas encoder that never calls back', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close, width: 1000, height: 500 }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
    let started!: () => void
    const encoding = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => { started() })
    const controller = new AbortController()
    const task = createImageThumbnail(new Blob(), controller.signal)
    await encoding
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
