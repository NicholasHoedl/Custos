import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign
} from '../../../src/main/services/campaign.service'
import { createEntity, getEntity, listEntities } from '../../../src/main/services/entity.service'
import { createSession, listSessions } from '../../../src/main/services/session.service'
import { createNote, listAllNotes, listNotesForEntity } from '../../../src/main/services/note.service'
import { createEvent, listEvents } from '../../../src/main/services/event.service'
import { createLink } from '../../../src/main/services/link.service'
import { BruteForceVectorStore } from '../../../src/main/services/vector-store.service'
import { makeTestDb } from '../../helpers/test-db'

// A deterministic unit vector so the cascade test can prove a note's embedding is swept on delete.
function unit(i: number): Float32Array {
  const v = new Float32Array(384)
  v[i] = 1
  return v
}

describe('campaign.service', () => {
  let ctx: DbContext

  beforeEach(() => {
    ctx = makeTestDb()
  })

  it('updates name/description and re-stamps updatedAt', () => {
    const c = createCampaign(ctx, { name: 'Old Name' })
    const u = updateCampaign(ctx, c.id, { name: 'New Name', description: 'desc' })
    expect(u.name).toBe('New Name')
    expect(u.description).toBe('desc')
    expect(u.updatedAt).toBeGreaterThanOrEqual(c.updatedAt)
  })

  it('cascades entity-less lore notes when the campaign is deleted', () => {
    const store = new BruteForceVectorStore(ctx)
    const doomed = createCampaign(ctx, { name: 'Doomed lore' }).id
    const lore = createNote(ctx, { campaignId: doomed, entityIds: [], content: 'a world fact' })
    store.upsertNote(lore.id, unit(0), 'h')

    const survivor = createCampaign(ctx, { name: 'Survivor' }).id
    const keep = createNote(ctx, { campaignId: survivor, entityIds: [], content: 'kept lore' })

    deleteCampaign(ctx, doomed)

    expect(listAllNotes(ctx, doomed)).toHaveLength(0)
    expect(store.noteHash(lore.id)).toBeNull() // embedding cascaded off the deleted note row
    expect(listAllNotes(ctx, survivor).map((n) => n.id)).toEqual([keep.id]) // other campaign untouched
  })

  it('deletes a campaign and cascades to its sessions, entities, notes, links, and events', () => {
    const campaignId = createCampaign(ctx, { name: 'Doomed' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const inn = createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle' })
    const session = createSession(ctx, { campaignId })
    const store = new BruteForceVectorStore(ctx)
    const note = createNote(ctx, {
      campaignId,
      entityIds: [npc.id],
      sessionId: session.id,
      content: 'owes a favor'
    })
    store.upsertNote(note.id, unit(0), 'h')
    createLink(ctx, { campaignId, fromEntityId: npc.id, toEntityId: inn.id, relation: 'located_in' })
    createEvent(ctx, { sessionId: session.id, content: 'Aldric appears', entityId: npc.id })

    // A second campaign and its data must be left completely untouched.
    const otherId = createCampaign(ctx, { name: 'Survivor' }).id
    const safe = createEntity(ctx, { campaignId: otherId, type: 'npc', name: 'Safe' })

    deleteCampaign(ctx, campaignId)

    expect(getCampaign(ctx, campaignId)).toBeNull()
    expect(listSessions(ctx, campaignId)).toHaveLength(0)
    expect(listEntities(ctx, campaignId)).toHaveLength(0)
    expect(getEntity(ctx, npc.id)).toBeNull()
    expect(listNotesForEntity(ctx, npc.id)).toHaveLength(0)
    expect(store.noteHash(note.id)).toBeNull() // note row swept (no campaign FK) + embedding cascaded
    expect(listEvents(ctx, session.id)).toHaveLength(0)

    // The other campaign survives intact.
    expect(getCampaign(ctx, otherId)?.name).toBe('Survivor')
    expect(getEntity(ctx, safe.id)?.name).toBe('Safe')
    expect(listCampaigns(ctx).map((c) => c.name)).toEqual(['Survivor'])
  })
})
