import { app } from 'electron'
import type { RawExtraction } from '@shared/import-types'
import type { RawEnrichment } from '@shared/enrich-types'
import type { MomentSuggestion, StorySuggestion } from '@shared/suggest-types'
import type { ConverseQuestion } from '@shared/converse-types'
import type { DerivedProfile } from '@shared/derive-profile-types'

// TEST-ONLY fake-AI seam (ROADMAP P2-6, ADR-041). When `LEDGER_FAKE_AI` is set AND the app is not
// packaged, the two "Close out session" AI calls — tier-1 extraction (import.service) and tier-2
// enrichment (enrich.service) — return this CANNED data instead of calling Claude. That lets the e2e
// suite drive the close-out wizard deterministically and offline while still exercising the REAL IPC
// handlers, the validators, and the DB `applyChangeset` transaction. `isOnline()` also short-circuits on
// this flag so the flow needs no network. Set ONLY by `tests/e2e/helpers.ts`.
//
// The `!app.isPackaged` guard means a shipped installer can never activate this even if the env var were
// somehow present; the env check is first so `app.isPackaged` is never touched in normal/unit runs.

export function fakeAiEnabled(): boolean {
  return !!process.env['LEDGER_FAKE_AI'] && !app.isPackaged
}

/**
 * e2e seam (ADR-044): treat the forced first-run tutorial as already done so a fresh test DB (no
 * settings.json → `tutorialCompleted` false) doesn't block every spec behind the overlay. `launchApp` sets
 * `LEDGER_SKIP_TUTORIAL` by default; the tutorial spec omits it. Same packaged-off guard as the AI seam.
 */
export function tutorialSkipped(): boolean {
  return !!process.env['LEDGER_SKIP_TUTORIAL'] && !app.isPackaged
}

/**
 * Tier-1 (capture) canned output: one new NPC + one note tagging it (`#0`). Non-empty so the tier-1
 * `ChangesetReview` renders the Entities + Annals sections; the distinct name means use-import defaults
 * it to "create" (no fuzzy match against the campaign's lone main character).
 */
export function fakeExtraction(): RawExtraction {
  return {
    entities: [
      {
        type: 'npc',
        name: 'Aldric Vane',
        description: 'A wary tavern-keeper the party struck a deal with.'
      }
    ],
    notes: [
      {
        content: 'The party met Aldric in the tavern and struck a deal.',
        entityRefs: ['#0'],
        confidence: 'confirmed'
      }
    ],
    statusChanges: []
  }
}

/**
 * Tier-2 (enrich) canned output for one subject: a single trait `add`, anchored to the REAL subject id so
 * it survives enrich's subject-only + field-whitelist post-filter (traits is a universal promoted field)
 * → a non-empty tier-2 review with a Field changes section. Requires the subject's real UUID, which the
 * caller (`enrich.service`) has in scope.
 */
export function fakeEnrichment(subjectId: string): RawEnrichment {
  return {
    relationshipChanges: [],
    fieldChanges: [{ entityRef: subjectId, field: 'traits', op: 'add', value: 'Stubbed by e2e' }]
  }
}

// ---- All-lenses coverage (ADR-043): canned output for the remaining AI lenses. Each matches the exact
// pre-validation shape the lens's validator expects. ----

/**
 * Canned persona brief. Counsel/Converse/Recall call `generatePersona → complete()` (a real Claude call)
 * before their own model call; faking it here lets those lenses run under the seam without a 401.
 */
export function fakePersona(): string {
  return 'A steady, plain-spoken adventurer who leads with curiosity and keeps their word — watches before acting, speaks briefly, and trusts earned loyalty over charm.'
}

/** Counsel "in the moment": EXACTLY 4 narrative options with DISTINCT primary tags — the count
 *  `validateMoment` accepts. Plain English, no D&D mechanics (ADR-048). */
export function fakeSuggest(): MomentSuggestion[] {
  return [
    {
      primaryTag: 'diplomatic',
      secondaryTags: ['patient'],
      title: 'Offer them a way to walk away with their pride.',
      explanation:
        'Propose a compromise that lets both sides back down. You would rather defuse this than win it outright.'
    },
    {
      primaryTag: 'cautious',
      secondaryTags: [],
      title: 'Hold back and watch before you commit to anything.',
      explanation:
        'Read the room first. You trust hard facts over first impressions, and a moment of patience keeps your options open.'
    },
    {
      primaryTag: 'deceptive',
      secondaryTags: ['cunning'],
      title: 'Play along to draw out what they really want.',
      explanation:
        'Feign agreement so they tip their hand. You would rather learn their angle than reveal your own.'
    },
    {
      primaryTag: 'protective',
      secondaryTags: [],
      title: 'Put yourself between the danger and whoever is most exposed.',
      explanation:
        'Shield the person least able to defend themselves, even at a cost to you. Protecting the party comes first.'
    }
  ]
}

/** Counsel "what's next": ≥3 grouped story directions (survives `validateDirections`). */
export function fakeDirections(): StorySuggestion[] {
  return [
    {
      category: 'quest',
      suggestion: 'Follow the unpaid debt back to whoever is really collecting it.',
      rationale: 'Ties the open thread to a face the party can confront.'
    },
    {
      category: 'npc',
      suggestion: 'Pay the tavern-keeper a second visit — they hinted at more.',
      rationale: 'A warm contact is the cheapest lead available.'
    },
    {
      category: 'location',
      suggestion: 'Scout the road out of town before the next nightfall.',
      rationale: 'Sets up the journey and surfaces an ambush or an ally.'
    }
  ]
}

/** Converse: 4 in-character questions with DISTINCT tags, funnel-ordered rapport → secret (survives
 *  `validateConverse`, floor 4). */
export function fakeConverse(): ConverseQuestion[] {
  return [
    {
      question: 'It has been a long road for you — how are you holding up, truly?',
      tag: 'rapport',
      read: 'Opens warmly to earn a little trust before pressing.'
    },
    {
      question: 'What first brought you to this place?',
      tag: 'open-probe',
      read: 'A low-cost prompt that lets them choose what to reveal.'
    },
    {
      question: 'When all of this is over, what are you actually after?',
      tag: 'motivation',
      read: 'Tests whether their stated aims match their real ones.'
    },
    {
      question: 'What is the one thing you are hoping no one here finds out?',
      tag: 'secret-seeking',
      read: 'A high-cost probe — worth the risk only after some rapport.'
    }
  ]
}

/** Draft step 1: a non-empty derived profile (survives `validateDerived`). */
export function fakeDerive(): DerivedProfile {
  return {
    description:
      'A wandering problem-solver shaped by a hard childhood and a stubborn sense of fairness.',
    traits: ['resourceful', 'guarded'],
    goals: ['find out who burned the old district'],
    flaws: ['trusts too slowly to ask for help'],
    voiceExamples: ["I'll hear you out. That's not the same as agreeing."]
  }
}

/** Streamed prose for the two streaming lenses — emitted via the service's existing `onText` callback. */
export const FAKE_RECALL_TEXT =
  'From what the party has recorded, the trail points back to a single unpaid debt and the person quietly calling it in.'
export const FAKE_RECAP_TEXT =
  'The session opened in the tavern, where the party struck a wary bargain with a stranger and agreed to look into a debt no one wanted to claim.'
