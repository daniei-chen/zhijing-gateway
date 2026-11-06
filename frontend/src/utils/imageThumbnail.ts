function abortError() { return new DOMException('Thumbnail cancelled', 'AbortError') }
function assertActive(signal?: AbortSignal) { if (signal?.aborted) throw abortError() }

async function imageSource(blob: Blob, signal?: AbortSignal): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  assertActive(signal)
  if (typeof window.createImageBitmap === 'function') {
    const bitmap = await window.createImageBitmap(blob)
    if (signal?.aborted) { bitmap.close(); throw abortError() }
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }
  const url = URL.createObjectURL(blob)
  let closed = false
  const close = () => { if (!closed) { closed = true; URL.revokeObjectURL(url) } }
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      const cleanup = () => { img.onload = null; img.onerror = null; signal?.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); img.removeAttribute('src'); close(); reject(abortError()) }
      img.onload = () => { cleanup(); resolve(img) }
      img.onerror = () => { cleanup(); reject(new Error('Image unavailable')) }
      signal?.addEventListener('abort', abort, { once: true })
      img.src = url
      if (signal?.aborted) abort()
    })
    assertActive(signal)
    return { image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, close }
  } catch (error) { close(); throw error }
}

/** A page cancellation releases temporary URLs immediately and late bitmaps on arrival. */
export async function createImageThumbnail(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  const source = await imageSource(blob, signal)
  const canvas = document.createElement('canvas')
  try {
    assertActive(signal)
    if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) throw new Error('Invalid image dimensions')
    const scale = Math.min(1, 360 / Math.max(source.width, source.height))
    canvas.width = Math.max(1, Math.round(source.width * scale))
    canvas.height = Math.max(1, Math.round(source.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height)
  } finally { source.close() }
  const result = await new Promise<Blob>((resolve, reject) => {
    const abort = () => { cleanup(); reject(abortError()) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try {
      canvas.toBlob(thumbnail => {
        cleanup()
        if (signal?.aborted) reject(abortError())
        else if (thumbnail) resolve(thumbnail)
        else reject(new Error('Thumbnail unavailable'))
      }, 'image/webp', 0.72)
    } catch (error) { cleanup(); reject(error) }
  })
  assertActive(signal)
  return result
}
