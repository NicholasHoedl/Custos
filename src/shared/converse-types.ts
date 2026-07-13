// Shared types for Converse: the in-character "question" lens — the third AI sibling to Consult (Recall,
// factual answers) and Counsel (Suggest, action ideas). You Converse WITH a character (an NPC or a fellow
// PC — the person across the table), and Converse returns a spread of tagged, in-character QUESTIONS the
// asking PC could ask to draw them out. There is NO briefing — the questions are the whole product; the
// service reasons over what the party knows/suspects/doesn't internally and emits only the questions
// (ADR-034). Like Suggest, it's single-shot (request/response, not streaming) and structured (ADR-008/009).

import type { AiRunCost } from './usage-types'

export interface ConverseRequest {
  /** Cancellation key (P1-5): converse:cancel aborts the in-flight call by this id. Optional — the
   *  renderer always sends one; direct service calls (tests) may omit it. */
  requestId?: string
  campaignId: string
  /** The asker — the in-character POV. Requires an active PC (+ persona), like Suggest/Counsel. */
  pcId: string
  /** Who the PC is talking WITH — the target character (an npc or pc; never the asking PC itself). */
  targetId: string
  /** Optional "thread": what to dig into (a third party, a topic, a rumor). Blank = draw them out generally. */
  focus?: string
  /** Chronology (ADR-017): reconstruct "as of" this session NUMBER (notes + state + ties clamped ≤ N). */
  asOfSession?: number
  /** Per-query speed: 'quick' = Sonnet + medium effort (table-fast); 'deep'/unset = the Settings model +
   *  effort. Mirrors Recall/Counsel's speed toggle. */
  speed?: 'quick' | 'deep'
  /** Follow-up loop (ADR-049): the conversation so far — the question the PC ASKED and what the target
   *  said back, each turn, oldest-first (newest last). Present → the model returns follow-up questions that
   *  build on those specific exchanges. The `question` is the suggestion the player actually used. */
  history?: { question: string; answer: string }[]
}

// The question-type taxonomy (ADR-034). Each suggestion gets ONE tag naming the KIND of question. The
// model only emits `tag`; the aim (lore vs character) and trust cost are static UI enrichment derived from
// CONVERSE_TAG_META below — they order the spread (rapport → sensitive) and label each card.
export const CONVERSE_TAGS = [
  'open-probe',
  'rapport',
  'backstory-dig',
  'feelings',
  'motivation',
  'opinion',
  'lore',
  'rumor-test',
  'callback',
  'secret-seeking',
  'leading',
  'challenge',
  'flatter',
  'empathetic-disclosure'
] as const

export type ConverseTag = (typeof CONVERSE_TAGS)[number]

/** What a question chiefly goes after: world/plot ('lore'), the target's inner life ('character'), or both. */
export type ConverseAim = 'lore' | 'character' | 'both'

/** Social capital a question spends or builds — the funnel axis (rapport → sensitive). */
export type ConverseCost = 'builds' | 'low' | 'med' | 'high'

export interface ConverseTagMeta {
  label: string
  aim: ConverseAim
  cost: ConverseCost
}

/** Static per-tag metadata: display label + the aim/cost the UI shows and orders by (the model never
 *  emits these). Cost reflects the KIND of question, not the specific phrasing. */
export const CONVERSE_TAG_META: Record<ConverseTag, ConverseTagMeta> = {
  'open-probe': { label: 'Open Probe', aim: 'lore', cost: 'low' },
  rapport: { label: 'Rapport', aim: 'character', cost: 'builds' },
  'backstory-dig': { label: 'Backstory', aim: 'character', cost: 'low' },
  feelings: { label: 'Feelings', aim: 'character', cost: 'med' },
  motivation: { label: 'Motivation', aim: 'character', cost: 'med' },
  opinion: { label: 'Opinion', aim: 'both', cost: 'med' },
  lore: { label: 'Lore', aim: 'lore', cost: 'low' },
  'rumor-test': { label: 'Rumor Test', aim: 'lore', cost: 'low' },
  callback: { label: 'Callback', aim: 'both', cost: 'low' },
  'secret-seeking': { label: 'Secret-Seeking', aim: 'both', cost: 'high' },
  leading: { label: 'Leading', aim: 'both', cost: 'high' },
  challenge: { label: 'Challenge', aim: 'both', cost: 'high' },
  flatter: { label: 'Flatter', aim: 'both', cost: 'low' },
  'empathetic-disclosure': { label: 'Empathetic Disclosure', aim: 'character', cost: 'builds' }
}

/** Funnel order for sorting a spread cheap → costly (rapport-building first, sensitive probes last). */
export const CONVERSE_COST_ORDER: Record<ConverseCost, number> = {
  builds: 0,
  low: 1,
  med: 2,
  high: 3
}

/** Human labels for the cost badge (UI). */
export const CONVERSE_COST_LABELS: Record<ConverseCost, string> = {
  builds: 'Builds trust',
  low: 'Low cost',
  med: 'Medium cost',
  high: 'High cost'
}

/** Human labels for the aim badge (UI). */
export const CONVERSE_AIM_LABELS: Record<ConverseAim, string> = {
  lore: 'Lore',
  character: 'Character',
  both: 'Lore + Character'
}

/** Display label for a tag — the curated CONVERSE_TAG_META label, with a title-case fallback (mirrors
 *  suggest-types `tagLabel`) so an unknown/legacy slug still renders sensibly. */
export function converseTagLabel(tag: string): string {
  const meta = (CONVERSE_TAG_META as Record<string, ConverseTagMeta>)[tag]
  if (meta) return meta.label
  return tag
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
}

/** One in-character question the asking PC could pose: the line (in the PC's voice), its type TAG, and a
 *  short "read" — what the PC suspects / why ask now / what gap it opens (the thing that makes it intentional). */
export interface ConverseQuestion {
  question: string
  tag: ConverseTag
  read: string
}

export type ConverseFailureReason =
  | 'no_key'
  | 'bad_key'
  | 'offline'
  | 'no_pc'
  | 'invalid'
  | 'api'
  | 'unknown'

/**
 * The result of a Converse query. On success: the spread of in-character questions (each tagged). On
 * failure: a reason the renderer can render without try/catch (mirrors SuggestResult). There is no
 * 'no_model' reason — Converse grounds by DIRECT FETCH, not semantic search, so it needs no local model.
 */
export type ConverseResult =
  | { ok: true; questions: ConverseQuestion[]; cost?: AiRunCost }
  | { ok: false; reason: ConverseFailureReason; message?: string }

/**
 * One turn in a Converse thread (ADR-049, the follow-up loop). `asked` is the exchange that prompted this
 * spread — the question the PC used and the target's answer — or null for the opening spread. Renderer-
 * facing state (mirrors RecallTurn); never crosses IPC.
 */
export interface ConverseTurn {
  asked: { question: string; answer: string } | null
  questions: ConverseQuestion[]
  cost?: AiRunCost
}
