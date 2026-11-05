<template>
  <section class="z-daily-token-chart card p-4">
    <header class="z-trend-header">
      <div><h3>{{ zh ? '每日 Token 使用' : 'Daily token usage' }}</h3><p>{{ zh ? '每日总量，配合缓存命中率一起看。' : 'Daily totals, with cache efficiency in view.' }}</p></div>
      <span class="z-trend-daily-badge">DAILY</span>
    </header>
    <div class="z-trend-metrics">
      <div class="z-trend-metric"><span><i aria-hidden="true"></i>{{ zh ? '所选区间总 Token' : 'Tokens in this period' }}</span><strong>{{ loading ? '—' : formatTokens(summary.tokens) }}</strong></div>
      <div class="z-trend-metric"><span><i aria-hidden="true"></i>{{ zh ? '缓存命中率' : 'Cache hit rate' }}</span><strong>{{ loading || !summary.promptTokens ? '—' : `${hitRate(summary).toFixed(1)}%` }}</strong></div>
    </div>
    <div v-if="loading" class="flex h-48 items-center justify-center"><LoadingSpinner /></div>
    <div v-else-if="dailyData.length" class="h-48"><Line :data="chartData" :options="chartOptions" role="img" :aria-label="zh ? '每日总 Token 与缓存命中率曲线' : 'Daily total tokens and cache hit rate'" /></div>
    <div v-else class="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.dashboard.noDataAvailable') }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, type ChartData, type ChartOptions } from 'chart.js'
import { Line } from 'vue-chartjs'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useWorkspaceAppearance } from '@/composables/useWorkspaceAppearance'
import { rollupDailyTokenUsage, formatWorkspaceTokens as formatTokens, type DailyTokenUsage } from './dailyTokenUsage'
import type { TrendDataPoint } from '@/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)
const props = defineProps<{ trendData: TrendDataPoint[]; loading?: boolean }>()
const { t, locale } = useI18n()
const zh = computed(() => locale?.value === 'zh')
const { isDark, motionEnabled } = useWorkspaceAppearance()
const dailyData = computed(() => rollupDailyTokenUsage(props.trendData))
const summary = computed(() => dailyData.value.reduce((sum, day) => ({
  tokens: sum.tokens + day.tokens,
  promptTokens: sum.promptTokens + day.promptTokens,
  cacheReadTokens: sum.cacheReadTokens + day.cacheReadTokens
}), { tokens: 0, promptTokens: 0, cacheReadTokens: 0 }))
const hitRate = (day: Pick<DailyTokenUsage, 'promptTokens' | 'cacheReadTokens'>) => day.promptTokens > 0 ? day.cacheReadTokens / day.promptTokens * 100 : 0
const chartData = computed<ChartData<'line'>>(() => ({
  labels: dailyData.value.map(day => day.date),
  datasets: [
    {
      label: zh.value ? '每日 Token' : 'Daily tokens',
      data: dailyData.value.map(day => day.tokens),
      borderColor: isDark.value ? '#80a0ff' : '#4f7cff',
      backgroundColor: context => {
        const { ctx, chartArea } = context.chart
        if (!chartArea) return '#4f7cff12'
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
        gradient.addColorStop(0, isDark.value ? '#4f7cff35' : '#4f7cff23')
        gradient.addColorStop(1, '#4f7cff00')
        return gradient
      },
      fill: true, borderWidth: 2.8, tension: .36, pointRadius: dailyData.value.length === 1 ? 4 : 0, pointHoverRadius: 5, pointHoverBorderWidth: 3, pointHoverBorderColor: isDark.value ? '#211e2b' : '#ffffff', yAxisID: 'y'
    },
    {
      label: zh.value ? '缓存命中率' : 'Cache hit rate',
      data: dailyData.value.map(hitRate),
      borderColor: isDark.value ? '#48d9bb' : '#16b99a',
      backgroundColor: '#16b99a', borderWidth: 1.8, borderDash: [4, 4], fill: false, tension: .32, pointRadius: dailyData.value.length === 1 ? 3 : 0, pointHoverRadius: 4, yAxisID: 'yPercent'
    }
  ]
}))
const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true, maintainAspectRatio: false,
  animation: motionEnabled.value ? { duration: 650, easing: 'easeOutQuart' } : false,
  interaction: { intersect: false, mode: 'index' },
  layout: { padding: { top: 8, right: 2 } },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: isDark.value ? '#f4f1fa' : '#292633', titleColor: isDark.value ? '#292633' : '#ffffff', bodyColor: isDark.value ? '#292633' : '#ffffff', footerColor: isDark.value ? '#696277' : '#c6bdd5', padding: 13, cornerRadius: 10, boxPadding: 5,
      callbacks: {
        label: context => `${context.dataset.label}: ${context.dataset.yAxisID === 'yPercent' ? `${Number(context.raw).toFixed(1)}%` : formatTokens(Number(context.raw))}`,
        footer: items => {
          const day = dailyData.value[items[0]?.dataIndex ?? -1]
          return day ? `${t('dashboard.actual')}: $${day.actualCost.toFixed(4)} · ${t('dashboard.standard')}: $${day.standardCost.toFixed(4)}` : ''
        }
      }
    }
  },
  scales: {
    x: { border: { display: false }, grid: { display: false }, ticks: { color: isDark.value ? '#aaa6b8' : '#9393a4', maxTicksLimit: 6, maxRotation: 0, padding: 10, font: { size: 10 }, callback: function(value) { return this.getLabelForValue(Number(value)).slice(5).replace('-', '/') } } },
    y: { beginAtZero: true, border: { display: false, dash: [3, 5] }, grid: { color: isDark.value ? '#ffffff09' : '#24233309', drawTicks: false }, ticks: { color: isDark.value ? '#aaa6b8' : '#9393a4', maxTicksLimit: 5, padding: 10, font: { size: 9 }, callback: value => formatTokens(Number(value)) } },
    yPercent: { position: 'right', min: 0, max: 100, border: { display: false }, grid: { display: false }, ticks: { color: isDark.value ? '#48d9bb' : '#16a488', stepSize: 25, padding: 9, font: { size: 9 }, callback: value => `${value}%` } }
  }
}))
</script>
