import { asc, eq } from 'drizzle-orm'
import type { EventLogEntry } from '@shared/entity-types'
import type { CreateEventInput, UpdateEventInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToEvent } from './serialize'

export function listEvents(ctx: DbContext, sessionId: string): EventLogEntry[] {
  return ctx.drizzle
    .select()
    .from(schema.eventLog)
    .where(eq(schema.eventLog.sessionId, sessionId))
    .orderBy(asc(schema.eventLog.timestamp))
    .all()
    .map(rowToEvent)
}

/** Every event-log entry in a campaign (chronological). For export/backup. */
export function listEventsForCampaign(ctx: DbContext, campaignId: string): EventLogEntry[] {
  return ctx.drizzle
    .select()
    .from(schema.eventLog)
    .where(eq(schema.eventLog.campaignId, campaignId))
    .orderBy(asc(schema.eventLog.timestamp))
    .all()
    .map(rowToEvent)
}

/** Edit a chronicle entry's content in place (ROADMAP P1-4). The timestamp is left untouched so the
 *  entry keeps its position in the oldest-first log. Editing after close-out does NOT retroactively
 *  change already-extracted notes — they're independent records (see the EventFeed hint). */
export function updateEvent(ctx: DbContext, id: string, patch: UpdateEventInput): EventLogEntry {
  ctx.drizzle
    .update(schema.eventLog)
    .set({ content: patch.content })
    .where(eq(schema.eventLog.id, id))
    .run()
  const r = ctx.drizzle.select().from(schema.eventLog).where(eq(schema.eventLog.id, id)).get()
  if (!r) throw new Error(`Event ${id} not found`)
  return rowToEvent(r)
}

/** Delete a chronicle entry. Nothing references event_log, so this is an unconstrained single delete. */
export function deleteEvent(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.eventLog).where(eq(schema.eventLog.id, id)).run()
}

export function createEvent(ctx: DbContext, input: CreateEventInput): EventLogEntry {
  // Derive campaignId from the session so the event stays campaign-scoped.
  const session = ctx.drizzle
    .select({ campaignId: schema.session.campaignId })
    .from(schema.session)
    .where(eq(schema.session.id, input.sessionId))
    .get()
  if (!session) throw new Error(`Session ${input.sessionId} not found`)
  const row = {
    id: newId(),
    sessionId: input.sessionId,
    campaignId: session.campaignId,
    content: input.content,
    entityId: input.entityId ?? null,
    timestamp: now()
  }
  ctx.drizzle.insert(schema.eventLog).values(row).run()
  return rowToEvent(row)
}
