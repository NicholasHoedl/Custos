import { and, desc, eq, gte, inArray, lt, max, sql } from 'drizzle-orm'
import type { Session } from '@shared/entity-types'
import type {
  CreateSessionInput,
  InsertSessionBeforeInput,
  UpdateSessionInput
} from '@shared/ipc-types'
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
 * Backfill (ADR-062): insert a NEW empty session at the anchor's number; the anchor and every later
 * session shift +1, and the denormalized chronology stamps (status_history.since_session_number,
 * entity_link.start/end_session_number — ADR-017's session-number timeline) shift with them in the
 * SAME transaction. This is the ONE sanctioned renumber, and it's a UNIFORM shift — existing sessions
 * never change relative order, so no tie interval can invert. Notes/events reference sessions by ID
 * and travel for free.
 *
 * Invariants:
 * - NULL stamps are never touched: SQL `>= k` is false for NULL, so pre-tracking baselines (NULL
 *   since/start) stay pre-tracking and OPEN intervals (NULL end) stay open — which also keeps the
 *   partial `link_open_unique_idx ... WHERE end_session_number IS NULL` membership stable.
 * - The session shift uses a NEGATE two-phase (`n → -(n+1)` then `negatives → -n`): SQLite checks the
 *   (campaign_id, number) UNIQUE index PER ROW during UPDATE (no deferred constraints, and UPDATE's
 *   ORDER BY does not control write order), so a naive single `+1` collides. Intermediate negatives
 *   can't collide with live positives, and the flipped results (k+1…) can't collide with the
 *   unshifted rows (< k).
 */
export function insertSessionBefore(ctx: DbContext, input: InsertSessionBeforeInput): Session {
  const before = getSession(ctx, input.beforeSessionId)
  if (!before) throw new Error(`Session ${input.beforeSessionId} not found`)
  // Never trust a renderer-supplied pairing (mirrors resolveCaptureSessionNumber's ethos).
  if (before.campaignId !== input.campaignId) {
    throw new Error(
      `Session ${input.beforeSessionId} does not belong to campaign ${input.campaignId}`
    )
  }
  const k = before.number
  const row = {
    id: newId(),
    campaignId: input.campaignId,
    number: k,
    title: null,
    summary: null,
    date: new Date().toISOString().slice(0, 10),
    createdAt: now()
  }
  ctx.drizzle.transaction((tx) => {
    // Session numbers: negate two-phase (see doc comment).
    tx.update(schema.session)
      .set({ number: sql`-(${schema.session.number} + 1)` })
      .where(and(eq(schema.session.campaignId, input.campaignId), gte(schema.session.number, k)))
      .run()
    tx.update(schema.session)
      .set({ number: sql`-${schema.session.number}` })
      .where(and(eq(schema.session.campaignId, input.campaignId), lt(schema.session.number, 0)))
      .run()
    // Status history has no campaign column — scope through the campaign's entities.
    tx.update(schema.statusHistory)
      .set({ sinceSessionNumber: sql`${schema.statusHistory.sinceSessionNumber} + 1` })
      .where(
        and(
          gte(schema.statusHistory.sinceSessionNumber, k),
          inArray(
            schema.statusHistory.entityId,
            tx
              .select({ id: schema.entity.id })
              .from(schema.entity)
              .where(eq(schema.entity.campaignId, input.campaignId))
          )
        )
      )
      .run()
    // Tie intervals: plain +1 per column (no unique constraint spans the shifted values).
    tx.update(schema.entityLink)
      .set({ startSessionNumber: sql`${schema.entityLink.startSessionNumber} + 1` })
      .where(
        and(
          eq(schema.entityLink.campaignId, input.campaignId),
          gte(schema.entityLink.startSessionNumber, k)
        )
      )
      .run()
    tx.update(schema.entityLink)
      .set({ endSessionNumber: sql`${schema.entityLink.endSessionNumber} + 1` })
      .where(
        and(
          eq(schema.entityLink.campaignId, input.campaignId),
          gte(schema.entityLink.endSessionNumber, k)
        )
      )
      .run()
    // Number k is now free — the new session takes it.
    tx.insert(schema.session).values(row).run()
  })
  return rowToSession(row)
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
