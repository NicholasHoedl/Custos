import { describe, it, expect, beforeEach } from 'vitest'
import type { Entity } from '@shared/entity-types'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createLink, deleteLink, listForEntity } from '../../../src/main/services/link.service'
import { makeTestDb } from '../../helpers/test-db'

describe('link.service', () => {
  let ctx: DbContext
  let campaignId: string
  let aldric: Entity
  let inn: Entity

  beforeEach(() => {
    ctx = makeTestDb()
    campaignId = createCampaign(ctx, { name: 'C' }).id
    aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric Vane' })
    inn = createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle Inn' })
  })

  it('creates a valid link', () => {
    const l = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    expect(l.relation).toBe('located_in')
  })

  it('rejects a relation not allowed between the two types', () => {
    expect(() =>
      createLink(ctx, { campaignId, fromEntityId: aldric.id, toEntityId: inn.id, relation: 'owns' })
    ).toThrow()
  })

  it('is idempotent on a duplicate edge', () => {
    const a = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    const b = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    expect(b.id).toBe(a.id)
  })

  it('shows the forward label on the source and the inverse label on the target', () => {
    createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in',
      description: 'runs the place'
    })

    const fromAldric = listForEntity(ctx, aldric.id)
    expect(fromAldric).toHaveLength(1)
    expect(fromAldric[0].label).toBe('located in')
    expect(fromAldric[0].other.name).toBe('Copper Kettle Inn')

    const fromInn = listForEntity(ctx, inn.id)
    expect(fromInn[0].label).toBe('contains')
    expect(fromInn[0].other.name).toBe('Aldric Vane')
    expect(fromInn[0].link.description).toBe('runs the place')
  })

  it('deletes a link', () => {
    const l = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    deleteLink(ctx, l.id)
    expect(listForEntity(ctx, aldric.id)).toHaveLength(0)
  })

  it('collapses a reciprocal symmetric link (no duplicate edge or row)', () => {
    const mirna = createEntity(ctx, { campaignId, type: 'npc', name: 'Mirna Dendrar' })
    const a = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: mirna.id,
      relation: 'ally_of'
    })
    // Authoring the same alliance from the other side must return the existing edge, not a new one.
    const b = createLink(ctx, {
      campaignId,
      fromEntityId: mirna.id,
      toEntityId: aldric.id,
      relation: 'ally_of'
    })
    expect(b.id).toBe(a.id)
    expect(listForEntity(ctx, aldric.id)).toHaveLength(1)
    expect(listForEntity(ctx, mirna.id)).toHaveLength(1)
    expect(listForEntity(ctx, aldric.id)[0].label).toBe('ally of')
  })

  it('collapses an inverse-paired link authored from the other side', () => {
    // located_in (aldric -> inn) and contains (inn -> aldric) are the same containment edge.
    const a = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in'
    })
    const b = createLink(ctx, {
      campaignId,
      fromEntityId: inn.id,
      toEntityId: aldric.id,
      relation: 'contains'
    })
    expect(b.id).toBe(a.id)
    expect(listForEntity(ctx, aldric.id)).toHaveLength(1)
    expect(listForEntity(ctx, inn.id)).toHaveLength(1)
  })
})
