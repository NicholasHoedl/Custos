# ADR-035: Two-tier extraction — 'capture' note-taker + the manual "Illuminate" enrichment pass

## Status

Accepted — **implemented**. Extraction runs in one of two modes; a new per-entity enrichment service
("Illuminate", code name `enrich`) fills in profiles + ties from accumulated notes. No migration (the
`withChanges` boolean becomes a TypeScript-level `ExtractionMode`; enrichment reuses every existing
column and the existing apply transaction). Verified: typecheck + lint + the full suite (238 tests; new
coverage for the mode matrix, the enrich prompt/validation, and the Illuminate apply path).

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

The single extraction call (Chronicle + Transcribe, `withChanges: true`) juggled ~5 reasoning jobs at
once — spot entities, dedup them against the roster, write notes, dedup notes, and infer status + ADR-033
relationship ties + ADR-028 field changes — often from a single journal line. The overloaded prompt
degraded all of them, and the subjective fields (traits/goals/flaws/ties) were being inferred from the
one sentence that happened to mention an entity rather than from everything known about it.

## Decision

**Tier 1 — 'capture' (user-initiated; the Chronicle "Close out session" wizard + Transcribe).**
`ExtractionMode = 'capture' | 'full'` replaces `withChanges`. Capture proposes **entities + notes +
statusChanges only** — the schema *omits* the tie/field arrays (closed `additionalProperties:false`, so
the model cannot emit them), the system prompt drops those instruction blocks, and the roster context
stops surfacing current fields. **Status stays in tier 1** because it drives as-of chronology (ADR-017).
`'full'` (all five arrays) survives for exactly one caller — backstory step 2 (DeriveReview), which
needs undated MC-anchored ties in one pass and has no session for a later Illuminate run to target.

**The close-out ritual (as-built revision).** Chronicle entries save as **plain log lines** — no
per-entry extraction (the original draft ran tier 1 automatically per entry; revised before ship).
Extraction is deliberate: the Chronicle header's **"Close out session"** opens ONE locked wizard
(`CloseOutDialog`) that joins the session's chronicle entries oldest-first, runs a single tier-1
extraction over the whole log, reviews it, applies it stamped at the session, then **chains straight
into Illuminate** (scan runs after tier-1 apply commits, so it sees the fresh notes) — checklist →
per-entity sweep → ties/fields review → apply. The wizard is dismissable ONLY by approving or rejecting
(Esc/overlay/X are inert; rejects confirm; hard failures always offer a plain Close — never trap). The
review runs the shared `ChangesetReview` with its opt-in volume features: **bulk tri-state per-section
toggles** and a **compact density pass**. Close-out is re-runnable (ADR-031 dedup) and the session
stays active — no `closed` flag, no migration. The standalone Illuminate on the Sessions view remains
the surgical re-run path.

**Tier 2 — "Illuminate" (manual, per session; SessionsView).** A pre-flight checklist lists the
session's **touched entities** (derived from `listNotesForSession`'s entityIds with note counts —
chronicle events never carry an entityId in practice, so notes are the record). Each checked entity gets
**one focused model call** (`enrich.service.enrichEntity` → `enrichChangeset`) grounded in its **full
note history** (newest 30, rendered oldest-first), current profile, live ties (id-bearing lines — a
sever must reference the far endpoint by real id), and the roster. The model proposes ONLY
`relationshipChanges` + `fieldChanges`, referencing **real ids** (never `#index`; never new
entities/notes/status; never name/type changes). The renderer sequences the calls (progress per row;
cancel between entities; a key/offline failure aborts the remainder), **merges** proposals (cross-entity
tie dedup via the relation's `inverseKey` canonical form — enriching both endpoints can propose the same
edge twice), and reviews them in the shared `ChangesetReview` (only the Relationships + Fields sections
render). Apply reuses `import.apply` with empty entities/notes/status arrays, **stamped at the enriched
session** — ties open their interval at session N, never leaking knowledge backwards.

**Shared validation, factored.** The tie/field validation rules (ADR-031 live-edge/no-op/dedup drops +
ADR-033 caps) moved out of the monolithic `validateExtraction` into exported
`validateRelationshipChanges` / `validateFieldChanges` over a `ChangeValidationCtx` (resolveRef /
refKey / typeOfRef / entityByRef / isLiveLink). Import builds the ctx from its `#index`+id closures;
enrich builds a **real-id-only** ctx. Pure refactor for import (its tests pass unmodified); enrich adds
two post-filters: every field change must target the subject **and** a whitelisted field
(`description|traits|goals|flaws` ∪ the type's `profileKeys` — an automated sweep must not invent
attribute keys), and every tie must include the subject.

**`description` becomes a first-class field-change target.** It was silently misrouting into the
`attributes` JSON bag (a latent bug — the validator and `fieldChangePatch` only knew promoted lists and
profile attributes). Both now handle `description` as the real scalar column; only the enrich prompt
advertises it.

**Result semantics.** A per-entity enrichment returning nothing is `ok: true` with empty arrays —
"nothing new" is the *expected* steady-state of a sweep (deliberately unlike `ExtractResult`'s `'empty'`
failure). Re-running Illuminate is safe: the ADR-031 dedup rules drop everything already recorded.

**Naming.** User-facing label **"Illuminate"** (the illuminated-manuscript register beside
Chronicle/Codex/Annals); code name `enrich` everywhere (`enrich.service`, `ipc/enrich`, `enrich:*`
channels, `use-enrich`, `EnrichDialog`) — the same label↔code split as Transcribe↔import.

## Consequences

### Positive
- Each call does ONE job: live capture is frictionless (zero AI at the table — entries just save);
  tier 1 reads the WHOLE session's log at once (better narrative context than a lone line); enrichment
  reasons over the accumulated record — the grounding win that motivated the split.
- Review happens once per session in a surface built for volume (bulk toggles, compact rows), not as a
  drip of small inline reviews.
- Cost is visible and user-controlled (one deliberate ritual; the checklist chooses the sweep size).
- The description misroute is fixed for the full mode too.

### Negative / Risks
- **Forgotten close-out:** nothing is extracted until the ritual runs (the drift risk now covers BOTH
  tiers); no nudge/"unclosed" indicator yet — deferred with the no-persistence decision.
- A Transcribe paste no longer yields ties/fields directly — the flow is Transcribe → Illuminate that
  session (see ADR-036).
- Per-entity calls cost more per session than one batched call — accepted; a batched call would recreate
  the overload this ADR exists to remove.
- A `too_long` on a very large joined chronicle has no in-wizard remedy (close + Transcribe in chunks).

## Related Decisions
- ADR-014/018/022 (the changeset engine + journal capture this splits), ADR-028 (field changes),
  ADR-031 (dedup rules, reused verbatim), ADR-033 (tie enrichment fields), ADR-017 (why status stays in
  tier 1), ADR-030 v3 (the backstory flow that keeps 'full'), ADR-036 (the UI consolidation shipped
  alongside).

## References
- Types: `shared/import-types.ts` (`ExtractionMode`), `shared/enrich-types.ts`.
- Prompts/schemas: `claude.service.ts` (`buildExtractionSystem(mode)`, `extractionSchema(mode)`,
  `ENRICH_INSTRUCTIONS`, `ENRICH_SCHEMA`, `buildEnrichUserContent`, `enrichChangeset`).
- Services: `import.service.ts` (`ChangeValidationCtx`, `validateRelationshipChanges`,
  `validateFieldChanges`, description in `fieldChangePatch`), `enrich.service.ts`
  (`listTouchedEntities`, `enrichEntity`), `ipc/enrich.ts`.
- Renderer: `hooks/use-enrich.ts`, `components/capture/CloseOutDialog.tsx` (the close-out wizard),
  `components/sessions/EnrichDialog.tsx` + `enrich-rows.tsx`, `ChangesetReview.tsx`
  (`ChangesetReviewModel`; opt-in `bulk`/`density` volume props), `import-rows.tsx` (`compact`,
  `BulkToggle`).
- Tests: `enrich.service.test.ts`, `enrich-prompt.test.ts`, `extract-prompt.test.ts` (mode matrix),
  `import-apply.test.ts` (Illuminate payload + F1 regression).
