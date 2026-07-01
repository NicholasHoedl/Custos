# ADR-016: Suggest output model v2 — multi-tag moments + a directions mode (supersedes ADR-009)

## Status

Accepted — **supersedes [ADR-009](009-suggest-output-model.md)**.

**Date:** 2026-06-30
**Deciders:** Solo developer

*Backfilled record of decisions already implemented — commits `53a6228` (the open-ended "directions"
mode) and `60e33a6` (the multi-tag in-the-moment overhaul). ADR-009's **mechanism** — structured
output + code-side validation on Opus 4.8 with adaptive thinking — is retained; what this supersedes is
the **shape** of the output.*

## Context

ADR-009 modeled Suggest as a single call returning **4 of 7 fixed attitudes** (Neutral, Friendly,
Hostile, Moral, Selfish, Compassionate, Cynical), one in-character action each. In use, two limits
showed:

1. Seven coarse attitudes flatten characters — a dwarf paladin's "hostile" reads like a rogue's, with
   no room for *how* a move is flavored (cunning, honorable, primal) or for leaning into who the PC is.
2. "In the moment" answers a charged situation, but the more common table question is open-ended —
   "we're between beats, what could happen next?" — which the attitude model can't express.

## Decision Drivers

* Richer, character-specific flavor than 7 fixed attitudes, still constrained to a known vocabulary
  (chip-renderable, no free-text sprawl).
* Distinct, non-redundant options (avoid the "four near-identical attitudes" failure).
* A second, open-ended mode for story progression, not just reaction.
* Keep ADR-009's reliable mechanism: structured output + **code-side** count/uniqueness validation
  (JSON-schema still can't bound array length or uniqueness).

## Considered Options

### Option 1: Keep 4-of-7 fixed attitudes (ADR-009 as-is)
- **Cons:** too coarse; no flavor nuance; single-mode (documented above).

### Option 2: Free-text attitude labels
- **Pros:** unlimited nuance.
- **Cons:** unbounded/unstable labels; not a fixed chip vocabulary; no enum to validate against.

### Option 3: A bounded tag vocabulary, multi-tag per option, + a separate directions mode (chosen)
- A 62-tag pool (disposition + the PC's own race/class); each moment option carries 1 primary + ≤2
  secondary tags; a distinct-primary set of 8. A sibling `directions` mode returns categorized
  open-ended moves.
- **Pros:** far richer yet still bounded/validatable; leans into the PC (race/class tags); covers both
  question-shapes.
- **Cons:** more validation surface; race/class legality is prompt-enforced, not schema-enforced.

## Decision

Replace the 7-attitude enum with **`SUGGEST_TAGS`** (`src/shared/suggest-types.ts`) — **62 tags**: 40
`DISPOSITION_TAGS` (friendly, cunning, honorable, vengeful, primal, …) + 10 `RACE_TAGS` + 12
`CLASS_TAGS`. Suggest gains a **`mode`**:

- **`attitudes`** ("in the moment") — returns **exactly 8** `MomentSuggestion`s, each
  `{ primaryTag, secondaryTags (≤2), action, rationale }`, with **distinct primary tags**.
  `validateMoment` (suggest.service) enforces exactly-8 + distinct primaries + non-empty
  action/rationale and cleans secondaries (valid enum, deduped, ≤2, ≠ primary); **one retry**, else
  `invalid`. Race/class tags are constrained to the PC's OWN race/class **by the prompt** (from
  `attributes.ancestry` / `attributes.class`); validation accepts any enum tag, so a stray foreign tag
  is cosmetic, not a failure.
- **`directions`** ("what's next") — returns a variable set (**≥3, capped ~10**) of `StorySuggestion`s,
  each `{ category, suggestion, rationale }` over 8 `SUGGEST_CATEGORIES`
  (quest / npc / location / party / personal / story / faction / item), grounded in the campaign's open
  quests + the rest of the party. `validateDirections` drops malformed entries and requires ≥3; one
  retry, else `invalid`.

Both remain **single-shot structured** calls on the settings-selected model (Opus 4.8 default) with
adaptive-thinking `effort` — ADR-009's mechanism, unchanged. Both also fold in the current scene (see
ADR-015): the scene block + pinned entities enter grounding ahead of the retrieved chunks.

## Rationale

A bounded tag vocabulary keeps the reliability ADR-009 bought (enum-constrained, chip-renderable,
code-validatable) while dissolving its main weakness — coarseness — via multi-tagging and race/class
flavor. Moving from "4 of 7" to "8 distinct primaries" widens the spread the player chooses from
without letting options collapse into duplicates. `directions` is a genuinely different question
(progression vs. reaction), so it's a sibling mode with its own looser validation (no natural fixed
count) rather than a forced fit into the attitude shape. Keeping race/class legality in the prompt (not
the schema) mirrors ADR-009's finding that the hard constraints live in code/prompt, not JSON-schema.

## Consequences

### Positive
- Richer, character-specific, still-bounded options; a wider 8-way spread; a second open-ended mode;
  ADR-009's validated-structured-output mechanism preserved.

### Negative / Risks
- The exact-8-distinct-primaries rule is the main churn risk — an occasional retry or `invalid`; relax
  `validateMoment` to a floor if it nags.
- Race/class tags aren't schema-enforced to the PC → a foreign tag can slip through as cosmetic.
- A larger vocabulary means a bigger prompt and more room for near-duplicate flavor.

## Related Decisions

- **Supersedes ADR-009** (4-of-7 fixed attitudes) — same structured-output/code-validation mechanism,
  new output shape.
- ADR-015 — the current scene consumed by both modes.
- ADR-008 — request/response over the typed IPC layer (Suggest does not stream).
- ADR-012 — the hybrid dense + fuzzy retrieval that feeds grounding.

## References

- `src/shared/suggest-types.ts` (`SUGGEST_TAGS`, `MomentSuggestion`, `StorySuggestion`, `SuggestMode`,
  `SUGGEST_CATEGORIES`)
- `src/main/services/suggest.service.ts` (`validateMoment`, `validateDirections`, retrieval + retry)
- `src/main/services/claude.service.ts` (`suggest`, `suggestDirections` — schemas/prompts)
- `src/renderer/src/components/views/SuggestView.tsx`
- `009-suggest-output-model.md` (superseded); `../../SPEC.md` §10 (Delivered beyond the MVP)
