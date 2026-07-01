import { and, eq, isNull, lte, or } from 'drizzle-orm'
import type { EntityType } from '@shared/entity-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { EMBED_DIM, EMBED_MODEL } from './embedding-constants'

// A retrieved RAG candidate — a note or an entity's own description — with its similarity score.
export interface RetrievedChunk {
  kind: 'note' | 'entity'
  entityId: string
  entityName: string
  entityType: EntityType
  noteId: string | null
  sessionId: string | null
  sessionLabel: string | null
  content: string
  score: number
}

export interface VectorStore {
  upsertNote(noteId: string, vector: Float32Array, contentHash: string): void
  upsertEntity(entityId: string, vector: Float32Array, contentHash: string): void
  removeNote(noteId: string): void
  removeEntity(entityId: string): void
  noteHash(noteId: string): string | null
  entityHash(entityId: string): string | null
  search(query: Float32Array, campaignId: string, k: number, asOf?: number): RetrievedChunk[]
  /** Entities whose NAME the query fuzzily matches (typo-tolerant), as chunks — merged with `search`. */
  fuzzyEntityChunks(
    campaignId: string,
    query: string,
    exclude: Set<string>,
    limit: number,
    asOf?: number
  ): RetrievedChunk[]
}

function toBuf(v: Float32Array): Buffer {
  return Buffer.from(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
}
function toVec(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
}
function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

// ---- Typo-tolerant lexical matching over entity names (the signal dense embeddings lack) ----

// Query words that carry no naming intent — excluded so they can't spuriously match an entity name.
const STOPWORDS = new Set([
  'the', 'who', 'what', 'are', 'and', 'was', 'were', 'our', 'their', 'them', 'this', 'that', 'with',
  'for', 'how', 'why', 'when', 'where', 'does', 'did', 'has', 'have', 'about', 'they', 'you', 'your',
  'his', 'her', 'him', 'she', 'now', 'still', 'from', 'into', 'been', 'know'
])

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function trigrams(s: string): Set<string> {
  const g = new Set<string>()
  if (s.length < 3) {
    if (s) g.add(s)
    return g
  }
  for (let i = 0; i <= s.length - 3; i++) g.add(s.slice(i, i + 3))
  return g
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return (2 * inter) / (a.size + b.size)
}

/**
 * How strongly a query "names" an entity (0..1): the best fuzzy (trigram Dice) overlap between a
 * meaningful query word and a token of the entity's name, with exact/substring boosts. This is the
 * typo-tolerant lexical signal dense embeddings lack — "glastav" still scores ~0.5 against "Glasstaff".
 */
export function nameMatchScore(query: string, name: string): number {
  const words = (query.toLowerCase().match(/[a-z0-9']{3,}/g) ?? [])
    .map(norm)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  const tokens = name
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length >= 3)
  if (!words.length || !tokens.length) return 0
  let best = 0
  for (const w of words) {
    const wg = trigrams(w)
    for (const t of tokens) {
      if (w === t) return 1
      // Only treat them as the same (mis)spelled word when their lengths are comparable — otherwise a
      // short token that's a coincidental substring ("last" inside "glastav") scores spuriously high.
      if (Math.min(w.length, t.length) / Math.max(w.length, t.length) < 0.6) continue
      if (t.includes(w) || w.includes(t)) best = Math.max(best, 0.9)
      else best = Math.max(best, dice(wg, trigrams(t)))
    }
  }
  return best
}

export const FUZZY_THRESHOLD = 0.5
const FUZZY_NOTES_PER_ENTITY = 2

// Brute-force cosine vector store (ADR-012). Vectors are normalized at embed time, so cosine == dot.
// O(n·dim) per query — irrelevant at MVP scale; swappable for sqlite-vec behind this interface later.
export class BruteForceVectorStore implements VectorStore {
  constructor(private readonly ctx: DbContext) {}

  upsertNote(noteId: string, vector: Float32Array, contentHash: string): void {
    const vec = toBuf(vector)
    const updatedAt = Date.now()
    this.ctx.drizzle
      .insert(schema.noteEmbedding)
      .values({ noteId, model: EMBED_MODEL, dim: EMBED_DIM, vector: vec, contentHash, updatedAt })
      .onConflictDoUpdate({
        target: schema.noteEmbedding.noteId,
        set: { model: EMBED_MODEL, dim: EMBED_DIM, vector: vec, contentHash, updatedAt }
      })
      .run()
  }

  upsertEntity(entityId: string, vector: Float32Array, contentHash: string): void {
    const vec = toBuf(vector)
    const updatedAt = Date.now()
    this.ctx.drizzle
      .insert(schema.entityEmbedding)
      .values({ entityId, model: EMBED_MODEL, dim: EMBED_DIM, vector: vec, contentHash, updatedAt })
      .onConflictDoUpdate({
        target: schema.entityEmbedding.entityId,
        set: { model: EMBED_MODEL, dim: EMBED_DIM, vector: vec, contentHash, updatedAt }
      })
      .run()
  }

  removeNote(noteId: string): void {
    this.ctx.drizzle.delete(schema.noteEmbedding).where(eq(schema.noteEmbedding.noteId, noteId)).run()
  }

  removeEntity(entityId: string): void {
    this.ctx.drizzle
      .delete(schema.entityEmbedding)
      .where(eq(schema.entityEmbedding.entityId, entityId))
      .run()
  }

  noteHash(noteId: string): string | null {
    const r = this.ctx.drizzle
      .select({ h: schema.noteEmbedding.contentHash })
      .from(schema.noteEmbedding)
      .where(eq(schema.noteEmbedding.noteId, noteId))
      .get()
    return r?.h ?? null
  }

  entityHash(entityId: string): string | null {
    const r = this.ctx.drizzle
      .select({ h: schema.entityEmbedding.contentHash })
      .from(schema.entityEmbedding)
      .where(eq(schema.entityEmbedding.entityId, entityId))
      .get()
    return r?.h ?? null
  }

  search(query: Float32Array, campaignId: string, k: number, asOf?: number): RetrievedChunk[] {
    const chunks: RetrievedChunk[] = []

    // Notes are M2M with entities (note_entity). A note linked to N entities would otherwise produce N
    // identical chunks; emit ONE chunk per note, attributed to a representative entity — the first by
    // name (orderBy + first-seen wins). The single-entity RetrievedChunk shape stays unchanged so all
    // downstream (recall/suggest gather, mapSources, scene pinning) is untouched.
    const noteRows = this.ctx.drizzle
      .select({
        noteId: schema.noteEmbedding.noteId,
        vector: schema.noteEmbedding.vector,
        content: schema.note.content,
        entityId: schema.entity.id,
        sessionId: schema.note.sessionId,
        sessionNumber: schema.session.number,
        entityName: schema.entity.name,
        entityType: schema.entity.type
      })
      .from(schema.noteEmbedding)
      .innerJoin(schema.note, eq(schema.note.id, schema.noteEmbedding.noteId))
      .innerJoin(schema.noteEntity, eq(schema.noteEntity.noteId, schema.note.id))
      .innerJoin(schema.entity, eq(schema.entity.id, schema.noteEntity.entityId))
      .leftJoin(schema.session, eq(schema.session.id, schema.note.sessionId))
      .where(
        asOf === undefined
          ? eq(schema.entity.campaignId, campaignId)
          : and(
              eq(schema.entity.campaignId, campaignId),
              // No future leak: only notes from sessions <= N; undated (null-session) notes pass through.
              or(isNull(schema.note.sessionId), lte(schema.session.number, asOf))
            )
      )
      .orderBy(schema.entity.name)
      .all()

    const seenNote = new Set<string>()
    for (const n of noteRows) {
      if (seenNote.has(n.noteId)) continue // keep only the representative (first-by-name) entity's row
      seenNote.add(n.noteId)
      chunks.push({
        kind: 'note',
        entityId: n.entityId,
        entityName: n.entityName,
        entityType: n.entityType as EntityType,
        noteId: n.noteId,
        sessionId: n.sessionId,
        sessionLabel: n.sessionNumber != null ? `Session ${n.sessionNumber}` : null,
        content: n.content,
        score: dot(query, toVec(n.vector))
      })
    }

    const entityRows = this.ctx.drizzle
      .select({
        entityId: schema.entityEmbedding.entityId,
        vector: schema.entityEmbedding.vector,
        name: schema.entity.name,
        type: schema.entity.type,
        description: schema.entity.description
      })
      .from(schema.entityEmbedding)
      .innerJoin(schema.entity, eq(schema.entity.id, schema.entityEmbedding.entityId))
      .where(eq(schema.entity.campaignId, campaignId))
      .all()

    for (const e of entityRows) {
      chunks.push({
        kind: 'entity',
        entityId: e.entityId,
        entityName: e.name,
        entityType: e.type as EntityType,
        noteId: null,
        sessionId: null,
        sessionLabel: null,
        content: e.description ? `${e.name}: ${e.description}` : e.name,
        score: dot(query, toVec(e.vector))
      })
    }

    chunks.sort((a, b) => b.score - a.score)
    return chunks.slice(0, k)
  }

  fuzzyEntityChunks(
    campaignId: string,
    query: string,
    exclude: Set<string>,
    limit: number,
    asOf?: number
  ): RetrievedChunk[] {
    const entities = this.ctx.drizzle
      .select({
        id: schema.entity.id,
        name: schema.entity.name,
        type: schema.entity.type,
        description: schema.entity.description
      })
      .from(schema.entity)
      .where(eq(schema.entity.campaignId, campaignId))
      .all()

    const matched = entities
      .filter((e) => !exclude.has(e.id))
      .map((e) => ({ e, score: nameMatchScore(query, e.name) }))
      .filter((m) => m.score >= FUZZY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const out: RetrievedChunk[] = []
    for (const { e, score } of matched) {
      // The entity's own description (the canonical "who is X"), then a few of its notes.
      out.push({
        kind: 'entity',
        entityId: e.id,
        entityName: e.name,
        entityType: e.type as EntityType,
        noteId: null,
        sessionId: null,
        sessionLabel: null,
        content: e.description ? `${e.name}: ${e.description}` : e.name,
        score
      })
      const notes = this.ctx.drizzle
        .select({
          id: schema.note.id,
          content: schema.note.content,
          sessionId: schema.note.sessionId,
          sessionNumber: schema.session.number
        })
        .from(schema.noteEntity)
        .innerJoin(schema.note, eq(schema.note.id, schema.noteEntity.noteId))
        .leftJoin(schema.session, eq(schema.session.id, schema.note.sessionId))
        .where(
          asOf === undefined
            ? eq(schema.noteEntity.entityId, e.id)
            : and(
                eq(schema.noteEntity.entityId, e.id),
                or(isNull(schema.note.sessionId), lte(schema.session.number, asOf))
              )
        )
        .limit(FUZZY_NOTES_PER_ENTITY)
        .all()
      for (const n of notes) {
        out.push({
          kind: 'note',
          entityId: e.id,
          entityName: e.name,
          entityType: e.type as EntityType,
          noteId: n.id,
          sessionId: n.sessionId,
          sessionLabel: n.sessionNumber != null ? `Session ${n.sessionNumber}` : null,
          content: n.content,
          score
        })
      }
    }
    return out
  }
}
