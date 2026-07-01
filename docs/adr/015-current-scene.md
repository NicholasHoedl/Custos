# ADR-015: Current scene — a renderer-selected present moment pinned into grounding

## Status

Accepted

**Date:** 2026-06-30
**Deciders:** Solo developer

*Backfilled record of a decision already implemented — commits `0947681` (current-scene context in
Recall & Suggest) and `d3e87e3` (scene v2: `sceneMode` + the "in the scene" actors). Written now so
this significant, cross-cutting choice has a record, per the ADR convention.*

## Context

Recall and Suggest retrieve by embedding similarity, but "what the table is doing right now" — where
the party is standing, the time of day, who they're facing, whether it's a fight — is rarely the most
*embedding-similar* content, yet it's the strongest lever on a good answer. A tense parley and a knife
fight in the same room want different Recall tempo and different Suggest moves. That present-moment
context isn't in any single note; it's transient table state the player knows and the model can't
infer.

## Decision Drivers

* Ground Recall/Suggest in the *current* situation, not just similar history.
* The present moment must be grounded **regardless of vector score** (similarity won't reliably
  surface it).
* Zero schema cost — the scene is ephemeral, not durable campaign data.
* Reuse the existing graph (a location's contents, a quest's involved NPCs) rather than re-entering
  who's-where by hand.
* Leave the Recall/Suggest call sites structurally unchanged.

## Considered Options

### Option 1: A renderer-selected scene, resolved + expanded in main, pinned into grounding (chosen)
- Sidebar selectors set a `SceneContext`; `resolveScene` expands it and returns a formatted block plus
  a pinned entity set that the gather loops fold in **ahead of** the vector chunks.
- **Pros:** present-moment always grounded; no schema; reuses `getHierarchy`/`listForEntity`;
  Recall/Suggest only prepend the pinned set.
- **Cons:** one more thing to keep current at the table; a bounded expansion can omit some entities.

### Option 2: Persist the scene as a DB row
- **Pros:** survives as history.
- **Cons:** it's ephemeral by nature; a schema + migration for transient UI state is overkill — a
  renderer-persisted blob suffices.

### Option 3: Infer the scene from the latest notes/session
- **Pros:** no manual entry.
- **Cons:** unreliable — the model can't know the party just walked into the throne room; guessing the
  present moment defeats the purpose.

## Decision

Add a renderer-selected **`SceneContext`** (`src/shared/scene-types.ts`): `locationId`,
`embarkedQuestId`, `nearbyPcIds` (party PCs present), `presentEntityIds` (the NPCs/factions being
faced), `sceneMode` (one of combat / social / exploration / stealth / downtime / travel — replacing an
earlier in-combat boolean), and `timeOfDay`. It is picked in the sidebar and **persisted
renderer-side** (an upgradable `ledger.scene` blob; no DB).

`scene.service.resolveScene` (main) turns it into (a) a formatted present-moment **`block`**, (b) a
**pinned** entity set — the location, quest, nearby/active PCs and faced actors, PLUS the location's
contents (`getHierarchy`, capped `MAX_HERE = 10`) and the quest's involved NPCs (`listForEntity`,
capped `MAX_QUEST_INVOLVED = 8`) — and (c) the quest / nearby PCs for Suggest's directions threads.
Recall and Suggest call **`gatherPinned`** to fold the pinned set into their relationship/state
grounding **before** the vector chunks, so scene entities are always present; `sceneMode` also drives a
mode-aware "PRESENT SCENE" nudge in the prompts. An all-empty scene is a no-op (behavior is unchanged
when the feature is unused).

## Rationale

Pinning **separately from retrieval** is the crux: similarity search optimizes for relevance to the
*query*, but the current scene must be grounded whether or not it's similar — so it's injected
directly, not left to the vector store. Expanding through the existing graph means selecting a
location/quest also pulls what's in it and who it involves, so the model sees the neighborhood without
manual re-entry. Keeping the scene renderer-persisted (no schema) matches its ephemeral nature and
costs nothing downstream; `resolveScene` returns plain accumulators the existing gather loops already
understand, so Recall/Suggest needed no structural change.

## Consequences

### Positive
- Present-moment grounding for both AI features; no migration; reuses graph traversal; bounded prompt
  cost; `sceneMode` is a single strong lever on tone/tempo.

### Negative / Risks
- The scene is manual state the user must keep current — a stale scene yields stale grounding.
- Bounded expansion (`MAX_HERE` / `MAX_QUEST_INVOLVED`) can omit some present entities in a very dense
  location.
- The scene lives only in renderer-persisted storage → it is not part of campaign history or exports.

## Related Decisions

- ADR-011 — the recursive-CTE `getHierarchy` traversal reused to expand a location's contents.
- ADR-012 — the brute-force vector store the pinned set is deliberately kept *separate* from.
- ADR-016 — Suggest's output model, which consumes the scene (block + pinned set + directions threads).

## References

- `src/shared/scene-types.ts`; `src/main/services/scene.service.ts` (`resolveScene`, `gatherPinned`)
- `src/main/services/claude.service.ts` (`formatScene`, the mode-aware prompt nudge)
- `src/main/services/recall.service.ts`, `src/main/services/suggest.service.ts` (consumers)
- `../../SPEC.md` §10 (Delivered beyond the MVP)
