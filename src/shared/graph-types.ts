import type {
  Entity,
  EntityLink,
  EntityType,
  Lifecycle,
  Note,
  NoteConfidence
} from './entity-types'

export type LinkDirection = 'out' | 'in'

// The campaign relationship graph (P2-3, enriched in the Web feature pass): a node/edge slice of the
// campaign's ties, consumed by the "Web" view. Carries the tie ENRICHMENT (disposition/confidence/
// description) so edges can be styled by feeling + certainty, the DIRECTION so directed relations draw an
// arrowhead, and the CHRONOLOGY interval so a session `asOf` can reconstruct the web at any point in time.
// `buildCampaignGraph(ctx, campaignId, asOf?)`: with no `asOf` it's the live "as it stands now" picture
// (open-interval edges only); with an `asOf` it's the web AS OF that session — edges live then, plus those
// just-formed / just-severed at N, and node lifecycle reconstructed to N (`faded` de-emphasizes the fallen
// and the not-yet-present).
export interface GraphNode {
  id: string
  name: string
  type: EntityType
  image: string | null // portrait data URL (P2-2), clipped into the node when present
  lifecycle: Lifecycle // live lifecycle, or reconstructed AS OF the query session when `asOf` is set
  faded: boolean // de-emphasize: fallen/presumed (now), or ended / not-yet-present (as-of)
}

export interface GraphEdge {
  id: string
  from: string // source entity id (the edge's authored `from`)
  to: string // target entity id
  relation: string // the stored relation key (free text; may be an unknown key)
  label: string // the forward display label (RELATIONS[relation].forward, or the raw key)
  description: string | null // the tie's "why/when" — shown in the edge tooltip
  fromDisposition: string | null // how `from` feels about `to` (ADR-033) — drives edge warmth
  toDisposition: string | null // how `to` feels about `from`
  confidence: NoteConfidence // 'confirmed' | 'rumored' | 'suspected' — drives the line dash
  directed: boolean // draw an arrowhead (RELATIONS[relation].symmetric === false)
  startSessionNumber: number | null // chronology interval start (null = pre-tracking)
  endSessionNumber: number | null // chronology interval end (null = still live)
  severed: boolean // as-of only: ended exactly at the query session — render as a fading ghost
  justFormed: boolean // as-of only: started exactly at the query session — pulse/highlight
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
