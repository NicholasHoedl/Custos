import type { EntityType } from './entity-types'

// ---- Paste-and-extract import (v1: entities + notes) ----
// The model proposes new entities + notes from pasted raw text; the user reviews/edits/confirms each
// item; we apply in one transaction. Proposed (not-yet-created) entities are referenced by LOCAL INDEX:
// in the model's JSON a NEW entity is "#0","#1",… (its position in `entities`), and an EXISTING entity
// is its real id (the prompt lists candidate ids). The validator normalizes those strings to EntityRef.
// Relationship extraction is intentionally deferred (see plan §Fast-follow); stated relationships
// survive as note prose in v1.

export interface ExtractRequest {
  campaignId: string
  text: string
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
  notes: { content: string; entityRefs: string[]; tags?: string[] }[]
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
}

export interface ExtractionProposal {
  entities: ProposedEntity[]
  notes: ProposedNote[]
}

export type ExtractFailureReason = 'no_key' | 'offline' | 'api' | 'invalid' | 'empty'

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
}

export interface ConfirmedNote {
  content: string
  entityRefs: EntityRef[]
  tags: string[]
  include: boolean
}

export interface ConfirmedChangeset {
  campaignId: string
  sessionId: string | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
}

export interface ApplyResult {
  createdEntityIds: string[]
  linkedEntityIds: string[]
  createdNoteIds: string[]
  skipped: { kind: 'entity' | 'note'; reason: string }[]
}
