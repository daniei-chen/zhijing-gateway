import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSwipeSelect, type SwipeSelectVirtualContext } from '../useSwipeSelect'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function table(initial: number[] = [], batched = false, virtual = false) {
  const selected = new Set(initial)
  let dragging: ReturnType<typeof useSwipeSelect>
  const wrapper = mount(defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null)
      const adapter = {
        isSelected: (id: number) => selected.has(id),
        select: (id: number) => selected.add(id),
        deselect: (id: number) => selected.delete(id),
        ...(batched ? { batchUpdate: (update: (draft: Set<number>) => void) => update(selected) } : {})
      }
      const rows = [11, 12, 13, 14]
      const context = virtual ? {
        getVirtualizer: () => ({
          scrollElement: container.value,
          getVirtualItems: () => [],
          options: { estimateSize: () => 40 }
        }),
        getSortedData: () => rows,
        getRowId: (id: number) => id
      } as unknown as SwipeSelectVirtualContext : undefined
      dragging = useSwipeSelect(container, adapter, context)
      return () => h('div', { ref: container, class: 'table-page-layout' }, [
        h('button', { id: 'action' }, 'Delete selected'),
        h('table', [h('tbody', rows.map((id, index) => h('tr', { 'data-row-id': id, 'data-index': index }, [
          h('td', [h('span', `Account ${id}`)]), h('td', { 'data-padding': id }, '')
        ])))])
      ])
    }
  }), { attachTo: document.body })
  dispose = () => wrapper.unmount()
  Object.defineProperties(document.documentElement, {
    clientWidth: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 900 }
  })
  wrapper.findAll('tr').forEach((row, index) => {
    vi.spyOn(row.element, 'getBoundingClientRect').mockReturnValue({
      top: 150 + index * 40, bottom: 190 + index * 40, height: 40,
      left: 0, right: 800, width: 800, x: 0, y: 150 + index * 40, toJSON: () => ({})
    })
  })
  vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue({
    top: 150, bottom: 310, height: 160, left: 0, right: 800, width: 800,
    x: 0, y: 150, toJSON: () => ({})
  })
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  function frame() {
    const pending = [...frames.entries()]
    frames.clear()
    pending.forEach(([, callback]) => callback(performance.now()))
  }
  function mouse(target: Element | Document, type: string, y: number, button = 0) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 300, clientY: y, button }))
  }
  return { wrapper, selected, dragging: () => dragging!, mouse, frame }
}

describe('table drag selection as user interaction', () => {
  it.each([false, true])('selects a range then restores selection outside a shrinking range (batch=%s)', batch => {
    const t = table([14], batch)
    t.mouse(t.wrapper.get('[data-padding="11"]').element, 'mousedown', 165)
    t.mouse(document, 'mousemove', 250)
    expect([...t.selected].sort()).toEqual([11, 12, 13, 14])
    expect(t.dragging().isDragging.value).toBe(true)
    t.mouse(document, 'mousemove', 205); t.frame()
    expect([...t.selected].sort()).toEqual([11, 12, 14])
    t.mouse(document, 'mouseup', 205)
    expect(t.dragging().isDragging.value).toBe(false)
    t.mouse(document, 'mousemove', 300); t.frame()
    expect([...t.selected].sort()).toEqual([11, 12, 14])
  })

  it.each([false, true])('deselects in virtual full-render fallback without disturbing outside rows (batch=%s)', batch => {
    const t = table([11, 12, 13, 14], batch, true)
    t.mouse(t.wrapper.get('[data-padding="12"]').element, 'mousedown', 205)
    t.mouse(document, 'mousemove', 250)
    expect([...t.selected].sort()).toEqual([11, 14])
    t.mouse(document, 'mousemove', 205); t.frame()
    expect([...t.selected].sort()).toEqual([11, 13, 14])
    window.dispatchEvent(new Event('blur'))
    expect(t.dragging().isDragging.value).toBe(false)
  })

  it('preserves ordinary clicks, text selection and interactive controls', () => {
    const t = table()
    for (const target of [t.wrapper.get('span').element, t.wrapper.get('#action').element]) {
      t.mouse(target, 'mousedown', 165)
      t.mouse(document, 'mousemove', 260)
      t.mouse(document, 'mouseup', 260)
    }
    expect(t.selected.size).toBe(0)
    t.mouse(t.wrapper.get('[data-padding="11"]').element, 'mousedown', 165)
    t.mouse(document, 'mousemove', 169)
    expect(t.dragging().isDragging.value).toBe(false)
    t.mouse(document, 'mouseup', 169)
    expect(t.selected.size).toBe(0)
  })

  it('removes threshold blockers and active selection when unmounted', () => {
    const t = table()
    t.mouse(t.wrapper.get('[data-padding="11"]').element, 'mousedown', 165)
    const blocked = new Event('selectstart', { cancelable: true })
    document.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
    dispose?.(); dispose = undefined
    const restored = new Event('selectstart', { cancelable: true })
    document.dispatchEvent(restored)
    expect(restored.defaultPrevented).toBe(false)
    t.mouse(document, 'mousemove', 260)
    expect(t.selected.size).toBe(0)
  })
})
