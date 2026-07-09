import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// usage.service (P0-4): pricing math, monthly bucketing, persistence, and the never-throw guarantee.
const dir = mkdtempSync(join(tmpdir(), 'ledger-usage-'))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import {
  costOf,
  recordUsage,
  usageSummary,
  _resetUsageForTests
} from '../../../src/main/services/usage.service'

const u = (inp: number, out: number, read = 0, write = 0) => ({
  inputTokens: inp,
  outputTokens: out,
  cacheReadTokens: read,
  cacheWriteTokens: write
})

beforeEach(() => _resetUsageForTests())

describe('usage.service', () => {
  it('prices per model, with cache reads at 0.1× and writes at 1.25× input', () => {
    // Opus 4.8: $5 in / $25 out per MTok.
    expect(costOf('claude-opus-4-8', u(1_000_000, 0))).toBeCloseTo(5, 6)
    expect(costOf('claude-opus-4-8', u(0, 1_000_000))).toBeCloseTo(25, 6)
    // Sonnet 4.6: $3/$15; cache tiers scale the INPUT price.
    expect(costOf('claude-sonnet-4-6', u(0, 0, 1_000_000, 0))).toBeCloseTo(0.3, 6)
    expect(costOf('claude-sonnet-4-6', u(0, 0, 0, 1_000_000))).toBeCloseTo(3.75, 6)
    // A realistic enrich call: 5k in, 1.5k out on Sonnet ≈ $0.0375.
    expect(costOf('claude-sonnet-4-6', u(5_000, 1_500))).toBeCloseTo(0.0375, 6)
  })

  it('prices unknown models as Opus — estimates only overshoot', () => {
    expect(costOf('claude-next-99', u(1_000_000, 0))).toBeCloseTo(5, 6)
  })

  it('records into the current month + per-feature buckets and persists across reloads', () => {
    const run = recordUsage('illuminate', 'claude-sonnet-4-6', u(5_000, 1_500))
    expect(run.usd).toBeCloseTo(0.0375, 6)
    recordUsage('illuminate', 'claude-sonnet-4-6', u(5_000, 1_500))
    recordUsage('lore', 'claude-sonnet-4-6', u(1_000_000, 0))

    _resetUsageForTests() // force a re-read from disk
    const s = usageSummary()
    expect(s.monthKey).toMatch(/^\d{4}-\d{2}$/)
    expect(s.monthCalls).toBe(3)
    expect(s.monthUsd).toBeCloseTo(0.075 + 3, 6)
    expect(s.byFeature.illuminate).toEqual({ calls: 2, usd: expect.closeTo(0.075, 6) })
    expect(s.byFeature.lore?.calls).toBe(1)
    expect(s.lifetimeUsd).toBeCloseTo(s.monthUsd, 6)
    expect(s.lifetimeCalls).toBe(3)
  })
})
