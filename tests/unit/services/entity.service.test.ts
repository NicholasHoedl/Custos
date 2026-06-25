import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import {
  createEntity,
  getEntity,
  listEntities,
  updateEntity
} from '../../../src/main/services/entity.service'
import { makeTestDb } from '../../helpers/test-db'

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
})
