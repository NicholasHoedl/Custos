import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ROADMAP P1-2/P1-4 against a REAL in-memory DB: the derived unclosed-session count, and chronicle
// entry edit/delete. Date.now is stubbed to an incrementing clock so create-order === timestamp-order
// (createEvent/createNote each stamp via serialize.now() = Date.now()).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createSession } from '../../../src/main/services/session.service'
import { unclosedCounts } from '../../../src/main/services/session.service'
import {
  createEvent,
  updateEvent,
  deleteEvent,
  listEvents
} from '../../../src/main/services/event.service'
import { createNote } from '../../../src/main/services/note.service'

let clock = 1_000
beforeEach(() => {
  clock = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10))
})
afterEach(() => vi.restoreAllMocks())

describe('session.service — unclosedCounts (P1-2)', () => {
  it('counts entries newer than the session’s newest note, and clears after close-out stamps notes', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })

    // Two fresh entries, no notes yet → both unclosed.
    createEvent(ctx, { sessionId: session.id, content: 'We entered the cave.' })
    createEvent(ctx, { sessionId: session.id, content: 'A goblin ambush.' })
    expect(unclosedCounts(ctx, campaignId)[session.id]).toBe(2)

    // Close-out stamps a note at the session (createdAt now > both events) → nothing unclosed.
    createNote(ctx, { campaignId, entityIds: [], content: 'Ambush at the cave.', sessionId: session.id })
    expect(unclosedCounts(ctx, campaignId)[session.id]).toBeUndefined()

    // A new entry after the close-out → unclosed again, count 1.
    createEvent(ctx, { sessionId: session.id, content: 'They pressed deeper.' })
    expect(unclosedCounts(ctx, campaignId)[session.id]).toBe(1)
  })

  it('never flags a session with zero entries', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const empty = createSession(ctx, { campaignId })
    expect(unclosedCounts(ctx, campaignId)).toEqual({})
    expect(unclosedCounts(ctx, campaignId)[empty.id]).toBeUndefined()
  })

  it('ignores a campaign-lore note (null session) — it stamps no session', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    createEvent(ctx, { sessionId: session.id, content: 'An entry.' })
    // A later note with NO session must not clear the session's unclosed mark.
    createNote(ctx, { campaignId, entityIds: [], content: 'World lore.' })
    expect(unclosedCounts(ctx, campaignId)[session.id]).toBe(1)
  })
})

describe('event.service — edit/delete (P1-4)', () => {
  it('updates content in place, keeping the timestamp (and log position)', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const ev = createEvent(ctx, { sessionId: session.id, content: 'teh goblin' })

    const updated = updateEvent(ctx, ev.id, { content: 'the goblin' })
    expect(updated.content).toBe('the goblin')
    expect(updated.timestamp).toBe(ev.timestamp) // unchanged → stable ordering
    expect(listEvents(ctx, session.id)[0].content).toBe('the goblin')
  })

  it('deletes an entry', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const ev = createEvent(ctx, { sessionId: session.id, content: 'a typo entry' })
    expect(listEvents(ctx, session.id)).toHaveLength(1)

    deleteEvent(ctx, ev.id)
    expect(listEvents(ctx, session.id)).toHaveLength(0)
  })
})
