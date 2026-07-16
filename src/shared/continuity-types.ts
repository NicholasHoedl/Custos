// Shared types for Continuity (ADR-056): the read-only campaign AUDIT lens — the maintenance sibling to
// the query lenses. It scans the recorded memory for self-contradictions and surfaces them as a findings
// report: a "fallen" entity still referenced as ACTING, two notes asserting opposite facts, a rumor a
// later note resolved but whose confidence was never updated, a status that doesn't match its lifecycle,
// a pair recorded as both allies and enemies. Two sources: always-on DETERMINISTIC checks (typed status
// presets + alliance conflict — no key needed) and ONE whole-campaign AI pass for the semantic contradictions.
// Informational only — each finding links the entities involved; v1 never auto-applies a fix. Ties/notes
// persist past death by design — a dead entity merely HOLDING a tie is not a slip; only "still ACTING" is
// (the AI pass's job).

import type { AiRunCost } from './usage-types'
import type { Lifecycle } from './entity-types'

/** The kind of inconsistency. Deterministic checks emit the first two; the AI pass emits the rest
 *  (`timeline-leak` = a note implying an [ended] entity still ACTS, plus `contradiction` / `unresolved-rumor`;
 *  it's told NOT to duplicate the deterministic categories). */
export const CONTINUITY_CATEGORIES = [
  'status-mismatch', // a status preset's lifecycle != the stored lifecycle (deterministic)
  'faction-conflict', // a live ally_of AND enemy_of on the same pair (deterministic)
  'timeline-leak', // a note implying an [ended] entity is still ACTING (AI)
  'contradiction', // two records disagree (AI)
  'unresolved-rumor' // a rumor a later note resolved/refuted, but the confidence was never updated (AI)
] as const
export type ContinuityCategory = (typeof CONTINUITY_CATEGORIES)[number]

export type ContinuitySeverity = 'high' | 'medium' | 'low'

/** Display label per category (UI badge). */
export const CONTINUITY_CATEGORY_LABELS: Record<ContinuityCategory, string> = {
  'status-mismatch': 'Status mismatch',
  'faction-conflict': 'Alliance conflict',
  'timeline-leak': 'Timeline slip',
  contradiction: 'Contradiction',
  'unresolved-rumor': 'Stale rumor'
}

/** Sort weight so the most serious findings float to the top of the report. */
export const CONTINUITY_SEVERITY_ORDER: Record<ContinuitySeverity, number> = {
  high: 0,
  medium: 1,
  low: 2
}

/**
 * A concrete, reversible correction the GM can APPLY from a finding. Deterministic findings attach these
 * (the check knows exactly what's wrong); AI findings never do (their resolution is a judgment, not a diff).
 * Applied through the existing `entity.update` / `link.sever` IPC — no new privileged path, no AI, no key.
 */
export type ContinuityFixAction =
  | { kind: 'set-lifecycle'; entityId: string; lifecycle: Lifecycle }
  | { kind: 'sever-tie'; linkId: string }

/** One or more labelled actions the finding card renders as buttons (e.g. faction-conflict offers "sever
 *  the ally tie" AND "sever the enemy tie" — the GM picks which). */
export interface ContinuityFix {
  actions: { action: ContinuityFixAction; label: string }[]
}

/**
 * One inconsistency in the record. `entityIds` are the entities involved (for jump-to links in the report);
 * `detail` quotes the evidence; `suggestedFix` is an optional advisory string; `fix` is an optional STRUCTURED
 * one-click correction (deterministic findings only). `source` distinguishes a computed (deterministic)
 * finding from a model-found one.
 */
export interface ContinuityFinding {
  category: ContinuityCategory
  severity: ContinuitySeverity
  source: 'check' | 'ai'
  summary: string
  detail: string
  entityIds: string[]
  suggestedFix?: string
  fix?: ContinuityFix
}

/** One finding as the MODEL emits it (raw, pre-validation): `entityRefs` are ids it chose; the service
 *  validates the category/severity and resolves refs to real campaign ids → a `ContinuityFinding`. */
export interface RawContinuityFinding {
  category: string
  severity: string
  summary: string
  detail: string
  entityRefs: string[]
  suggestedFix?: string
}

export interface ContinuityRequest {
  /** Cancellation key: continuity:cancel aborts the in-flight AI call by this id (optional; tests may omit). */
  requestId?: string
  campaignId: string
  /** Per-query speed (mirrors the other lenses): 'quick' = Sonnet + medium, 'deep'/unset = Settings model.
   *  (v1 audits the live "now" picture; an as-of audit is a reserved future extension.) */
  speed?: 'quick' | 'deep'
}

/**
 * The optional AI pass's outcome. The deterministic findings ALWAYS return regardless of this — the audit
 * is useful with no key. `skipped` = the pass didn't run (no key / offline / nothing to check); `failed` =
 * it ran and errored.
 */
export type ContinuityAiStatus =
  | { status: 'ok' }
  | { status: 'skipped'; reason: 'no_key' | 'offline' | 'empty' }
  | { status: 'failed'; reason: 'bad_key' | 'too_long' | 'api' | 'unknown'; message?: string }

/**
 * The audit result. Unlike the query lenses there is no hard ok/fail — the deterministic checks always
 * produce `findings`; the AI pass is additive and reports its own `ai` status (so "no key" still yields a
 * useful report). Findings are already merged (deterministic + AI) and sorted by severity.
 */
export interface ContinuityResult {
  findings: ContinuityFinding[]
  ai: ContinuityAiStatus
  cost?: AiRunCost
}
