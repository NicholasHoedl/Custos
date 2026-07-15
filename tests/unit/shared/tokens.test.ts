import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  MAX_EXTRACT_INPUT_TOKENS,
  EXTRACT_ADVISORY_TOKENS
} from '../../../src/shared/tokens'

describe('estimateTokens (D1 pre-flight size guard)', () => {
  it('estimates ~1 token per 4 characters', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('rounds up a partial token', () => {
    expect(estimateTokens('abcde')).toBe(2) // 5/4 → 1.25 → 2
  })

  it('the hard ceiling sits under Claude context but above any real session; advisory is lower', () => {
    expect(MAX_EXTRACT_INPUT_TOKENS).toBeLessThan(200_000)
    expect(EXTRACT_ADVISORY_TOKENS).toBeLessThan(MAX_EXTRACT_INPUT_TOKENS)
    // a genuinely pathological ~700k-char paste trips the hard guard (import.service returns too_long)
    expect(estimateTokens('x'.repeat(700_000))).toBeGreaterThan(MAX_EXTRACT_INPUT_TOKENS)
  })
})
