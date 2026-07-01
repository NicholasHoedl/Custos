import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity
} from '../../../src/main/services/entity.service'
import { getEntityHistory } from '../../../src/main/services/chronology.service'
import { createNote, listNotesForEntity } from '../../../src/main/services/note.service'
import { createEvent, listEvents } from '../../../src/main/services/event.service'
import { createSession } from '../../../src/main/services/session.service'
import { createLink, listForEntity } from '../../../src/main/services/link.service'
import { BruteForceVectorStore } from '../../../src/main/services/vector-store.service'
import { makeTestDb } from '../../helpers/test-db'

// A deterministic unit vector so the orphan test can attach embeddings without the embedding model.
function unit(i: number): Float32Array {
  const v = new Float32Array(384)
  v[i] = 1
  return v
}

describe('entity.service', () => {
  let ctx: DbContext
  let campaignId: string

  beforeEach(() => {
    ctx = makeTestDb()
    campaignId = createCampaign(ctx, { name: 'Test Campaign' }).id
  })

  it('creates an entity and round-trips traits/goals/attributes JSON', () => {
    const e = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Aldric Vane',
      traits: ['gruff', 'loyal'],
      goals: ['protect the inn'],
      attributes: { race: 'human', occupation: 'innkeeper' }
    })
    expect(e.traits).toEqual(['gruff', 'loyal'])
    expect(e.goals).toEqual(['protect the inn'])
    expect(e.attributes).toEqual({ race: 'human', occupation: 'innkeeper' })

    const got = getEntity(ctx, e.id)
    expect(got?.name).toBe('Aldric Vane')
    expect(got?.attributes).toEqual({ race: 'human', occupation: 'innkeeper' })
  })

  it('lists entities, optionally filtered by type', () => {
    createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle' })
    expect(listEntities(ctx, campaignId).length).toBe(2)
    expect(listEntities(ctx, campaignId, 'npc').map((e) => e.name)).toEqual(['Aldric'])
  })

  it('updates fields and re-stamps updatedAt', () => {
    const e = createEntity(ctx, { campaignId, type: 'npc', name: 'A', attributes: { x: 1 } })
    const u = updateEntity(ctx, e.id, { name: 'A (renamed)', attributes: { y: 2 } })
    expect(u.name).toBe('A (renamed)')
    expect(u.attributes).toEqual({ y: 2 })
    expect(u.updatedAt).toBeGreaterThanOrEqual(e.updatedAt)
  })

  it('deletes an entity and cascades to its notes, links, and event references', () => {
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const inn = createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle' })
    const session = createSession(ctx, { campaignId })

    createNote(ctx, { entityIds: [npc.id], content: 'owes a favor' })
    createLink(ctx, { campaignId, fromEntityId: npc.id, toEntityId: inn.id, relation: 'located_in' })
    const event = createEvent(ctx, {
      sessionId: session.id,
      content: 'Aldric appears',
      entityId: npc.id
    })

    deleteEntity(ctx, npc.id)

    expect(getEntity(ctx, npc.id)).toBeNull()
    expect(listNotesForEntity(ctx, npc.id)).toHaveLength(0) // its only note was orphan-removed
    expect(listForEntity(ctx, inn.id)).toHaveLength(0) // link cascade-deleted (both ends)

    const events = listEvents(ctx, session.id)
    expect(events).toHaveLength(1) // the session log entry survives...
    expect(events[0].id).toBe(event.id)
    expect(events[0].entityId).toBeNull() // ...with its entity reference set to null

    expect(getEntity(ctx, inn.id)?.name).toBe('Copper Kettle') // the other entity is untouched
  })

  it('on delete, keeps shared notes but orphan-removes notes left with no entities (+ embedding)', () => {
    const store = new BruteForceVectorStore(ctx)
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const b = createEntity(ctx, { campaignId, type: 'npc', name: 'Brynn' })
    const shared = createNote(ctx, { entityIds: [a.id, b.id], content: 'they plotted together' })
    const solo = createNote(ctx, { entityIds: [a.id], content: 'a secret only about Aldric' })
    store.upsertNote(shared.id, unit(0), 'hs')
    store.upsertNote(solo.id, unit(1), 'hso')

    deleteEntity(ctx, a.id)

    // The shared note survives (still tagged to Brynn), now listed only under Brynn; embedding intact.
    const brynnNotes = listNotesForEntity(ctx, b.id)
    expect(brynnNotes.map((n) => n.id)).toEqual([shared.id])
    expect(brynnNotes[0].entityIds).toEqual([b.id])
    expect(store.noteHash(shared.id)).toBe('hs')

    // The solo note had only Aldric → orphaned → removed, and its embedding cascaded away.
    expect(store.noteHash(solo.id)).toBeNull()
  })

  // ---- Chronology capture (M3) ----

  it('seeds a baseline history row on create, with lifecycle derived from status', () => {
    const s = createSession(ctx, { campaignId }) // session 1
    const e = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Fallen Foe',
      status: 'Dead',
      sessionId: s.id
    })
    expect(e.lifecycle).toBe('ended') // heuristic on 'Dead'
    const h = getEntityHistory(ctx, e.id)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ lifecycle: 'ended', status: 'Dead', sinceSessionNumber: 1 })
  })

  it('records a pre-tracking baseline (null session) when no session is active', () => {
    const e = createEntity(ctx, { campaignId, type: 'npc', name: 'Nobody' })
    const h = getEntityHistory(ctx, e.id)
    expect(h).toHaveLength(1)
    expect(h[0].sinceSessionNumber).toBeNull() // no sessions exist -> pre-tracking
    expect(h[0].lifecycle).toBe('unknown')
  })

  it('appends a stamped history row when status or lifecycle changes', () => {
    const s1 = createSession(ctx, { campaignId }) // 1
    const e = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Duke',
      status: 'Alive',
      sessionId: s1.id
    })
    createSession(ctx, { campaignId }) // 2
    const s3 = createSession(ctx, { campaignId }) // 3
    const u = updateEntity(ctx, e.id, { status: 'Slain', lifecycle: 'ended', sessionId: s3.id })
    expect(u.lifecycle).toBe('ended')
    const h = getEntityHistory(ctx, e.id)
    expect(h).toHaveLength(2) // baseline + the change
    expect(h[1]).toMatchObject({ lifecycle: 'ended', status: 'Slain', sinceSessionNumber: 3 })
  })

  it('does not append a history row when neither status nor lifecycle changes', () => {
    const s = createSession(ctx, { campaignId })
    const e = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Steady',
      status: 'Fine',
      sessionId: s.id
    })
    updateEntity(ctx, e.id, { name: 'Steady Renamed', sessionId: s.id }) // rename only
    expect(getEntityHistory(ctx, e.id)).toHaveLength(1) // still just the baseline
  })
})
