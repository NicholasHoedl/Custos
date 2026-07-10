import { app } from 'electron'
import type { RawExtraction } from '@shared/import-types'
import type { RawEnrichment } from '@shared/enrich-types'

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
