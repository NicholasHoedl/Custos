import { and, eq, like, or } from 'drizzle-orm'
import type { EntityType } from '@shared/entity-types'
import type { EntitySearchResult } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'

// Phase 1 uses LIKE (plenty fast at this scale). It lives behind this seam so an FTS5 backend can
// drop in later without touching callers (ADR-011 / plan: "SearchService seam, FTS5 target").

function snippet(text: string | null, query: string, max = 140): string {
  if (!text) return ''
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return text.length > max ? text.slice(0, max) + '…' : text
  const start = Math.max(0, i - 40)
  const slice = text.slice(start, start + max)
  return (start > 0 ? '…' : '') + slice + (start + max < text.length ? '…' : '')
}

export function searchText(ctx: DbContext, query: string, campaignId: string): EntitySearchResult[] {
  const q = query.trim()
  if (!q) return []
  const pattern = `%${q}%`
  const results = new Map<string, EntitySearchResult>()

  // Entity name / description hits.
  const entities = ctx.drizzle
    .select()
    .from(schema.entity)
    .where(
      and(
        eq(schema.entity.campaignId, campaignId),
        or(like(schema.entity.name, pattern), like(schema.entity.description, pattern))
      )
    )
    .all()
  for (const e of entities) {
    results.set(e.id, {
      entityId: e.id,
      type: e.type as EntityType,
      name: e.name,
      snippet: snippet(e.description ?? e.name, q)
    })
  }

  // Note-content hits surface every in-campaign entity the note is associated with (M2M via note_entity).
  const noteHits = ctx.drizzle
    .select({ entity: schema.entity, note: schema.note })
    .from(schema.note)
    .innerJoin(schema.noteEntity, eq(schema.noteEntity.noteId, schema.note.id))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.noteEntity.entityId))
    .where(and(eq(schema.entity.campaignId, campaignId), like(schema.note.content, pattern)))
    .all()
  for (const { entity: e, note: n } of noteHits) {
    if (!results.has(e.id)) {
      results.set(e.id, {
        entityId: e.id,
        type: e.type as EntityType,
        name: e.name,
        snippet: snippet(n.content, q)
      })
    }
  }

  return [...results.values()].slice(0, 25)
}
