<template>
  <span ref="marker" class="z-admin-nav-marker" :data-visible="visible" :style="{ height: `${height}px`, transform: `translateY(${top}px)` }" aria-hidden="true"></span>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ path: string }>()
const marker = ref<HTMLElement | null>(null)
const top = ref(0)
const height = ref(0)
const visible = ref(false)
let observer: ResizeObserver | undefined

// Follow the native active link, including expanded children. Never intercept navigation.
function measure() {
  const island = marker.value?.parentElement
  const active = island?.querySelector<HTMLElement>('a.sidebar-link-active[aria-current="page"]')
    ?? island?.querySelector<HTMLElement>('.sidebar-link-active')
  visible.value = !!active
  if (!active || !island) return
  const bounds = active.getBoundingClientRect()
  top.value = bounds.top - island.getBoundingClientRect().top - island.clientTop
  height.value = bounds.height
}

watch(() => props.path, async () => { await nextTick(); measure() })
onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined' || !marker.value?.parentElement) return
  observer = new ResizeObserver(measure)
  observer.observe(marker.value.parentElement)
})
onUnmounted(() => observer?.disconnect())
</script>
