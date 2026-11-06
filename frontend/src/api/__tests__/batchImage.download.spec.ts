import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveBlob } from '../batchImage'

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
let clicked: { name: string; href: string; connected: boolean }[] = []

beforeEach(() => {
  clicked = []
  document.body.innerHTML = ''
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-download')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push({ name: this.download, href: this.href, connected: this.isConnected }) })
})
afterEach(() => { vi.restoreAllMocks(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; document.body.innerHTML = '' })

describe('batch image download blob ownership', () => {
  it('connects one download link, preserves the requested filename and releases its URL after success', () => {
    const blob = new Blob(['synthetic archive'], { type: 'application/zip' })
    saveBlob(blob, 'synthetic "archive" 中文.zip')
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(clicked).toEqual([{ name: 'synthetic "archive" 中文.zip', href: 'blob:synthetic-download', connected: true }])
    expect(document.body.querySelector('a')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download')
  })
  it('releases the link and URL when the download click throws', () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('Synthetic click refused') })
    expect(() => saveBlob(new Blob(['synthetic']), 'synthetic.zip')).toThrow('Synthetic click refused')
    expect(document.body.querySelector('a')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download')
  })
  it('releases the URL when appending the link fails', () => {
    vi.spyOn(document.body, 'appendChild').mockImplementationOnce(() => { throw new Error('Synthetic append refused') })
    expect(() => saveBlob(new Blob(['synthetic']), 'synthetic.zip')).toThrow('Synthetic append refused')
    expect(clicked).toHaveLength(0); expect(document.body.querySelector('a')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download')
  })
  it('releases the URL when allocating the anchor fails after the URL was allocated', () => {
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => { throw new Error('Synthetic anchor allocation refused') })
    expect(() => saveBlob(new Blob(['synthetic']), 'synthetic.zip')).toThrow('Synthetic anchor allocation refused')
    expect(clicked).toHaveLength(0); expect(document.body.querySelector('a')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download')
  })
  it('cleans up safely when a synchronous click handler already removes the anchor', () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(function () { this.remove() })
    expect(() => saveBlob(new Blob(['synthetic']), 'synthetic.zip')).not.toThrow()
    expect(document.body.querySelector('a')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download')
  })
  it('does not create a link when URL allocation itself fails', () => {
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('Synthetic URL allocation refused') })
    expect(() => saveBlob(new Blob(['synthetic']), 'synthetic.zip')).toThrow('Synthetic URL allocation refused')
    expect(clicked).toHaveLength(0); expect(document.body.querySelector('a')).toBeNull(); expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
