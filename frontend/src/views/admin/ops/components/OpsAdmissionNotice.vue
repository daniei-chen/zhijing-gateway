<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AdmissionHint } from '../utils/requestDiagnostics'

const props = defineProps<{ hint: AdmissionHint }>()
const { t } = useI18n()
const isLegacy = computed(() => props.hint.basis === 'legacy')
</script>

<template>
  <aside class="ops-admission-notice" :aria-label="t('admin.ops.diagnostics.admissionTitle')">
    <div class="flex flex-wrap items-center gap-2">
      <span class="ops-admission-dot" aria-hidden="true"></span>
      <h4 class="text-sm font-semibold">{{ t(`admin.ops.diagnostics.scope.${hint.scope}`) }}</h4>
      <span v-if="hint.limit !== null" class="ops-admission-limit">{{ t('admin.ops.diagnostics.limit', { n: hint.limit }) }}</span>
      <span v-if="isLegacy" class="ml-auto text-xs">{{ t('admin.ops.diagnostics.legacyBadge') }}</span>
    </div>
    <p class="mt-2 text-sm">{{ t('admin.ops.diagnostics.admissionAdvice') }}</p>
    <p v-if="isLegacy" class="mt-2 text-xs opacity-80">{{ t('admin.ops.diagnostics.legacyHint') }}</p>
    <p v-else class="mt-2 text-xs opacity-80">{{ t('admin.ops.diagnostics.recordedHint') }}</p>
  </aside>
</template>

<style scoped>
.ops-admission-notice { padding:1rem; border:1px solid rgb(99 102 241 / .2); border-radius:1rem; background:linear-gradient(115deg,rgb(99 102 241 / .08),rgb(6 182 212 / .07)); color:rgb(55 48 163) }
.dark .ops-admission-notice { color:rgb(199 210 254); border-color:rgb(129 140 248 / .25) }
.ops-admission-dot { width:.45rem; height:.45rem; border-radius:50%; background:rgb(99 102 241); box-shadow:0 0 0 4px rgb(99 102 241 / .1) }
.ops-admission-limit { border-radius:.5rem; padding:.2rem .5rem; font-size:.75rem; background:rgb(99 102 241 / .09); font-variant-numeric:tabular-nums }
</style>
