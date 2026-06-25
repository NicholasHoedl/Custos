import { asc, eq } from 'drizzle-orm'
import type { EventLogEntry } from '@shared/entity-types'
import type { CreateEventInput } from '@shared/ipc-types'
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
