import { asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Note } from '@shared/entity-types'
import type { CreateNoteInput, UpdateNoteInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToNote, serializeArray } from './serialize'

const NO_ENTITIES = 'A note must be associated with at least one entity'

/** noteId -> its full set of associated entity ids, for the given notes (one round-trip). */
function entityIdsFor(ctx: DbContext, noteIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (noteIds.length === 0) return map
  const rows = ctx.drizzle
    .select({ noteId: schema.noteEntity.noteId, entityId: schema.noteEntity.entityId })
    .from(schema.noteEntity)
    .where(inArray(schema.noteEntity.noteId, noteIds))
    .all()
  for (const r of rows) {
    const arr = map.get(r.noteId)
    if (arr) arr.push(r.entityId)
    else map.set(r.noteId, [r.entityId])
  }
  return map
}

/** Notes associated with one entity (newest first), each carrying its full set of entity ids. */
export function listNotesForEntity(ctx: DbContext, entityId: string): Note[] {
  const rows = ctx.drizzle
    .select({ note: schema.note })
    .from(schema.noteEntity)
    .innerJoin(schema.note, eq(schema.noteEntity.noteId, schema.note.id))
    .where(eq(schema.noteEntity.entityId, entityId))
    .orderBy(desc(schema.note.createdAt))
    .all()
    .map((r) => r.note)
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

/** Every note linked to any entity in the campaign (deduped, newest first) — the Notes manager feed. */
export function listAllNotes(ctx: DbContext, campaignId: string): Note[] {
  const rows = ctx.drizzle
    .selectDistinct({ note: schema.note })
    .from(schema.note)
    .innerJoin(schema.noteEntity, eq(schema.noteEntity.noteId, schema.note.id))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.noteEntity.entityId))
    .where(eq(schema.entity.campaignId, campaignId))
    .orderBy(desc(schema.note.createdAt))
    .all()
    .map((r) => r.note)
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

/** Notes captured during one session (chronological order), each carrying its full set of entity ids. */
export function listNotesForSession(ctx: DbContext, sessionId: string): Note[] {
  const rows = ctx.drizzle
    .selectDistinct({ note: schema.note })
    .from(schema.note)
    .innerJoin(schema.noteEntity, eq(schema.noteEntity.noteId, schema.note.id))
    .where(eq(schema.note.sessionId, sessionId))
    .orderBy(asc(schema.note.createdAt))
    .all()
    .map((r) => r.note)
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

export function createNote(ctx: DbContext, input: CreateNoteInput): Note {
  const entityIds = [...new Set(input.entityIds)]
  if (entityIds.length === 0) throw new Error(NO_ENTITIES)
  const createdAt = now()
  const row = {
    id: newId(),
    sessionId: input.sessionId ?? null,
    content: input.content,
    tags: serializeArray(input.tags),
    createdAt
  }
  ctx.drizzle.transaction((tx) => {
    tx.insert(schema.note).values(row).run()
    tx.insert(schema.noteEntity)
      .values(entityIds.map((entityId) => ({ noteId: row.id, entityId, createdAt })))
      .run()
  })
  return rowToNote(row, entityIds)
}

export function updateNote(ctx: DbContext, id: string, patch: UpdateNoteInput): Note {
  ctx.drizzle.transaction((tx) => {
    const set: Partial<typeof schema.note.$inferInsert> = {}
    if (patch.content !== undefined) set.content = patch.content
    if (patch.tags !== undefined) set.tags = serializeArray(patch.tags)
    if (Object.keys(set).length > 0) {
      tx.update(schema.note).set(set).where(eq(schema.note.id, id)).run()
    }
    if (patch.entityIds !== undefined) {
      const entityIds = [...new Set(patch.entityIds)]
      if (entityIds.length === 0) throw new Error(NO_ENTITIES) // rolls back the transaction
      const createdAt = now()
      tx.delete(schema.noteEntity).where(eq(schema.noteEntity.noteId, id)).run()
      tx.insert(schema.noteEntity)
        .values(entityIds.map((entityId) => ({ noteId: id, entityId, createdAt })))
        .run()
    }
  })
  const r = ctx.drizzle.select().from(schema.note).where(eq(schema.note.id, id)).get()
  if (!r) throw new Error(`Note ${id} not found`)
  return rowToNote(r, entityIdsFor(ctx, [id]).get(id) ?? [])
}

export function deleteNote(ctx: DbContext, id: string): void {
  // FK cascade (foreign_keys = ON at runtime) clears the note's note_entity links + its embedding.
  ctx.drizzle.delete(schema.note).where(eq(schema.note.id, id)).run()
}

/**
 * Delete notes left with zero entity associations. A note must always have ≥1 entity, so call this
 * after a delete that cascades note_entity links — an entity delete (orphans notes tagged only to it)
 * or a campaign delete (note rows have no campaign FK, so they don't cascade and must be swept here).
 * Each removed note's embedding cascades away via FK; shared notes (still linked) are untouched.
 */
export function deleteOrphanNotes(ctx: DbContext): void {
  const orphans = ctx.drizzle
    .select({ id: schema.note.id })
    .from(schema.note)
    .leftJoin(schema.noteEntity, eq(schema.noteEntity.noteId, schema.note.id))
    .where(isNull(schema.noteEntity.noteId))
    .all()
    .map((r) => r.id)
  if (orphans.length === 0) return
  ctx.drizzle.delete(schema.note).where(inArray(schema.note.id, orphans)).run()
}
