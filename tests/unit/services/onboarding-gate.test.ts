import { describe, expect, it } from 'vitest'
import { deriveTutorialDone } from '../../../src/main/services/onboarding-gate'

// The first-run-tutorial gate (ADR-059). The load-bearing case is the mid-tour relaunch: the spotlight
// tour creates a REAL campaign at step 1, so campaigns-exist alone must NOT count as onboarded while a
// `tutorialStep` marks a tour in progress.
describe('deriveTutorialDone', () => {
  const gate = (
    tutorialCompleted: boolean,
    skipped: boolean,
    campaignCount: number,
    tutorialStep: string | undefined
  ): boolean => deriveTutorialDone({ tutorialCompleted, skipped, campaignCount, tutorialStep })

  it('fresh install → tutorial runs', () => {
    expect(gate(false, false, 0, undefined)).toBe(false)
  })

  it('mid-tour relaunch (campaign already created at step 1) → tour RESUMES, not done', () => {
    expect(gate(false, false, 1, 'session')).toBe(false)
  })

  it('quit right after the welcome page (no campaign yet) → tour resumes', () => {
    expect(gate(false, false, 0, 'campaign')).toBe(false)
  })

  it('grandfathered pre-tutorial data (campaigns, no step) → done', () => {
    expect(gate(false, false, 3, undefined)).toBe(true)
  })

  it('completed flag → done', () => {
    expect(gate(true, false, 1, undefined)).toBe(true)
  })

  it('e2e skip seam → done', () => {
    expect(gate(false, true, 0, undefined)).toBe(true)
  })

  it('completed wins over a stale leftover step', () => {
    expect(gate(true, false, 1, 'guide')).toBe(true)
  })
})
