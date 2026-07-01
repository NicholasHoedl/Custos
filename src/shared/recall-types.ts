import type { EntityType } from './entity-types'
import type { SceneContext } from './scene-types'

// Shared types for Phase 2 Recall: the streaming request/response contract and the persona brief.

export type RecallMode = 'in_character' | 'factual'

export interface RecallRequest {
  requestId: string
  query: string
  campaignId: string
  pcId: string | null
  mode: RecallMode
  /** The current scene (location/time/party/quest/combat), folded into grounding. */
  scene?: SceneContext
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

/** A cited source surfaced under the answer (clickable → open the entity/note). */
export interface RecallSource {
  entityId: string
  entityType: EntityType
  entityName: string
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
}

export type RecallErrorKind = 'offline' | 'no_key' | 'no_model' | 'api' | 'unknown'

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
}

/** Embedding-model download progress (onboarding). */
export interface ModelDownloadProgress {
  status: 'downloading' | 'ready' | 'error'
  loaded?: number
  total?: number
  file?: string
  message?: string
}
