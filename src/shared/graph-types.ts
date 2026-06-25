import type { Entity, EntityLink, Note } from './entity-types'

export type LinkDirection = 'out' | 'in'

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
