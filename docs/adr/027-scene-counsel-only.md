# ADR-027: Scene is Counsel-only; Consult is a scene-free out-of-character notes narrator

## Status

Accepted

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

The "current scene" (ADR-015) — the table's present moment (location, mode, party present, NPCs faced,
embarked quest) — was global state that grounded **both** Consult (Recall) and Counsel (Suggest), yet its
selector only ever lived in the Counsel pane. That left Recall grounded by an **invisible** scene the user
couldn't see or change from the Consult view.

Meanwhile Consult has settled into a specific role: an **out-of-character narrator that answers factual
queries about the notes** (ADR-023 already retired its in-character UI). An in-character, moment-specific
"we're in combat at the inn, at night, facing Glasstaff" context doesn't belong in a factual note-lookup —
it's a *Counsel* concern (deciding how a character acts in this moment), not a *Recall* one.

A relevance pass over the six scene fields also flagged **Time of Day** as the one whose value doesn't
justify a control: a `When: night` line rarely changes the advice, and the scene mode + the situation text
already carry it.

## Decision Drivers

* Match each tool's grounding to its actual job — Recall = notes; Counsel = the in-character moment.
* Don't ground a lens by state its own view can't show or edit.
* Keep the scene lean — drop a field that doesn't earn its control.

## Decision

1. **Remove the scene from Recall entirely.** Recall no longer accepts, pins, or injects the scene: the
   `scene` field is gone from `RecallRequest`; `recall.service` drops the `resolveScene` / `gatherPinned`
   pre-seed and the scene block; Recall's `buildUserContent` loses its `scene` parameter. Recall now grounds
   purely on the **retrieved notes plus their relationships + status** (the anti-hallucination lever from
   ADR-011/017 — "who owns the staff / is this NPC dead" — stays). The **scene is now a Counsel-only
   concept.**
2. **Drop the Time-of-Day scene field.** Remove `timeOfDay` from `SceneContext`, the store, `SceneControls`,
   `resolveScene`, and `formatScene`. The remaining five fields (mode, present entities, party present,
   location, embarked quest) all earn their place — mode steers the advice; present entities target it;
   party-present feeds the Counsel-v2 teamwork option; location/quest pin grounding.
3. **Converse stays target-only** (unchanged) — it grounds by direct fetch of the target, not the scene.

`scene.service` (`resolveScene` / `gatherPinned` / `formatScene`) and `SceneControls` are otherwise
unchanged — Suggest still uses them exactly as before. No migration.

## Rationale

Grounding should follow function. Recall's answers are supposed to be faithful to the notes, so pinning a
moment-specific scene into them muddied a factual tool without a way to see what was steering it. Making the
scene Counsel-only removes that coupling and aligns with Recall's established out-of-character direction.
Pruning Time of Day follows the same "does this earn its keep?" discipline applied to the entity data model
in ADR-026.

## Consequences

### Positive
- Consult is a clean, purely note-driven narrator — no hidden scene skew; simpler `recall.service`.
- The scene is unambiguously a Counsel input; no "invisible grounding" gap.
- Recall keeps its retrieved-entity relationship/status grounding, so dropping the scene does **not**
  reintroduce ownership/resolved-thread hallucinations.

### Negative
- ADR-015's statement that the scene "steers both Recall and Suggest" is now historical — this ADR narrows
  it to **Suggest only**.
- A legacy persisted scene may carry a stale `timeOfDay` key in `localStorage`; the store's `persistedScene`
  now reconstructs only known fields, so it's dropped on next load.

### Risks & Mitigations
- **Recall loses useful location context** → in practice the note retrieval + relationship/state grounding
  already surface the relevant entities; the scene's marginal contribution to a *factual* answer was low.

## Related Decisions

- ADR-015 — current scene; **this ADR narrows its scope to Suggest/Counsel only** (Recall no longer uses it).
- ADR-023 — retired the in-character Recall UI; this continues Recall's out-of-character positioning (the
  dormant in-character `recall.service`/persona path is retained per ADR-023 and is out of scope here).
- ADR-026 — Counsel v2; the scene's five remaining fields feed Counsel's pillar/teamwork/mechanic output.

## References

- `src/shared/recall-types.ts` (`RecallRequest` — scene removed), `src/renderer/src/hooks/use-recall.ts`,
  `src/main/services/recall.service.ts`, `src/main/services/claude.service.ts` (Recall `buildUserContent` /
  `RecallParams`).
- `src/shared/scene-types.ts` (Time of Day removed), `src/renderer/src/store/app-store.ts`,
  `src/renderer/src/components/scene/SceneControls.tsx`, `src/main/services/scene.service.ts`,
  `formatScene` in `claude.service.ts`.
- `../../SPEC.md` §10, `../../ARCHITECTURE.md`.
