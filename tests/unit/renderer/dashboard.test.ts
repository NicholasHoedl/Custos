import { describe, it, expect } from 'vitest'
import type { Entity, Note, Session } from '@shared/entity-types'
// Pure renderer module; vitest resolves only @shared, so reach it by relative path (mirrors
// mention.test.ts). Covers the Home dashboard's selectors (ADR-061).
import {
  activeQuests,
  archiveSpotlight,
  latestSession,
  needsFirstSession,
  recentlyTouched,
  relativeDays,
  typeCounts,
  unresolvedRumors
} from '../../../src/renderer/src/lib/dashboard'

let seq = 0
function ent(over: Partial<Entity>): Entity {
  seq += 1
  return {
    id: over.id ?? `e${seq}`,
    campaignId: 'c1',
    type: 'npc',
    name: `Entity ${seq}`,
    description: null,
    image: null,
    traits: [],
    goals: [],
    flaws: [],
    voiceExamples: [],
    attributes: {},
    status: null,
    lifecycle: 'active',
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

function note(over: Partial<Note>): Note {
  seq += 1
  return {
    id: over.id ?? `n${seq}`,
    campaignId: 'c1',
    entityIds: [],
    sessionId: null,
    content: `note ${seq}`,
    tags: [],
    confidence: 'confirmed',
    createdAt: 0,
    ...over
  }
}

function session(number: number): Session {
  return {
    id: `s${number}`,
    campaignId: 'c1',
    number,
    title: null,
    summary: null,
    date: null,
    createdAt: number
  }
}

describe('activeQuests', () => {
  it('keeps only active quests, newest-touched first, capped', () => {
    const qs = [
      ent({ type: 'quest', lifecycle: 'active', updatedAt: 1, name: 'Old' }),
      ent({ type: 'quest', lifecycle: 'ended', updatedAt: 9, name: 'Closed' }),
      ent({ type: 'quest', lifecycle: 'active', updatedAt: 5, name: 'New' }),
      ent({ type: 'npc', lifecycle: 'active', updatedAt: 9 })
    ]
    expect(activeQuests(qs).map((q) => q.name)).toEqual(['New', 'Old'])
    expect(activeQuests(qs, 1).map((q) => q.name)).toEqual(['New'])
  })
})

describe('unresolvedRumors', () => {
  it('keeps rumored + suspected notes, newest first, capped', () => {
    const ns = [
      note({ confidence: 'confirmed', createdAt: 10 }),
      note({ confidence: 'rumored', createdAt: 3, content: 'old rumor' }),
      note({ confidence: 'suspected', createdAt: 7, content: 'hunch' })
    ]
    expect(unresolvedRumors(ns).map((n) => n.content)).toEqual(['hunch', 'old rumor'])
    expect(unresolvedRumors(ns, 1)).toHaveLength(1)
  })
})

describe('typeCounts', () => {
  it('counts per type in canonical order, omitting zero types', () => {
    const es = [ent({ type: 'npc' }), ent({ type: 'npc' }), ent({ type: 'location' })]
    expect(typeCounts(es)).toEqual([
      { type: 'npc', count: 2 },
      { type: 'location', count: 1 }
    ])
  })
})

describe('recentlyTouched', () => {
  it('sorts by updatedAt desc without mutating the input', () => {
    const es = [ent({ updatedAt: 1, name: 'A' }), ent({ updatedAt: 5, name: 'B' })]
    const out = recentlyTouched(es, 1)
    expect(out.map((e) => e.name)).toEqual(['B'])
    expect(es[0].name).toBe('A') // input untouched
  })
})

describe('latestSession / relativeDays', () => {
  it('picks the highest session number regardless of order', () => {
    expect(latestSession([session(2), session(5), session(1)])?.number).toBe(5)
    expect(latestSession([])).toBeNull()
  })
  it('formats day distances', () => {
    const day = 86_400_000
    expect(relativeDays(1000, 1000)).toBe('today')
    expect(relativeDays(0, day + 1)).toBe('yesterday')
    expect(relativeDays(0, 12 * day)).toBe('12 days ago')
  })
})

describe('needsFirstSession', () => {
  it('is true only when a campaign has no sessions yet', () => {
    expect(needsFirstSession([])).toBe(true)
    expect(needsFirstSession([session(1)])).toBe(false)
  })
})

describe('archiveSpotlight', () => {
  it('is null with no candidates', () => {
    expect(archiveSpotlight([ent({})], [note({ confidence: 'confirmed' })], 0)).toBeNull()
  })

  it('surfaces the most dormant active entity and old rumors, deterministically by seed', () => {
    const dusty = ent({ id: 'dusty', lifecycle: 'active', name: 'Dusty' })
    const fresh = ent({ id: 'fresh', lifecycle: 'active', name: 'Fresh' })
    const gone = ent({ id: 'gone', lifecycle: 'ended', name: 'Gone' })
    const ns = [
      note({ entityIds: ['dusty'], createdAt: 1 }),
      note({ entityIds: ['fresh'], createdAt: 100 }),
      note({ entityIds: ['gone'], createdAt: 1 }), // ended → never spotlighted
      note({ confidence: 'rumored', createdAt: 2, content: 'whispers' })
    ]
    const pool = [0, 1, 2, 3].map((s) => archiveSpotlight([dusty, fresh, gone], ns, s))
    // Pool = [dormant dusty, dormant fresh, rumor] → seed rotates across it deterministically.
    expect(pool[0]).toEqual(pool[3]) // 3 % 3 === 0
    const first = pool[0]
    expect(first?.kind).toBe('dormant')
    if (first?.kind === 'dormant') expect(first.entity.id).toBe('dusty') // oldest newest-note first
    expect(pool.some((p) => p?.kind === 'rumor')).toBe(true)
    expect(pool.every((p) => p?.kind !== 'dormant' || p.entity.id !== 'gone')).toBe(true)
  })
})
