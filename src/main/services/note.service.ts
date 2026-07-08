import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { Note } from '@shared/entity-types'
import type { CreateNoteInput, UpdateNoteInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToNote, serializeArray } from './serialize'

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

/**
 * Notes associated with one entity (newest first), each carrying its full set of entity ids. Chronology
 * (ADR-017/034): pass `asOf` to clamp to notes the party could have taken by session N — a note is kept
 * when its session number ≤ N OR it has no session (null = pre-tracking baseline, always included, like
 * `stateAsOf`/`isIntervalLiveAt`). The session leftJoin is harmless when `asOf` is unset (no filter).
 */
export function listNotesForEntity(ctx: DbContext, entityId: string, asOf?: number): Note[] {
  const rows = ctx.drizzle
    .select({ note: schema.note })
    .from(schema.noteEntity)
    .innerJoin(schema.note, eq(schema.noteEntity.noteId, schema.note.id))
    .leftJoin(schema.session, eq(schema.note.sessionId, schema.session.id))
    .where(
      asOf === undefined
        ? eq(schema.noteEntity.entityId, entityId)
        : and(
            eq(schema.noteEntity.entityId, entityId),
            or(isNull(schema.note.sessionId), lte(schema.session.number, asOf))
          )
    )
    .orderBy(desc(schema.note.createdAt))
    .all()
    .map((r) => r.note)
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

/** Every note in the campaign (newest first) — the Notes manager feed. Notes are first-class campaign
 *  children (note.campaignId, ADR-021), so this reads the note table directly; entity-less lore is
 *  included, and each note carries its (possibly empty) set of entity ids. */
export function listAllNotes(ctx: DbContext, campaignId: string): Note[] {
  const rows = ctx.drizzle
    .select()
    .from(schema.note)
    .where(eq(schema.note.campaignId, campaignId))
    .orderBy(desc(schema.note.createdAt))
    .all()
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

/** Notes captured during one session (chronological order), each carrying its full set of entity ids. */
export function listNotesForSession(ctx: DbContext, sessionId: string): Note[] {
  const rows = ctx.drizzle
    .select()
    .from(schema.note)
    .where(eq(schema.note.sessionId, sessionId))
    .orderBy(asc(schema.note.createdAt))
    .all()
  const byNote = entityIdsFor(
    ctx,
    rows.map((n) => n.id)
  )
  return rows.map((n) => rowToNote(n, byNote.get(n.id) ?? []))
}

export function createNote(ctx: DbContext, input: CreateNoteInput): Note {
  const entityIds = [...new Set(input.entityIds)]
  const createdAt = now()
  const row = {
    id: newId(),
    campaignId: input.campaignId,
    sessionId: input.sessionId ?? null,
    content: input.content,
    tags: serializeArray(input.tags),
    confidence: input.confidence ?? 'confirmed',
    createdAt
  }
  ctx.drizzle.transaction((tx) => {
    tx.insert(schema.note).values(row).run()
    // A note MAY stand alone as campaign lore (ADR-021); only write join rows when it tags entities.
    if (entityIds.length > 0) {
      tx.insert(schema.noteEntity)
        .values(entityIds.map((entityId) => ({ noteId: row.id, entityId, createdAt })))
        .run()
    }
  })
  return rowToNote(row, entityIds)
}

export function updateNote(ctx: DbContext, id: string, patch: UpdateNoteInput): Note {
  ctx.drizzle.transaction((tx) => {
    const set: Partial<typeof schema.note.$inferInsert> = {}
    if (patch.content !== undefined) set.content = patch.content
    if (patch.tags !== undefined) set.tags = serializeArray(patch.tags)
    if (patch.confidence !== undefined) set.confidence = patch.confidence
    if (Object.keys(set).length > 0) {
      tx.update(schema.note).set(set).where(eq(schema.note.id, id)).run()
    }
    if (patch.entityIds !== undefined) {
      const entityIds = [...new Set(patch.entityIds)]
      const createdAt = now()
      // Replace the note's entity links; clearing them all is allowed — the note survives as lore.
      tx.delete(schema.noteEntity).where(eq(schema.noteEntity.noteId, id)).run()
      if (entityIds.length > 0) {
        tx.insert(schema.noteEntity)
          .values(entityIds.map((entityId) => ({ noteId: id, entityId, createdAt })))
          .run()
      }
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
