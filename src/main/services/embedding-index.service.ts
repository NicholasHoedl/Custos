import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { VectorStore } from './vector-store.service'
import { embed, isModelReady } from './embedding.service'

// Keeps the vector store in sync with notes + entity descriptions. Embedding is CPU-bound, so it runs
// off the capture hot path: handlers enqueue (fire-and-forget) and a serial queue embeds one at a time.
// Deletions need no handling here — the embedding rows cascade via their foreign keys.

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function entityText(name: string, description: string | null): string {
  return description ? `${name}\n${description}` : name
}

let chain: Promise<void> = Promise.resolve()
function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error('[embedding-index]', err))
}

export function indexNote(ctx: DbContext, store: VectorStore, noteId: string): void {
  enqueue(async () => {
    if (!isModelReady()) return
    const note = ctx.drizzle
      .select({ content: schema.note.content })
      .from(schema.note)
      .where(eq(schema.note.id, noteId))
      .get()
    if (!note) return
    const h = hash(note.content)
    if (store.noteHash(noteId) === h) return
    store.upsertNote(noteId, await embed(note.content), h)
  })
}

export function indexEntity(ctx: DbContext, store: VectorStore, entityId: string): void {
  enqueue(async () => {
    if (!isModelReady()) return
    const entity = ctx.drizzle
      .select({ name: schema.entity.name, description: schema.entity.description })
      .from(schema.entity)
      .where(eq(schema.entity.id, entityId))
      .get()
    if (!entity) return
    const text = entityText(entity.name, entity.description)
    const h = hash(text)
    if (store.entityHash(entityId) === h) return
    store.upsertEntity(entityId, await embed(text), h)
  })
}

/**
 * Embed any notes/entities lacking an up-to-date embedding. Runs on startup, after a model download,
 * and on a manual re-index. Returns how many items were (re)embedded.
 */
export async function backfill(ctx: DbContext, store: VectorStore): Promise<number> {
  if (!isModelReady()) return 0
  let count = 0
  const notes = ctx.drizzle
    .select({ id: schema.note.id, content: schema.note.content })
    .from(schema.note)
    .all()
  for (const n of notes) {
    const h = hash(n.content)
    if (store.noteHash(n.id) !== h) {
      try {
        store.upsertNote(n.id, await embed(n.content), h)
        count++
      } catch (err) {
        console.error('[embedding-index] backfill note', n.id, err)
      }
    }
  }
  const entities = ctx.drizzle
    .select({ id: schema.entity.id, name: schema.entity.name, description: schema.entity.description })
    .from(schema.entity)
    .all()
  for (const e of entities) {
    const text = entityText(e.name, e.description)
    const h = hash(text)
    if (store.entityHash(e.id) !== h) {
      try {
        store.upsertEntity(e.id, await embed(text), h)
        count++
      } catch (err) {
        console.error('[embedding-index] backfill entity', e.id, err)
      }
    }
  }
  return count
}
