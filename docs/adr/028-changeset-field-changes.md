# ADR-028: Changeset field changes — add/cut/alter to existing entities' traits, goals, flaws & attributes

## Status

Accepted — **implemented**. Extraction (Chronicle/Transcribe, `withChanges`) now proposes a fourth
change kind: edits to an existing entity's descriptive fields, reviewed and toggled like every other
change and applied in the same transaction. Verified: typecheck + lint + the unit/integration suite
(new validate/apply coverage for add·cut·alter on promoted lists, scalar attributes, and list
attributes; existing-only, off-profile, and unmatched-`oldValue` drops; the prompt/schema carry the
new field).

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

The changeset engine (Import "Transcribe" + Journal "Chronicle", ADR-014/018) proposes new **entities**,
**notes**, **status/lifecycle** changes, and **relationship** form/sever — but it cannot edit an
*existing* entity's descriptive fields. In play, an NPC who starts cautious grows reckless; a creature's
weakness is learned; a faction's alignment is revealed. Today those revisions require opening the entity
form by hand — the extracted narrative can create the fact as a note but can't fold it into the entity's
structured `traits`/`goals`/`flaws` or its per-type `attributes`, which are exactly the fields the AI
lenses (Counsel persona, embeddings, Converse) read. The gap: extraction can *add* structure but never
*revise* it.

## Decision Drivers

* Let extracted text keep an entity's structured fields current, not just append prose notes.
* Reuse the existing changeset pattern (a `Proposed*`/`Confirmed*` shape, a schema branch, a
  validate + apply phase, a hook array, a toggle-able review row) — minimal new surface.
* Nothing written without review; same atomic per-batch apply as every other change (ADR-014).
* Bounded prompt cost — a cut/alter must reference a *real* current item, which the model can only do
  if it sees the entity's current fields, without ballooning the extraction context.
* No schema migration — the `traits`/`goals`/`flaws`/`attributes` columns already exist.

## Considered Options

### Option A: A generic "entity patch" (arbitrary field → new value)
- One change that overwrites any field wholesale.
- **Pros:** fewest types. **Cons:** overwrites lists instead of surgically editing them; the reviewer
  can't see *what* changed; invites edits to `name`/`description`/`lifecycle` that other change kinds or
  the form already own. Rejected — too coarse and it blurs ownership.

### Option B: A dedicated `fieldChange` with an explicit op (chosen)
- `{entityRef (existing only), field, op: add|cut|alter, value, oldValue}` targeting one field with one
  operation; lists edit item-wise, scalars set/clear.
- **Pros:** slots into the existing pattern; the op + `oldValue` make the review row a precise diff;
  existing-only scope keeps new entities' fields owned by creation; no migration. **Cons:** the model
  must echo an existing list item verbatim in `oldValue` (mitigated by showing current items in-context;
  the validator drops mismatches).

### Option C: Chronology-version the field edits (validity intervals per field)
- Track field history the way status/relationships are tracked (ADR-017).
- **Pros:** as-of field reconstruction. **Cons:** large new machinery (per-field intervals, migration)
  for descriptive text that — unlike lifecycle/relationships — has no as-of query demand. Rejected (YAGNI).

## Decision

Add a **fourth change kind, `fieldChange`**, to changeset v2:

1. **Shape.** `ProposedFieldChange { entityRef; field; op: 'add'|'cut'|'alter'; value: string|null;
   oldValue: string|null }` (+ `ConfirmedFieldChange` with `include`). `field` is a promoted list
   (`traits`|`goals`|`flaws`) **or** a per-type attribute key (`weakness`, `alignment`, `abilities`, …).
   The service resolves list-vs-scalar from `entity-profiles`.
2. **Ops.** **add** appends an item / sets a value; **cut** removes the named item / clears the key;
   **alter** rewords an item (`oldValue → value`) / changes a value. For a list cut/alter, `oldValue`
   names the exact existing item.
3. **Existing entities only.** A new entity sets its fields at creation — the validator drops any
   `#index` (proposed) ref.
4. **Not chronology-versioned.** Unlike status/lifecycle + relationships, apply is a plain
   `updateEntity` (no status-history row, no session stamp) run in the same transaction, after
   relationship changes and before notes. Because `updateEntity` **replaces** the whole array/object,
   apply re-reads the entity per change and computes the merged value — so several edits to one field in
   a batch compound correctly (better-sqlite3 sees its own writes within the transaction).
5. **Grounding the prompt.** Extraction's existing-entity context is enriched: for entities the pasted
   text *mentions* (the already name-ranked, capped list), it now renders their current
   traits/goals/flaws + salient attributes, so a cut/alter can copy the exact item. Plain Import
   (`withChanges: false`) is unchanged — no fields are surfaced there.
6. **Validation.** Resolve `entityRef` (existing only); check the op; for a promoted list confirm the
   type's profile allows it (`profileFor`); for a list cut/alter require `oldValue` to match a current
   item (no silent no-ops); coerce `""`→`null`; dedup.

## Rationale

The op-based `fieldChange` is the smallest thing that makes structured revision *reviewable*: the op +
`oldValue` turn each edit into a precise diff row (add chip · struck item · old→new), which is what lets
the human-in-the-loop gate stay meaningful for edits to their own canon — including PCs, where the
review/toggle is the safety. Keeping it existing-only and un-versioned avoids new machinery: descriptive
fields have no as-of demand the way lifecycle does, so a plain `updateEntity` in the existing transaction
suffices. The one real cost — the model must reference a real item to cut/alter — is paid by showing the
current items in-context and dropping mismatches in the validator, bounded by the same name-ranked cap
that already keeps the extraction prompt lean.

## Consequences

### Positive
- Chronicle/Transcribe now keep an entity's structured fields current (traits/goals/flaws + attributes),
  feeding the AI lenses that read them — not just appending notes.
- Pure extension of the changeset pattern; no migration; plain Import untouched.
- Precise, toggle-able diff rows; atomic per-batch apply with the same guarantees as every other change.

### Negative
- The extraction context grows for change runs (current fields of mentioned entities) — bounded by the
  existing name-ranked cap, non-empty fields only, mentioned entities only.

### Risks & Mitigations
- Model echoes an inexact `oldValue` for a cut/alter → the validator drops the mismatch (the model sees
  the current items in-context, so exact matches are expected).
- Unwanted edits to a PC or key NPC → the per-change review/toggle is the gate; the prompt leans
  conservative (only narrated changes; never rename an entity).
- `updateEntity` replaces the whole list/object → apply computes the merged value first and re-reads per
  change so intra-batch edits to one field compound rather than clobber.

## Related Decisions

- ADR-018 — changeset v2 (`withChanges` status/relationship changes); this adds the field-change kind
  alongside them on the same backend and review surface.
- ADR-014 — the extract→review→transactional-apply pipeline this rides.
- ADR-026 — promoted `flaws` + the per-type profile fields that `fieldChange` edits; `profileFor` is the
  list-vs-scalar oracle.
- ADR-017 — chronology; deliberately *not* extended here (field edits aren't as-of versioned).

## References

- `src/shared/import-types.ts` — `FieldChangeOp`, `ProposedFieldChange`, `ConfirmedFieldChange`,
  `ExtractionProposal.fieldChanges`, `ConfirmedChangeset.fieldChanges`, `ApplyResult.fieldChangesApplied`.
- `src/main/services/claude.service.ts` — `CHANGES_INSTRUCTIONS` (FIELD CHANGES), `extractionSchema`,
  `buildExtractionUserContent` (existing-entity field enrichment), `ExtractExistingEntity`.
- `src/main/services/import.service.ts` — `validateExtraction` (field-change section, `attrStringArray`),
  `applyChangeset` (field-change phase, `applyListOp`, `fieldChangePatch`).
- `src/renderer/src/hooks/use-import.ts`, `.../capture/import-rows.tsx` (`FieldChangeRow`),
  `.../capture/ChangesetReview.tsx` — the review surface.
- Tests: `tests/unit/services/import.service.test.ts`, `tests/integration/import-apply.test.ts`,
  `tests/unit/services/extract-prompt.test.ts`.
