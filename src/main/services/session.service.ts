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
