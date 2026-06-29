import { describe, it, expect, vi } from 'vitest'

// scene.service imports claude.service (formatScene) → key.service → electron; stub electron.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createLink } from '../../../src/main/services/link.service'
import {
  resolveScene,
  gatherPinned,
  type RelItem,
  type StateItem
} from '../../../src/main/services/scene.service'

describe('scene.service resolveScene', () => {
  it('returns an empty result when no scene is set', () => {
    const ctx = makeTestDb()
    expect(resolveScene(ctx, undefined, null)).toEqual({
      block: null,
      pinned: [],
      quest: null,
      nearbyPcs: []
    })
  })

  it('pins the selected entities, expands location contents + quest-involved, and formats a block', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    const elaria = createEntity(ctx, { campaignId, type: 'pc', name: 'Elaria' })
    const inn = createEntity(ctx, {
      campaignId,
      type: 'location',
      name: 'Stonehill Inn',
      status: 'Safe'
    })
    const town = createEntity(ctx, { campaignId, type: 'location', name: 'Phandalin' })
    const toblen = createEntity(ctx, { campaignId, type: 'npc', name: 'Toblen Stonehill' })
    const quest = createEntity(ctx, {
      campaignId,
      type: 'quest',
      name: 'Rescue Gundren',
      status: 'Active',
      attributes: { objective: 'Find and free Gundren' }
    })
    const gundren = createEntity(ctx, { campaignId, type: 'npc', name: 'Gundren' })
    // Inn is in Phandalin; Toblen is in the Inn; the quest involves Gundren.
    createLink(ctx, { campaignId, fromEntityId: inn.id, toEntityId: town.id, relation: 'located_in' })
    createLink(ctx, {
      campaignId,
      fromEntityId: toblen.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    createLink(ctx, {
      campaignId,
      fromEntityId: quest.id,
      toEntityId: gundren.id,
      relation: 'involves'
    })

    const r = resolveScene(
      ctx,
      {
        locationId: inn.id,
        embarkedQuestId: quest.id,
        nearbyPcIds: [elaria.id],
        timeOfDay: 'evening',
        inCombat: true
      },
      pc.id
    )

    expect(r.quest?.id).toBe(quest.id)
    expect(r.nearbyPcs.map((p) => p.name)).toEqual(['Elaria'])
    expect(r.pinned.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        'Vargas',
        'Elaria',
        'Stonehill Inn',
        'Rescue Gundren',
        'Toblen Stonehill',
        'Gundren'
      ])
    )

    const block = r.block ?? ''
    expect(block).toContain('Where: Stonehill Inn (in Phandalin) — Safe')
    expect(block).toContain('When: Evening')
    expect(block).toContain('In combat: yes')
    expect(block).toContain('Party present: Elaria')
    expect(block).toContain('Pursuing: Rescue Gundren (Find and free Gundren)')
    expect(block).toContain('Also here: Toblen Stonehill')
  })

  it('tolerates missing/blank entity IDs', () => {
    const ctx = makeTestDb()
    createCampaign(ctx, { name: 'C' })
    const r = resolveScene(
      ctx,
      {
        locationId: 'nope',
        embarkedQuestId: null,
        nearbyPcIds: ['ghost'],
        timeOfDay: null,
        inCombat: true
      },
      null
    )
    expect(r.pinned).toEqual([])
    expect(r.quest).toBeNull()
    expect(r.block).toContain('In combat: yes')
  })
})

describe('scene.service gatherPinned', () => {
  it('pushes each entity once and skips already-seen ids', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric', status: 'Alive' })
    const seen = new Set<string>()
    const relItems: RelItem[] = []
    const stateItems: StateItem[] = []
    gatherPinned(ctx, [a, a], seen, relItems, stateItems) // duplicate ignored
    expect(stateItems).toHaveLength(1)
    expect(stateItems[0]).toEqual({ name: 'Aldric', type: 'npc', status: 'Alive' })
    expect(relItems).toHaveLength(1)
  })
})
