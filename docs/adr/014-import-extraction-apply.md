# ADR-014: Import — LLM extraction with human-in-the-loop transactional apply

## Status

Accepted

**Date:** 2026-06-30
**Deciders:** Solo developer

## Context

The graph is only as valuable as what's entered, and entity-by-entity typing is the friction wall
that keeps it sparse. Players already have raw text — session notes, a chat log, a backstory doc.
Import turns that into structured entities + notes. The hard parts: never writing unreviewed AI
output as canon, not duplicating existing entities, and applying a batch safely. (v1 scope:
entities + notes; relationship extraction deferred.)

## Decision Drivers

* **Nothing written without human confirmation** (the model proposes; the user disposes).
* **Dedup** proposed entities against existing ones (link vs. create).
* **Atomic** apply — a partial import must never persist.
* Reuse the existing write services + fuzzy matcher + embedding indexer.
* Structured, parseable extraction.

## Considered Options

### Option 1: Two-phase extract → review → transactional apply (chosen)
- `extract`: one structured Claude call → a validated/deduped proposal; review UI edits it;
  `apply`: one DB transaction.
- **Pros:** human-in-the-loop by construction; atomic; reuses `createEntity`/`createNote`,
  `nameMatchScore`, and `indexEntity`/`indexNote`.
- **Cons:** more moving parts (a proposal/confirmed type split; temp-id bookkeeping).

### Option 2: Auto-apply the model's output
- **Pros:** one step.
- **Cons:** writes hallucinations/duplicates as canon — unacceptable.

### Option 3: Renderer creates each item via the existing per-item IPC calls
- **Pros:** no new service.
- **Cons:** N round-trips; no atomicity (a mid-batch failure leaves half an import);
  ref-resolution logic leaks into the renderer.

## Decision

A **two-phase** flow. `import.service.extract` sends the paste + a bounded existing-entity list to
Claude via a new `structuredObjectCall` (multi-array structured output; sibling of
`structuredArrayCall`), then **validates and dedups in code** into an `ExtractionProposal`.
Proposed (not-yet-created) entities are referenced by **local index** — `"#0"`, `"#1"` in the
model's JSON; existing entities by real id — normalized to an `EntityRef` union. Dedup surfaces
existing matches via the exported `nameMatchScore`/`FUZZY_THRESHOLD` (reused from Recall's fuzzy
search, ADR-012); a strong (≥0.9) match defaults the item to "link". The user reviews every item,
then `import.service.applyChangeset` writes the confirmed set in **one `ctx.drizzle.transaction`**
(entities first into an index→id map, then notes resolving their refs and attaching the active
session). Any create throw rolls the whole batch back and rethrows; `indexEntity`/`indexNote` run
**after commit** (fire-and-forget — they read the row back, so a rolled-back row must never be
queued).

## Rationale

Extraction is probabilistic, so the only safe design writes nothing without review — hence the
proposal/confirmed split. Doing validation/dedup in code (not the schema) mirrors ADR-009's
finding that JSON-schema can't bound counts/uniqueness. The single transaction gives
all-or-nothing safety for a multi-row apply; post-commit indexing avoids embedding rows a rollback
erased. Temp-id-by-index lets notes reference entities that don't exist yet without a pre-insert.

## Consequences

### Positive
- No unreviewed writes; atomic apply; existing-entity dedup; reuses services/matcher/indexer; no
  DB migration.

### Negative / Risks
- Hallucinated entities/notes → gated entirely by per-item review.
- Dedup false positives → 0.5 only *surfaces* candidates; default is "create" unless a ≥0.9 match;
  the user flips link↔create.
- Large pastes cost tokens / can truncate → soft character warning in the UI; chunking is a
  follow-up.
- Relationship extraction deferred → stated relationships survive as note prose in v1; the temp-id
  model + transaction already support adding a `relations[]` step later.

## Related Decisions

- ADR-008 — request/response over the typed IPC layer (import is two single-shot calls, no stream)
- ADR-009 — structured output + code-side validation (import extends it with `structuredObjectCall`)
- ADR-012 — the brute-force cosine store's `nameMatchScore`, reused for dedup
- ADR-004 — SQLite / better-sqlite3 transaction used for the atomic apply

## References

- `src/main/services/import.service.ts` (extract/validate/dedup + `applyChangeset`)
- `src/shared/import-types.ts` (`EntityRef`, proposal/confirmed/result types)
- `src/main/services/claude.service.ts` (`structuredObjectCall`, extraction prompt/schema)
- `src/renderer/src/components/views/ImportView.tsx`; `src/renderer/src/hooks/use-import.ts`
- `../../SPEC.md` §10 (Delivered beyond the MVP)
