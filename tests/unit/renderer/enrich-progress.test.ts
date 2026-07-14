import { describe, it, expect } from 'vitest'
// Pure renderer helper (type-only shared import); vitest resolves only @shared, so reach it by relative path.
import { summarizeFailures } from '../../../src/renderer/src/lib/enrich-progress'

describe('summarizeFailures (A1: honest Illuminate failure state)', () => {
  it('returns null when nothing failed', () => {
    expect(summarizeFailures([{ state: 'done' }, { state: 'empty' }])).toBeNull()
    expect(summarizeFailures([])).toBeNull()
  })

  it('counts failures and lists distinct reasons', () => {
    expect(
      summarizeFailures([
        { state: 'failed', reason: 'api' },
        { state: 'failed', reason: 'api' },
        { state: 'failed', reason: 'too_long' },
        { state: 'done' }
      ])
    ).toEqual({ count: 3, reasons: ['api', 'too_long'] })
  })

  it('defaults a missing reason to api', () => {
    expect(summarizeFailures([{ state: 'failed' }])).toEqual({ count: 1, reasons: ['api'] })
  })
})
