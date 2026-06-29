// Shared types for Phase 3 Suggest: the request/response contract for attitude-based, in-character
// action suggestions. Unlike Recall, Suggest is single-shot (request/response, not streaming) and
// returns a structured set of recommendations (ADR-008, ADR-009).

import type { SceneContext } from './scene-types'

/** The seven roleplay attitudes a PC might adopt. The model picks the 4 most likely (SPEC §3). */
export const ATTITUDES = [
  'neutral',
  'friendly',
  'hostile',
  'moral',
  'selfish',
  'compassionate',
  'cynical'
] as const

export type Attitude = (typeof ATTITUDES)[number]

/** Human labels for the attitude cards (UI). */
export const ATTITUDE_LABELS: Record<Attitude, string> = {
  neutral: 'Neutral',
  friendly: 'Friendly',
  hostile: 'Hostile',
  moral: 'Moral',
  selfish: 'Selfish',
  compassionate: 'Compassionate',
  cynical: 'Cynical'
}

/** One suggested stance: the attitude, a concrete in-character action, and why it fits this PC. */
export interface AttitudeRecommendation {
  attitude: Attitude
  action: string
  rationale: string
}

/**
 * Suggest has two modes: 'attitudes' (closed-ended — 4 ways to react to a charged moment) and
 * 'directions' (open-ended — story-progression moves to keep things going).
 */
export type SuggestMode = 'attitudes' | 'directions'

/** Categories for open-ended "what's next" suggestions; each suggestion carries exactly one. */
export const SUGGEST_CATEGORIES = [
  'quest',
  'npc',
  'location',
  'party',
  'personal',
  'story',
  'faction',
  'item'
] as const

export type SuggestCategory = (typeof SUGGEST_CATEGORIES)[number]

/** Human labels for the category group headers (UI). */
export const CATEGORY_LABELS: Record<SuggestCategory, string> = {
  quest: 'Quest',
  npc: 'NPC',
  location: 'Location',
  party: 'Party',
  personal: 'Personal',
  story: 'Story',
  faction: 'Faction',
  item: 'Item'
}

/** One open-ended next move: its category, a concrete in-character suggestion, and why it fits. */
export interface StorySuggestion {
  category: SuggestCategory
  suggestion: string
  rationale: string
}

export interface SuggestRequest {
  campaignId: string
  pcId: string
  situation: string
  /** Defaults to 'attitudes' when omitted (back-compat). */
  mode?: SuggestMode
  /** The current scene (location/time/party/quest/combat), folded into grounding. */
  scene?: SceneContext
}

export type SuggestFailureReason =
  | 'no_key'
  | 'no_model'
  | 'offline'
  | 'no_pc'
  | 'invalid'
  | 'api'
  | 'unknown'

/**
 * The result of a Suggest query, discriminated by `mode`. Attitudes mode returns exactly 4 distinct
 * recommendations; directions mode returns a grouped set of story suggestions. On failure, a reason the
 * renderer can render without try/catch (mirrors RecallDone.reason).
 */
export type SuggestResult =
  | { ok: true; mode: 'attitudes'; recommendations: AttitudeRecommendation[] }
  | { ok: true; mode: 'directions'; suggestions: StorySuggestion[] }
  | { ok: false; reason: SuggestFailureReason; message?: string }
