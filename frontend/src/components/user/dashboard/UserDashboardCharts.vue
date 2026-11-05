<template>
  <div class="z-workbench-charts">
    <!-- Date Range Filter -->
    <div class="z-workbench-chart-toolbar">
      <div class="z-workbench-chart-title"><h3>{{ locale === 'zh' ? '使用概览' : 'Usage overview' }}</h3><span>YOUR ACTIVITY</span></div>
      <div class="z-workbench-chart-controls">
        <div class="flex items-center gap-2">
          <DateRangePicker :start-date="startDate" :end-date="endDate" @update:startDate="$emit('update:startDate', $event)" @update:endDate="$emit('update:endDate', $event)" @change="$emit('dateRangeChange', $event)" />
        </div>
        <span class="z-trend-daily-badge">{{ locale === 'zh' ? '按日统计' : 'DAILY' }}</span>
        <button @click="$emit('refresh')" :disabled="loading" class="btn btn-secondary" :aria-label="t('common.refresh')"><Icon name="refresh" size="sm" />{{ t('common.refresh') }}</button>
      </div>
    </div>

    <!-- Charts Grid -->
    <div class="z-workbench-chart-grid">
      <TokenUsageTrend class="z-workbench-trend" :trend-data="trend" :loading="loading" daily />
      <!-- Model Distribution Chart -->
      <div class="card z-model-panel">
        <div v-if="loading" class="z-chart-loading">
          <LoadingSpinner size="md" />
        </div>
        <div class="z-model-panel-title"><h3>{{ t('dashboard.modelDistribution') }}</h3><span>MODEL MIX</span></div>
        <template v-if="modelData">
          <div class="z-model-ring">
            <Doughnut :data="modelData" :options="doughnutOptions" role="img" :aria-label="t('dashboard.modelDistribution')" />
            <div class="z-model-ring-center"><strong>{{ formatTokens(totalModelTokens) }}</strong><span>{{ t('dashboard.tokens') }}</span></div>
          </div>
          <ul class="z-model-list">
            <li v-for="(model, index) in models" :key="model.model">
              <div class="z-model-list-heading"><div class="z-model-list-name"><i :style="{ backgroundColor: zhijingChartColors[index % zhijingChartColors.length] }" aria-hidden="true" /><span>{{ model.model }}</span></div><span>{{ formatTokens(model.total_tokens) }}</span></div>
              <div class="z-model-share" aria-hidden="true"><span :style="{ width: `${totalModelTokens ? Math.min(100, model.total_tokens / totalModelTokens * 100) : 0}%`, backgroundColor: zhijingChartColors[index % zhijingChartColors.length] }"></span></div>
              <div class="z-model-list-detail"><span>{{ formatNumber(model.requests) }} {{ t('dashboard.requests') }}</span><span>{{ t('dashboard.actual') }} ${{ formatCost(model.actual_cost) }} · {{ t('dashboard.standard') }} ${{ formatCost(model.cost) }}</span></div>
            </li>
          </ul>
        </template>
        <div v-else class="z-model-empty">{{ t('dashboard.noDataAvailable') }}</div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import DateRangePicker from '@/components/common/DateRangePicker.vue'
import Icon from '@/components/icons/Icon.vue'
import { useWorkspaceAppearance } from '@/composables/useWorkspaceAppearance'
import { zhijingChartColors } from '@/components/charts/zhijingPalette'
import { formatWorkspaceTokens as formatTokens } from '@/components/charts/dailyTokenUsage'
import { Doughnut } from 'vue-chartjs'
import TokenUsageTrend from '@/components/charts/TokenUsageTrend.vue'
import type { TrendDataPoint, ModelStat } from '@/types'
import { formatCostFixed as formatCost, formatNumberLocaleString as formatNumber } from '@/utils/format'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import type { ChartOptions } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler)

const props = defineProps<{ loading: boolean, startDate: string, endDate: string, granularity: string, trend: TrendDataPoint[], models: ModelStat[] }>()
defineEmits(['update:startDate', 'update:endDate', 'update:granularity', 'dateRangeChange', 'granularityChange', 'refresh'])
const { t, locale } = useI18n()
const { motionEnabled, isDark } = useWorkspaceAppearance()
const totalModelTokens = computed(() => props.models.reduce((sum, model) => sum + (model.total_tokens || 0), 0))

const modelData = computed(() => !props.models?.length ? null : {
  labels: props.models.map((m: ModelStat) => m.model),
  datasets: [{
    data: props.models.map((m: ModelStat) => m.total_tokens),
    backgroundColor: props.models.map((_, index) => zhijingChartColors[index % zhijingChartColors.length]),
    borderWidth: 0,
    borderRadius: 3,
    spacing: 3
  }]
})

const doughnutOptions = computed<ChartOptions<'doughnut'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '80%',
  animation: motionEnabled.value ? { duration: 650, easing: 'easeOutQuart' } : false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: isDark.value ? '#ede8f5' : '#292633',
      bodyColor: isDark.value ? '#292633' : '#ffffff',
      titleColor: isDark.value ? '#292633' : '#ffffff',
      callbacks: {
        label: (context: any) => `${context.label}: ${formatTokens(context.parsed)} tokens`
      }
    }
  }
}))
</script>
