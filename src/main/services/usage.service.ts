import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { AiFeature, AiRunCost, AiUsage, UsageSummary } from '@shared/usage-types'

// Central AI cost accounting (ROADMAP P0-4). claude.service records every call here; totals persist
// at userData/usage.json in monthly buckets. Recording must NEVER break an AI call — every disk/state
// failure is swallowed into a warn. Prices are estimates pinned to this build (the API bills the
// truth; this exists so a $1 close-out is never a surprise again).

/** $ per MTok. Cache reads bill at 0.1× input; cache writes (5-minute TTL) at 1.25× input. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 }
}
/** Unknown model id → price as Opus (the most expensive tier), so estimates only ever overshoot. */
const FALLBACK = PRICES['claude-opus-4-8']

export function costOf(model: string, u: AiUsage): number {
  const p = PRICES[model] ?? FALLBACK
  return (
    (u.inputTokens * p.input +
      u.cacheReadTokens * p.input * 0.1 +
      u.cacheWriteTokens * p.input * 1.25 +
      u.outputTokens * p.output) /
    1_000_000
  )
}

interface FeatureBucket {
  calls: number
  usd: number
}
interface MonthBucket {
  usd: number
  calls: number
  byFeature: Partial<Record<AiFeature, FeatureBucket>>
}
interface UsageFile {
  months: Record<string, MonthBucket>
  lifetimeUsd: number
  lifetimeCalls: number
}

let state: UsageFile | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'usage.json')
}

function load(): UsageFile {
  if (state) return state
  try {
    if (existsSync(filePath())) {
      const raw = JSON.parse(readFileSync(filePath(), 'utf-8')) as Partial<UsageFile>
      state = {
        months: raw.months ?? {},
        lifetimeUsd: typeof raw.lifetimeUsd === 'number' ? raw.lifetimeUsd : 0,
        lifetimeCalls: typeof raw.lifetimeCalls === 'number' ? raw.lifetimeCalls : 0
      }
      return state
    }
  } catch (err) {
    log.warn('usage.json unreadable — starting fresh', err)
  }
  state = { months: {}, lifetimeUsd: 0, lifetimeCalls: 0 }
  return state
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

/** Record one call's usage; returns the priced usage so callers can surface per-run cost. */
export function recordUsage(feature: AiFeature, model: string, u: AiUsage): AiRunCost {
  const usd = costOf(model, u)
  try {
    const s = load()
    const key = monthKey()
    const month = (s.months[key] ??= { usd: 0, calls: 0, byFeature: {} })
    const f = (month.byFeature[feature] ??= { calls: 0, usd: 0 })
    month.usd += usd
    month.calls += 1
    f.usd += usd
    f.calls += 1
    s.lifetimeUsd += usd
    s.lifetimeCalls += 1
    writeFileSync(filePath(), JSON.stringify(s, null, 2))
  } catch (err) {
    log.warn('usage recording failed (call unaffected)', err)
  }
  return { ...u, usd }
}

export function usageSummary(): UsageSummary {
  const s = load()
  const key = monthKey()
  const month = s.months[key] ?? { usd: 0, calls: 0, byFeature: {} }
  return {
    monthKey: key,
    monthUsd: month.usd,
    monthCalls: month.calls,
    byFeature: month.byFeature,
    lifetimeUsd: s.lifetimeUsd,
    lifetimeCalls: s.lifetimeCalls
  }
}

/** Test seam: drop the in-memory cache so a fresh file (or temp dir) is re-read. */
export function _resetUsageForTests(): void {
  state = null
}
