// Shared types for "Illuminate" (code name enrich, ADR-035) — the manual tier-2 enrichment pass. Given a
// session, the user picks which of its touched entities to enrich; each selected entity gets ONE focused
// model call grounded in its FULL note history + current profile + live ties, proposing ONLY relationship
// and field changes (real-id refs; tier 2 never creates entities/notes/status). Results merge into one
// ChangesetReview and apply through the existing import engine, stamped at the enriched session.

import type { EntityType } from './entity-types'
import type {
  ExtractFailureReason,
  ProposedFieldChange,
  ProposedRelationshipChange,
  RawExtraction
} from './import-types'

/** One entity a session's notes touched — a pre-flight checklist row. */
export interface TouchedEntity {
  entityId: string
  name: string
  type: EntityType
  noteCount: number
}

export interface EnrichEntityRequest {
  campaignId: string
  /** The session being illuminated — applied ties open their interval here (decision #6, ADR-035). */
  sessionId: string
  entityId: string
}

/** The raw model shape for tier 2: the two change arrays only. */
export type RawEnrichment = Pick<RawExtraction, 'relationshipChanges' | 'fieldChanges'>

/**
 * Per-entity enrichment result. NOTE: an empty result is `ok: true` with empty arrays — "nothing new
 * about this entity" is the EXPECTED steady-state of a sweep (deliberately unlike ExtractResult's
 * 'empty' failure, which signals an unusable extraction). `ok: false` is reserved for real failures.
 */
export type EnrichEntityResult =
  | {
      ok: true
      relationshipChanges: ProposedRelationshipChange[]
      fieldChanges: ProposedFieldChange[]
    }
  | { ok: false; reason: ExtractFailureReason; message?: string }
