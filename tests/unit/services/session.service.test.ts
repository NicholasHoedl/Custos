import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import type { DbContext } from '../../../src/main/services/db-context'
import * as schema from '../../../src/main/db/schema'
import { createCampaign } from '../../../src/main/services/campaign.service'
import {
  createSession,
  deleteSession,
  getSession,
  insertSessionBefore,
  listSessions,
  updateSession
} from '../../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../../src/main/services/entity.service'
import { createLink, severLink } from '../../../src/main/services/link.service'
import { getEntityHistory } from '../../../src/main/services/chronology.service'
import { createNote, listNotesForEntity } from '../../../src/main/services/note.service'
import { createEvent, listEvents } from '../../../src/main/services/event.service'
import { makeTestDb } from '../../helpers/test-db'

describe('session.service', () => {
  let ctx: DbContext
  let campaignId: string

  beforeEach(() => {
    ctx = makeTestDb()
    campaignId = createCampaign(ctx, { name: 'Test Campaign' }).id
  })

  it('updates title/summary/date', () => {
    const s = createSession(ctx, { campaignId })
    const u = updateSession(ctx, s.id, { title: 'The Ambush', summary: 'goblins', date: '2025-02-01' })
    expect(u.title).toBe('The Ambush')
    expect(u.summary).toBe('goblins')
    expect(u.date).toBe('2025-02-01')
  })

  it('deletes a session, cascading its events and nulling its notes’ session link', () => {
    const session = createSession(ctx, { campaignId })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    createNote(ctx, { campaignId, entityIds: [npc.id], sessionId: session.id, content: 'a captured note' })
    createEvent(ctx, { sessionId: session.id, content: 'something happened' })

    deleteSession(ctx, session.id)

    expect(getSession(ctx, session.id)).toBeNull()
    expect(listEvents(ctx, session.id)).toHaveLength(0) // events cascade away

    const notes = listNotesForEntity(ctx, npc.id)
    expect(notes).toHaveLength(1) // the note itself survives...
    expect(notes[0].sessionId).toBeNull() // ...with its session link nulled
  })

  it('does not renumber surviving sessions; the freed number is reused by the next create', () => {
    const s1 = createSession(ctx, { campaignId })
    const s2 = createSession(ctx, { campaignId })
    expect(s1.number).toBe(1)
    expect(s2.number).toBe(2)

    deleteSession(ctx, s2.id)
    expect(listSessions(ctx, campaignId).map((s) => s.number)).toEqual([1])

    const s3 = createSession(ctx, { campaignId })
    expect(s3.number).toBe(2) // next = max(remaining) + 1 — no unique-constraint clash
  })

  // ADR-062: the ONE sanctioned renumber — a uniform +1 shift that inserts a new empty session before
  // an existing one and moves every denormalized chronology stamp with it in the same transaction.
  describe('insertSessionBefore', () => {
    it('shifts a DENSE run under the unique index (fails if simplified to a single +1 UPDATE)', () => {
      // Adjacent numbers are the case where a naive `SET number = number + 1` trips SQLite's per-row
      // unique check on (campaign_id, number) — this test locks the negate two-phase in place.
      const sessions = [1, 2, 3, 4, 5].map(() => createSession(ctx, { campaignId }))
      const anchor = sessions[2] // number 3

      const inserted = insertSessionBefore(ctx, { campaignId, beforeSessionId: anchor.id })

      expect(inserted.number).toBe(3)
      expect(inserted.title).toBeNull()
      expect(inserted.summary).toBeNull()
      expect(inserted.date).toBe(new Date().toISOString().slice(0, 10))
      const numbers = listSessions(ctx, campaignId).map((s) => s.number)
      expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
      expect(getSession(ctx, anchor.id)?.number).toBe(4) // the anchor shifted up...
      expect(getSession(ctx, sessions[0].id)?.number).toBe(1) // ...rows below k untouched
      expect(getSession(ctx, sessions[4].id)?.number).toBe(6)
    })

    it('inserts before the OLDEST session (the backfill case)', () => {
      const s1 = createSession(ctx, { campaignId })
      const s2 = createSession(ctx, { campaignId })

      const inserted = insertSessionBefore(ctx, { campaignId, beforeSessionId: s1.id })

      expect(inserted.number).toBe(1)
      expect(getSession(ctx, s1.id)?.number).toBe(2)
      expect(getSession(ctx, s2.id)?.number).toBe(3)
    })

    it('tolerates gaps left by deletes; the gap below k is untouched', () => {
      const s1 = createSession(ctx, { campaignId })
      const s2 = createSession(ctx, { campaignId })
      const s3 = createSession(ctx, { campaignId })
      deleteSession(ctx, s2.id) // numbers: 1, 3

      const inserted = insertSessionBefore(ctx, { campaignId, beforeSessionId: s3.id })

      expect(inserted.number).toBe(3)
      expect(getSession(ctx, s1.id)?.number).toBe(1) // the 1..2 gap stays a gap
      expect(getSession(ctx, s3.id)?.number).toBe(4)
    })

    it('never touches another campaign', () => {
      const otherId = createCampaign(ctx, { name: 'Other' }).id
      const otherSession = createSession(ctx, { campaignId: otherId })
      const a = createEntity(ctx, { campaignId: otherId, type: 'npc', name: 'A' })
      const b = createEntity(ctx, { campaignId: otherId, type: 'npc', name: 'B' })
      const otherLink = createLink(ctx, {
        campaignId: otherId,
        fromEntityId: a.id,
        toEntityId: b.id,
        relation: 'ally_of',
        sessionId: otherSession.id
      })

      const mine = createSession(ctx, { campaignId })
      insertSessionBefore(ctx, { campaignId, beforeSessionId: mine.id })

      expect(getSession(ctx, otherSession.id)?.number).toBe(1)
      const row = ctx.drizzle
        .select()
        .from(schema.entityLink)
        .where(eq(schema.entityLink.id, otherLink.id))
        .get()
      expect(row?.startSessionNumber).toBe(1)
    })

    it('shifts chronology stamps with the sessions and NEVER touches NULLs', () => {
      const s1 = createSession(ctx, { campaignId })
      const s2 = createSession(ctx, { campaignId })
      // Pre-tracking baseline (explicit null) vs a session-1 baseline + a status change at session 2.
      const ancient = createEntity(ctx, { campaignId, type: 'npc', name: 'Ancient', sessionId: null })
      const aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric', sessionId: s1.id })
      const mirna = createEntity(ctx, { campaignId, type: 'npc', name: 'Mirna', sessionId: s1.id })
      const krell = createEntity(ctx, { campaignId, type: 'npc', name: 'Krell', sessionId: s1.id })
      updateEntity(ctx, aldric.id, { status: 'Missing', sessionId: s2.id })
      // Interval [1, 2): formed at s1, severed at s2. An open tie from s2. A pre-tracking tie.
      const severed = createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: mirna.id,
        relation: 'ally_of',
        sessionId: s1.id
      })
      severLink(ctx, severed.id, s2.id)
      const open = createLink(ctx, {
        campaignId,
        fromEntityId: aldric.id,
        toEntityId: krell.id,
        relation: 'ally_of',
        sessionId: s2.id
      })
      const preTracking = createLink(ctx, {
        campaignId,
        fromEntityId: mirna.id,
        toEntityId: krell.id,
        relation: 'ally_of',
        sessionId: null
      })

      insertSessionBefore(ctx, { campaignId, beforeSessionId: s1.id })

      // Status history: NULL baseline untouched; stamped rows shifted with their sessions.
      expect(getEntityHistory(ctx, ancient.id)[0].sinceSessionNumber).toBeNull()
      const aldricRows = getEntityHistory(ctx, aldric.id)
      expect(aldricRows.map((r) => r.sinceSessionNumber)).toEqual([2, 3])
      // Tie intervals: [1,2) -> [2,3); open start 2 -> 3 with end STILL NULL; pre-tracking stays NULL.
      const linkById = (id: string) =>
        ctx.drizzle.select().from(schema.entityLink).where(eq(schema.entityLink.id, id)).get()
      expect(linkById(severed.id)?.startSessionNumber).toBe(2)
      expect(linkById(severed.id)?.endSessionNumber).toBe(3)
      expect(linkById(open.id)?.startSessionNumber).toBe(3)
      expect(linkById(open.id)?.endSessionNumber).toBeNull()
      expect(linkById(preTracking.id)?.startSessionNumber).toBeNull()
      expect(linkById(preTracking.id)?.endSessionNumber).toBeNull()
    })

    it('rejects an unknown anchor and a session from another campaign', () => {
      const otherId = createCampaign(ctx, { name: 'Other' }).id
      const other = createSession(ctx, { campaignId: otherId })
      createSession(ctx, { campaignId })

      expect(() => insertSessionBefore(ctx, { campaignId, beforeSessionId: 'nope' })).toThrow(
        /not found/
      )
      expect(() => insertSessionBefore(ctx, { campaignId, beforeSessionId: other.id })).toThrow(
        /does not belong/
      )
    })
  })
})
