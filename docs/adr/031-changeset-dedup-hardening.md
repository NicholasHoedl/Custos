# ADR-031: Changeset dedup hardening — near-duplicate notes, already-live ties, and no-op changes

## Status

Accepted — **implemented**. `validateExtraction` (the shared changeset validator behind Chronicle,
Transcribe, and the backstory Suggest) now deduplicates every proposal kind against BOTH the batch and
the campaign's existing data. Resolves the dedup follow-up ADR-018 explicitly deferred ("duplicate notes
on re-runs are only review-gated — hash-dedup is a follow-up"). Verified: typecheck + lint + the full
suite (200 tests; 5 new covering each dedup path).

**As-built addendum (same day) — status preset snapping:** testing surfaced statuses the pickers don't
offer ("active" on a pc whose presets are Active/Inactive/Dead), which also slipped the no-op drop on
casing. The extraction prompt now lists each type's curated status presets (a `STATUS_VOCAB` generated
from `ENTITY_PROFILES`, so it can't drift; free text stays allowed), and the validator/apply **snap a
case-insensitive preset match to the canonical label + the preset's EXPLICIT lifecycle** — the same
mapping the form's combobox applies, the preset winning over a contradictory model lifecycle, and the
only path to `presumed_ended` (npc "Missing" → *presumed lost*; the heuristic never derives it, ADR-021).
The no-op drop then operates on normalized values, so "active" proposed on an "Active" character vanishes.

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

An audit of the Suggest surfaces' duplication defenses found the ENTITY path strong (intra-batch
type+name collapse; trigram fuzzy matching against existing entities with an auto-Link default at ≥0.9;
the prompt lists existing ids) — but everything else leaked on re-runs or overlapping imports:

* **Notes had no dedup at all** — re-running the backstory Suggest, or re-pasting overlapping session
  notes, duplicated notes verbatim (the known ADR-018 gap). Duplicated notes double-count in retrieval.
* **Relationship proposals** ignored existing edges: an already-live tie re-appeared in every review
  (apply was idempotent via `findOpenLink`, so no duplicate row — but it was review noise and re-runs
  re-proposed everything). Intra-batch dedup keyed on the exact tuple, so the SAME tie authored from
  both directions ("A ally_of B" + "B ally_of A", or "A located_in B" + "B contains A") showed twice.
* **Status changes** equal to the entity's current state survived review (a guaranteed no-op at apply —
  `updateEntity` only appends history when something changed).
* **Scalar field changes** setting a value already there (or clearing an empty key) survived review.

## Decision

Harden `validateExtraction` (all deterministic, before anything reaches the review):

1. **Notes** — compare each proposal against the campaign's existing notes (`listAllNotes`) and the
   batch so far, on a normalized form (lowercase, punctuation/whitespace-insensitive):
   - **Exact normalized match → dropped outright** (it is already recorded; zero value).
   - **Near-duplicate** (meaningful-token Jaccard ≥ **0.8**) → kept but flagged
     **`possibleDuplicate`**; the review seeds it **unchecked** with a "Possible duplicate" badge, so
     keeping it is an explicit opt-in. Flagging (not dropping) preserves the human-in-the-loop guarantee
     for the fuzzy zone.
2. **Relationships** — a `form` between two EXISTING entities whose live equivalent edge exists
   (`findOpenLink`, inverse-aware) is **dropped**; a severed edge can still be re-formed (only OPEN
   intervals match). Intra-batch dedup now keys on a **direction-independent canonical form**
   (`canonicalRelKey`: lexicographic min of the forward and inverse authorings), collapsing symmetric
   and directed-pair double-authoring.
3. **Status changes** — a proposal equal to an existing entity's CURRENT lifecycle+status
   (null-normalized) is **dropped** (guaranteed apply no-op).
4. **Scalar field changes** — add/alter to the current value, and cut of an empty key, are **dropped**
   (list-kind fields already had item-level guards, ADR-028).

Net effect: re-running the same text yields an (almost) empty changeset — entities auto-Link, verbatim
notes vanish, reworded notes arrive unchecked, recorded ties/states never re-surface — and the "empty"
result reads as "nothing new found."

## Rationale

Dedup belongs in the validator, not the prompt: the model can't reliably know what's recorded, and the
validator can check deterministically. The one fuzzy judgment (a reworded note) is surfaced as a
default-off flag rather than silently dropped, keeping ADR-014's review-gate philosophy intact — exact
duplicates carry no information, so silence there is correct. The tie/status/field drops remove only
guaranteed no-ops, so nothing a user could have wanted is lost.

## Consequences

### Positive
- Re-runs and overlapping imports no longer accumulate duplicate notes or re-propose recorded ties.
- Review changesets are signal-dense; "empty" now genuinely means "nothing new."
- Purely additive validator logic — no schema change, no prompt change, apply untouched.

### Negative / Risks
- Token-set similarity can flag two SHORT notes that share words but differ in meaning ("Mira trusts
  Victor" vs "Victor trusts Mira") — mitigated: flagged notes are one click to re-include, never dropped.
- `findOpenLink` lookups during validation add per-proposal DB reads — negligible at this scale
  (synchronous better-sqlite3, tens of proposals).

## Related Decisions

- ADR-018 — changeset v2; this resolves its explicitly deferred note-dedup follow-up.
- ADR-028 — field changes (list-level guards this extends to scalars).
- ADR-030 v3 — the backstory Suggest + standing-ties capture that made re-run dedup pressing.
- ADR-014 — the review-gate philosophy the near-dupe flag preserves.

## References

- `src/main/services/import.service.ts` — `validateExtraction` (note/status/relationship/field
  sections), `normalizeNoteText` / `noteTokens` / `jaccard` / `NOTE_DUP_THRESHOLD` / `canonicalRelKey`.
- `src/shared/import-types.ts` — `ProposedNote.possibleDuplicate` / `ConfirmedNote.possibleDuplicate`.
- `src/renderer/src/hooks/use-import.ts` (include seeding), `components/capture/import-rows.tsx` (badge).
- Tests: `tests/unit/services/import.service.test.ts` ("dedup hardening (ADR-031)").
