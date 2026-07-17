import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import log from 'electron-log/main'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { VectorStore } from './vector-store.service'
import { embed, isModelReady } from './embedding.service'
import { parseArray, parseObject } from './serialize'

// Keeps the vector store in sync with notes + entities. An entity embeds its name, description,
// traits/goals/flaws, and the combat/social-salient type attributes (ADR-026) so that structured
// character/creature/faction data — not just the free-text description — is retrievable. Embedding is
// CPU-bound, so it runs off the capture hot path: handlers enqueue (fire-and-forget) and a serial queue
// embeds one at a time. Deletions need no handling here — the embedding rows cascade via their FKs.

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

interface IndexEntityRow {
  type: string
  name: string
  description: string | null
  traits: string | null
  goals: string | null
  flaws: string | null
  attributes: string | null
}

// The type-specific attribute keys worth embedding — the ones that carry combat/social signal. Human-only
// fields (player/rarity/value/date/reach/kind) are skipped to keep the vector tight and on-topic.
const EMBED_ATTR_KEYS: Record<string, readonly string[]> = {
  creature: ['tactics', 'weakness', 'abilities', 'habitat'],
  faction: ['alignment'],
  npc: ['role', 'race'],
  quest: ['objective'],
  location: ['atmosphere', 'features'],
  item: ['properties'],
  event: ['outcome', 'significance']
}

/** The text embedded for an entity: name + description + promoted lists + salient type attributes. */
function entityText(e: IndexEntityRow): string {
  const parts: string[] = [e.name]
  if (e.description) parts.push(e.description)
  const list = (label: string, raw: string | null): void => {
    const vals = parseArray(raw)
    if (vals.length) parts.push(`${label}: ${vals.join(', ')}`)
  }
  list('Traits', e.traits)
  list('Goals', e.goals)
  list('Flaws', e.flaws)
  const attrs = parseObject(e.attributes)
  for (const key of EMBED_ATTR_KEYS[e.type] ?? []) {
    const v = attrs[key]
    const text = Array.isArray(v)
      ? v.filter(Boolean).join(', ')
      : typeof v === 'string'
        ? v.trim()
        : ''
    if (text) parts.push(`${key[0].toUpperCase()}${key.slice(1)}: ${text}`)
  }
  return parts.join('\n')
}

const elog = log.scope('embedding-index')

let chain: Promise<void> = Promise.resolve()
function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => elog.error(err))
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
      .select({
        type: schema.entity.type,
        name: schema.entity.name,
        description: schema.entity.description,
        traits: schema.entity.traits,
        goals: schema.entity.goals,
        flaws: schema.entity.flaws,
        attributes: schema.entity.attributes
      })
      .from(schema.entity)
      .where(eq(schema.entity.id, entityId))
      .get()
    if (!entity) return
    const text = entityText(entity)
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
        elog.error('backfill note', n.id, err)
      }
    }
  }
  const entities = ctx.drizzle
    .select({
      id: schema.entity.id,
      type: schema.entity.type,
      name: schema.entity.name,
      description: schema.entity.description,
      traits: schema.entity.traits,
      goals: schema.entity.goals,
      flaws: schema.entity.flaws,
      attributes: schema.entity.attributes
    })
    .from(schema.entity)
    .all()
  for (const e of entities) {
    const text = entityText(e)
    const h = hash(text)
    if (store.entityHash(e.id) !== h) {
      try {
        store.upsertEntity(e.id, await embed(text), h)
        count++
      } catch (err) {
        elog.error('backfill entity', e.id, err)
      }
    }
  }
  return count
}
