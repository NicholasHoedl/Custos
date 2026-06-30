import { describe, it, expect } from 'vitest'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createLink, getEntityContext } from '../../src/main/services/link.service'
import { searchText } from '../../src/main/services/search.service'
import { makeTestDb } from '../helpers/test-db'

describe('capture integration', () => {
  it('builds a campaign and gathers an NPC context bundle (the RAG-ready chain)', () => {
    const ctx = makeTestDb()
    const c = createCampaign(ctx, { name: 'The Lost Mines' })

    const s1 = createSession(ctx, { campaignId: c.id, title: 'The Goblin Ambush' })
    expect(s1.number).toBe(1)

    const aldric = createEntity(ctx, {
      campaignId: c.id,
      type: 'npc',
      name: 'Aldric Vane',
      description: 'Innkeeper of the Copper Kettle'
    })
    const inn = createEntity(ctx, { campaignId: c.id, type: 'location', name: 'Copper Kettle Inn' })
    const sword = createEntity(ctx, { campaignId: c.id, type: 'item', name: 'Old Sword' })

    createNote(ctx, {
      entityIds: [aldric.id],
      sessionId: s1.id,
      content: 'Said the north road is dangerous — bandits in the last month'
    })
    createLink(ctx, {
      campaignId: c.id,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    createLink(ctx, {
      campaignId: c.id,
      fromEntityId: aldric.id,
      toEntityId: sword.id,
      relation: 'owns'
    })

    const bundle = getEntityContext(ctx, aldric.id, 1)
    expect(bundle.notes[0].content).toContain('north road')
    expect(bundle.neighbors.map((n) => n.entity.name).sort()).toEqual([
      'Copper Kettle Inn',
      'Old Sword'
    ])

    const hits = searchText(ctx, 'north road', c.id)
    expect(hits.map((h) => h.name)).toContain('Aldric Vane')

    const s2 = createSession(ctx, { campaignId: c.id })
    expect(s2.number).toBe(2)
  })
})
