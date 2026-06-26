import { eq } from 'drizzle-orm'
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
  search(query: Float32Array, campaignId: string, k: number): RetrievedChunk[]
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

  search(query: Float32Array, campaignId: string, k: number): RetrievedChunk[] {
    const chunks: RetrievedChunk[] = []

    const noteRows = this.ctx.drizzle
      .select({
        noteId: schema.noteEmbedding.noteId,
        vector: schema.noteEmbedding.vector,
        content: schema.note.content,
        entityId: schema.note.entityId,
        sessionId: schema.note.sessionId,
        sessionNumber: schema.session.number,
        entityName: schema.entity.name,
        entityType: schema.entity.type
      })
      .from(schema.noteEmbedding)
      .innerJoin(schema.note, eq(schema.note.id, schema.noteEmbedding.noteId))
      .innerJoin(schema.entity, eq(schema.entity.id, schema.note.entityId))
      .leftJoin(schema.session, eq(schema.session.id, schema.note.sessionId))
      .where(eq(schema.entity.campaignId, campaignId))
      .all()

    for (const n of noteRows) {
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
}
