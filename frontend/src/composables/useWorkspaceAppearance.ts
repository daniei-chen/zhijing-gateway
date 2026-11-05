import { computed, ref } from 'vue'
import { createSharedComposable, useMediaQuery, useMutationObserver, useStorage } from '@vueuse/core'

/** Presentation preferences only. No account, billing or request state. */
export const useWorkspaceAppearance = createSharedComposable(() => {
  const isDark = ref(document.documentElement.classList.contains('dark'))
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const motionPreference = useStorage('zhijing-workspace-motion', true)

  useMutationObserver(document.documentElement, () => {
    isDark.value = document.documentElement.classList.contains('dark')
  }, { attributes: true, attributeFilter: ['class'] })

  const motionEnabled = computed(() => motionPreference.value && !prefersReducedMotion.value)
  const toggleMotion = () => { motionPreference.value = !motionPreference.value }

  return { isDark, prefersReducedMotion, motionEnabled, toggleMotion }
})
