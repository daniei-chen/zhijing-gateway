import type { UserSubscription } from '@/types'
import { isOneTimeDailyQuota } from '@/utils/subscriptionQuota'

export type PlanPeriod = 'daily' | 'weekly' | 'monthly'

export interface PlanQuota {
  period: PlanPeriod
  limit: number
  used: number
  remaining: number
  percent: number
  endsAt: Date | null
  oneTime: boolean
}

const windows: ReadonlyArray<{ period: PlanPeriod; hours: number }> = [
  { period: 'daily', hours: 24 },
  { period: 'weekly', hours: 168 },
  { period: 'monthly', hours: 720 }
]

// Display the existing USD windows individually. This never resets usage,
// combines windows, changes a subscription, or converts it to a new currency.
export function getPlanQuotas(subscription: UserSubscription): PlanQuota[] {
  const quotas: PlanQuota[] = []
  for (const { period, hours } of windows) {
    const limit = subscription.group?.[`${period}_limit_usd`]
    if (limit == null || !Number.isFinite(limit) || limit <= 0) continue
    const rawUsage = subscription[`${period}_usage_usd`]
    const used = Number.isFinite(rawUsage) ? Math.max(0, rawUsage) : 0
    const oneTime = period === 'daily' && isOneTimeDailyQuota(subscription)
    const start = subscription[`${period}_window_start`]
    const end = oneTime && subscription.expires_at
      ? new Date(subscription.expires_at)
      : start ? new Date(new Date(start).getTime() + hours * 3_600_000) : null
    quotas.push({
      period, limit, used,
      remaining: Math.max(0, limit - used),
      percent: Math.min(100, Math.max(0, used / limit * 100)),
      endsAt: end && Number.isFinite(end.getTime()) ? end : null,
      oneTime
    })
  }
  return quotas
}

export function getPlanStatus(subscription: UserSubscription, now: Date): UserSubscription['status'] {
  if (subscription.status !== 'active' || !subscription.expires_at) return subscription.status
  const expiry = new Date(subscription.expires_at).getTime()
  return Number.isFinite(expiry) && expiry <= now.getTime() ? 'expired' : subscription.status
}

export function hasPlanQuotaConfiguration(subscription: UserSubscription): boolean {
  if (!subscription.group) return false
  return windows.every(({ period }) => {
    const limit = subscription.group?.[`${period}_limit_usd`]
    return limit == null || (Number.isFinite(limit) && limit >= 0)
  })
}
