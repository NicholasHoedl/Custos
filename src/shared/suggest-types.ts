// Shared types for Phase 3 Suggest: the request/response contract for attitude-based, in-character
// action suggestions. Unlike Recall, Suggest is single-shot (request/response, not streaming) and
// returns a structured set of recommendations (ADR-008, ADR-009).

import type { SceneContext } from './scene-types'
import type { AiRunCost } from './usage-types'

// The "in the moment" tag vocabulary. Each suggestion gets ONE primary tag (its dominant flavor) plus
// up to two secondary tags, drawn from this pool. Disposition tags describe the KIND of move; the
// race/class tags let a move lean into who the PC is (the model only ever applies the PC's OWN race
// and class — see SUGGEST_INSTRUCTIONS / suggest.service).
export const DISPOSITION_TAGS = [
  'friendly',
  'hostile',
  'diplomatic',
  'defiant',
  'intimidating',
  'cautious',
  'reckless',
  'impatient',
  'patient',
  'stealthy',
  'deceptive',
  'cunning',
  'resourceful',
  'tactical',
  'bold',
  'insightful',
  'investigative',
  'educated',
  'analytical',
  'religious',
  'honorable',
  'merciful',
  'vengeful',
  'protective',
  'selfish',
  'greedy',
  'curious',
  'loyal',
  'playful',
  'survival',
  'sacrificial',
  // Expansion: distrust, candor, leadership, the body (forceful/nimble/defensive), keen senses,
  // results-over-principle, and a tie to the wild.
  'suspicious',
  'forthright',
  'inspiring',
  'forceful',
  'nimble',
  'defensive',
  'perceptive',
  'pragmatic',
  'primal'
] as const

/** Standard player races — a move may be tagged with the PC's OWN race (never another's). */
export const RACE_TAGS = [
  'human',
  'elf',
  'drow',
  'half-elf',
  'dwarf',
  'halfling',
  'gnome',
  'half-orc',
  'tiefling',
  'dragonborn'
] as const

/** Standard player classes — a move may be tagged with the PC's OWN class. */
export const CLASS_TAGS = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard'
] as const

export const SUGGEST_TAGS = [...DISPOSITION_TAGS, ...RACE_TAGS, ...CLASS_TAGS] as const
export type SuggestTag = (typeof SUGGEST_TAGS)[number]

/** Display label for a tag — title-cased and hyphen-aware (e.g. "half-elf" → "Half-Elf"). */
export function tagLabel(tag: string): string {
  return tag
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
}

/** The three pillars of D&D play. Every "in the moment" option is tagged with the pillar it engages, so
 *  the six span combat / social / exploration instead of clustering in one (ADR-026). */
export const SUGGEST_PILLARS = ['combat', 'social', 'exploration'] as const
export type SuggestPillar = (typeof SUGGEST_PILLARS)[number]

export const PILLAR_LABELS: Record<SuggestPillar, string> = {
  combat: 'Combat',
  social: 'Social',
  exploration: 'Exploration'
}

/**
 * One "in the moment" suggestion: a concrete in-character action, its dominant PRIMARY tag, up to two
 * SECONDARY tags for nuance, the PILLAR it engages, how it resolves at the table (MECHANIC: the 5e check +
 * ability + stakes), an optional TEAMWORK play with a present ally, and a one-line rationale.
 */
export interface MomentSuggestion {
  primaryTag: SuggestTag
  secondaryTags: SuggestTag[]
  pillar: SuggestPillar
  action: string
  /** The 5e check + governing ability (+ what it's opposed by), no DCs or failure outcomes — e.g. "Deception (CHA) vs. their Insight". */
  mechanic: string
  /** A coordination play naming a PRESENT ally, or null when the move is solo. */
  teamwork: string | null
  rationale: string
}

/**
 * Suggest has two modes: 'attitudes' (the "in the moment" mode — 6 tagged ways to react to a charged
 * moment) and 'directions' (open-ended — story-progression moves to keep things going).
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
  /** Cancellation key (P1-5): suggest:cancel aborts the in-flight call by this id. Optional — the
   *  renderer always sends one; direct service calls (tests) may omit it. */
  requestId?: string
  campaignId: string
  pcId: string
  situation: string
  /** Optional player goal — biases the 'in the moment' spread toward it (ADR-026). */
  goal?: string
  /** Defaults to 'attitudes' when omitted (back-compat). */
  mode?: SuggestMode
  /** The current scene (location/time/party/quest/combat), folded into grounding. */
  scene?: SceneContext
  /** Chronology (ADR-017): reconstruct "as of" this session NUMBER (retrieval + state clamped ≤ N). */
  asOfSession?: number
  /** Per-query speed: 'quick' = Sonnet + medium effort (table-fast); 'deep'/unset = the Settings
   *  Counsel model + effort. Mirrors Recall's speed toggle. */
  speed?: 'quick' | 'deep'
  /** Refine (attitudes only): a short nudge to reshape the spread — "Bolder", "De-escalate", … When set
   *  with `previous`, the model re-rolls a fresh six adjusted toward it instead of a first pass. */
  refinement?: string
  /** The spread being refined, so the re-roll produces genuinely different options (not a repeat). */
  previous?: MomentSuggestion[]
}

export type SuggestFailureReason =
  | 'no_key'
  | 'bad_key'
  | 'no_model'
  | 'offline'
  | 'no_pc'
  | 'invalid'
  | 'api'
  | 'unknown'

/**
 * The result of a Suggest query, discriminated by `mode`. Attitudes ("in the moment") mode returns
 * exactly SIX multi-tagged suggestions; directions mode returns a grouped set of story suggestions. On
 * failure, a reason the renderer can render without try/catch (mirrors RecallDone.reason).
 */
export type SuggestResult =
  | { ok: true; mode: 'attitudes'; recommendations: MomentSuggestion[]; cost?: AiRunCost }
  | { ok: true; mode: 'directions'; suggestions: StorySuggestion[]; cost?: AiRunCost }
  | { ok: false; reason: SuggestFailureReason; message?: string }
