<template>
  <details class="z-membership-card z-page-section" :class="`is-${status}`" @toggle="handleToggle">
    <summary class="z-membership-summary">
      <div class="z-membership-brand">
        <div class="z-membership-wordmark"><span>ZHIJING / MEMBERSHIP</span><Icon name="sparkles" size="sm" /></div>
        <img class="z-membership-emblem" src="/app-assets/zhijing-z.png" width="76" height="76" alt="" aria-hidden="true">
        <div class="z-membership-identity">
          <span class="z-membership-platform">{{ platformLabel(subscription.group?.platform || '') }}</span>
          <h3>{{ subscription.group?.name || `Group #${subscription.group_id}` }}</h3>
          <p v-if="subscription.group?.description" class="z-membership-description">{{ subscription.group.description }}</p>
        </div>
        <div class="z-membership-brand-bottom">
          <span class="z-membership-status"><i aria-hidden="true" />{{ t(`userSubscriptions.status.${status}`) }}</span>
          <span class="z-membership-expiry" :title="expirationLabel">
            {{ subscription.expires_at ? t('userSubscriptions.expires') : t('userSubscriptions.noExpiration') }}
            <strong v-if="subscription.expires_at">{{ expirationLabel }}</strong>
          </span>
        </div>
      </div>

      <div class="z-membership-overview">
        <div class="z-membership-overview-heading">
          <span>{{ t(status === 'active' ? 'memberWorkspace.quotaOverview' : 'memberWorkspace.quotaHistory') }}</span>
          <span class="z-membership-toggle">{{ t(expanded ? 'memberWorkspace.hideDetails' : 'memberWorkspace.viewDetails') }}<Icon name="chevronDown" size="sm" /></span>
        </div>
        <div v-if="quotas.length" class="z-membership-metrics">
          <div v-for="quota in quotas" :key="quota.period" class="z-membership-metric" :data-period="quota.period" :class="{ 'is-low': quota.percent >= 90 && status === 'active' }">
            <span class="z-membership-metric-label"><i aria-hidden="true" />{{ t(status === 'active' ? 'memberWorkspace.periodRemaining' : 'memberWorkspace.periodUsed', { period: t(`userSubscriptions.${quota.period}`) }) }}</span>
            <strong :title="`$${money(status === 'active' ? quota.remaining : quota.used)}`"><small>$</small>{{ summaryMoney(status === 'active' ? quota.remaining : quota.used) }}</strong>
            <span class="z-membership-metric-limit">{{ t('memberWorkspace.limit') }} ${{ money(quota.limit) }}</span>
          </div>
        </div>
        <div v-else class="z-membership-no-limit">
          <Icon :name="quotaConfigured ? 'sparkles' : 'infoCircle'" size="lg" />
          <div><strong>{{ t(quotaConfigured ? 'userSubscriptions.unlimited' : 'memberWorkspace.quotaUnavailable') }}</strong><p>{{ t(quotaConfigured ? 'userSubscriptions.unlimitedDesc' : 'memberWorkspace.quotaUnavailableDesc') }}</p></div>
        </div>
        <div class="z-membership-reset-summary">
          <Icon name="clock" size="sm" />
          <span v-if="status !== 'active'">{{ t(`userSubscriptions.status.${status}`) }}</span>
          <span v-else-if="nextQuota">{{ t(`userSubscriptions.${nextQuota.period}`) }} · {{ windowLabel(nextQuota) }}</span>
          <span v-else-if="quotas.length">{{ windowLabel(quotas[0]) }}</span>
          <span v-else>{{ t('memberWorkspace.detailsHint') }}</span>
        </div>
      </div>
    </summary>

    <div class="z-membership-details">
      <div class="z-membership-detail-heading">
        <h4>{{ t('memberWorkspace.usageDetails') }}</h4>
        <span>{{ t('memberWorkspace.usedOfLimit') }}</span>
      </div>
      <div v-for="quota in quotas" :key="quota.period" class="z-membership-quota" :data-period="quota.period" :class="{ 'is-warning': quota.percent >= 70, 'is-critical': quota.percent >= 90 }">
        <div class="z-membership-quota-label"><strong>{{ t(`userSubscriptions.${quota.period}`) }}</strong><span>{{ windowLabel(quota) }}</span></div>
        <div class="z-membership-quota-bar">
          <div class="z-membership-progress" role="progressbar" :aria-label="`${t(`userSubscriptions.${quota.period}`)} ${t('memberWorkspace.used')}`" :aria-valuenow="Math.round(quota.percent)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="t('userSubscriptions.usageOf', { used: `$${money(quota.used)}`, limit: `$${money(quota.limit)}` })"><span :style="{ width: `${quota.percent}%` }" /></div>
          <span>{{ t('memberWorkspace.usedPercent', { percent: quota.percent.toFixed(1) }) }}</span>
        </div>
        <div class="z-membership-quota-amount"><strong>${{ money(quota.used) }}</strong><span>/ ${{ money(quota.limit) }}</span></div>
      </div>
      <p v-if="!quotas.length" class="z-membership-no-quota-text">{{ t(quotaConfigured ? 'userSubscriptions.unlimitedDesc' : 'memberWorkspace.quotaUnavailableDesc') }}</p>
      <div class="z-membership-rate">
        <span>{{ t('payment.planCard.rate') }} <strong>×{{ subscription.group?.rate_multiplier ?? 1 }}</strong></span>
        <span v-if="peakRate">{{ t('payment.planCard.peakRate') }} <strong>{{ peakRate }}</strong></span>
      </div>
      <div class="z-membership-footer">
        <RouterLink to="/usage" class="z-membership-usage-link">{{ t('nav.usage') }}<Icon name="arrowRight" size="sm" /></RouterLink>
        <button v-if="subscription.status === 'active'" type="button" class="btn btn-primary" @click="$emit('renew')">{{ t('payment.renewNow') }}<Icon name="arrowRight" size="sm" /></button>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import type { UserSubscription } from '@/types'
import { formatDateTimeToMinute } from '@/utils/format'
import { platformLabel } from '@/utils/platformColors'
import { formatPeakRateWindow, hasPeakRate, serverTimezoneLabel } from '@/utils/peak-rate'
import { getRemainingDurationParts } from '@/utils/subscriptionQuota'
import { getPlanQuotas, getPlanStatus, hasPlanQuotaConfiguration, type PlanQuota } from './planPresentation'

const props = defineProps<{ subscription: UserSubscription }>()
defineEmits<{ renew: [] }>()
const { t } = useI18n()
const appStore = useAppStore()
const now = useNow({ interval: 60_000 })
const expanded = ref(false)
const quotas = computed(() => getPlanQuotas(props.subscription))
const quotaConfigured = computed(() => hasPlanQuotaConfiguration(props.subscription))
const status = computed(() => getPlanStatus(props.subscription, now.value))
const nextQuota = computed(() => quotas.value.filter(q => q.endsAt && q.endsAt.getTime() > now.value.getTime()).sort((a, b) => a.endsAt!.getTime() - b.endsAt!.getTime())[0])
const expirationLabel = computed(() => {
  const value = props.subscription.expires_at
  return value && Number.isFinite(new Date(value).getTime()) ? formatDateTimeToMinute(value) : '—'
})
const peakRate = computed(() => hasPeakRate(props.subscription.group)
  ? formatPeakRateWindow(props.subscription.group, serverTimezoneLabel(appStore.cachedPublicSettings?.server_utc_offset)) : '')
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const money = (value: number) => formatter.format(value)
const summaryMoney = (value: number) => value >= 10_000 ? compactFormatter.format(value) : money(value)

function handleToggle(event: Event) {
  expanded.value = (event.currentTarget as HTMLDetailsElement).open
}

function windowLabel(quota: PlanQuota): string {
  if (status.value !== 'active') return t(`userSubscriptions.status.${status.value}`)
  if (!quota.endsAt) return t('userSubscriptions.windowNotActive')
  const parts = getRemainingDurationParts(quota.endsAt, now.value)
  if (!parts) return t(quota.oneTime ? 'memberWorkspace.windowEnded' : 'memberWorkspace.resetPending')
  const time = parts.days > 0 ? `${parts.days}d ${parts.hours}h`
    : parts.hours > 0 ? `${parts.hours}h ${parts.minutes}m` : `${parts.minutes}m`
  return t(quota.oneTime ? 'userSubscriptions.quotaEndsIn' : 'userSubscriptions.resetIn', { time })
}
</script>

<style scoped>
.z-membership-card { min-width: 0; overflow: clip; border: 1px solid var(--z-line); border-radius: 22px; background: var(--z-surface); box-shadow: 0 10px 30px #34264b05; }
.z-membership-summary { display: grid; grid-template-columns: minmax(260px, .9fr) minmax(0, 1.25fr); list-style: none; cursor: pointer; }
.z-membership-summary::-webkit-details-marker { display: none; }
.z-membership-summary:focus-visible { outline: 3px solid var(--z-brand); outline-offset: -4px; border-radius: 21px; }
.z-membership-brand { position: relative; isolation: isolate; min-width: 0; min-height: 246px; padding: 25px 27px 23px; display: flex; flex-direction: column; justify-content: space-between; gap: 22px; overflow: hidden; color: #f9f6ff; background: radial-gradient(ellipse at 5% 0, #9164c74a, transparent 72%), linear-gradient(125deg, #443259, #242237); transition: min-height .28s var(--z-ease), padding .28s var(--z-ease); }
.z-membership-brand::after { content: ''; position: absolute; z-index: -1; width: 210px; height: 210px; right: -120px; top: -60px; border-radius: 50%; border: 1px solid #c1a5ff19; box-shadow: 0 0 0 35px #c1a5ff04, 0 0 0 70px #c1a5ff03; pointer-events: none; }
.z-membership-wordmark { display: flex; justify-content: space-between; align-items: center; gap: 16px; color: #d5c7eb; font: 9px var(--z-mono); letter-spacing: .13em; }
.z-membership-wordmark svg { opacity: .8; }
.z-membership-emblem { position: absolute; z-index: -1; width: 66px; height: 66px; right: 25px; top: 88px; opacity: .21; transform: rotate(-11deg); filter: brightness(1.9); pointer-events: none; }
.z-membership-identity { min-width: 0; padding-right: 35px; }
.z-membership-platform { display: inline-flex; max-width: 100%; overflow-wrap: anywhere; border: 1px solid #ffffff20; border-radius: 5px; padding: 2px 7px; margin-bottom: 7px; font-size: 10px; line-height: 1.6; color: #e3d8f4; }
.z-membership-identity h3 { font-size: 29px; font-weight: 650; letter-spacing: -.04em; line-height: 1.35; overflow-wrap: anywhere; }
.z-membership-description { margin-top: 8px; max-width: 280px; font-size: 12px; line-height: 1.65; color: #d2c8e0; overflow-wrap: anywhere; }
.z-membership-brand-bottom { display: flex; align-items: center; justify-content: space-between; gap: 15px; flex-wrap: wrap; }
.z-membership-status { display: inline-flex; gap: 6px; align-items: center; color: #d8d2e1; font-size: 11px; white-space: nowrap; }
.z-membership-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.is-active .z-membership-status { color: #a8f0d4; }
.is-revoked .z-membership-status, .is-suspended .z-membership-status { color: #ffd0c9; }
.z-membership-expiry { color: #c6bcd5; font-size: 10px; line-height: 1.7; }
.z-membership-expiry strong { display: block; color: #ebe5f5; font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.z-membership-overview { display: flex; flex-direction: column; justify-content: space-between; gap: 25px; min-width: 0; padding: 26px 28px 22px; background: radial-gradient(ellipse at 100% 0, #9b79db08, transparent 70%); }
.z-membership-overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--z-muted); font-size: 12px; }
.z-membership-toggle { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; font-size: 11px; color: var(--z-brand); }
.z-membership-toggle svg { transition: transform .25s var(--z-ease); }
[open] .z-membership-toggle svg { transform: rotate(180deg); }
.z-membership-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.z-membership-metric { --quota-color: #4f7cff; display: flex; flex-direction: column; min-width: 0; gap: 9px; }
[data-period='weekly'] { --quota-color: #16b99a; }
[data-period='monthly'] { --quota-color: #8b5cf6; }
.z-membership-metric-label { display: flex; align-items: center; gap: 6px; color: var(--z-muted); font-size: 11px; }
.z-membership-metric-label i { width: 5px; height: 5px; border-radius: 50%; background: var(--quota-color); flex-shrink: 0; }
.z-membership-metric > strong { font-size: clamp(19px, 2vw, 28px); font-weight: 600; letter-spacing: -.05em; color: var(--z-ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
.z-membership-metric > strong small { margin-right: 2px; color: var(--z-muted); font-size: .62em; font-weight: 500; }
.z-membership-metric-limit { color: var(--z-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.z-membership-metric.is-low > strong { color: #dc5b5b; }
.z-membership-reset-summary { display: flex; align-items: center; gap: 7px; color: var(--z-muted); font-size: 11px; line-height: 1.6; }
.z-membership-reset-summary > svg { flex-shrink: 0; color: var(--z-brand); }
.z-membership-no-limit { display: flex; align-items: center; gap: 13px; color: var(--z-brand); }
.z-membership-no-limit strong { color: var(--z-ink); font-size: 24px; font-weight: 600; }
.z-membership-no-limit p { margin-top: 8px; color: var(--z-muted); font-size: 12px; line-height: 1.7; }
.z-membership-details { border-top: 1px solid var(--z-line); padding: 24px 28px 22px; }
.z-membership-detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 9px; }
.z-membership-detail-heading h4 { color: var(--z-ink); font-size: 14px; font-weight: 600; }
.z-membership-detail-heading > span { color: var(--z-muted); font-size: 11px; }
.z-membership-quota { --quota-color: #4f7cff; display: grid; grid-template-columns: minmax(115px, .8fr) minmax(0, 1.5fr) minmax(110px, .7fr); align-items: center; gap: 22px; padding: 18px 0; border-bottom: 1px solid var(--z-line); }
.z-membership-quota[data-period='weekly'] { --quota-color: #16b99a; }
.z-membership-quota[data-period='monthly'] { --quota-color: #8b5cf6; }
.z-membership-quota.is-warning { --quota-color: #d79631; }
.z-membership-quota.is-critical { --quota-color: #dc5b5b; }
.z-membership-quota-label { display: flex; flex-direction: column; gap: 5px; }
.z-membership-quota-label strong { color: var(--z-ink); font-size: 13px; font-weight: 500; }
.z-membership-quota-label > span { color: var(--z-muted); font-size: 11px; line-height: 1.5; }
.z-membership-quota-bar { min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.z-membership-progress { height: 5px; overflow: hidden; border-radius: 9px; background: var(--z-line); }
.z-membership-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--quota-color); }
.z-membership-quota-bar > span { color: var(--z-muted); font-size: 11px; }
.z-membership-quota-amount { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; gap: 4px; color: var(--z-ink); font-variant-numeric: tabular-nums; font-size: 13px; }
.z-membership-quota-amount > strong { font-weight: 600; }
.z-membership-quota-amount > span { color: var(--z-muted); font-size: 11px; }
.z-membership-no-quota-text { margin: 15px 0; font-size: 13px; color: var(--z-muted); }
.z-membership-rate { display: flex; flex-wrap: wrap; gap: 9px 25px; padding: 16px 0; color: var(--z-muted); font-size: 11px; line-height: 1.6; }
.z-membership-rate strong { margin-left: 5px; color: var(--z-ink); font-weight: 500; }
.z-membership-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; border-top: 1px solid var(--z-line); }
.z-membership-footer .btn { min-height: 38px; gap: 12px; padding: 8px 17px; border-radius: 10px; font-size: 12px; }
.z-membership-usage-link { display: inline-flex; align-items: center; gap: 9px; min-height: 38px; font-size: 12px; color: var(--z-brand); }
.z-membership-card[open] .z-membership-brand { min-height: 170px; padding-block: 20px; gap: 12px; }
.z-membership-card[open] .z-membership-description { display: none; }
.z-membership-card[open] .z-membership-wordmark { display: none; }
.z-membership-card[open] .z-membership-identity h3 { font-size: 25px; }
.z-membership-card[open] .z-membership-emblem { top: 42px; }
.z-membership-card[open] .z-membership-overview { padding-block: 21px; gap: 16px; }
.z-membership-card[open] .z-membership-metric { gap: 5px; }
.z-membership-card[open] .z-membership-metric > strong { font-size: 23px; }
.z-membership-card[open] .z-membership-metric-limit { display: none; }
@media (prefers-reduced-motion: no-preference) {
  :global(.z-member-workspace[data-motion='full']) .z-membership-card[open] .z-membership-details { animation: membership-details-enter .25s ease-out; }
  :global(.z-member-workspace[data-motion='full']) .z-membership-progress > span { transition: width .3s ease; }
  @keyframes membership-details-enter { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
}
@media (prefers-reduced-motion: reduce) { .z-membership-card * { transition: none !important; animation: none !important; } }
@media (min-width: 1440px) { .z-membership-overview { padding-inline: 34px; } .z-membership-metrics { gap: 24px; } }
@media (max-width: 900px) { .z-membership-summary { grid-template-columns: minmax(0, 1fr); } .z-membership-brand { min-height: 205px; } .z-membership-identity { padding-right: 80px; } .z-membership-overview { gap: 23px; padding-block: 23px; } .z-membership-metric > strong { font-size: 27px; } .z-membership-card[open] .z-membership-brand { min-height: 150px; } }
@media (max-width: 600px) { .z-membership-card { border-radius: 17px; } .z-membership-brand { padding: 22px; gap: 19px; min-height: 215px; } .z-membership-brand-bottom { gap: 10px; } .z-membership-identity h3 { font-size: 27px; } .z-membership-overview { padding: 21px; gap: 22px; } .z-membership-metrics { gap: 10px; } .z-membership-metric-label { gap: 4px; font-size: 10px; } .z-membership-metric > strong, .z-membership-card[open] .z-membership-metric > strong { font-size: clamp(17px, 5vw, 25px); } .z-membership-metric-limit { font-size: 9px; } .z-membership-details { padding: 22px 21px; } .z-membership-quota { grid-template-columns: minmax(0, 1fr) auto; gap: 13px; padding-block: 16px; } .z-membership-quota-bar { grid-column: 1 / -1; grid-row: 2; flex-direction: row; align-items: center; gap: 14px; } .z-membership-progress { flex: 1; } .z-membership-quota-bar > span { flex-shrink: 0; } .z-membership-quota-amount { grid-column: 2; grid-row: 1; } }
@media (max-width: 360px) { .z-membership-overview, .z-membership-brand, .z-membership-details { padding-inline: 16px; } .z-membership-metric-label { font-size: 9px; } .z-membership-identity { padding-right: 35px; } }
</style>
