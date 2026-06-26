import { desc, eq } from 'drizzle-orm'
import type { Note } from '@shared/entity-types'
import type { CreateNoteInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToNote, serializeArray } from './serialize'

export function listNotes(ctx: DbContext, entityId: string): Note[] {
  return ctx.drizzle
    .select()
    .from(schema.note)
    .where(eq(schema.note.entityId, entityId))
    .orderBy(desc(schema.note.createdAt))
    .all()
    .map(rowToNote)
}

export function createNote(ctx: DbContext, input: CreateNoteInput): Note {
  const row = {
    id: newId(),
    entityId: input.entityId,
    sessionId: input.sessionId ?? null,
    content: input.content,
    tags: serializeArray(input.tags),
    createdAt: now()
  }
  ctx.drizzle.insert(schema.note).values(row).run()
  return rowToNote(row)
}

export function updateNote(ctx: DbContext, id: string, patch: { content?: string }): Note {
  if (patch.content !== undefined) {
    ctx.drizzle
      .update(schema.note)
      .set({ content: patch.content })
      .where(eq(schema.note.id, id))
      .run()
  }
  const r = ctx.drizzle.select().from(schema.note).where(eq(schema.note.id, id)).get()
  if (!r) throw new Error(`Note ${id} not found`)
  return rowToNote(r)
}

export function deleteNote(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.note).where(eq(schema.note.id, id)).run()
}
