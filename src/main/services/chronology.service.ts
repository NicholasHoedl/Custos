import { and, eq, isNull, lte, or } from 'drizzle-orm'
import type { Entity, Lifecycle, StatusHistoryEntry } from '@shared/entity-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { rowToStatusHistory } from './serialize'

// Chronology reconstruction (ADR-017 / docs/design/chronology.md). Session order (`session.number`)
// is the timeline; it is denormalized into status_history.since_session_number and the entity_link
// interval columns, so everything here is a pure, join-free integer comparison — trivially testable.

const ENDED_KEYWORDS = ['dead', 'deceased', 'destroyed', 'ruined', 'disbanded', 'abandoned', 'gone']

/**
 * Derive a coarse lifecycle from free-text status. MUST mirror the SQL `CASE` in migration 0005 so
 * backfilled rows and runtime writes agree: dead/destroyed/… → `ended`; blank → `unknown`; else
 * `active`.
 */
export function lifecycleHeuristic(status: string | null): Lifecycle {
  if (status === null || status.trim() === '') return 'unknown'
  const s = status.toLowerCase()
  return ENDED_KEYWORDS.some((k) => s.includes(k)) ? 'ended' : 'active'
}

/**
 * Is a relationship interval live at session `n`? Started at or before n (or pre-tracking), and not
 * yet ended as of n (endSession is exclusive: a link severed in session E is already gone at E).
 */
export function isIntervalLiveAt(
  startSessionNumber: number | null,
  endSessionNumber: number | null,
  n: number
): boolean {
  const started = startSessionNumber === null || startSessionNumber <= n
  const notEnded = endSessionNumber === null || endSessionNumber > n
  return started && notEnded
}

/**
 * Reconstruct an entity's lifecycle + status AS OF session number `n`: the latest status_history row
 * applicable at n (`since_session_number` NULL [pre-tracking] or ≤ n), tie-broken by `recordedAt`.
 * Pure and join-free. Returns null when no row applies (e.g. the entity did not exist yet at n); the
 * caller then falls back to the entity's live status.
 */
export function stateAsOf(
  ctx: DbContext,
  entityId: string,
  n: number
): { lifecycle: Lifecycle; status: string | null } | null {
  const rows = ctx.drizzle
    .select()
    .from(schema.statusHistory)
    .where(
      and(
        eq(schema.statusHistory.entityId, entityId),
        or(
          isNull(schema.statusHistory.sinceSessionNumber),
          lte(schema.statusHistory.sinceSessionNumber, n)
        )
      )
    )
    .all()
  if (rows.length === 0) return null
  // Latest applicable = highest since_session_number (NULL = earliest), tie-broken by recordedAt.
  // recordedAt ties use >= so the LATER row wins: rows iterate in insertion order (the entity-id
  // index walks rowids), and a backfill batch can write a baseline + a change in the same millisecond
  // — the change, applied second, must win at that session.
  const best = rows.reduce((a, b) => {
    const as = a.sinceSessionNumber ?? Number.NEGATIVE_INFINITY
    const bs = b.sinceSessionNumber ?? Number.NEGATIVE_INFINITY
    return bs > as || (bs === as && b.recordedAt >= a.recordedAt) ? b : a
  })
  return { lifecycle: best.lifecycle as Lifecycle, status: best.status }
}

/**
 * An entity's status + lifecycle at the query time: its LIVE values for a "now" query (asOf
 * undefined), or its state reconstructed AS OF session `asOf`. When no history applies at `asOf` (the
 * entity did not exist yet), returns an empty/unknown state so grounding asserts nothing false.
 */
export function resolveEntityState(
  ctx: DbContext,
  entity: Entity,
  asOf?: number
): { status: string | null; lifecycle: Lifecycle } {
  if (asOf === undefined) return { status: entity.status, lifecycle: entity.lifecycle }
  return stateAsOf(ctx, entity.id, asOf) ?? { status: null, lifecycle: 'unknown' }
}

/** An entity's full status/lifecycle history, oldest first (baseline → later changes). For the UI. */
export function getEntityHistory(ctx: DbContext, entityId: string): StatusHistoryEntry[] {
  return ctx.drizzle
    .select()
    .from(schema.statusHistory)
    .where(eq(schema.statusHistory.entityId, entityId))
    .all()
    .map(rowToStatusHistory)
    .sort((a, b) => {
      const as = a.sinceSessionNumber ?? Number.NEGATIVE_INFINITY
      const bs = b.sinceSessionNumber ?? Number.NEGATIVE_INFINITY
      return as - bs || a.recordedAt - b.recordedAt
    })
}
