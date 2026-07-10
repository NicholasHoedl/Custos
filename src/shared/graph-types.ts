import type { Entity, EntityLink, EntityType, Lifecycle, Note, NoteConfidence } from './entity-types'

export type LinkDirection = 'out' | 'in'

// The campaign relationship graph (P2-3): a flat node/edge slice of the campaign's LIVE ties, consumed by
// the "Web" view. Deliberately minimal — just what the d3-force layout + SVG render need. Severed
// (closed-interval) edges are excluded upstream; this is the "as it stands now" picture.
export interface GraphNode {
  id: string
  name: string
  type: EntityType
  image: string | null // portrait data URL (P2-2), clipped into the node when present
  lifecycle: Lifecycle // drives the dimmed treatment for fallen / presumed entities
}

export interface GraphEdge {
  id: string
  from: string // source entity id (the edge's authored `from`)
  to: string // target entity id
  relation: string // the stored relation key (free text; may be an unknown key)
  label: string // the forward display label (RELATIONS[relation].forward, or the raw key)
}

export interface CampaignGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** One relationship as seen from a particular entity (used by EntityDetail). */
export interface RelationshipView {
  link: EntityLink
  direction: LinkDirection // 'out' = this entity is the source; 'in' = the target
  label: string // forward label for 'out', inverse label for 'in'
  other: Entity // the entity on the other end
}

/** A neighbor reached while gathering an entity's context (the Phase-2 RAG bundle). */
export interface ContextNeighbor {
  entity: Entity
  hop: number
  viaRelation: string
  viaLabel: string
  viaDescription: string | null
  // ADR-033: the tie's enrichment, oriented for the seed entity (near = the seed's feeling about this
  // neighbor, far = the neighbor's feeling about the seed). Kept consistent with EntityLink even though
  // this seam is currently only exercised by tests (the live AI path is listForEntity → formatRelationships).
  viaNearDisposition: string | null
  viaFarDisposition: string | null
  viaConfidence: NoteConfidence
  direction: LinkDirection
}

/** The serializable graph slice around an entity — the seam Phase 2 GraphRAG consumes. */
export interface EntityContext {
  root: Entity
  notes: Note[]
  neighbors: ContextNeighbor[]
}

/** Containment hierarchy around an entity (breadcrumb + subtree). */
export interface HierarchyDescendant {
  entity: Entity
  depth: number
}

export interface HierarchyView {
  ancestors: Entity[] // top-most container down to the immediate parent
  descendants: HierarchyDescendant[] // everything contained, with depth
}
