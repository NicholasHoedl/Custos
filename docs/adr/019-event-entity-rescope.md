# ADR-019: Re-scope the `event` entity type — world history, not party beats

## Status

Accepted

**Date:** 2026-07-02
**Deciders:** Solo developer

## Context

Ledger has two "event" concepts. The **`event_log` table** is the session log — timestamped beats of
what the party did and experienced at the table ("we stormed the manor", a dropped quote). The
**`event` entity type** is a full graph node (date/outcome/significance attributes, `involves` /
`involved_in` edges, embeddings). Nothing bridges them, their purposes were never delineated, and the
ambiguity shows up in practice: extraction (Import/Backfill) proposes an `event` entity for ordinary
party beats — the live backfill verification created one for a manor raid that is really a session
beat — and the SPEC's original entity list (§4) never included `event` at all. The 2026-07-02 quality
review flagged the two-concept overlap as a modeling smell.

## Decision Drivers

* One clear owner per concept — a captured happening should have exactly one obvious home.
* Reduce extraction ambiguity (the model needs a bright-line test, not taste).
* Zero risk to existing data (the live campaign may contain event entities).
* Keep the graph able to represent world history worth linking to (`involves` edges to actors/places).

## Considered Options

### Option 1: Soft-retire the type
- Remove `event` from creation surfaces + extraction; keep legacy rows readable.
- **Pros:** one concept fewer. **Cons:** loses a genuinely useful node kind — world-scale happenings
  (a war, a razed city) are things other entities relate *to*, which notes can't express as edges.

### Option 2: Hard-retire + migrate
- Convert existing event entities to notes/beats and drop the type.
- **Pros:** cleanest end-state. **Cons:** a data migration against the live campaign for marginal
  gain; destroys the world-history modeling capability.

### Option 3: Re-scope — events are WORLD HISTORY (chosen)
- Keep the type; give it a bright-line definition and align prompts/UI copy to it.

## Decision

**`event` entities are large-scale, world-impacting events**: a city destroyed, a ruler
assassinated, a war declared, a plague, a historically significant happening. They usually do
**not** involve the party. Party-centric happenings — fights, discoveries, rescues, betrayals the
party lived through — belong in the **session log** (`event_log`) and **notes**, even when dramatic,
*unless* the party's deed is itself of world-historical importance (they killed the king).

**The dividing test is scale of impact on the world, not party participation.** `event_log` = the
party's story (table time); `event` entities = the world's history (world time). Other entities
relate to an event via `involves` / `involved_in`.

Applied as guidance, not schema: the extraction prompt (Import/Backfill) instructs the model to
propose an `event` entity only for world-changing happenings and to keep party beats as notes; the
event profile's placeholders read at world scale ("The Sack of Neverwinter"). No schema, relation,
or data changes; existing event rows are untouched and remain valid.

## Rationale

The overlap was never between two mechanisms — it was a missing definition. A scale-of-impact test
gives capture and extraction a bright line ("did the *world* change, or did the *party's day*?"),
preserves the graph's ability to hang relationships off major happenings (which notes cannot do),
and costs nothing: no migration, no type removal, no legacy-row risk. Retirement was rejected
because world-scale events are exactly the kind of node an as-of-aware campaign graph (ADR-017)
benefits from linking to.

## Consequences

### Positive
- One bright-line rule for humans and the extractor; less event-entity noise from Import/Backfill.
- World history stays graphable (edges, embeddings, chronology) — distinct from the party's log.
- Zero data risk; prompt + copy changes only.

### Negative / Risks
- The boundary is prompt-enforced, not schema-enforced — the model (or user) can still misfile a
  happening; review remains the gate (ADR-014/018).
- Existing event entities created under the old, vaguer meaning may read as party beats; they can be
  re-filed manually if they grate (no bulk migration provided).

## Related Decisions

- ADR-014 / ADR-018 — the extraction + review pipelines whose prompts carry this rule.
- ADR-017 — chronology; world events benefit from lifecycle/history like any entity.

## References

- `src/main/services/claude.service.ts` (extraction ENTITIES guidance)
- `src/shared/entity-profiles.ts` (event profile), `src/shared/entity-types.ts`
- `src/main/db/schema.ts` (`event_log` — the party's session beats)
- `../../SPEC.md` §4 (original entity list, which never included `event`)
