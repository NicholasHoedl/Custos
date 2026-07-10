import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Entity } from '@shared/entity-types'
import type { DbContext } from '../../../src/main/services/db-context'
import * as schema from '../../../src/main/db/schema'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createSession } from '../../../src/main/services/session.service'
import {
  buildCampaignGraph,
  createLink,
  deleteLink,
  listForEntity,
  severLink,
  updateLink
} from '../../../src/main/services/link.service'
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

  it('updates a tie’s description in place (ADR-032), leaving the interval untouched', () => {
    const l = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in',
      description: 'Rents a room upstairs.'
    })
    const updated = updateLink(ctx, l.id, { description: 'Owns the place outright.' })
    expect(updated.description).toBe('Owns the place outright.')
    expect(updated.startSessionNumber).toBe(l.startSessionNumber) // interval unchanged
    // Clearing to empty normalizes to null.
    expect(updateLink(ctx, l.id, { description: '   ' }).description).toBeNull()
    // A missing link throws rather than silently succeeding.
    expect(() => updateLink(ctx, 'nope', { description: 'x' })).toThrow()
  })

  it('persists + edits directional disposition and confidence (ADR-033); defaults confidence to confirmed', () => {
    const mira = createEntity(ctx, { campaignId, type: 'npc', name: 'Mira' })
    const l = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: mira.id,
      relation: 'related_to',
      fromDisposition: 'protective, guilty',
      toDisposition: 'adoring'
    })
    expect(l.fromDisposition).toBe('protective, guilty')
    expect(l.toDisposition).toBe('adoring')
    expect(l.confidence).toBe('confirmed') // default when omitted

    // Edit disposition + confidence independently of description; the interval is untouched.
    const up = updateLink(ctx, l.id, { toDisposition: 'resentful', confidence: 'rumored' })
    expect(up.toDisposition).toBe('resentful')
    expect(up.fromDisposition).toBe('protective, guilty') // unchanged (not in the patch)
    expect(up.confidence).toBe('rumored')
    expect(up.startSessionNumber).toBe(l.startSessionNumber)
    // Clearing a disposition to blank normalizes to null.
    expect(updateLink(ctx, l.id, { fromDisposition: '  ' }).fromDisposition).toBeNull()
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

  // ---- Chronology: sever + re-form (M3) ----

  it('severs a relationship without deleting it, and re-forms a fresh interval', () => {
    const rowsFor = (): (typeof schema.entityLink.$inferSelect)[] =>
      ctx.drizzle.select().from(schema.entityLink).where(eq(schema.entityLink.fromEntityId, aldric.id)).all()

    const s1 = createSession(ctx, { campaignId }) // session 1
    const l1 = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in',
      sessionId: s1.id
    })
    expect(l1.startSessionNumber).toBe(1)
    expect(l1.endSessionNumber).toBeNull()

    const s2 = createSession(ctx, { campaignId }) // session 2
    severLink(ctx, l1.id, s2.id)

    const afterSever = rowsFor()
    expect(afterSever).toHaveLength(1) // not deleted — the row survives
    expect(afterSever[0].endSessionNumber).toBe(2) // closed at session 2

    // Re-forming the same edge creates a NEW open interval (idempotency ignores closed rows).
    const s3 = createSession(ctx, { campaignId }) // session 3
    const l2 = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: inn.id,
      relation: 'located_in',
      sessionId: s3.id
    })
    expect(l2.id).not.toBe(l1.id)
    const afterReform = rowsFor()
    expect(afterReform).toHaveLength(2) // both intervals preserved
    expect(afterReform.filter((r) => r.endSessionNumber === null)).toHaveLength(1) // exactly one open
  })

  // ---- Campaign graph (P2-3, the "Web" view) ----

  describe('buildCampaignGraph', () => {
    it('emits a node per entity (carrying image + lifecycle) and a labelled edge per LIVE tie', () => {
      const relic = createEntity(ctx, {
        campaignId,
        type: 'item',
        name: 'Ashen Relic',
        image: 'data:image/jpeg;base64,AAAA'
      })
      createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: inn.id,
        relation: 'located_in'
      })
      createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: relic.id,
        relation: 'owns'
      })

      const g = buildCampaignGraph(ctx, campaignId)
      expect(g.nodes.map((n) => n.name).sort()).toEqual([
        'Aldric Vane',
        'Ashen Relic',
        'Copper Kettle Inn'
      ])
      // Portrait + lifecycle ride through onto the node.
      const relicNode = g.nodes.find((n) => n.id === relic.id)!
      expect(relicNode.image).toBe('data:image/jpeg;base64,AAAA')
      expect(relicNode.lifecycle).toBe(relic.lifecycle) // the node mirrors the entity's lifecycle
      // The default (imageless) entity is null, not undefined.
      expect(g.nodes.find((n) => n.id === inn.id)!.image).toBeNull()

      // Edges carry the FORWARD display label (not the raw key), oriented from -> to.
      const owns = g.edges.find((e) => e.to === relic.id)!
      expect(owns.from).toBe(aldric.id)
      expect(owns.label).toBe('owns')
      expect(g.edges.find((e) => e.to === inn.id)!.label).toBe('located in')
      expect(g.edges).toHaveLength(2)
    })

    it('excludes severed (closed-interval) ties — the map is the current picture', () => {
      const s1 = createSession(ctx, { campaignId })
      const live = createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: inn.id,
        relation: 'located_in',
        sessionId: s1.id
      })
      const mira = createEntity(ctx, { campaignId, type: 'npc', name: 'Mira' })
      const doomed = createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: mira.id,
        relation: 'ally_of',
        sessionId: s1.id
      })
      const s2 = createSession(ctx, { campaignId })
      severLink(ctx, doomed.id, s2.id)

      const g = buildCampaignGraph(ctx, campaignId)
      expect(g.nodes).toHaveLength(3) // Mira stays a node even though her tie is severed
      expect(g.edges).toHaveLength(1) // only the live tie is an edge
      expect(g.edges[0].id).toBe(live.id)
    })

    it('drops an edge whose endpoint entity is gone (defensive against dangling refs)', () => {
      createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: inn.id,
        relation: 'located_in'
      })
      // Force a dangling edge by removing the endpoint row directly (bypassing deleteEntity's cascade).
      ctx.drizzle.delete(schema.entity).where(eq(schema.entity.id, inn.id)).run()
      const g = buildCampaignGraph(ctx, campaignId)
      expect(g.nodes.map((n) => n.id)).toEqual([aldric.id])
      expect(g.edges).toHaveLength(0) // the dangling edge is dropped, not crashed on
    })
  })
})
