import type { EntityType } from './entity-types'

// The curated, code-extensible relationship vocabulary (the RAG-context backbone).
// The DB stores `entity_link.relation` as the forward key string; the inverse label is derived at
// read time so an edge reads correctly from both ends. To add a relation, add an entry here — no
// migration needed. Hierarchical pairs are traversed with recursive CTEs (composite-for-hierarchy).

export type RelationKey =
  | 'located_in'
  | 'contains'
  | 'member_of'
  | 'has_member'
  | 'owns'
  | 'owned_by'
  | 'quest_giver_of'
  | 'quest_given_by'
  | 'involves'
  | 'involved_in'
  | 'ally_of'
  | 'enemy_of'
  | 'knows'
  | 'related_to'

export interface RelationDef {
  key: RelationKey
  forward: string // label shown on the from -> to edge
  inverse: string // label shown from the to side
  inverseKey: RelationKey // the paired key (self for symmetric)
  symmetric: boolean
  fromTypes: EntityType[] | '*'
  toTypes: EntityType[] | '*'
  hierarchical: boolean // located_in/contains, member_of/has_member — walked by the hierarchy CTE
}

const ACTOR: EntityType[] = ['npc', 'faction', 'pc', 'creature']

export const RELATIONS: Record<RelationKey, RelationDef> = {
  located_in: {
    key: 'located_in',
    forward: 'located in',
    inverse: 'contains',
    inverseKey: 'contains',
    symmetric: false,
    fromTypes: ['npc', 'location', 'item', 'faction', 'pc', 'creature'],
    toTypes: ['location'],
    hierarchical: true
  },
  contains: {
    key: 'contains',
    forward: 'contains',
    inverse: 'located in',
    inverseKey: 'located_in',
    symmetric: false,
    fromTypes: ['location'],
    toTypes: ['npc', 'location', 'item', 'faction', 'pc', 'creature'],
    hierarchical: true
  },
  member_of: {
    key: 'member_of',
    forward: 'member of',
    inverse: 'has member',
    inverseKey: 'has_member',
    symmetric: false,
    fromTypes: ['npc', 'pc'],
    toTypes: ['faction'],
    hierarchical: true
  },
  has_member: {
    key: 'has_member',
    forward: 'has member',
    inverse: 'member of',
    inverseKey: 'member_of',
    symmetric: false,
    fromTypes: ['faction'],
    toTypes: ['npc', 'pc'],
    hierarchical: true
  },
  owns: {
    key: 'owns',
    forward: 'owns',
    inverse: 'owned by',
    inverseKey: 'owned_by',
    symmetric: false,
    fromTypes: ['npc', 'pc', 'faction', 'creature'],
    toTypes: ['item'],
    hierarchical: false
  },
  owned_by: {
    key: 'owned_by',
    forward: 'owned by',
    inverse: 'owns',
    inverseKey: 'owns',
    symmetric: false,
    fromTypes: ['item'],
    toTypes: ['npc', 'pc', 'faction', 'creature'],
    hierarchical: false
  },
  quest_giver_of: {
    key: 'quest_giver_of',
    forward: 'quest giver of',
    inverse: 'quest given by',
    inverseKey: 'quest_given_by',
    symmetric: false,
    fromTypes: ['npc', 'faction'],
    toTypes: ['quest'],
    hierarchical: false
  },
  quest_given_by: {
    key: 'quest_given_by',
    forward: 'quest given by',
    inverse: 'quest giver of',
    inverseKey: 'quest_giver_of',
    symmetric: false,
    fromTypes: ['quest'],
    toTypes: ['npc', 'faction'],
    hierarchical: false
  },
  involves: {
    key: 'involves',
    forward: 'involves',
    inverse: 'involved in',
    inverseKey: 'involved_in',
    symmetric: false,
    fromTypes: ['quest', 'event'],
    toTypes: ['npc', 'location', 'faction', 'item', 'pc', 'creature'],
    hierarchical: false
  },
  involved_in: {
    key: 'involved_in',
    forward: 'involved in',
    inverse: 'involves',
    inverseKey: 'involves',
    symmetric: false,
    fromTypes: ['npc', 'location', 'faction', 'item', 'pc', 'creature'],
    toTypes: ['quest', 'event'],
    hierarchical: false
  },
  ally_of: {
    key: 'ally_of',
    forward: 'ally of',
    inverse: 'ally of',
    inverseKey: 'ally_of',
    symmetric: true,
    fromTypes: ACTOR,
    toTypes: ACTOR,
    hierarchical: false
  },
  enemy_of: {
    key: 'enemy_of',
    forward: 'enemy of',
    inverse: 'enemy of',
    inverseKey: 'enemy_of',
    symmetric: true,
    fromTypes: ACTOR,
    toTypes: ACTOR,
    hierarchical: false
  },
  knows: {
    key: 'knows',
    forward: 'knows',
    inverse: 'known by',
    inverseKey: 'knows',
    symmetric: true,
    fromTypes: ['npc', 'pc'],
    toTypes: ['npc', 'pc'],
    hierarchical: false
  },
  related_to: {
    key: 'related_to',
    forward: 'related to',
    inverse: 'related to',
    inverseKey: 'related_to',
    symmetric: true,
    fromTypes: '*',
    toTypes: '*',
    hierarchical: false
  }
}

export const RELATION_LIST: RelationDef[] = Object.values(RELATIONS)

/** The relation keys that form containment hierarchies (walked by the recursive-CTE traversal). */
export const HIERARCHY_RELATIONS: RelationKey[] = RELATION_LIST.filter((r) => r.hierarchical).map(
  (r) => r.key
)

export function isRelationKey(value: string): value is RelationKey {
  return Object.prototype.hasOwnProperty.call(RELATIONS, value)
}

/** Label shown when viewing the edge from the `to` side. */
export function inverseLabel(key: RelationKey): string {
  return RELATIONS[key].inverse
}

function typeMatches(allowed: EntityType[] | '*', type: EntityType): boolean {
  return allowed === '*' || allowed.includes(type)
}

/** Relations a user may author from `from` to `to` (drives the relation picker). */
export function relationsForTypes(from: EntityType, to: EntityType): RelationDef[] {
  return RELATION_LIST.filter(
    (r) => typeMatches(r.fromTypes, from) && typeMatches(r.toTypes, to)
  )
}

/** Validates that a relation is allowed between the two entity types. */
export function isRelationAllowed(relation: string, from: EntityType, to: EntityType): boolean {
  if (!isRelationKey(relation)) return false
  const def = RELATIONS[relation]
  return typeMatches(def.fromTypes, from) && typeMatches(def.toTypes, to)
}
