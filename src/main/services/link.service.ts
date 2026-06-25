import { and, eq, or } from 'drizzle-orm'
import type { Entity, EntityLink } from '@shared/entity-types'
import type { CreateLinkInput, HierarchyKind } from '@shared/ipc-types'
import type {
  ContextNeighbor,
  EntityContext,
  HierarchyDescendant,
  HierarchyView,
  RelationshipView
} from '@shared/graph-types'
import { RELATIONS, isRelationAllowed, isRelationKey } from '@shared/relations'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { getEntity } from './entity.service'
import { listNotes } from './note.service'
import { newId, now, rowToLink } from './serialize'

const HIERARCHY_PAIR: Record<HierarchyKind, { fwd: string; inv: string }> = {
  location: { fwd: 'located_in', inv: 'contains' },
  faction: { fwd: 'member_of', inv: 'has_member' }
}

const MAX_DEPTH = 32
const MAX_CONTEXT_NODES = 60

export function createLink(ctx: DbContext, input: CreateLinkInput): EntityLink {
  const from = getEntity(ctx, input.fromEntityId)
  const to = getEntity(ctx, input.toEntityId)
  if (!from || !to) throw new Error('Both entities must exist to link them')
  if (from.id === to.id) throw new Error('Cannot link an entity to itself')
  if (!isRelationAllowed(input.relation, from.type, to.type)) {
    throw new Error(`Relation "${input.relation}" is not allowed from ${from.type} to ${to.type}`)
  }
  // Idempotent: an equivalent edge returns the existing one instead of duplicating. "Equivalent" is
  // the exact (from, to, relation) tuple OR the same relationship authored from the other side —
  // (to, from, inverseKey). For symmetric relations inverseKey === relation, so a reciprocal
  // ally_of/knows collapses; for directed pairs it collapses e.g. `contains` against `located_in`
  // (the reverse view is already derived at read time, so a second physical edge is pure duplication).
  const inverseKey = RELATIONS[input.relation].inverseKey
  const existing = ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(
      or(
        and(
          eq(schema.entityLink.fromEntityId, input.fromEntityId),
          eq(schema.entityLink.toEntityId, input.toEntityId),
          eq(schema.entityLink.relation, input.relation)
        ),
        and(
          eq(schema.entityLink.fromEntityId, input.toEntityId),
          eq(schema.entityLink.toEntityId, input.fromEntityId),
          eq(schema.entityLink.relation, inverseKey)
        )
      )
    )
    .get()
  if (existing) return rowToLink(existing)

  const row = {
    id: newId(),
    fromEntityId: input.fromEntityId,
    toEntityId: input.toEntityId,
    relation: input.relation,
    description: input.description ?? null,
    campaignId: input.campaignId,
    createdAt: now()
  }
  ctx.drizzle.insert(schema.entityLink).values(row).run()
  return rowToLink(row)
}

export function deleteLink(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.entityLink).where(eq(schema.entityLink.id, id)).run()
}

/** All relationships touching an entity, in both directions, with the correctly-oriented label. */
export function listForEntity(ctx: DbContext, entityId: string): RelationshipView[] {
  const links = ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(or(eq(schema.entityLink.fromEntityId, entityId), eq(schema.entityLink.toEntityId, entityId)))
    .all()
  const views: RelationshipView[] = []
  for (const l of links) {
    const isOut = l.fromEntityId === entityId
    const other = getEntity(ctx, isOut ? l.toEntityId : l.fromEntityId)
    if (!other) continue
    const def = isRelationKey(l.relation) ? RELATIONS[l.relation] : null
    const label = def ? (isOut ? def.forward : def.inverse) : l.relation
    views.push({ link: rowToLink(l), direction: isOut ? 'out' : 'in', label, other })
  }
  return views
}

/** Containment hierarchy (breadcrumb of ancestors + the contained subtree), via recursive CTEs. */
export function getHierarchy(ctx: DbContext, entityId: string, kind: HierarchyKind): HierarchyView {
  const { fwd, inv } = HIERARCHY_PAIR[kind]

  const ancRows = ctx.raw
    .prepare(
      `WITH RECURSIVE anc(id, depth) AS (
         SELECT @start, 0
         UNION
         SELECT p.parent, anc.depth + 1 FROM anc
         JOIN (
           SELECT from_entity_id AS child, to_entity_id AS parent FROM entity_link WHERE relation = @fwd
           UNION
           SELECT to_entity_id AS child, from_entity_id AS parent FROM entity_link WHERE relation = @inv
         ) p ON p.child = anc.id
         WHERE anc.depth < @maxDepth
       )
       SELECT id, depth FROM anc WHERE id <> @start ORDER BY depth DESC`
    )
    .all({ start: entityId, fwd, inv, maxDepth: MAX_DEPTH }) as Array<{ id: string; depth: number }>

  const descRows = ctx.raw
    .prepare(
      `WITH RECURSIVE des(id, depth) AS (
         SELECT @start, 0
         UNION
         SELECT c.child, des.depth + 1 FROM des
         JOIN (
           SELECT to_entity_id AS parent, from_entity_id AS child FROM entity_link WHERE relation = @fwd
           UNION
           SELECT from_entity_id AS parent, to_entity_id AS child FROM entity_link WHERE relation = @inv
         ) c ON c.parent = des.id
         WHERE des.depth < @maxDepth
       )
       SELECT id, depth FROM des WHERE id <> @start ORDER BY depth ASC`
    )
    .all({ start: entityId, fwd, inv, maxDepth: MAX_DEPTH }) as Array<{ id: string; depth: number }>

  const ancestors = ancRows
    .map((r) => getEntity(ctx, r.id))
    .filter((e): e is Entity => e !== null)
  const descendants = descRows
    .map((r): HierarchyDescendant | null => {
      const e = getEntity(ctx, r.id)
      return e ? { entity: e, depth: r.depth } : null
    })
    .filter((d): d is HierarchyDescendant => d !== null)

  return { ancestors, descendants }
}

/**
 * The Phase-2 RAG seam: the seed entity + its notes + its 1..depth-hop neighborhood, each neighbor
 * carrying the edge relation/description. De-duplicated and node-capped. Keep this signature stable.
 */
export function getEntityContext(ctx: DbContext, entityId: string, depth = 1): EntityContext {
  const root = getEntity(ctx, entityId)
  if (!root) throw new Error(`Entity ${entityId} not found`)
  const notes = listNotes(ctx, entityId)
  const visited = new Set<string>([entityId])
  const neighbors: ContextNeighbor[] = []
  let frontier: string[] = [entityId]

  for (let hop = 1; hop <= depth && neighbors.length < MAX_CONTEXT_NODES; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      if (neighbors.length >= MAX_CONTEXT_NODES) break
      const links = ctx.drizzle
        .select()
        .from(schema.entityLink)
        .where(or(eq(schema.entityLink.fromEntityId, id), eq(schema.entityLink.toEntityId, id)))
        .all()
      for (const l of links) {
        if (neighbors.length >= MAX_CONTEXT_NODES) break
        const isOut = l.fromEntityId === id
        const otherId = isOut ? l.toEntityId : l.fromEntityId
        if (visited.has(otherId)) continue
        const other = getEntity(ctx, otherId)
        if (!other) continue
        visited.add(otherId)
        const def = isRelationKey(l.relation) ? RELATIONS[l.relation] : null
        neighbors.push({
          entity: other,
          hop,
          viaRelation: l.relation,
          viaLabel: def ? (isOut ? def.forward : def.inverse) : l.relation,
          viaDescription: l.description,
          direction: isOut ? 'out' : 'in'
        })
        next.push(otherId)
      }
    }
    frontier = next
  }

  return { root, notes, neighbors }
}
