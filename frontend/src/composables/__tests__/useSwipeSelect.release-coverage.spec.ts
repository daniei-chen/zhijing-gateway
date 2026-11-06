import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSwipeSelect, type SwipeSelectVirtualContext } from '../useSwipeSelect'

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); document.body.innerHTML = ''; document.documentElement.classList.remove('dark') })
function table(options: { batch?: boolean; initial?: number[]; mode?: 'items' | 'estimate' | 'no-scroll' | 'no-driver'; invalidRow?: boolean; dark?: boolean } = {}) {
  const selected = new Set(options.initial ?? []), data = Array.from({ length: 10 }, (_, i) => ({ id: 101 + i }))
  if (options.dark) document.documentElement.classList.add('dark')
  let control!: ReturnType<typeof useSwipeSelect>
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frames.set(++nextFrame, fn); return nextFrame })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  Object.defineProperties(document.documentElement, { clientWidth: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 900 } })
  const view = mount(defineComponent({ setup() {
    const container = ref<HTMLElement | null>(null)
    const virtual = options.mode ? {
      getVirtualizer: () => options.mode === 'no-driver' ? null : { scrollElement: options.mode === 'no-scroll' ? null : scroll, getVirtualItems: () => options.mode === 'estimate' ? [] : data.slice(0, 4).map((_, index) => ({ index, start: index * 40, end: (index + 1) * 40 })), options: { estimateSize: () => 40 } },
      getSortedData: () => data, getRowId: (row: { id: number }) => row.id,
    } as unknown as SwipeSelectVirtualContext : undefined
    control = useSwipeSelect(container, { isSelected: id => selected.has(id), select: id => { selected.add(id) }, deselect: id => { selected.delete(id) }, ...(options.batch ? { batchUpdate: (apply: (draft: Set<number>) => void) => apply(selected) } : {}) }, virtual)
    return () => h('section', { class: 'table-page-layout', style: 'overflow-y:auto' }, [h('button', { 'data-action': '' }, 'Action'), h('div', { 'data-padding': '' }), h('div', { ref: container }, [h('table', [h('thead', [h('tr', [h('th', 'Name')])]), h('tbody', options.mode === 'estimate' ? [] : data.slice(0, 4).map((row, index) => h('tr', { 'data-row-id': options.invalidRow && index === 1 ? 'invalid' : row.id, 'data-index': index }, [h('td', { 'data-cell': row.id }, ''), h('td', [h('span', `Row ${row.id}`)])])))])])])
  } }), { attachTo: document.body })
  const scroll = view.element as HTMLElement
  Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 360 }, scrollHeight: { configurable: true, value: 1000 }, clientWidth: { configurable: true, value: 800 }, scrollWidth: { configurable: true, value: 800 } })
  const rect = (top: number, height: number): DOMRect => ({ x: 0, y: top, left: 0, right: 800, top, bottom: top + height, width: 800, height, toJSON: () => ({}) })
  vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => rect(100, 360))
  vi.spyOn(view.get('thead').element, 'getBoundingClientRect').mockImplementation(() => rect(100, 20))
  view.findAll('tbody tr').forEach((row, index) => vi.spyOn(row.element, 'getBoundingClientRect').mockImplementation(() => rect(120 + index * 40 - scroll.scrollTop, 40)))
  disposers.push(() => view.unmount())
  function mouse(target: Element | Document, type: string, y: number, x = 300, button = 0) { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, clientX: x, button })) }
  function frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(performance.now())) }
  const start = () => view.find('[data-cell="101"]').exists() ? view.get('[data-cell="101"]').element : view.get('[data-padding]').element
  return { view, scroll, selected, control, mouse, frame, start, frames }
}

describe('native table drag selection across real/virtual scroll boundaries', () => {
  it.each([false, true])('extends beyond rendered virtual rows and restores the shrinking range (batch=%s)', batch => {
    const t = table({ mode: 'items', batch, initial: [110] })
    t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 310)
    expect([...t.selected].sort()).toEqual([101, 102, 103, 104, 105, 110])
    t.mouse(document, 'mousemove', 210); t.frame()
    expect([...t.selected].sort()).toEqual([101, 102, 103, 110])
    t.mouse(document, 'mouseup', 210); expect(t.control.isDragging.value).toBe(false)
  })
  it.each([false, true])('deselects a virtual range without losing untouched selected rows (batch=%s)', batch => {
    const t = table({ mode: 'items', batch, initial: [101, 102, 103, 104, 105, 110] })
    t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 310)
    expect([...t.selected]).toEqual([110])
    t.mouse(document, 'mousemove', 210); t.frame()
    expect([...t.selected].sort()).toEqual([104, 105, 110])
    window.dispatchEvent(new Event('blur')); expect(t.control.isDragging.value).toBe(false)
  })
  it('uses the virtual row estimate during an empty rendering window', () => {
    const t = table({ mode: 'estimate' })
    t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 310)
    expect([...t.selected]).toEqual([101, 102, 103, 104, 105])
    t.mouse(document, 'mousemove', -100); t.frame(); expect([...t.selected]).toEqual([101])
  })
  it.each(['no-driver', 'no-scroll'] as const)('retains selection safely while the virtualizer has %s', mode => {
    const t = table({ mode, initial: [110] }); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 210)
    expect([...t.selected]).toEqual([110]); t.mouse(document, 'mouseup', 210)
    expect(t.control.isDragging.value).toBe(false)
  })
  it('rechecks a virtual range after wheel scrolling, then ignores a queued frame after release', () => {
    const t = table({ mode: 'items' }); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 210)
    expect([...t.selected]).toEqual([101, 102, 103])
    t.scroll.scrollTop = 80; document.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 })); t.frame()
    expect([...t.selected]).toEqual([101, 102, 103, 104, 105])
    document.dispatchEvent(new WheelEvent('wheel')); t.mouse(document, 'mouseup', 210); t.frame()
    expect([...t.selected]).toEqual([101, 102, 103, 104, 105])
  })
  it('auto-scrolls a constrained parent near its lower edge and stops on blur', () => {
    const t = table({ mode: 'items' }); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 445)
    const before = t.scroll.scrollTop; t.frame(); expect(t.scroll.scrollTop).toBeGreaterThan(before)
    window.dispatchEvent(new Event('blur')); const stopped = t.scroll.scrollTop; t.frame(); expect(t.scroll.scrollTop).toBe(stopped)
    expect(document.querySelector('div[style*="position: fixed"]')).toBeNull()
  })
  it.each([false, true])('skips a malformed DOM row ID instead of selecting an invalid account (batch=%s)', batch => {
    const t = table({ batch, invalidRow: true }); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 230)
    expect([...t.selected]).toEqual([101, 103]); expect([...t.selected].every(Number.isFinite)).toBe(true)
  })
  it('does not start range selection from scrollbars or secondary mouse actions', () => {
    const t = table()
    for (const [x, button] of [[810, 0], [1000, 0], [300, 2]]) {
      t.mouse(t.scroll, 'mousedown', 130, x, button); t.mouse(document, 'mousemove', 230, x, button)
      expect([...t.selected]).toEqual([]); expect(t.control.isDragging.value).toBe(false)
    }
    const text = t.view.get('tbody tr td span').element
    t.mouse(text, 'mousedown', 130); t.mouse(document, 'mousemove', 230); expect([...t.selected]).toEqual([])
  })
  it('keeps ordinary text selection below the threshold and removes the blocker on blur', () => {
    const t = table(); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 132)
    const during = new Event('selectstart', { cancelable: true }); document.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true); expect(t.control.isDragging.value).toBe(false)
    window.dispatchEvent(new Event('blur')); const after = new Event('selectstart', { cancelable: true }); document.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false); expect([...t.selected]).toEqual([])
  })
  it('uses the dark overlay palette and cleans an active drag on component disposal', () => {
    const t = table({ dark: true }); t.mouse(t.start(), 'mousedown', 130); t.mouse(document, 'mousemove', 210)
    const overlay = document.querySelector<HTMLElement>('div[style*="position: fixed"]')!
    expect(overlay.style.border).toContain('96, 165, 250'); expect(overlay.style.pointerEvents).toBe('none')
    t.view.unmount(); expect(document.querySelector('div[style*="position: fixed"]')).toBeNull()
    const selected = [...t.selected]; t.mouse(document, 'mousemove', 300); t.frame(); expect([...t.selected]).toEqual(selected)
  })
})
