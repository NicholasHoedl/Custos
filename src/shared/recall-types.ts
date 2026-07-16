import type { EntityType, TutorialStepId } from './entity-types'
import type { AiRunCost } from './usage-types'

// Shared types for Phase 2 Recall: the streaming request/response contract and the persona brief.

export type RecallMode = 'in_character' | 'factual'

export interface RecallRequest {
  requestId: string
  query: string
  campaignId: string
  pcId: string | null
  mode: RecallMode
  /** Per-query speed/depth (overhaul): 'quick' = Sonnet + concise; 'deep'/unset = the Settings model +
   *  full synthesis. Resolved in recall.service; the Settings "Lore model" card is the Deep default. */
  speed?: 'quick' | 'deep'
  /** Follow-up loop (overhaul): prior turns (TEXT only) so the answer stays in context. Capped in the
   *  service; the latest query still re-retrieves fresh grounding. */
  history?: { question: string; answer: string }[]
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
  /** Set on the done event (overhaul): true if the streamed answer actually cited this note. Retrieved-
   *  but-uncited sources still show — they're the grounding — just without the "cited" mark. */
  cited?: boolean
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

/** The early sources event (overhaul): retrieved grounding, emitted right after retrieval so it shows
 *  before the answer finishes streaming. The `done` event later marks which were `cited`. */
export interface RecallSourcesEvent {
  requestId: string
  sources: RecallSource[]
}

/** One completed turn in a Lore conversation (overhaul follow-up loop): the question, the answer, and the
 *  sources that grounded it. Held by the renderer; prior turns' {question, answer} ride RecallRequest.history. */
export interface RecallTurn {
  question: string
  answer: string
  sources: RecallSource[]
  /** The turn's outcome — offline/no_key show the retrieved notes with a note instead of an answer. */
  reason?: RecallReason
  cost?: AiRunCost | null
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
  /** First-run tutorial (ADR-044 → ADR-059): the forced tour is done (persisted flag), skipped (e2e),
   *  or grandfathered (pre-tutorial data). */
  tutorialDone: boolean
  /** Mid-tour resume point (ADR-059) — present only while a spotlight tour is in progress, so AppShell's
   *  single status fetch carries both the gate and where to pick back up. */
  tutorialStep?: TutorialStepId
}

/** Embedding-model download progress (onboarding). */
export interface ModelDownloadProgress {
  status: 'downloading' | 'ready' | 'error'
  loaded?: number
  total?: number
  file?: string
  message?: string
}
