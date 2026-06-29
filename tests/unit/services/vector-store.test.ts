import { describe, it, expect, beforeEach } from 'vitest'
import type { Entity } from '@shared/entity-types'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createNote } from '../../../src/main/services/note.service'
import { BruteForceVectorStore, nameMatchScore } from '../../../src/main/services/vector-store.service'
import { makeTestDb } from '../../helpers/test-db'

// Deterministic unit vectors (no embedding model needed) so similarity ordering is exact.
function vec(...hot: number[]): Float32Array {
  const v = new Float32Array(384)
  for (const i of hot) v[i] = 1
  return v
}

describe('vector-store (brute-force cosine)', () => {
  let ctx: DbContext
  let store: BruteForceVectorStore
  let campaignId: string
  let npc: Entity

  beforeEach(() => {
    ctx = makeTestDb()
    store = new BruteForceVectorStore(ctx)
    campaignId = createCampaign(ctx, { name: 'C' }).id
    npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
  })

  it('ranks the closest note first and is campaign-scoped', () => {
    const n1 = createNote(ctx, { entityId: npc.id, content: 'the north road ambush' })
    const n2 = createNote(ctx, { entityId: npc.id, content: 'turnip prices' })
    store.upsertNote(n1.id, vec(0), 'h1')
    store.upsertNote(n2.id, vec(1), 'h2')

    const results = store.search(vec(0), campaignId, 5)
    expect(results[0].noteId).toBe(n1.id)
    expect(results[0].score).toBeGreaterThan(results[1].score)

    const otherCampaign = createCampaign(ctx, { name: 'Other' }).id
    expect(store.search(vec(0), otherCampaign, 5)).toHaveLength(0)
  })

  it('indexes entity descriptions as their own chunks', () => {
    store.upsertEntity(npc.id, vec(0), 'he')
    const entityChunk = store.search(vec(0), campaignId, 5).find((r) => r.kind === 'entity')
    expect(entityChunk?.entityId).toBe(npc.id)
  })

  it('tracks content hashes and removes', () => {
    const n = createNote(ctx, { entityId: npc.id, content: 'x' })
    store.upsertNote(n.id, vec(0), 'h1')
    expect(store.noteHash(n.id)).toBe('h1')
    store.upsertNote(n.id, vec(2), 'h2') // re-embed updates the hash
    expect(store.noteHash(n.id)).toBe('h2')
    store.removeNote(n.id)
    expect(store.noteHash(n.id)).toBeNull()
  })
})

describe('fuzzy entity matching (typo-tolerant retrieval)', () => {
  it('scores a misspelled proper noun high, exact spelling perfect', () => {
    expect(nameMatchScore('who is glastav?', 'Iarno "Glasstaff" Albrek')).toBeGreaterThanOrEqual(0.5)
    expect(nameMatchScore('Glasstaff', 'Iarno "Glasstaff" Albrek')).toBe(1)
  })

  it('does not match unrelated queries or bare stopwords', () => {
    expect(nameMatchScore('who is the innkeeper?', 'Iarno "Glasstaff" Albrek')).toBeLessThan(0.5)
    expect(nameMatchScore('who are they?', 'Iarno "Glasstaff" Albrek')).toBe(0)
  })

  it('fuzzyEntityChunks surfaces the misspelled entity (description + notes), honoring exclude', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const glass = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Iarno "Glasstaff" Albrek',
      description: 'The masked Redbrand leader.'
    })
    createNote(ctx, { entityId: glass.id, content: 'We took his staff and he begged.' })
    createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar Hallwinter' }) // should NOT match

    const hits = store.fuzzyEntityChunks(campaignId, 'who is glastav?', new Set(), 2)
    expect(hits.some((c) => c.kind === 'entity' && c.entityId === glass.id)).toBe(true)
    expect(hits.some((c) => c.kind === 'note' && c.content.includes('begged'))).toBe(true)
    expect(hits.every((c) => c.entityId === glass.id)).toBe(true) // unrelated entity not pulled in

    // excluding the matched entity (already a dense hit) yields nothing
    expect(store.fuzzyEntityChunks(campaignId, 'who is glastav?', new Set([glass.id]), 2)).toHaveLength(0)
  })
})
