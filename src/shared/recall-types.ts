import type { EntityType } from './entity-types'
import type { AiRunCost } from './usage-types'

// Shared types for Phase 2 Recall: the streaming request/response contract and the persona brief.

export type RecallMode = 'in_character' | 'factual'

export interface RecallRequest {
  requestId: string
  query: string
  campaignId: string
  pcId: string | null
  mode: RecallMode
  /**
   * Chronology (ADR-017): reconstruct the world "as of" this session NUMBER. Omitted = now (latest).
   * When set, retrieval AND state are clamped to ≤ N (no future-knowledge leak).
   */
  asOfSession?: number
}

export interface RecallChunk {
  requestId: string
  text: string
}

/** A cited source surfaced under the answer (clickable → open the entity/note). The entity fields are
 *  null for a campaign-lore note (a note owned by no entity — ADR-021); the UI shows it non-clickable. */
export interface RecallSource {
  entityId: string | null
  entityType: EntityType | null
  entityName: string | null
  noteId: string | null
  sessionLabel: string | null
  snippet?: string // shown in the offline / retrieval-only view
}

export type RecallReason = 'ok' | 'offline' | 'no_key' | 'no_model'

export interface RecallDone {
  requestId: string
  mode: RecallMode
  sources: RecallSource[]
  reason: RecallReason
  /** Per-run token/price readout (P0-4); absent on the no-op paths (offline/no_key/no_model). */
  cost?: AiRunCost
}

export type RecallErrorKind = 'offline' | 'no_key' | 'bad_key' | 'no_model' | 'api' | 'unknown'

export interface RecallError {
  requestId: string
  message: string
  kind: RecallErrorKind
}

/** The in-character persona for a PC, as exposed to the renderer (the brief text + edit/staleness flags). */
export interface PersonaBrief {
  entityId: string
  brief: string
  edited: boolean
  stale: boolean
  model: string | null
  updatedAt: number
}

/** Whether the prerequisites for AI features are satisfied. */
export interface OnboardingStatus {
  keyReady: boolean
  modelReady: boolean
  /** First-run tutorial (ADR-044): the forced wizard is done (persisted flag) or skipped (e2e). */
  tutorialDone: boolean
}

/** Embedding-model download progress (onboarding). */
export interface ModelDownloadProgress {
  status: 'downloading' | 'ready' | 'error'
  loaded?: number
  total?: number
  file?: string
  message?: string
}
