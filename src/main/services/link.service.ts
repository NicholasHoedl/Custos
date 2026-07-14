import { and, eq, isNull, or } from 'drizzle-orm'
import type { Entity, EntityLink, NoteConfidence } from '@shared/entity-types'
import type { RelationKey } from '@shared/relations'
import type { CreateLinkInput, HierarchyKind, UpdateLinkInput } from '@shared/ipc-types'
import type {
  CampaignGraph,
  ContextNeighbor,
  EntityContext,
  GraphEdge,
  GraphNode,
  HierarchyDescendant,
  HierarchyView,
  RelationshipView
} from '@shared/graph-types'
import { RELATIONS, isRelationAllowed, isRelationKey } from '@shared/relations'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { isIntervalLiveAt, resolveEntityState } from './chronology.service'
import { getEntity, listEntities } from './entity.service'
import { listNotesForEntity } from './note.service'
import { resolveCaptureSessionNumber } from './session.service'
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
  // Idempotent: an equivalent OPEN edge returns the existing one instead of duplicating (a severed
  // edge can be re-formed as a fresh interval). "Equivalent" includes the inverse authoring direction
  // — see findOpenLink.
  const existing = findOpenLink(ctx, input.fromEntityId, input.toEntityId, input.relation)
  if (existing) return existing

  const row = {
    id: newId(),
    fromEntityId: input.fromEntityId,
    toEntityId: input.toEntityId,
    relation: input.relation,
    description: input.description?.trim() || null,
    // Tie enrichment (ADR-033): per-direction feeling + epistemic weight.
    fromDisposition: input.fromDisposition?.trim() || null,
    toDisposition: input.toDisposition?.trim() || null,
    confidence: input.confidence ?? 'confirmed',
    campaignId: input.campaignId,
    createdAt: now(),
    // Chronology (ADR-017): a new relationship opens an interval at the active session. An explicit
    // null sessionId (undated import, ADR-030) = a PRE-TRACKING interval, open since before session 1.
    startSessionNumber:
      input.sessionId === null
        ? null
        : resolveCaptureSessionNumber(ctx, input.sessionId, input.campaignId),
    endSessionNumber: null
  }
  ctx.drizzle.insert(schema.entityLink).values(row).run()
  return rowToLink(row)
}

/**
 * The OPEN (live) edge for (from, to, relation), if any — matching the exact tuple OR the same
 * relationship authored from the other side ((to, from, inverseKey); for symmetric relations
 * inverseKey === relation, so a reciprocal ally_of collapses; for directed pairs `contains` collapses
 * against `located_in`). Backs createLink's idempotency and the backfill's sever-by-endpoints.
 */
export function findOpenLink(
  ctx: DbContext,
  fromEntityId: string,
  toEntityId: string,
  relation: RelationKey
): EntityLink | null {
  const inverseKey = RELATIONS[relation].inverseKey
  const row = ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(
      and(
        isNull(schema.entityLink.endSessionNumber),
        or(
          and(
            eq(schema.entityLink.fromEntityId, fromEntityId),
            eq(schema.entityLink.toEntityId, toEntityId),
            eq(schema.entityLink.relation, relation)
          ),
          and(
            eq(schema.entityLink.fromEntityId, toEntityId),
            eq(schema.entityLink.toEntityId, fromEntityId),
            eq(schema.entityLink.relation, inverseKey)
          )
        )
      )
    )
    .get()
  return row ? rowToLink(row) : null
}

/**
 * Chronology (ADR-017): "unlink" without erasing history — close the OPEN interval by stamping
 * end_session_number with the active session. A no-op if the link is missing or already severed. When
 * no session exists to anchor a "when", there is no timeline to preserve, so fall back to hard removal.
 * The explicit `deleteLink` remains an escape hatch for genuine mis-entries.
 */
export function severLink(ctx: DbContext, id: string, sessionId?: string): void {
  const link = ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(eq(schema.entityLink.id, id))
    .get()
  if (!link || link.endSessionNumber !== null) return
  const n = resolveCaptureSessionNumber(ctx, sessionId, link.campaignId)
  if (n === null) {
    ctx.drizzle.delete(schema.entityLink).where(eq(schema.entityLink.id, id)).run()
    return
  }
  ctx.drizzle
    .update(schema.entityLink)
    .set({ endSessionNumber: n })
    .where(eq(schema.entityLink.id, id))
    .run()
}

/** Edit a relationship's context description (ADR-032). Endpoints + relation are immutable here — those
 *  are a sever + re-create. Throws if the link is gone. */
export function updateLink(ctx: DbContext, id: string, patch: UpdateLinkInput): EntityLink {
  const row = ctx.drizzle.select().from(schema.entityLink).where(eq(schema.entityLink.id, id)).get()
  if (!row) throw new Error('Relationship not found')
  // Only the provided fields change; endpoints + relation stay immutable (ADR-033).
  const set: Partial<typeof schema.entityLink.$inferInsert> = {}
  if (patch.description !== undefined) set.description = patch.description?.trim() || null
  if (patch.fromDisposition !== undefined)
    set.fromDisposition = patch.fromDisposition?.trim() || null
  if (patch.toDisposition !== undefined) set.toDisposition = patch.toDisposition?.trim() || null
  if (patch.confidence !== undefined) set.confidence = patch.confidence
  if (Object.keys(set).length > 0) {
    ctx.drizzle.update(schema.entityLink).set(set).where(eq(schema.entityLink.id, id)).run()
  }
  return rowToLink({ ...row, ...set })
}

export function deleteLink(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.entityLink).where(eq(schema.entityLink.id, id)).run()
}

/** Every relationship edge in a campaign (all intervals — live and severed). For export/backup. */
export function listLinksForCampaign(ctx: DbContext, campaignId: string): EntityLink[] {
  return ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(eq(schema.entityLink.campaignId, campaignId))
    .all()
    .map(rowToLink)
}

/**
 * The campaign relationship graph (P2-3, enriched in the Web feature pass): every entity as a node and its
 * ties as labelled edges, for the "Web" view. Edges carry the tie ENRICHMENT (disposition/confidence/
 * description) + DIRECTION + chronology INTERVAL so the renderer can style by feeling/certainty, draw
 * arrowheads on directed relations, and reconstruct the web at any session. Endpoints not in the node set
 * are dropped defensively (deleteEntity cascades, so this shouldn't occur — but a dangling ref must never
 * crash the layout).
 *
 * `asOf` (session number) drives the time slider: with no `asOf` it's the live "now" picture (open-interval
 * edges only, live lifecycle). With an `asOf` it's the web AS OF that session — edges live at N (via
 * `isIntervalLiveAt`) PLUS ties severed exactly at N (kept as fading `severed` ghosts) and formed exactly at
 * N (`justFormed`, for the "what changed" pulse); older-severed and future ties are dropped. Node lifecycle
 * is reconstructed to N via `resolveEntityState`, and `faded` de-emphasizes the fallen (now + as-of) and the
 * not-yet-present (as-of, whose reconstruction is `unknown`). The node SET is always the full cast so the
 * layout stays stable as the slider moves — only edges and dimming change.
 */
export function buildCampaignGraph(
  ctx: DbContext,
  campaignId: string,
  asOf?: number
): CampaignGraph {
  const entities = listEntities(ctx, campaignId)
  const nodes: GraphNode[] = entities.map((e) => {
    const lifecycle = asOf === undefined ? e.lifecycle : resolveEntityState(ctx, e, asOf).lifecycle
    const faded =
      lifecycle === 'ended' ||
      lifecycle === 'presumed_ended' ||
      (asOf !== undefined && lifecycle === 'unknown') // reconstructed 'unknown' at N = not present yet
    return { id: e.id, name: e.name, type: e.type, image: e.image, lifecycle, faded }
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges: GraphEdge[] = []
  for (const link of listLinksForCampaign(ctx, campaignId)) {
    if (!ids.has(link.fromEntityId) || !ids.has(link.toEntityId)) continue // defensive: drop dangling
    let severed = false
    let justFormed = false
    if (asOf === undefined) {
      if (link.endSessionNumber !== null) continue // now: live (open-interval) ties only
    } else {
      const live = isIntervalLiveAt(link.startSessionNumber, link.endSessionNumber, asOf)
      severed = link.endSessionNumber === asOf // just ended AT N (isIntervalLiveAt treats end as exclusive)
      if (!live && !severed) continue // older-severed or not-yet-formed at N — omit
      justFormed = link.startSessionNumber === asOf
    }
    edges.push({
      id: link.id,
      from: link.fromEntityId,
      to: link.toEntityId,
      relation: link.relation,
      label: isRelationKey(link.relation) ? RELATIONS[link.relation].forward : link.relation,
      description: link.description,
      fromDisposition: link.fromDisposition,
      toDisposition: link.toDisposition,
      confidence: link.confidence,
      directed: isRelationKey(link.relation) ? !RELATIONS[link.relation].symmetric : false,
      startSessionNumber: link.startSessionNumber,
      endSessionNumber: link.endSessionNumber,
      severed,
      justFormed
    })
  }
  return { nodes, edges }
}

/**
 * All relationships touching an entity, correctly oriented. Chronology (ADR-017): by default returns
 * only LIVE (open-interval) relationships; pass `asOf` to return those live at that session number.
 * Severed relationships surface only in an as-of view or the history disclosure.
 */
export function listForEntity(ctx: DbContext, entityId: string, asOf?: number): RelationshipView[] {
  const links = ctx.drizzle
    .select()
    .from(schema.entityLink)
    .where(
      or(eq(schema.entityLink.fromEntityId, entityId), eq(schema.entityLink.toEntityId, entityId))
    )
    .all()
  const views: RelationshipView[] = []
  for (const l of links) {
    const live =
      asOf === undefined
        ? l.endSessionNumber === null
        : isIntervalLiveAt(l.startSessionNumber, l.endSessionNumber, asOf)
    if (!live) continue
    const isOut = l.fromEntityId === entityId
    const other = getEntity(ctx, isOut ? l.toEntityId : l.fromEntityId)
    if (!other) continue
    const def = isRelationKey(l.relation) ? RELATIONS[l.relation] : null
    const label = def ? (isOut ? def.forward : def.inverse) : l.relation
    views.push({ link: rowToLink(l), direction: isOut ? 'out' : 'in', label, other })
  }
  return views
}

/** Containment hierarchy (breadcrumb of ancestors + the contained subtree), via recursive CTEs.
 *  Structural only — deliberately ignores disposition/confidence/description (ADR-033); containment is a
 *  fact of place/membership, not a feeling. */
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

  const ancestors = ancRows.map((r) => getEntity(ctx, r.id)).filter((e): e is Entity => e !== null)
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
 * carrying the edge relation/description. De-duplicated and node-capped. Chronology (ADR-017/034): pass
 * `asOf` to clamp the seed's notes to what was known by session N (Converse's as-of reconstruction);
 * omit it for the live view. The optional trailing param keeps existing callers unchanged.
 */
export function getEntityContext(
  ctx: DbContext,
  entityId: string,
  depth = 1,
  asOf?: number
): EntityContext {
  const root = getEntity(ctx, entityId)
  if (!root) throw new Error(`Entity ${entityId} not found`)
  const notes = listNotesForEntity(ctx, entityId, asOf)
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
          // ADR-033: orient the tie's disposition for the frontier entity (near = its feeling about `other`).
          viaNearDisposition: isOut ? l.fromDisposition : l.toDisposition,
          viaFarDisposition: isOut ? l.toDisposition : l.fromDisposition,
          viaConfidence: l.confidence as NoteConfidence,
          direction: isOut ? 'out' : 'in'
        })
        next.push(otherId)
      }
    }
    frontier = next
  }

  return { root, notes, neighbors }
}
