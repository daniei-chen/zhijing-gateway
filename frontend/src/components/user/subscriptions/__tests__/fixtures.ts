import type { Group, UserSubscription } from '@/types'

export function plan(overrides: Partial<UserSubscription> = {}): UserSubscription {
  return {
    id: 12, user_id: 1, group_id: 9, status: 'active',
    starts_at: '2026-10-15T12:00:00Z', expires_at: '2026-11-15T12:00:00Z',
    daily_usage_usd: 12.84, weekly_usage_usd: 146.73, monthly_usage_usd: 391.25,
    daily_window_start: '2026-11-04T12:00:00Z',
    weekly_window_start: '2026-11-01T12:00:00Z',
    monthly_window_start: '2026-10-15T12:00:00Z',
    created_at: '2026-10-15T12:00:00Z', updated_at: '2026-11-04T12:00:00Z',
    group: { id: 9, name: 'Plan A', platform: 'openai', rate_multiplier: 1, daily_limit_usd: 40, weekly_limit_usd: 600, monthly_limit_usd: 2000 } as Group,
    ...overrides
  }
}
