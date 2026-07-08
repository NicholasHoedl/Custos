import type { EntityType, Lifecycle, NoteConfidence } from './entity-types'
import type { RelationKey } from './relations'

// ---- Paste-and-extract import + backfill interview (changeset v2) ----
// The model proposes new entities + notes from pasted raw text; the user reviews/edits/confirms each
// item; we apply in one transaction. Proposed (not-yet-created) entities are referenced by LOCAL INDEX:
// in the model's JSON a NEW entity is "#0","#1",… (its position in `entities`), and an EXISTING entity
// is its real id (the prompt lists candidate ids). The validator normalizes those strings to EntityRef.
// Two-tier split (ADR-035): extraction runs in one of two MODES — 'capture' (the automatic note-taker:
// entities + notes + statusChanges; Chronicle + Transcribe) or 'full' (all five arrays including
// relationship/field changes; the backstory wizard ONLY). Applied changes stamp at the batch's session
// so the captured past feeds Chronology's as-of reconstruction (ADR-017).

/** Tier split (ADR-035): 'capture' = entities + notes + statusChanges (the automatic note-taker);
 *  'full' = all five arrays (ties + field changes too — backstory step 2 only). */
export type ExtractionMode = 'capture' | 'full'

export interface ExtractRequest {
  campaignId: string
  text: string
  /** Extraction tier (ADR-035). Defaults to 'capture'. */
  mode?: ExtractionMode
  /** ADR-030 v3: the existing entity whose personal BACKSTORY `text` is (the main character) — the
   *  extractor is told, so the standing ties it proposes anchor to that character. */
  backstorySubjectId?: string
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
  /** Both modes: state changes the text narrates, e.g. a death or a completion (ADR-035 keeps status in
   *  tier 1 — it drives as-of chronology). */
  statusChanges?: { entityRef: string; lifecycle?: string; status?: string }[]
  /** 'full' mode only: relationships that formed or ended during the described events. */
  relationshipChanges?: {
    fromRef: string
    toRef: string
    relation: string
    action: string
    description?: string
    fromDisposition?: string
    toDisposition?: string
    confidence?: string
  }[]
  /** 'full' mode only: edits to an EXISTING entity's fields (traits/goals/flaws/attributes/description). */
  fieldChanges?: { entityRef: string; field?: string; op?: string; value?: string; oldValue?: string }[]
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
  /** ADR-031: the content closely matches an EXISTING note (near-duplicate) — review defaults it OFF.
   *  Exact-normalized duplicates never reach the proposal at all (dropped in validation). */
  possibleDuplicate?: boolean
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
  // Tie enrichment (ADR-033) — only meaningful for `form` (a new edge carries these; sever just closes one).
  description?: string | null
  fromDisposition?: string | null
  toDisposition?: string | null
  confidence?: NoteConfidence
}

export type FieldChangeOp = 'add' | 'cut' | 'alter'

/** A validated FIELD change: add/cut/alter a promoted list (traits/goals/flaws), the description, or a
 *  type attribute on an EXISTING entity. For a list cut/alter, `oldValue` is the exact current item
 *  (else null). */
export interface ProposedFieldChange {
  entityRef: EntityRef
  field: string // 'traits' | 'goals' | 'flaws' | 'description' | an attribute key
  op: FieldChangeOp
  value: string | null
  oldValue: string | null
}

export interface ExtractionProposal {
  entities: ProposedEntity[]
  notes: ProposedNote[]
  statusChanges: ProposedStatusChange[]
  relationshipChanges: ProposedRelationshipChange[]
  fieldChanges: ProposedFieldChange[]
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
  possibleDuplicate?: boolean // ADR-031: shown as a review badge; seeds include:false
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
  description?: string | null
  fromDisposition?: string | null
  toDisposition?: string | null
  confidence?: NoteConfidence
}

export interface ConfirmedFieldChange {
  entityRef: EntityRef
  field: string
  op: FieldChangeOp
  value: string | null
  oldValue: string | null
  include: boolean
}

export interface ConfirmedChangeset {
  campaignId: string
  sessionId: string | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
  /** Optional per-tier: capture emits statusChanges only; full adds ties + fields; Illuminate (ADR-035)
   *  sends ONLY relationship/field changes with everything else empty. */
  statusChanges?: ConfirmedStatusChange[]
  relationshipChanges?: ConfirmedRelationshipChange[]
  fieldChanges?: ConfirmedFieldChange[]
}

export interface ApplyResult {
  createdEntityIds: string[]
  linkedEntityIds: string[]
  createdNoteIds: string[]
  statusChangesApplied: number
  relationshipChangesApplied: number
  fieldChangesApplied: number
  skipped: { kind: 'entity' | 'note' | 'change'; reason: string }[]
}
