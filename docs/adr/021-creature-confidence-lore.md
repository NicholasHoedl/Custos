# ADR-021: Creature type, `presumed_ended` lifecycle, note confidence, and entity-less campaign lore

## Status

Accepted

**Date:** 2026-07-06
**Deciders:** Solo developer

## Context

Dogfooding against a real set of messy player notes (Thundertree / Phandalin) exposed four gaps where
the data model could not hold what a table actually records:

1. **Monsters have no home.** A dragon, an undead swarm, or a plant-hazard is not a person, yet the only
   creature-ish type was `npc`. Filing a monster as an NPC gave it a social persona it shouldn't have and
   no place for tactics / abilities / weakness.
2. **Everything is asserted as flatly true.** Real notes hedge — "Dead **potentially**", "demon
   web**???**", a rumor overheard in a tavern. The model treated every note as fact, so Recall/Suggest
   could assert a rumor or a *presumed* death as certain — a direct violation of the grounding-honesty
   bar (ADR-017): the AI must never claim more certainty than the record holds.
3. **Presumed-dead had no coarse state.** Lifecycle was `active | ended | unknown`. "We think the boss
   died in the collapse, but never saw a body" is neither cleanly `ended` (unconfirmed) nor `unknown`
   (we have a strong belief) — the AI needs to *hedge*, not assert.
4. **World facts belong to no entity.** "The runes mean *beware*", "the Harpers work independently" —
   lore that is true of the campaign, owned by no single entity. Yet a note required ≥1 entity, so this
   kind of fact had nowhere to live.

These surfaced together from one gap analysis and are recorded here as one decision with four parts.

## Decision Drivers

* Capture what tables actually write, without inventing heavyweight machinery.
* Preserve the grounding-honesty invariant (ADR-017): never assert beyond the record's certainty.
* Minimize migration risk against the live campaign (only one column-adding change is unavoidable).
* Reuse the existing seams — free-text type/lifecycle columns, the RAG document-title injection point,
  the FK-off-around-migrate table-rebuild pattern (ADR-004).

## Considered Options

### Creature
- **`npc` sub-kind (attribute flag)** — no new type, but pollutes NPC surfaces (persona, in-character
  Recall) with non-persons and hides monsters from type filters.
- **New first-class `creature` type (chosen)** — `entity.type` is free-text TEXT (no CHECK), so a new
  type needs *no migration*; `Record<EntityType,…>` maps force exhaustive labels/profiles at compile
  time, and the extraction enum `[...ENTITY_TYPES]` auto-includes it.

### Presumed-ended
- **Reuse `unknown`** — loses the "we believe it's gone" signal; the AI can't hedge specifically.
- **Add `presumed_ended` (chosen)** — a fourth free-text lifecycle value (no migration), *set
  explicitly* by the user/extractor, never derived (see Decision).

### Note confidence
- **A boolean `rumored` flag** — too coarse; can't distinguish a secondhand rumor from the party's own
  hypothesis.
- **`confidence = confirmed | rumored | suspected`, default `confirmed` (chosen)** — one column, three
  states, injected into the RAG document title so the model hedges.

### Entity-less lore
- **A `lore` entity type** — a fake entity per world-fact; clutters the graph and the type filters.
- **First-class `note.campaignId`, relax the ≥1-entity rule (chosen)** — a note becomes a campaign
  child in its own right; tagging entities stays optional (0..N).

## Decision

**1. `creature` is a new first-class entity type.** Its profile carries `abilities` (list), `tactics`,
`weakness`, `habitat` — not a social persona. PC-only features (persona, in-character voice) skip it. No
migration (free-text `entity.type`).

**2. `presumed_ended` is a fourth lifecycle value**, meaning *believed gone/dead but UNCONFIRMED*. It is
**set explicitly**, never derived: `lifecycleHeuristic` (which backfills lifecycle from free-text status
in migration 0005) is left **unchanged**, preserving the invariant that the heuristic mirrors the 0005
SQL `CASE` (asserted by `chronology.service.test.ts`). In `formatState` a `presumed_ended` entity is
surfaced with the marker `[presumed ended — unconfirmed]`, distinct from `[ended]`, so the AI hedges.

**3. Notes carry `confidence = confirmed | rumored | suspected`** (default `confirmed`). It is injected
into the **citeable RAG document title** — `Entity — Session 3 · (rumored)` / `· (suspected)`, nothing
for confirmed — across Recall, Suggest, and Directions, so the model is told to hedge rather than
asserting a rumor/hypothesis as fact. Extraction proposes it (from "?", "potentially", "presumably");
the user can set it on any note.

**4. Notes are first-class campaign children via `note.campaignId`** (NOT NULL, FK cascade). The
≥1-entity rule is relaxed: a note MAY tag **0..N** entities. An untagged note is **campaign lore** — a
world-fact owned by no entity. It still embeds and retrieves; in retrieval its entity fields are **null**
and the Recall UI shows it as a non-clickable "Campaign lore" source. `deleteOrphanNotes` is deleted:
an entity delete now simply drops the `note_entity` link (the note survives as lore), and a campaign
delete cascades notes via the new FK.

**Migration 0006** (the one unavoidable schema change) rebuilds the `note` table (SQLite can't
`ALTER ADD` a NOT-NULL FK column with a per-row value) to add `campaign_id` + `confidence`, backfilling
each note's `campaign_id` from its tagged entity's campaign. It follows the 0004 table-rebuild
precedent under the FK-off-around-migrate guard (ADR-004), with a prepended `DELETE` of any pre-existing
linkless note so the NOT-NULL backfill can't abort.

## Rationale

Three of the four parts cost **no migration** because the schema was already built for open extension:
free-text `type`/`lifecycle` TEXT columns (a deliberate ADR-017 choice) and `Record<Union,…>` maps that
turn "add a value" into a compile-time checklist. Confidence rides the *existing* grounding seam — the
document title the model already cites — so hedging needs no new prompt scaffolding, only a suffix. The
honesty invariant is strengthened, not bent: `presumed_ended` and `rumored`/`suspected` give the model
*more* ways to be appropriately uncertain, and the heuristic stays frozen so the 0005 mirror holds.

Making notes first-class (`campaignId`) rather than adding a `lore` entity keeps the graph clean (no
fake nodes) and matches how tables think — a lot of what gets written is world-truth, not a fact *about*
someone. The nullable-entity retrieval path is the price: `RetrievedChunk` / `RecallSource` entity fields
become nullable and every grounding/dedup/render consumer learns to skip or label the entity-less case.

## Consequences

### Positive

- Monsters, rumors, presumed deaths, and world-lore all have a natural home; capture matches reality.
- The AI hedges rumors/hypotheses/presumed-deaths instead of asserting them — the grounding-honesty bar
  holds under messier input.
- Only one migration; three of four features are pure additive TEXT/label changes.
- Lore notes enrich Recall, Recap, and Export for free (they flow through the same note paths).

### Negative

- `note` gained a table rebuild (0006) — a destructive-shape migration, mitigated by the FK-off guard +
  three migration tests (backfill, orphan-guard, FK-on tripwire).
- Nullable entity fields ripple through retrieval; every consumer now guards `entityId === null`.

### Risks & Mitigations

- **Backfill picks the wrong campaign for a cross-campaign note** → notes are always created within one
  campaign and only tag same-campaign entities, so the `LIMIT 1` subquery is deterministic and correct;
  a linkless pre-0006 note is deleted first so it can't backfill NULL and abort the transaction.
- **A `presumed_ended` value drifts from the heuristic** → it is set-only, never derived; the heuristic
  is frozen and covered by `chronology.service.test.ts`.
- **The model over-hedges confirmed facts** → only `rumored`/`suspected` inject a tag; `confirmed`
  (the default, the overwhelming majority) reads exactly as before.

## Related Decisions

- ADR-017 — chronology + the grounding-honesty bar this extends (lifecycle, `formatState`, as-of clamp).
- ADR-004 — SQLite + Drizzle + the FK-off-around-migrate table-rebuild pattern reused by 0006.
- ADR-012 — the brute-force vector store whose `search()` now LEFT-JOINs the entity for lore notes.
- ADR-014 / ADR-018 — the extraction/apply pipelines that now propose `confidence` (but still require
  ≥1 entity for an *extracted* note — an entity-less extracted note is noise).

## References

- `src/shared/entity-types.ts` (`EntityType` + `creature`, `Lifecycle` + `presumed_ended`,
  `NoteConfidence`, `Note.campaignId`), `src/shared/entity-profiles.ts` (creature profile)
- `drizzle/0006_medical_wildside.sql` (note table rebuild), `src/main/db/schema.ts`
- `src/main/services/note.service.ts` (relaxed ≥1 rule, plain campaign/session selects),
  `src/main/services/vector-store.service.ts` (nullable-entity retrieval, `note.campaignId` scope)
- `src/main/services/claude.service.ts` (`chunkTitle` confidence injection, `formatState` marker)
- `src/main/services/{recall,suggest,entity,campaign}.service.ts` (grounding guards, dropped cascade)
- `tests/integration/migrations.test.ts` (0006 backfill / orphan-guard / FK-on tripwire)
- `../../SPEC.md` §10 (Delivered beyond the MVP), `../../ARCHITECTURE.md` (data model)
