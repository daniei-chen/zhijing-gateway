import { describe, expect, it } from 'vitest'
import { rollupDailyTokenUsage } from '../dailyTokenUsage'
import type { TrendDataPoint } from '@/types'

const point = (extra: Partial<TrendDataPoint>): TrendDataPoint => ({
  date: '2026-11-04', requests: 1, input_tokens: 0, output_tokens: 0,
  cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0,
  actual_cost: 0, cost: 0, ...extra
})

describe('daily token usage presentation', () => {
  it('combines hourly points by the API calendar date and sums authoritative totals and costs', () => {
    const result = rollupDailyTokenUsage([
      point({ date: '2026-11-04 08:00', total_tokens: 200, actual_cost: .2, cost: .3 }),
      point({ date: '2026-11-03', total_tokens: 80 }),
      point({ date: '2026-11-04T20:00:00-08:00', total_tokens: 700, actual_cost: .4, cost: .5 })
    ])
    expect(result.map(day => [day.date, day.tokens])).toEqual([['2026-11-03', 80], ['2026-11-04', 900]])
    expect(result[1].actualCost).toBeCloseTo(.6)
    expect(result[1].standardCost).toBeCloseTo(.8)
  })

  it('retains prompt and cached totals so the daily hit rate is weighted by token volume', () => {
    const [day] = rollupDailyTokenUsage([
      point({ date: '2026-11-04 08:00', input_tokens: 100, cache_read_tokens: 900, total_tokens: 1100 }),
      point({ date: '2026-11-04 09:00', input_tokens: 7800, cache_creation_tokens: 300, cache_read_tokens: 900, total_tokens: 9500 })
    ])
    expect(day.promptTokens).toBe(10000)
    expect(day.cacheReadTokens).toBe(1800)
    expect(day.cacheReadTokens / day.promptTokens * 100).toBe(18)
    expect(day.tokens).toBe(10600)
  })

  it('preserves an explicit zero total and safely handles an empty period', () => {
    expect(rollupDailyTokenUsage([])).toEqual([])
    expect(rollupDailyTokenUsage([point({ input_tokens: 20, total_tokens: 0 })])[0].tokens).toBe(0)
  })
})
