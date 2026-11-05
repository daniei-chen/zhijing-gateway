import type { TrendDataPoint } from '@/types'

export type DailyTokenUsage = {
  date: string
  tokens: number
  promptTokens: number
  cacheReadTokens: number
  actualCost: number
  standardCost: number
}

export const formatWorkspaceTokens = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString()

// Keep the API's calendar date and token total authoritative, including hourly responses.
export function rollupDailyTokenUsage(points: TrendDataPoint[]): DailyTokenUsage[] {
  const days = new Map<string, DailyTokenUsage>()
  const number = (value: number | undefined) => Number.isFinite(value) ? Number(value) : 0
  for (const point of points) {
    const date = point.date.slice(0, 10)
    const day = days.get(date) ?? { date, tokens: 0, promptTokens: 0, cacheReadTokens: 0, actualCost: 0, standardCost: 0 }
    const input = number(point.input_tokens)
    const output = number(point.output_tokens)
    const cacheRead = number(point.cache_read_tokens)
    const cacheWrite = number(point.cache_creation_tokens)
    day.tokens += point.total_tokens == null ? input + output + cacheRead + cacheWrite : number(point.total_tokens)
    day.promptTokens += input + cacheRead + cacheWrite
    day.cacheReadTokens += cacheRead
    day.actualCost += number(point.actual_cost)
    day.standardCost += number(point.cost)
    days.set(date, day)
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}
