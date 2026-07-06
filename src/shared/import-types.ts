import type { EntityType, Lifecycle, NoteConfidence } from './entity-types'
import type { RelationKey } from './relations'

// ---- Paste-and-extract import + backfill interview (changeset v2) ----
// The model proposes new entities + notes from pasted raw text; the user reviews/edits/confirms each
// item; we apply in one transaction. Proposed (not-yet-created) entities are referenced by LOCAL INDEX:
// in the model's JSON a NEW entity is "#0","#1",… (its position in `entities`), and an EXISTING entity
// is its real id (the prompt lists candidate ids). The validator normalizes those strings to EntityRef.
// Changeset v2 (ADR-018, backfill): extraction can ALSO emit status/relationship CHANGES — gated by
// `withChanges` so the plain Import pane is unchanged — which apply stamps at the batch's session so
// the backfilled past feeds Chronology's as-of reconstruction (ADR-017).

export interface ExtractRequest {
  campaignId: string
  text: string
  /** Changeset v2: also extract status/relationship changes (backfill interview). Default false. */
  withChanges?: boolean
}

/** A reference to an entity in the changeset — a proposed-new one (by index) or an existing id. */
export type EntityRef = { kind: 'new'; index: number } | { kind: 'existing'; entityId: string }

/** The raw, UNVALIDATED shape the model returns (cleaned in import.service before it reaches the UI). */
export interface RawExtraction {
  entities: {
    type: string
    name: string
    description?: string
    status?: string
    attributes?: { key: string; value: string }[]
  }[]
  notes: { content: string; entityRefs: string[]; tags?: string[]; confidence?: string }[]
  /** Changeset v2 (withChanges only): state changes the text narrates, e.g. a death or a completion. */
  statusChanges?: { entityRef: string; lifecycle?: string; status?: string }[]
  /** Changeset v2 (withChanges only): relationships that formed or ended during the described events. */
  relationshipChanges?: { fromRef: string; toRef: string; relation: string; action: string }[]
}

/** A possible existing match for a proposed entity (drives the "link instead of create" choice). */
export interface MatchCandidate {
  entityId: string
  name: string
  type: EntityType
  score: number
}

/** A validated proposed entity. `index` is its ORIGINAL position in the model's array (refs use it). */
export interface ProposedEntity {
  index: number
  type: EntityType
  name: string
  description?: string
  status?: string
  attributes?: Record<string, string>
  matches: MatchCandidate[]
}

export interface ProposedNote {
  content: string
  entityRefs: EntityRef[]
  tags: string[]
  confidence: NoteConfidence // epistemic weight (ADR-021); validator defaults to 'confirmed'
}

/** A validated status/lifecycle change, to be stamped at the batch's session on apply (ADR-018). */
export interface ProposedStatusChange {
  entityRef: EntityRef
  lifecycle: Lifecycle
  status: string | null
}

/** A validated relationship change: form opens an interval at the session; sever closes one. */
export interface ProposedRelationshipChange {
  fromRef: EntityRef
  toRef: EntityRef
  relation: RelationKey
  action: 'form' | 'sever'
}

export interface ExtractionProposal {
  entities: ProposedEntity[]
  notes: ProposedNote[]
  statusChanges: ProposedStatusChange[]
  relationshipChanges: ProposedRelationshipChange[]
}

export type ExtractFailureReason =
  | 'no_key'
  | 'bad_key'
  | 'offline'
  | 'api'
  | 'invalid'
  | 'empty'
  | 'too_long'

export type ExtractResult =
  | { ok: true; proposal: ExtractionProposal }
  | { ok: false; reason: ExtractFailureReason; message?: string }

/** A reviewed entity: create a new one, link the proposal onto an existing entity, or skip it. */
export interface ConfirmedEntity {
  index: number
  action: 'create' | 'link' | 'skip'
  type: EntityType
  name: string
  description?: string
  status?: string
  attributes?: Record<string, unknown>
  linkToEntityId?: string // required when action === 'link'
  /** Backfill: the session to stamp this entity's baseline at (its first appearance). Falls back to
   *  the changeset's sessionId. Omit for "the batch's session" (or pre-tracking when that is null). */
  sessionId?: string
}

export interface ConfirmedNote {
  content: string
  entityRefs: EntityRef[]
  tags: string[]
  confidence: NoteConfidence
  include: boolean
}

export interface ConfirmedStatusChange {
  entityRef: EntityRef
  lifecycle: Lifecycle
  status: string | null
  include: boolean
}

export interface ConfirmedRelationshipChange {
  fromRef: EntityRef
  toRef: EntityRef
  relation: RelationKey
  action: 'form' | 'sever'
  include: boolean
}

export interface ConfirmedChangeset {
  campaignId: string
  sessionId: string | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
  /** Changeset v2 (backfill) — absent for the plain Import pane. */
  statusChanges?: ConfirmedStatusChange[]
  relationshipChanges?: ConfirmedRelationshipChange[]
}

export interface ApplyResult {
  createdEntityIds: string[]
  linkedEntityIds: string[]
  createdNoteIds: string[]
  statusChangesApplied: number
  relationshipChangesApplied: number
  skipped: { kind: 'entity' | 'note' | 'change'; reason: string }[]
}
