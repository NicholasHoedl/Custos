# ADR-038: Entity merge — re-point only, cascade-swept dedup

## Status

Accepted — **implemented** (ROADMAP P1-6). A new `merge.service` collapses a duplicate entity into
another. No migration (reuses existing tables + the delete cascade). Verified: typecheck + lint + full
suite (259 tests; a 7-case merge integration test).

**Date:** 2026-07-09
**Deciders:** Solo developer

## Context

Extraction dedup (ADR-031) *prevents* most duplicate entities, but some slip through anyway — "Sildar"
vs "Sildar Hallwinter". Until now the only repair was delete-and-retype, which loses the duplicate's
notes and ties. The audit flagged the missing merge as the repair path.

## Decision

**Re-point only (decided over "absorb").** Merge moves the LOSER's relationships, notes, chronology
(status history), and event references onto the SURVIVOR, then deletes the loser. The survivor's own
profile fields (description/traits/goals/flaws/attributes) are left untouched — the loser's prose is
discarded (its *notes* survive as the record). Rejected the "absorb" alternative (union traits, fill
empty survivor fields): it needs conflict rules and a re-embed, for marginal benefit. Re-point-only
means the survivor's embedded text is unchanged, so **no re-embedding is required** (the IPC handler
still calls `indexEntity` — a hash-guarded no-op — to keep the seam honest); the loser's embedding row
cascades away on delete.

**Cascade-swept dedup — never an explicit pre-delete.** Two structural hazards a naive endpoint
re-point hits, both avoided by *leaving the colliding loser row in place* so `deleteEntity`'s FK cascade
removes it:
- **`note_entity` composite PK `(noteId, entityId)`:** re-pointing a note the survivor already tags
  would duplicate the PK. Only junctions for notes the survivor doesn't already tag are moved; the rest
  cascade away with the loser.
- **`entity_link` partial unique index** (`link_open_unique_idx` on open `(from,to,relation)`, migration
  0005): re-pointing both endpoints can make a self-loop or an open duplicate. Both are skipped (left to
  cascade). Duplicate detection reuses `findOpenLink` (so inverse-direction equivalents collapse too),
  run through a transaction-scoped `DbContext` (`{ drizzle: tx, raw }`) so it sees edges re-pointed
  earlier in the same loop — a second loser-edge that would duplicate the first is caught.

This "skip, let the cascade sweep" shape is why the merge never issues an explicit delete that could race
the unique index, and why it's a single `ctx.drizzle.transaction`.

**Main-character handling.** If the loser is the campaign's `main_character_id`, the pointer is carried
to the survivor **before** the loser is deleted (otherwise `onDelete: set null` would drop it). Carrying
the crown requires a PC survivor (`resolveMainCharacter`'s invariant); merging the MC into a non-PC is
rejected outright as almost certainly a mistake. The re-point uses a direct `tx.update` on `campaign`
(bypassing `resolveMainCharacter`, the same pattern `import-campaign.service` uses).

**UI.** A **Merge** action on `EntityDetail` opens `MergeEntityDialog`: the current entity is the loser,
you pick the survivor to keep (reusing `EntityPicker`), and a warning states the loser is deleted. On
success the browser refreshes and selection navigates to the survivor. Different-type merges are allowed
but flagged (re-point bypasses `isRelationAllowed`, so a cross-type merge can leave a type-odd tie —
rare, and the dialog warns).

## Consequences

### Positive
- The duplicate-repair path exists without data loss — notes and ties are preserved on the survivor.
- Zero schema change; the delete cascade does the cleanup, so the transaction is small and hard to get
  wrong (no manual multi-table teardown).

### Negative / Risks
- Re-point bypasses `createLink`'s type-allowed check, so a cross-type merge can leave a tie that
  wouldn't be creatable fresh. Accepted (flagged in the dialog; rare); a future pass could re-validate.
- The loser's description/traits are discarded — if the "better" prose was on the loser, the user must
  copy it over first. Accepted per the re-point-only decision.

## Related Decisions
- ADR-031 (dedup prevention — merge is the repair complement), ADR-017 (link intervals + the open-unique
  index this respects), ADR-021 (notes as first-class M2M children that survive), ADR-030 (main-character
  invariant), ADR-014 (the transaction style mirrored).

## References
- Service: `merge.service.ts` (`mergeEntities`); IPC `entity:merge` (`ipc/entity.ts`).
- Renderer: `entities/MergeEntityDialog.tsx`, `entities/EntityDetail.tsx` (the Merge action).
- Test: `tests/integration/merge.test.ts`.
