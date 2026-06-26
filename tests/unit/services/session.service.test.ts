import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession
} from '../../../src/main/services/session.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createNote, listNotes } from '../../../src/main/services/note.service'
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
    createNote(ctx, { entityId: npc.id, sessionId: session.id, content: 'a captured note' })
    createEvent(ctx, { sessionId: session.id, content: 'something happened' })

    deleteSession(ctx, session.id)

    expect(getSession(ctx, session.id)).toBeNull()
    expect(listEvents(ctx, session.id)).toHaveLength(0) // events cascade away

    const notes = listNotes(ctx, npc.id)
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
})
