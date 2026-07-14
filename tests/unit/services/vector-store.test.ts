import { describe, it, expect, beforeEach } from 'vitest'
import type { Entity } from '@shared/entity-types'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createNote } from '../../../src/main/services/note.service'
import { createSession } from '../../../src/main/services/session.service'
import { BruteForceVectorStore, nameMatchScore } from '../../../src/main/services/vector-store.service'
import { makeTestDb } from '../../helpers/test-db'
import { eq } from 'drizzle-orm'
import * as schema from '../../../src/main/db/schema'

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
    const n1 = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'the north road ambush' })
    const n2 = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'turnip prices' })
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

  it('emits ONE note chunk per note even when shared, attributed to the first entity by name', () => {
    // A note tagged to two entities must not produce two identical chunks (no prompt duplication).
    const zara = createEntity(ctx, { campaignId, type: 'npc', name: 'Zara' })
    const aldous = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldous' })
    const shared = createNote(ctx, { campaignId, entityIds: [zara.id, aldous.id], content: 'a shared secret' })
    store.upsertNote(shared.id, vec(3), 'h')

    const noteChunks = store.search(vec(3), campaignId, 10).filter((c) => c.kind === 'note')
    expect(noteChunks).toHaveLength(1)
    expect(noteChunks[0].noteId).toBe(shared.id)
    expect(noteChunks[0].entityName).toBe('Aldous') // representative = first by name (Aldous < Zara)
  })

  it('tracks content hashes and removes', () => {
    const n = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'x' })
    store.upsertNote(n.id, vec(0), 'h1')
    expect(store.noteHash(n.id)).toBe('h1')
    store.upsertNote(n.id, vec(2), 'h2') // re-embed updates the hash
    expect(store.noteHash(n.id)).toBe('h2')
    store.removeNote(n.id)
    expect(store.noteHash(n.id)).toBeNull()
  })

  it('ADR-052: search excludes vectors from a different (stale) embedding model', () => {
    const n = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'stale model note' })
    store.upsertNote(n.id, vec(0), 'h')
    // Simulate a leftover row from a previous embedder (migration 0012 normally purges these on a swap).
    ctx.drizzle
      .update(schema.noteEmbedding)
      .set({ model: 'Xenova/all-MiniLM-L6-v2' })
      .where(eq(schema.noteEmbedding.noteId, n.id))
      .run()
    // The model-filter must skip it — a mismatched-dim vector would otherwise dot-product to a garbage score.
    expect(store.search(vec(0), campaignId, 5).some((c) => c.noteId === n.id)).toBe(false)
  })

  it('surfaces an entity-less lore note as a chunk with null entity fields, campaign-scoped', () => {
    const lore = createNote(ctx, {
      campaignId,
      entityIds: [],
      content: 'the ancient runes ward against demons'
    })
    store.upsertNote(lore.id, vec(5), 'hl')

    const hit = store.search(vec(5), campaignId, 5).find((c) => c.noteId === lore.id)
    expect(hit).toBeTruthy()
    expect(hit!.kind).toBe('note')
    expect(hit!.entityId).toBeNull()
    expect(hit!.entityName).toBeNull()
    expect(hit!.entityType).toBeNull()
    expect(hit!.confidence).toBe('confirmed')

    // Scoped by note.campaignId — a different campaign never sees it.
    const other = createCampaign(ctx, { name: 'Other' }).id
    expect(store.search(vec(5), other, 5).some((c) => c.noteId === lore.id)).toBe(false)
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
    createNote(ctx, { campaignId, entityIds: [glass.id], content: 'We took his staff and he begged.' })
    createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar Hallwinter' }) // should NOT match

    const hits = store.fuzzyEntityChunks(campaignId, 'who is glastav?', new Set(), 2)
    expect(hits.some((c) => c.kind === 'entity' && c.entityId === glass.id)).toBe(true)
    expect(hits.some((c) => c.kind === 'note' && c.content.includes('begged'))).toBe(true)
    expect(hits.every((c) => c.entityId === glass.id)).toBe(true) // unrelated entity not pulled in

    // excluding the matched entity (already a dense hit) yields nothing
    expect(store.fuzzyEntityChunks(campaignId, 'who is glastav?', new Set([glass.id]), 2)).toHaveLength(0)
  })
})

describe('as-of clamp (chronology — no future-knowledge leak)', () => {
  it('search excludes notes from sessions AFTER N; keeps ≤ N and undated notes', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const s1 = createSession(ctx, { campaignId }) // session 1
    createSession(ctx, { campaignId }) // session 2
    const s3 = createSession(ctx, { campaignId }) // session 3
    const past = createNote(ctx, { campaignId, entityIds: [npc.id], sessionId: s1.id, content: 'past note' })
    const future = createNote(ctx, { campaignId, entityIds: [npc.id], sessionId: s3.id, content: 'future note' })
    const undated = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'timeless note' })
    for (const id of [past.id, future.id, undated.id]) store.upsertNote(id, vec(0), 'h')

    // As of session 2: the session-3 note vanishes; session-1 + undated remain.
    const asOf2 = store
      .search(vec(0), campaignId, 10, 2)
      .filter((c) => c.kind === 'note')
      .map((c) => c.noteId)
    expect(asOf2).toContain(past.id)
    expect(asOf2).toContain(undated.id)
    expect(asOf2).not.toContain(future.id)

    // "Now" (no asOf): every note is retrievable again.
    const now = store
      .search(vec(0), campaignId, 10)
      .filter((c) => c.kind === 'note')
      .map((c) => c.noteId)
    expect(now).toEqual(expect.arrayContaining([past.id, future.id, undated.id]))
  })

  it('fuzzyEntityChunks applies the same ≤ N clamp to an entity’s notes', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const glass = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno "Glasstaff" Albrek' })
    const s1 = createSession(ctx, { campaignId }) // 1
    createSession(ctx, { campaignId }) // 2
    const s3 = createSession(ctx, { campaignId }) // 3
    createNote(ctx, { campaignId, entityIds: [glass.id], sessionId: s1.id, content: 'took his staff early' })
    createNote(ctx, { campaignId, entityIds: [glass.id], sessionId: s3.id, content: 'a later betrayal' })

    const contents = store
      .fuzzyEntityChunks(campaignId, 'who is glastav?', new Set(), 5, 2)
      .filter((c) => c.kind === 'note')
      .map((c) => c.content)
    expect(contents.some((c) => c.includes('early'))).toBe(true) // session 1 ≤ 2
    expect(contents.some((c) => c.includes('betrayal'))).toBe(false) // session 3 > 2 → clamped out
  })

  it('applies the as-of clamp to entity-less lore notes too', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s1 = createSession(ctx, { campaignId })
    createSession(ctx, { campaignId })
    const s3 = createSession(ctx, { campaignId })
    const early = createNote(ctx, { campaignId, entityIds: [], sessionId: s1.id, content: 'early lore' })
    const late = createNote(ctx, { campaignId, entityIds: [], sessionId: s3.id, content: 'late lore' })
    for (const id of [early.id, late.id]) store.upsertNote(id, vec(6), 'h')

    const asOf2 = store
      .search(vec(6), campaignId, 10, 2)
      .filter((c) => c.kind === 'note')
      .map((c) => c.noteId)
    expect(asOf2).toContain(early.id)
    expect(asOf2).not.toContain(late.id)
  })
})
