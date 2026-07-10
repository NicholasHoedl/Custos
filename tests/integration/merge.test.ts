import { describe, it, expect, vi } from 'vitest'

// Entity merge (ROADMAP P1-6, re-point only) against a REAL in-memory DB. The correctness core: the
// loser's notes/ties/chronology/event-refs move to the survivor; the two structural hazards (note_entity
// composite-PK dupes, entity_link open-interval unique index + self-loops) are handled; the MC pointer
// is carried; guards reject nonsense merges.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../src/main/services/embedding-index.service', () => ({
  indexEntity: vi.fn(),
  indexNote: vi.fn(),
  backfill: vi.fn()
}))

import { makeTestDb } from '../helpers/test-db'
import { createCampaign, getCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, getEntity, updateEntity } from '../../src/main/services/entity.service'
import { createLink, listForEntity } from '../../src/main/services/link.service'
import { createNote, listNotesForEntity } from '../../src/main/services/note.service'
import { createEvent, listEvents } from '../../src/main/services/event.service'
import { getEntityHistory } from '../../src/main/services/chronology.service'
import { mergeEntities } from '../../src/main/services/merge.service'

function setup() {
  const ctx = makeTestDb()
  const campaign = createCampaign(ctx, { name: 'LMoP', mainCharacterName: 'Hero' })
  return { ctx, campaignId: campaign.id, mcId: getCampaign(ctx, campaign.id)!.mainCharacterId! }
}

describe('merge.service — mergeEntities (re-point only)', () => {
  it('moves the loser’s notes, ties, chronology, and event refs to the survivor, then deletes it', () => {
    const { ctx, campaignId } = setup()
    const survivor = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar Hallwinter' })
    const loser = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar' })
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    const session = createSession(ctx, { campaignId })

    createNote(ctx, { campaignId, entityIds: [loser.id], content: 'Sildar was taken to the manor.' })
    createLink(ctx, { campaignId, fromEntityId: loser.id, toEntityId: manor.id, relation: 'located_in' })
    updateEntity(ctx, loser.id, { status: 'Captured' }) // a dated status-history row
    createEvent(ctx, { sessionId: session.id, content: 'Freed Sildar.', entityId: loser.id })

    const merged = mergeEntities(ctx, { survivorId: survivor.id, loserId: loser.id })

    expect(merged.id).toBe(survivor.id)
    expect(getEntity(ctx, loser.id)).toBeNull() // gone
    expect(listNotesForEntity(ctx, survivor.id).some((n) => n.content.startsWith('Sildar was taken'))).toBe(true)
    expect(listForEntity(ctx, survivor.id).some((v) => v.other.id === manor.id)).toBe(true)
    expect(getEntityHistory(ctx, survivor.id).some((h) => h.status === 'Captured')).toBe(true)
    expect(listEvents(ctx, session.id)[0].entityId).toBe(survivor.id)
  })

  it('does not duplicate a note tagged to BOTH entities (composite-PK safe)', () => {
    const { ctx, campaignId } = setup()
    const survivor = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const loser = createEntity(ctx, { campaignId, type: 'npc', name: 'A dup' })
    createNote(ctx, { campaignId, entityIds: [survivor.id, loser.id], content: 'Shared note.' })

    mergeEntities(ctx, { survivorId: survivor.id, loserId: loser.id })

    const shared = listNotesForEntity(ctx, survivor.id).filter((n) => n.content === 'Shared note.')
    expect(shared).toHaveLength(1)
    expect(shared[0].entityIds.filter((id) => id === survivor.id)).toHaveLength(1)
    expect(shared[0].entityIds).not.toContain(loser.id)
  })

  it('drops a loser↔survivor tie instead of creating a self-loop', () => {
    const { ctx, campaignId } = setup()
    const survivor = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const loser = createEntity(ctx, { campaignId, type: 'npc', name: 'A dup' })
    createLink(ctx, { campaignId, fromEntityId: loser.id, toEntityId: survivor.id, relation: 'ally_of' })

    mergeEntities(ctx, { survivorId: survivor.id, loserId: loser.id })

    expect(listForEntity(ctx, survivor.id).some((v) => v.other.id === survivor.id)).toBe(false)
  })

  it('collapses a duplicate open tie (no unique-index violation)', () => {
    const { ctx, campaignId } = setup()
    const survivor = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const loser = createEntity(ctx, { campaignId, type: 'npc', name: 'A dup' })
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Manor' })
    createLink(ctx, { campaignId, fromEntityId: survivor.id, toEntityId: manor.id, relation: 'located_in' })
    createLink(ctx, { campaignId, fromEntityId: loser.id, toEntityId: manor.id, relation: 'located_in' })

    mergeEntities(ctx, { survivorId: survivor.id, loserId: loser.id })

    expect(listForEntity(ctx, survivor.id).filter((v) => v.other.id === manor.id)).toHaveLength(1)
  })

  it('carries the main-character pointer to a PC survivor', () => {
    const { ctx, campaignId, mcId } = setup()
    const survivorPc = createEntity(ctx, { campaignId, type: 'pc', name: 'Hero (canonical)' })

    mergeEntities(ctx, { survivorId: survivorPc.id, loserId: mcId })

    expect(getCampaign(ctx, campaignId)!.mainCharacterId).toBe(survivorPc.id)
    expect(getEntity(ctx, mcId)).toBeNull()
  })

  it('rejects merging the main character into a non-PC', () => {
    const { ctx, campaignId, mcId } = setup()
    const place = createEntity(ctx, { campaignId, type: 'location', name: 'A place' })
    expect(() => mergeEntities(ctx, { survivorId: place.id, loserId: mcId })).toThrow(/main character/i)
  })

  it('guards self-merge, missing entities, and cross-campaign merges', () => {
    const { ctx, campaignId } = setup()
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const other = createCampaign(ctx, { name: 'Other', mainCharacterName: 'X' })
    const b = createEntity(ctx, { campaignId: other.id, type: 'npc', name: 'B' })

    expect(() => mergeEntities(ctx, { survivorId: a.id, loserId: a.id })).toThrow(/itself/)
    expect(() => mergeEntities(ctx, { survivorId: a.id, loserId: 'nope' })).toThrow(/not found/)
    expect(() => mergeEntities(ctx, { survivorId: a.id, loserId: b.id })).toThrow(/different campaigns/)
  })
})
