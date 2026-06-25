import { describe, it, expect, beforeEach } from 'vitest'
import type { Entity } from '@shared/entity-types'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createNote } from '../../../src/main/services/note.service'
import {
  createLink,
  getEntityContext,
  getHierarchy
} from '../../../src/main/services/link.service'
import { makeTestDb } from '../../helpers/test-db'

describe('graph traversal', () => {
  let ctx: DbContext
  let campaignId: string

  beforeEach(() => {
    ctx = makeTestDb()
    campaignId = createCampaign(ctx, { name: 'C' }).id
  })

  const loc = (name: string): Entity =>
    createEntity(ctx, { campaignId, type: 'location', name })
  const link = (from: Entity, to: Entity, relation: 'located_in' | 'owns' | 'knows', description?: string): void => {
    createLink(ctx, { campaignId, fromEntityId: from.id, toEntityId: to.id, relation, description })
  }

  it('getHierarchy returns ancestors (top-most first) and descendants', () => {
    const faerun = loc('Faerûn')
    const coast = loc('Sword Coast')
    const phandalin = loc('Phandalin')
    link(coast, faerun, 'located_in')
    link(phandalin, coast, 'located_in')

    const breadcrumb = getHierarchy(ctx, phandalin.id, 'location')
    expect(breadcrumb.ancestors.map((a) => a.name)).toEqual(['Faerûn', 'Sword Coast'])

    const subtree = getHierarchy(ctx, faerun.id, 'location')
    expect(subtree.descendants.map((d) => d.entity.name).sort()).toEqual(['Phandalin', 'Sword Coast'])
  })

  it('getHierarchy survives cycles', () => {
    const a = loc('A')
    const b = loc('B')
    link(a, b, 'located_in')
    link(b, a, 'located_in')
    expect(() => getHierarchy(ctx, a.id, 'location')).not.toThrow()
  })

  it('getEntityContext gathers neighbors with edge labels/descriptions and the seed notes', () => {
    const aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const inn = loc('Copper Kettle')
    const sword = createEntity(ctx, { campaignId, type: 'item', name: 'Sword' })
    createNote(ctx, { entityId: aldric.id, content: 'Gruff innkeeper' })
    link(aldric, inn, 'located_in', 'runs it')
    link(aldric, sword, 'owns')

    const bundle = getEntityContext(ctx, aldric.id, 1)
    expect(bundle.root.name).toBe('Aldric')
    expect(bundle.notes).toHaveLength(1)
    expect(bundle.neighbors.map((n) => n.entity.name).sort()).toEqual(['Copper Kettle', 'Sword'])

    const innEdge = bundle.neighbors.find((n) => n.entity.name === 'Copper Kettle')
    expect(innEdge?.viaLabel).toBe('located in')
    expect(innEdge?.viaDescription).toBe('runs it')
  })

  it('getEntityContext respects the depth bound', () => {
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const b = createEntity(ctx, { campaignId, type: 'npc', name: 'B' })
    const c = createEntity(ctx, { campaignId, type: 'npc', name: 'C' })
    link(a, b, 'knows')
    link(b, c, 'knows')

    expect(getEntityContext(ctx, a.id, 1).neighbors.map((n) => n.entity.name)).toEqual(['B'])
    expect(getEntityContext(ctx, a.id, 2).neighbors.map((n) => n.entity.name).sort()).toEqual([
      'B',
      'C'
    ])
  })
})
