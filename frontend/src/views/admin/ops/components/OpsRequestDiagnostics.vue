<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OpsRequestDetail } from '@/api/admin/ops'
import OpsAdmissionNotice from './OpsAdmissionNotice.vue'
import { attemptMilestones, durationStages, getAdmissionHint, getGatewayTiming, ingressMilestones, measuredNumber } from '../utils/requestDiagnostics'

const props = defineProps<{ request: OpsRequestDetail }>()
const { t } = useI18n()
const timing = computed(() => getGatewayTiming(props.request.gateway_timing))
const admission = computed(() => getAdmissionHint(props.request))
const stages = computed(() => durationStages.map(stage => ({ ...stage, value: measuredNumber(timing.value?.metrics[stage.key]) })))
const milestones = computed(() => ingressMilestones.map(stage => ({ ...stage, value: measuredNumber(timing.value?.metrics[stage.key]) })))
const attempts = computed(() => attemptMilestones.map(stage => ({ ...stage, value: measuredNumber(timing.value?.metrics[stage.key]) })))
const scale = computed(() => Math.max(1, ...stages.value.map(stage => stage.value ?? 0)))
const hasMeasurements = computed(() => [...stages.value, ...milestones.value, ...attempts.value].some(stage => stage.value !== null))

function duration(value: unknown) {
  const n = measuredNumber(value)
  if (n === null) return t('admin.ops.diagnostics.unknown')
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(2)} s`
}
</script>

<template>
  <section class="ops-request-diagnostics" :aria-label="t('admin.ops.diagnostics.title')">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="ops-diagnostics-kicker">ZHIJING · REQUEST INSIGHT</div>
        <h3 class="mt-1 text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.ops.diagnostics.title') }}</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.diagnostics.subtitle') }}</p>
      </div>
      <span class="ops-diagnostics-source">{{ t(hasMeasurements ? 'admin.ops.diagnostics.memorySource' : 'admin.ops.diagnostics.noSample') }}</span>
    </div>

    <OpsAdmissionNotice v-if="admission" class="mt-4" :hint="admission" />

    <p v-if="!hasMeasurements" class="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-dark-800/60 dark:text-gray-300">
      {{ t('admin.ops.diagnostics.missingHint') }}
    </p>
    <p v-if="timing?.body_read_result === 'error'" class="mt-4 text-sm text-amber-700 dark:text-amber-300">{{ t('admin.ops.diagnostics.bodyInterrupted') }}</p>

    <div class="mt-5 grid gap-6 lg:grid-cols-2">
      <div>
        <h4 class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('admin.ops.diagnostics.stageTitle') }}</h4>
        <dl class="mt-3 space-y-3">
          <div v-for="stage in stages" :key="stage.key" :data-stage="stage.key">
            <div class="flex items-center justify-between gap-3 text-xs">
              <dt class="text-gray-600 dark:text-gray-300">{{ t(`admin.ops.diagnostics.stages.${stage.label}`) }}</dt>
              <dd class="shrink-0 font-mono tabular-nums" :class="stage.value === null ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'">{{ duration(stage.value) }}</dd>
            </div>
            <div class="ops-diagnostics-track" aria-hidden="true">
              <div v-if="stage.value !== null" class="ops-diagnostics-bar" :style="{ width: `${stage.value / scale * 100}%` }"></div>
            </div>
          </div>
        </dl>
      </div>

      <div>
        <h4 class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('admin.ops.diagnostics.milestoneTitle') }}</h4>
        <ol class="ops-milestones mt-3">
          <li v-for="stage in milestones" :key="stage.key" class="ops-milestone" :class="{ 'is-measured': stage.value !== null }" :data-stage="stage.key">
            <span class="ops-milestone-dot" aria-hidden="true"></span>
            <span class="min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-300">{{ t(`admin.ops.diagnostics.milestones.${stage.label}`) }}</span>
            <span class="shrink-0 font-mono text-xs tabular-nums" :class="stage.value === null ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'">{{ duration(stage.value) }}</span>
          </li>
        </ol>
      </div>
    </div>

    <div class="mt-5">
      <h4 class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('admin.ops.diagnostics.attemptTitle') }}</h4>
      <dl class="mt-3 grid gap-3 sm:grid-cols-3">
        <div v-for="stage in attempts" :key="stage.key" class="rounded-xl bg-indigo-50/60 p-3 dark:bg-indigo-950/30" :data-stage="stage.key">
          <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t(`admin.ops.diagnostics.attempts.${stage.label}`) }}</dt>
          <dd class="mt-2 font-mono text-sm tabular-nums text-gray-900 dark:text-white">{{ duration(stage.value) }}</dd>
        </div>
      </dl>
    </div>

    <div class="ops-forward-metric mt-5">
      <div>
        <span class="text-xs font-medium text-gray-700 dark:text-gray-200">{{ t('admin.ops.diagnostics.forwardFirst') }}</span>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.diagnostics.forwardHint') }}</p>
      </div>
      <span class="shrink-0 font-mono text-sm tabular-nums text-gray-900 dark:text-white">{{ duration(request.first_token_ms) }}</span>
    </div>
    <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.diagnostics.semanticHint') }}</p>
    <p v-if="hasMeasurements && timing" class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.diagnostics.retentionHint', { hours: Math.round(timing.retention_seconds / 3600), count: timing.capacity }) }}</p>
  </section>
</template>

<style scoped>
.ops-request-diagnostics { padding:1.25rem; border-radius:1.25rem; border:1px solid rgb(129 140 248 / .18); background:linear-gradient(135deg,rgb(255 255 255 / .94),rgb(238 242 255 / .7) 65%,rgb(236 254 255 / .6)); box-shadow:inset 0 1px 0 rgb(255 255 255 / .8),0 8px 30px rgb(79 70 229 / .04) }
.dark .ops-request-diagnostics { background:linear-gradient(135deg,rgb(30 33 48 / .96),rgb(30 27 55 / .9) 65%,rgb(20 40 47 / .88)); border-color:rgb(129 140 248 / .2); box-shadow:inset 0 1px 0 rgb(255 255 255 / .04) }
.ops-diagnostics-kicker { font-size:.6875rem; font-weight:600; letter-spacing:.12em; color:rgb(99 102 241) }
.dark .ops-diagnostics-kicker { color:rgb(165 180 252) }
.ops-diagnostics-source { border:1px solid rgb(129 140 248 / .18); border-radius:.6rem; padding:.35rem .6rem; font-size:.6875rem; color:rgb(79 70 229); background:rgb(99 102 241 / .05) }
.dark .ops-diagnostics-source { color:rgb(199 210 254) }
.ops-diagnostics-track { height:4px; margin-top:.45rem; border-radius:4px; overflow:hidden; background:rgb(129 140 248 / .1) }
.ops-diagnostics-bar { height:100%; border-radius:inherit; background:linear-gradient(90deg,rgb(129 140 248),rgb(56 189 248)) }
.ops-milestones { display:grid; gap:.75rem }
.ops-milestone { display:flex; align-items:center; gap:.65rem; min-height:1.6rem }
.ops-milestone-dot { width:.45rem; height:.45rem; flex-shrink:0; border-radius:50%; background:rgb(156 163 175 / .4) }
.is-measured .ops-milestone-dot { background:rgb(20 184 166); box-shadow:0 0 0 4px rgb(20 184 166 / .08) }
.ops-forward-metric { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:1rem; border-radius:.85rem; background:rgb(129 140 248 / .07) }
@media(max-width:420px) { .ops-request-diagnostics { padding:1rem } .ops-forward-metric { flex-wrap:wrap } }
</style>
