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
import { createNote, listNotes } from '../../../src/main/services/note.service'
import { createEvent, listEvents } from '../../../src/main/services/event.service'
import { createLink } from '../../../src/main/services/link.service'
import { makeTestDb } from '../../helpers/test-db'

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

  it('deletes a campaign and cascades to its sessions, entities, notes, links, and events', () => {
    const campaignId = createCampaign(ctx, { name: 'Doomed' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const inn = createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle' })
    const session = createSession(ctx, { campaignId })
    createNote(ctx, { entityId: npc.id, sessionId: session.id, content: 'owes a favor' })
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
    expect(listNotes(ctx, npc.id)).toHaveLength(0)
    expect(listEvents(ctx, session.id)).toHaveLength(0)

    // The other campaign survives intact.
    expect(getCampaign(ctx, otherId)?.name).toBe('Survivor')
    expect(getEntity(ctx, safe.id)?.name).toBe('Safe')
    expect(listCampaigns(ctx).map((c) => c.name)).toEqual(['Survivor'])
  })
})
