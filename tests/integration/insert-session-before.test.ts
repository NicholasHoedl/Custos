import { describe, it, expect } from 'vitest'

// ADR-062 — insertSessionBefore's uniform shift must be INVISIBLE to chronology: every as-of read at
// n+1 after the shift must equal the old read at n, pre-tracking NULLs must still read as
// before-everything, and the new session must be an empty beat in the timeline. Built against a REAL
// in-memory DB with a real story (baselines, status changes, formed/severed/open/pre-tracking ties,
// dated + timeless notes), mirroring import-apply.test.ts's shape.

import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import {
  createSession,
  insertSessionBefore,
  listSessions
} from '../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../src/main/services/entity.service'
import { buildCampaignGraph, createLink, listForEntity, severLink } from '../../src/main/services/link.service'
import { stateAsOf } from '../../src/main/services/chronology.service'
import { createNote, listNotesForEntity } from '../../src/main/services/note.service'
import type { DbContext } from '../../src/main/services/db-context'

/** Everything an as-of reader can observe at `n`, projected to STABLE identity (ids/contents/flags —
 *  never the stamped numbers themselves, which are exactly what the shift changes). */
function observeAt(
  ctx: DbContext,
  campaignId: string,
  entityIds: { aldric: string; mirna: string },
  n: number
): unknown {
  const graph = buildCampaignGraph(ctx, campaignId, n)
  return {
    aldric: stateAsOf(ctx, entityIds.aldric, n),
    mirna: stateAsOf(ctx, entityIds.mirna, n), // baseline at session 1 — covers "didn't exist yet"
    aldricTies: listForEntity(ctx, entityIds.aldric, n)
      .map((v) => v.link.id)
      .sort(),
    aldricNotes: listNotesForEntity(ctx, entityIds.aldric, n)
      .map((note) => note.content)
      .sort(),
    edges: graph.edges
      .map((e) => ({ id: e.id, severed: e.severed, justFormed: e.justFormed }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}

describe('insertSessionBefore — as-of chronology shifts coherently (ADR-062)', () => {
  it('reads at n+1 after the shift equal the old reads at n; the new session is an empty beat', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s1 = createSession(ctx, { campaignId })
    const s2 = createSession(ctx, { campaignId })
    const s3 = createSession(ctx, { campaignId })

    // The story: Aldric predates tracking, goes missing in session 2, dies in session 3. His tie to
    // Mirna forms in 1 and is severed in 3; a tie to Krell forms in 2 and stays open; Mirna–Krell
    // predates tracking. Notes at 1 and 3, plus one timeless (null-session) note.
    const aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric', sessionId: null })
    const mirna = createEntity(ctx, { campaignId, type: 'npc', name: 'Mirna', sessionId: s1.id })
    const krell = createEntity(ctx, { campaignId, type: 'npc', name: 'Krell', sessionId: s1.id })
    updateEntity(ctx, aldric.id, { status: 'Missing', sessionId: s2.id })
    updateEntity(ctx, aldric.id, { status: 'Dead', sessionId: s3.id })
    const tieSevered = createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: mirna.id,
      relation: 'ally_of',
      sessionId: s1.id
    })
    severLink(ctx, tieSevered.id, s3.id) // interval [1, 3)
    createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: krell.id,
      relation: 'ally_of',
      sessionId: s2.id
    })
    const tiePreTracking = createLink(ctx, {
      campaignId,
      fromEntityId: mirna.id,
      toEntityId: krell.id,
      relation: 'ally_of',
      sessionId: null
    })
    createNote(ctx, { campaignId, entityIds: [aldric.id], sessionId: s1.id, content: 'met at the inn' })
    createNote(ctx, { campaignId, entityIds: [aldric.id], sessionId: s3.id, content: 'fell at the bridge' })
    createNote(ctx, { campaignId, entityIds: [aldric.id], content: 'a legend older than the town' })

    const ids = { aldric: aldric.id, mirna: mirna.id }
    const before = [0, 1, 2, 3, 4].map((n) => observeAt(ctx, campaignId, ids, n))

    // ---- Backfill a session before session 1 ----
    const inserted = insertSessionBefore(ctx, { campaignId, beforeSessionId: s1.id })
    expect(inserted.number).toBe(1)

    // The whole timeline reads one step later, unchanged in content.
    for (const n of [0, 1, 2, 3, 4]) {
      expect(observeAt(ctx, campaignId, ids, n + 1)).toEqual(before[n])
    }

    // The new session is an EMPTY beat: pre-tracking facts are live (NULL still reads as
    // before-everything), nothing formed there, and only the timeless note is visible.
    expect(observeAt(ctx, campaignId, ids, 1)).toEqual(before[0]) // ≡ the pre-tracking world
    const graphAtNew = buildCampaignGraph(ctx, campaignId, 1)
    expect(graphAtNew.edges.map((e) => e.id)).toEqual([tiePreTracking.id])
    expect(graphAtNew.edges[0].justFormed).toBe(false)
    expect(listNotesForEntity(ctx, aldric.id, 1).map((n) => n.content)).toEqual([
      'a legend older than the town'
    ])
    // The session-1-formed tie now reads as just formed at 2.
    const graphAt2 = buildCampaignGraph(ctx, campaignId, 2)
    expect(graphAt2.edges.find((e) => e.id === tieSevered.id)?.justFormed).toBe(true)

    // ---- A second insert before a MIDDLE session (old s2, now number 3) ----
    const before2 = [1, 2, 3, 4, 5].map((n) => observeAt(ctx, campaignId, ids, n))
    const insertedMid = insertSessionBefore(ctx, { campaignId, beforeSessionId: s2.id })
    expect(insertedMid.number).toBe(3)

    // Rows BELOW k are untouched; rows at/after k read one step later.
    expect(observeAt(ctx, campaignId, ids, 1)).toEqual(before2[0])
    expect(observeAt(ctx, campaignId, ids, 2)).toEqual(before2[1])
    for (const n of [3, 4, 5]) {
      expect(observeAt(ctx, campaignId, ids, n + 1)).toEqual(before2[n - 1])
    }

    // Recap contiguity (recap.service looks up `number - 1`): the session AFTER the anchor now finds
    // the NEW empty session as its story predecessor — deliberate, documented in ADR-062.
    const sessions = listSessions(ctx, campaignId)
    const oldS2 = sessions.find((s) => s.id === s2.id)
    expect(oldS2?.number).toBe(4)
    const predecessor = sessions.find((s) => s.number === 3)
    expect(predecessor?.id).toBe(insertedMid.id)
    expect(predecessor?.summary).toBeNull()

    // Final number line: [new1, s1, new2, s2, s3] = 1..5.
    expect(sessions.map((s) => s.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })
})
