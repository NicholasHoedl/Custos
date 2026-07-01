import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import * as schema from '../../../src/main/db/schema'
import { createCampaign } from '../../../src/main/services/campaign.service'
import {
  getEntityHistory,
  isIntervalLiveAt,
  lifecycleHeuristic,
  stateAsOf
} from '../../../src/main/services/chronology.service'
import { makeTestDb } from '../../helpers/test-db'

describe('chronology.service', () => {
  describe('lifecycleHeuristic (must mirror migration 0005)', () => {
    it('maps blank/null to unknown', () => {
      expect(lifecycleHeuristic(null)).toBe('unknown')
      expect(lifecycleHeuristic('')).toBe('unknown')
      expect(lifecycleHeuristic('   ')).toBe('unknown')
    })
    it('maps death/destruction words to ended (case-insensitive, substring)', () => {
      expect(lifecycleHeuristic('Dead')).toBe('ended')
      expect(lifecycleHeuristic('DECEASED')).toBe('ended')
      expect(lifecycleHeuristic('city destroyed in the fire')).toBe('ended')
      expect(lifecycleHeuristic('disbanded')).toBe('ended')
    })
    it('maps everything else to active', () => {
      expect(lifecycleHeuristic('Alive and well')).toBe('active')
      expect(lifecycleHeuristic('Occupied')).toBe('active')
    })
  })

  describe('isIntervalLiveAt', () => {
    it('treats a null start as pre-tracking and a null end as still open', () => {
      expect(isIntervalLiveAt(null, null, 1)).toBe(true)
      expect(isIntervalLiveAt(null, null, 99)).toBe(true)
    })
    it('is inclusive of the start session and exclusive of the end session', () => {
      expect(isIntervalLiveAt(3, 5, 2)).toBe(false) // before it started
      expect(isIntervalLiveAt(3, 5, 3)).toBe(true) // at start (inclusive)
      expect(isIntervalLiveAt(3, 5, 4)).toBe(true)
      expect(isIntervalLiveAt(3, 5, 5)).toBe(false) // severed in 5 -> already gone at 5
      expect(isIntervalLiveAt(3, null, 10)).toBe(true) // open interval
    })
  })

  describe('stateAsOf / getEntityHistory', () => {
    let ctx: DbContext
    let campaignId: string

    beforeEach(() => {
      ctx = makeTestDb()
      campaignId = createCampaign(ctx, { name: 'C' }).id
    })

    // Insert a BARE entity (bypassing createEntity, which now seeds a baseline history row) so each
    // test controls exactly which status_history rows exist.
    const makeEntity = (name: string): string => {
      const id = `e-${name}`
      ctx.drizzle
        .insert(schema.entity)
        .values({
          id,
          campaignId,
          type: 'npc',
          name,
          description: null,
          traits: '[]',
          goals: '[]',
          attributes: '{}',
          status: null,
          lifecycle: 'unknown',
          createdAt: 1,
          updatedAt: 1
        })
        .run()
      return id
    }

    const history = (
      entityId: string,
      lifecycle: string,
      status: string | null,
      sinceSessionNumber: number | null,
      recordedAt: number
    ): void => {
      ctx.drizzle
        .insert(schema.statusHistory)
        .values({
          id: `h-${entityId}-${recordedAt}`,
          entityId,
          lifecycle,
          status,
          sinceSessionNumber,
          recordedAt
        })
        .run()
    }

    it('returns the latest applicable row; a pre-tracking baseline applies to all n', () => {
      const e = makeEntity('Duke')
      history(e, 'active', 'Alive', null, 100) // pre-tracking baseline
      history(e, 'ended', 'Dead', 3, 200) // died in session 3

      expect(stateAsOf(ctx, e, 1)).toEqual({ lifecycle: 'active', status: 'Alive' })
      expect(stateAsOf(ctx, e, 2)).toEqual({ lifecycle: 'active', status: 'Alive' })
      expect(stateAsOf(ctx, e, 3)).toEqual({ lifecycle: 'ended', status: 'Dead' }) // inclusive
      expect(stateAsOf(ctx, e, 9)).toEqual({ lifecycle: 'ended', status: 'Dead' })
    })

    it('tie-breaks rows with the same session by recordedAt', () => {
      const e = makeEntity('Flip')
      history(e, 'active', 'first', 4, 100)
      history(e, 'ended', 'second', 4, 200) // same session, later edit wins
      expect(stateAsOf(ctx, e, 4)).toEqual({ lifecycle: 'ended', status: 'second' })
    })

    it('returns null when no row applies (entity did not exist yet at n)', () => {
      const e = makeEntity('Newcomer')
      history(e, 'active', 'Arrived', 5, 100) // first appears in session 5
      expect(stateAsOf(ctx, e, 2)).toBeNull()
      expect(stateAsOf(ctx, e, 5)).toEqual({ lifecycle: 'active', status: 'Arrived' })
    })

    it('returns null for an entity with no history at all', () => {
      const e = makeEntity('Ghost')
      expect(stateAsOf(ctx, e, 1)).toBeNull()
    })

    it('getEntityHistory returns rows oldest-first (baseline before later changes)', () => {
      const e = makeEntity('Timeline')
      history(e, 'ended', 'Dead', 3, 200)
      history(e, 'active', 'Alive', null, 100) // baseline, inserted second but must sort first
      const h = getEntityHistory(ctx, e)
      expect(h.map((r) => r.status)).toEqual(['Alive', 'Dead'])
      expect(h[0].sinceSessionNumber).toBeNull()
    })
  })
})
