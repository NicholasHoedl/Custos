# ADR-054: Enum-only extraction status + type-aware lifecycle terminology

## Status

Accepted — **implemented**. Refines the status/lifecycle model of [ADR-021](021-creature-confidence-lore.md)
(status presets + explicit lifecycle) and [ADR-035](035-two-tier-extraction.md) (tier-1 extraction keeps
status). Two changes: (1) tier-1 **Extract** may only propose statuses from the entity type's curated enum,
with lifecycle derived strictly from the matched preset; (2) the UI's `ended` label is made
**type-appropriate** ("Fallen" reads wrong for a place/quest/item). Main service + shared types + prompt +
renderer + tests + docs; **no migration**. Verified: typecheck + lint + unit (326) + e2e.

**Date:** 2026-07-15
**Deciders:** Solo developer

## Context

Two related rough edges in how an entity's *state* is set and shown:

1. **The AI could set "fallen" out of nowhere.** Tier-1 extraction's `statusChange` schema *required* the
   model to emit a `lifecycle` enum directly, and its `status` was free text. The validator then accepted a
   non-preset status and derived the lifecycle from either the model's own field or a keyword heuristic
   (`lifecycleHeuristic`). So the model could mark an entity `ended`/"fallen" **two ways** with no curated
   status behind it — a free-text "Ruined"/"Slain"/"deceased" (→ heuristic) or the raw lifecycle field. That
   drifted from the design intent (ADR-021): status presets are the curated vocabulary, each carrying an
   explicit lifecycle; the model should pick a *status*, not decide the chronology bucket.

2. **"Fallen" is wrong for most entity types.** `LIFECYCLE_LABELS.ended = "Fallen"` (plus a Skull + blood
   strike) was shown for **every** type. A destroyed location, a disbanded faction, a closed quest, a lost
   item, a concluded event are not "fallen", and a Skull on a place is a category error.

## Decision

**1. Extraction status is ENUM-ONLY; lifecycle is strictly downstream of the chosen preset.**
- The `statusChange` schema drops the `lifecycle` field (model proposes `status` only, now required).
- The prompt tells the model to use exactly one of the type's listed statuses, or omit the status.
- `validateExtraction` snaps every proposed status (baseline + change) to the type's preset via
  `presetStatusFor`; a non-preset status is **dropped**, and the lifecycle comes **only** from
  `preset.lifecycle`. The `validLifecycle`/`lifecycleHeuristic` fallbacks are gone from this path.
- A newly-introduced entity with no preset status defaults to `active` (never an AI-guessed `ended`).

The model can therefore only make an entity `ended`/"fallen" by naming a preset whose lifecycle ends it —
exactly the manual form's behaviour. (The heuristic + the manual "presumed" toggle remain the only paths to
`presumed_ended`; extraction never reaches it.)

**2. Type-aware lifecycle terminology.** A shared `lifecycleLabel(type, lifecycle)` maps the `ended` bucket
to a per-type word via `ENDED_LABELS` — pc/npc **Fallen**, creature **Defeated**, location/item **Destroyed**,
faction **Disbanded**, quest **Closed**, event **Concluded** — and falls back to the neutral `LIFECYCLE_LABELS`
for `active`/`unknown`/`presumed_ended`. The Skull/blood death mark is kept only for the living cast
(`isDeathType` = pc/npc/creature); a location/faction/quest/item/event gets a neutral `CircleSlash` + a muted
strike. The Web view's blanket **"Hide fallen"** toggle becomes **"Hide gone"**. Every lifecycle-label
consumer (EntityDetail, CharacterDashboard, EntityBrowser, EntityHistory, the extract-review StatusChangeRow)
routes through the helper; the extract review threads the entity's type in via a new `refType` resolver.

## Rationale

- The curated presets already carry the right lifecycle per status; letting the model pick a *lifecycle*
  duplicated (and could contradict) that. Dropping the field makes the preset the single source of truth and
  removes the free-text/heuristic escape hatch — an entity's "fallen" state is now always explainable by a
  chosen status.
- The status words are already type-appropriate; the generic `ended` *label* just needed to follow suit. A
  small pure helper keeps the mapping in one place (shared, unit-tested) and every surface consistent.

## Consequences

### Positive
- Extraction can't silently kill an entity via prose; a status change is auditable to a curated preset.
- Re-running extraction stays dedup-safe (a preset status equal to current state is still dropped as a no-op).
- No migration, no new dependency (a neutral lucide icon + the existing label map).

### Negative / trade-offs
- A meaningful but non-preset status the model might have written ("Wounded", "Captured", "Retired") is now
  **dropped** rather than kept as free text. The prompt steers hard to the presets and the review lets the
  user fix it; coarser-but-curated beats free-text-that-can-mislead-chronology.
- `presumed_ended` keeps the generic "Presumed lost" (not type-specialised) — "Presumed defeated/closed"
  reads awkwardly, and it's a rare toggle-only state.

## Related Decisions

- [ADR-021](021-creature-confidence-lore.md) — status presets + explicit lifecycle (the
  contract this tightens).
- [ADR-035](035-two-tier-extraction.md) — tier-1 keeps status because it drives as-of chronology.
- [ADR-017](017-chronology-temporal-model.md) — the lifecycle buckets the labels name.

## References

- `src/main/services/claude.service.ts` — `STATUS_CHANGE_ITEM` schema + `STATUS_CHANGES_INSTRUCTIONS`.
- `src/main/services/import.service.ts` — `validateExtraction` snap-or-drop + `applyChangeset` default.
- `src/shared/entity-types.ts` — `ENDED_LABELS` / `lifecycleLabel` / `isDeathType`.
- `tests/unit/services/import.service.test.ts`, `tests/unit/shared/lifecycle-label.test.ts`.
