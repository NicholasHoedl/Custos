import { describe, it, expect } from 'vitest'
import { CAMPAIGN_EXPORT_VERSION } from '@shared/export-types'
import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createSession } from '../../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../../src/main/services/entity.service'
import { createNote } from '../../../src/main/services/note.service'
import { createLink } from '../../../src/main/services/link.service'
import { createEvent } from '../../../src/main/services/event.service'
import { updatePersona } from '../../../src/main/services/persona.service'
import { buildCampaignExport } from '../../../src/main/services/export.service'

describe('export.service — buildCampaignExport', () => {
  it('serializes the whole campaign graph (and omits embeddings)', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const s1 = createSession(ctx, { campaignId })
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Brother Cassius',
      status: 'Alive',
      sessionId: s1.id
    })
    const npc = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      status: 'At large',
      sessionId: s1.id
    })
    const loc = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    updateEntity(ctx, npc.id, { status: 'Defeated', lifecycle: 'ended', sessionId: s1.id }) // +1 history row
    const note = createNote(ctx, {
      campaignId,
      entityIds: [pc.id, npc.id],
      sessionId: s1.id,
      content: 'Cassius bested Glasstaff.'
    })
    createLink(ctx, {
      campaignId,
      fromEntityId: npc.id,
      toEntityId: loc.id,
      relation: 'located_in',
      sessionId: s1.id
    })
    createEvent(ctx, { sessionId: s1.id, content: 'The manor fell.' })
    updatePersona(ctx, pc.id, 'A steady cleric of Tymora.')

    const exp = buildCampaignExport(ctx, campaignId)

    expect(exp.version).toBe(CAMPAIGN_EXPORT_VERSION)
    expect(exp.exportedAt).toBeGreaterThan(0)
    expect(exp.campaign.id).toBe(campaignId)
    expect(exp.sessions).toHaveLength(1)
    expect(exp.entities.map((e) => e.name).sort()).toEqual([
      'Brother Cassius',
      'Glasstaff',
      'Tresendar Manor'
    ])
    // three baselines (one per created entity) + the Glasstaff change
    expect(exp.statusHistory.length).toBeGreaterThanOrEqual(4)
    expect(exp.notes).toHaveLength(1)
    expect([...exp.notes[0].entityIds].sort()).toEqual([npc.id, pc.id].sort()) // M2M captured on the note
    expect(note.id).toBe(exp.notes[0].id)
    expect(exp.entityLinks).toHaveLength(1)
    expect(exp.entityLinks[0].relation).toBe('located_in')
    expect(exp.eventLog).toHaveLength(1)
    expect(exp.personae).toHaveLength(1)
    expect(exp.personae[0].brief).toContain('cleric')
    // embeddings intentionally absent, and the whole thing is JSON-portable
    expect(exp).not.toHaveProperty('noteEmbedding')
    expect(exp).not.toHaveProperty('entityEmbedding')
    expect(() => JSON.parse(JSON.stringify(exp))).not.toThrow()
  })

  it('scopes strictly to one campaign', () => {
    const ctx = makeTestDb()
    const a = createCampaign(ctx, { name: 'A' }).id
    const b = createCampaign(ctx, { name: 'B' }).id
    createEntity(ctx, { campaignId: a, type: 'npc', name: 'A-npc' })
    createEntity(ctx, { campaignId: b, type: 'npc', name: 'B-npc' })
    expect(buildCampaignExport(ctx, a).entities.map((e) => e.name)).toEqual(['A-npc'])
  })
})
