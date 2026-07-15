import { desc, eq, max } from 'drizzle-orm'
import type { Session } from '@shared/entity-types'
import type { CreateSessionInput, UpdateSessionInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToSession } from './serialize'

export function listSessions(ctx: DbContext, campaignId: string): Session[] {
  return ctx.drizzle
    .select()
    .from(schema.session)
    .where(eq(schema.session.campaignId, campaignId))
    .orderBy(desc(schema.session.number))
    .all()
    .map(rowToSession)
}

export function getSession(ctx: DbContext, id: string): Session | null {
  const r = ctx.drizzle.select().from(schema.session).where(eq(schema.session.id, id)).get()
  return r ? rowToSession(r) : null
}

/** The session NUMBER for a given session id, or null if it doesn't exist. */
export function sessionNumberById(ctx: DbContext, id: string): number | null {
  const r = ctx.drizzle
    .select({ number: schema.session.number })
    .from(schema.session)
    .where(eq(schema.session.id, id))
    .get()
  return r?.number ?? null
}

/** The campaign's latest (highest) session number, or null if it has no sessions yet. */
export function latestSessionNumber(ctx: DbContext, campaignId: string): number | null {
  const r = ctx.drizzle
    .select({ number: schema.session.number })
    .from(schema.session)
    .where(eq(schema.session.campaignId, campaignId))
    .orderBy(desc(schema.session.number))
    .get()
  return r?.number ?? null
}

/**
 * Chronology (ADR-017): the session NUMBER to stamp a capture with — the given active session if it
 * resolves, else the campaign's latest, else null (pre-tracking; no sessions exist yet). Resolved in
 * the MAIN process, never trusting a renderer-supplied number.
 */
export function resolveCaptureSessionNumber(
  ctx: DbContext,
  sessionId: string | undefined,
  campaignId: string
): number | null {
  if (sessionId) {
    const byId = sessionNumberById(ctx, sessionId)
    if (byId !== null) return byId
  }
  return latestSessionNumber(ctx, campaignId)
}

export function createSession(ctx: DbContext, input: CreateSessionInput): Session {
  const agg = ctx.drizzle
    .select({ m: max(schema.session.number) })
    .from(schema.session)
    .where(eq(schema.session.campaignId, input.campaignId))
    .get()
  const number = (agg?.m ?? 0) + 1
  const row = {
    id: newId(),
    campaignId: input.campaignId,
    number,
    title: input.title ?? null,
    summary: null,
    date: new Date().toISOString().slice(0, 10),
    createdAt: now()
  }
  ctx.drizzle.insert(schema.session).values(row).run()
  return rowToSession(row)
}

export function updateSession(ctx: DbContext, id: string, patch: UpdateSessionInput): Session {
  const set: Partial<typeof schema.session.$inferInsert> = {}
  if (patch.title !== undefined) set.title = patch.title
  if (patch.summary !== undefined) set.summary = patch.summary
  if (patch.date !== undefined) set.date = patch.date
  // Skip a no-op update (Drizzle errors on an empty `set`); still return the current row below.
  if (Object.keys(set).length > 0) {
    ctx.drizzle.update(schema.session).set(set).where(eq(schema.session.id, id)).run()
  }
  const s = getSession(ctx, id)
  if (!s) throw new Error(`Session ${id} not found`)
  return s
}

// Deletes a session. Its event-log entries cascade away; notes keep their content but have their
// session link nulled (note.sessionId onDelete: 'set null') so no captured note is ever lost.
export function deleteSession(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.session).where(eq(schema.session.id, id)).run()
}

/**
 * Per-session count of chronicle entries added SINCE the session was last closed out (ROADMAP P1-2).
 * There is no `lastClosedOut` stamp — it's derived: close-out writes its notes stamped at the session
 * (`createNote` with `sessionId`, `createdAt = now()`), so an entry is "unclosed" when its
 * `event_log.updatedAt` (C1: bumped on EDIT too, so an entry edited AFTER its session was extracted
 * re-flags the session) is newer than that session's newest `note.createdAt`. Illuminate proposes no
 * notes, so it never moves the mark; undated batches stamp a null session and don't count. Returns a
 * sparse map (only sessions with ≥1 unclosed entry) — a session with zero entries is never flagged.
 */
export function unclosedCounts(ctx: DbContext, campaignId: string): Record<string, number> {
  // Newest extracted-note time per session.
  const noteRows = ctx.drizzle
    .select({ sessionId: schema.note.sessionId, newest: max(schema.note.createdAt) })
    .from(schema.note)
    .where(eq(schema.note.campaignId, campaignId))
    .groupBy(schema.note.sessionId)
    .all()
  const newestNote = new Map<string, number>()
  for (const r of noteRows) {
    if (r.sessionId && r.newest != null) newestNote.set(r.sessionId, r.newest)
  }
  // Count each session's entries newer than its newest note (in-memory combine — event volume per
  // campaign is small; mirrors enrich.service.listTouchedEntities' style).
  const events = ctx.drizzle
    .select({
      sessionId: schema.eventLog.sessionId,
      timestamp: schema.eventLog.timestamp,
      updatedAt: schema.eventLog.updatedAt
    })
    .from(schema.eventLog)
    .where(eq(schema.eventLog.campaignId, campaignId))
    .all()
  const counts: Record<string, number> = {}
  for (const e of events) {
    // C1: compare the EDIT time (updatedAt), not just creation — an entry edited after its session was
    // extracted re-flags the session (its extracted note still reflects the OLD text). Legacy rows have a
    // null updatedAt → fall back to timestamp (unchanged add-only behavior).
    if ((e.updatedAt ?? e.timestamp) > (newestNote.get(e.sessionId) ?? 0)) {
      counts[e.sessionId] = (counts[e.sessionId] ?? 0) + 1
    }
  }
  return counts
}
