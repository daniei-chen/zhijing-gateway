import { describe, expect, it } from 'vitest'
import type { Group } from '@/types'
import { getPlanQuotas, getPlanStatus, hasPlanQuotaConfiguration } from '../planPresentation'
import { plan } from './fixtures'

describe('native subscription display windows', () => {
  it('keeps USD limits separate and derives each remaining amount from its own usage', () => {
    const quotas = getPlanQuotas(plan())
    expect(quotas.map(q => q.period)).toEqual(['daily', 'weekly', 'monthly'])
    expect(quotas[0].remaining).toBeCloseTo(27.16)
    expect(quotas[1].remaining).toBeCloseTo(453.27)
    expect(quotas[2].remaining).toBeCloseTo(1608.75)
  })

  it('uses the native 24h, 168h and 720h window lengths', () => {
    const quotas = getPlanQuotas(plan())
    expect(quotas[0].endsAt?.toISOString()).toBe('2026-11-05T12:00:00.000Z')
    expect(quotas[1].endsAt?.toISOString()).toBe('2026-11-08T12:00:00.000Z')
    expect(quotas[2].endsAt?.toISOString()).toBe('2026-11-14T12:00:00.000Z')
  })

  it('ends a one-time daily allowance at subscription expiry instead of inventing a reset', () => {
    const quota = getPlanQuotas(plan({ starts_at: '2026-11-04T12:00:00Z', expires_at: '2026-11-04T18:00:00Z' }))[0]
    expect(quota.oneTime).toBe(true)
    expect(quota.endsAt?.toISOString()).toBe('2026-11-04T18:00:00.000Z')
  })

  it('does not reset cached usage when a window has elapsed', () => {
    const subscription = plan({ daily_window_start: '2026-10-01T00:00:00Z' })
    expect(getPlanQuotas(subscription)[0].remaining).toBeCloseTo(27.16)
    expect(subscription.daily_usage_usd).toBe(12.84)
  })

  it('does not invent a countdown before the window starts or for an invalid timestamp', () => {
    const quotas = getPlanQuotas(plan({ daily_window_start: null, weekly_window_start: 'not-a-date' }))
    expect(quotas[0].endsAt).toBeNull()
    expect(quotas[1].endsAt).toBeNull()
  })

  it('keeps remaining quota and progress in range after overuse without hiding actual usage', () => {
    const quota = getPlanQuotas(plan({ daily_usage_usd: 55 }))[0]
    expect(quota.remaining).toBe(0)
    expect(quota.percent).toBe(100)
    expect(quota.used).toBe(55)
  })

  it('keeps native zero and null group limits as unlimited, while missing group data stays unknown', () => {
    const subscription = plan()
    subscription.group = { ...subscription.group, daily_limit_usd: 0, weekly_limit_usd: null, monthly_limit_usd: null } as Group
    expect(getPlanQuotas(subscription)).toEqual([])
    expect(hasPlanQuotaConfiguration(subscription)).toBe(true)
    expect(hasPlanQuotaConfiguration(plan({ group: undefined }))).toBe(false)
  })

  it('rejects invalid configuration as unknown rather than calling it unlimited', () => {
    const subscription = plan()
    subscription.group = { ...subscription.group, daily_limit_usd: Number.NaN } as Group
    expect(hasPlanQuotaConfiguration(subscription)).toBe(false)
  })

  it('does not present an expired, suspended or revoked plan as active', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    expect(getPlanStatus(plan({ expires_at: '2026-11-04T12:00:00Z' }), now)).toBe('expired')
    expect(getPlanStatus(plan({ status: 'suspended' }), now)).toBe('suspended')
    expect(getPlanStatus(plan({ status: 'revoked' }), now)).toBe('revoked')
    expect(getPlanStatus(plan({ expires_at: null }), now)).toBe('active')
  })
})
