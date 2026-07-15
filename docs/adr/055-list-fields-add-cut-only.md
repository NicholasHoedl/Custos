# ADR-055: AI field changes may add/cut a trait, goal, or flaw — never alter one

## Status

Accepted — **implemented**. Refines [ADR-028](028-changeset-field-changes.md) (field changes) and
[ADR-035](035-two-tier-extraction.md) (two-tier extraction); a sibling of [ADR-054](054-enum-only-status-type-aware-lifecycle.md)
(don't let AI passes churn stable profile data). Validator + two prompts + tests + docs; **no schema/DB
change**. Verified: typecheck + lint + unit/integration (55 field-change tests) + e2e.

**Date:** 2026-07-15
**Deciders:** Solo developer

## Context

An entity's **traits / goals / flaws** are a stable set of discrete items, not a progress tracker. But the AI
field-change op set is `add | cut | alter`, and `alter` rewords an existing list item in place — so an AI pass
could turn the goal *"wants to find the Sword of Souls"* into *"…and now knows its location"*. That detail is
**progress**, and progress belongs in a **note** on the entity (or a **quest** entity), not baked into the
goal by editing it. The same churn concern already retired Illuminate's ability to touch `description`
(ADR-054's sibling change).

Two AI passes produce field changes: **Illuminate** (`enrich`) and the **"Draft from backstory"** derive
(`'full'` mode). The tier-1 **Extract** tool (`'capture'`) proposes no field changes at all (closed schema).

## Decision

**A promoted list field (traits / goals / flaws) is ADD/CUT only for AI passes — `alter` is dropped.**
- Enforced once, in the shared validator `validateFieldChanges` (`import.service.ts`): `if (op === 'alter'
  && isPromoted) continue`. Since both `'full'` extraction and Illuminate route through this validator, both
  paths are covered. `add` and `cut` on those lists stay fully allowed.
- Both field-change prompts are reworded to match: `FIELD_CHANGES_INSTRUCTIONS` (extraction) and the FIELD
  CHANGES paragraph inside `ENRICH_INSTRUCTIONS` (Illuminate) now say a trait/goal/flaw is add/cut only,
  never altered — a goal stays as written and its progress goes in a note or quest.
- **`alter` is retained** for a type **attribute** (a creature's `weakness`, a quest's `reward`, a list-kind
  attribute like `abilities`) and, for extraction, `description` — those are facts/reveals, not a progress
  log. The `FIELD_CHANGE_ITEM` schema keeps `alter` in its op enum, and `applyListOp`'s alter branch stays
  (list-kind attributes still use it).

The **manual entity form is unaffected** — the user can still edit a goal by hand. This rule constrains the
AI only.

## Rationale

- A single validator gate is the airtight choke point (both AI paths already share it), mirroring how ADR-054
  enforced enum-only status there. Prompt-only guidance would leave the door open; validator-only would
  waste model effort proposing changes that get dropped — so both.
- Scoping to the promoted lists (`isPromoted`) matches the request exactly and leaves legitimate attribute
  reveals/corrections working.

## Consequences

### Positive
- Goals/traits/flaws stay stable; the AI can grow or prune the list but not rewrite an item, so progress
  lives where it belongs (notes/quests) and the profile doesn't drift.
- No schema or DB change; `add`/`cut` and all attribute/description behaviour are untouched.

### Negative / trade-offs
- A genuinely reworded trait/goal (e.g. fixing a typo) now has to be done by hand, or expressed as a
  cut + add. Forbidding `alter` (not also cut+add) is the exact rule requested; the strengthened prompt also
  steers the model away from reconstructing an edit via cut+add.
- The apply-layer `applyListOp.alter` branch is now dead for promoted lists (still live for list-kind
  attributes) — left in place; an `import-apply` test still exercises it directly and is annotated as an
  apply-layer check.

## Related Decisions

- [ADR-028](028-changeset-field-changes.md) — the add/cut/alter field-change model this narrows.
- [ADR-054](054-enum-only-status-type-aware-lifecycle.md) — sibling: stop AI passes churning stable profile
  data (status/lifecycle there, list fields here).
- [ADR-035](035-two-tier-extraction.md) — which passes propose field changes.

## References

- `src/main/services/import.service.ts` — `validateFieldChanges` (the `isPromoted` alter gate).
- `src/main/services/claude.service.ts` — `FIELD_CHANGES_INSTRUCTIONS` + the enrich FIELD CHANGES paragraph.
- `tests/unit/services/import.service.test.ts`, `tests/unit/services/enrich.service.test.ts`.
