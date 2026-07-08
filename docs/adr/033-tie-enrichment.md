# ADR-033: Tie enrichment — directional disposition + epistemic confidence

## Status

Accepted — **implemented**. A relationship (`entity_link`) now carries a per-direction **disposition** (how
each side feels) and an **epistemic confidence** (like notes), and every extraction flow populates them
along with the existing description. Migration **0010** (three ADD COLUMNs). Verified: typecheck + lint +
the full suite (210 tests; new coverage for the service, extraction, prompt rendering, and the graph seam).

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

A tie is the ONLY way ownership/alliance/kinship/location facts reach the AI — embeddings never see the
edge graph, so `formatRelationships` → the prompt is the sole path. A design brainstorm (grounded in a map
of every tie consumer) found the model — `relation` + one shared `description` + chronology interval —
under-serves the app's flagship, the **in-character AI**: **symmetric relations collapse direction**, so
"A ally_of B" cannot express that A is devoted while B merely tolerates A, and the AI never learns how each
side *feels*. Two clarifying decisions: disposition is a **free-text short phrase** (nuance the model reads
and writes naturally, better than a coarse enum), stored **per direction** on the one edge; confidence
**reuses the note vocabulary** (ADR-021).

## Decision

- **Schema (migration 0010):** `entity_link` gains `from_disposition` / `to_disposition` (nullable text) and
  `confidence` (`text NOT NULL DEFAULT 'confirmed'`). Plain ADD COLUMNs — no table rebuild. `EntityLink`,
  `rowToLink`, `Create/UpdateLinkInput`, and `ContextNeighbor` (`viaNearDisposition`/`viaFarDisposition`/
  `viaConfidence`) carry them.
- **AI grounding (`formatRelationships`):** each tie line now renders the confidence tag (reusing the shared
  `confidenceTag`), the description, and — the point — the **directional disposition**, oriented for the
  viewing entity: `- {name} {label} {other}{· (rumored)} ({description}) — {name} feels {near}; {other}
  feels {far}`. All five lenses inherit it (Lore, both Counsel modes, Converse, Recap) through the single
  function.
- **Extraction:** the schema + `CHANGES_INSTRUCTIONS` ask the model to fill `description`,
  `fromDisposition`/`toDisposition`, and `confidence` on a `form` tie when the text supports it;
  `validateExtraction` carries them (capped; confidence snapped to the note vocabulary, default confirmed;
  `sever` takes none); `applyChangeset` passes them to `createLink`. Draft-from-backstory, Chronicle, and
  Transcribe all populate them.
- **UI:** the Ties list shows the description **inline** (not just a tooltip), a confidence badge, and the
  dispositions; the tie edit dialog and the manual Link dialog gain per-direction disposition inputs + a
  confidence select; the changeset review row shows the proposed confidence/dispositions and makes the
  description editable in place.
- **Write path:** `createLink` persists the three; `updateLink` edits any of them independently (endpoints +
  relation stay immutable).

### Every tie consumer was audited (per the "make every tool work with this" directive)
`formatRelationships` (all 5 lenses) and `listForEntity` → enriched/auto. `getEntityContext`/`ContextNeighbor`
→ enriched for consistency (though currently only the tests exercise that seam; the live path is
`listForEntity → formatRelationships`). `getHierarchy` → **deliberate no-op** (containment is structural,
not a feeling). Chronology `isIntervalLiveAt` → no-op (the interval filter is orthogonal; the fields ride
along). `serialize.rowToLink` + `listLinksForCampaign` (export) → auto-carry. Recall sources → unchanged
(they carry no tie data). Ties are NOT embedded, so no re-embed.

## Consequences

### Positive
- The in-character AI can finally reason about **asymmetric feeling** — the biggest expressive gap for
  Converse ("how would my PC feel about them?") and Counsel (in-character reactions).
- Epistemic confidence lets the AI hedge on rumored ties, consistent with note confidence and the
  spoiler-aware design.
- One renderer (`formatRelationships`) means every lens benefits at once.

### Negative / Risks
- **Directionality in extraction** — the model must map `fromDisposition` to `fromRef`; the prompt states it
  and the review/edit UI lets the user fix a flip. For the backstory flow, ties anchor to the MC
  (`backstorySubjectId`), so the MC is usually `from`.
- **Migration-bearing** — applies on next launch after a DB backup; the three ADD COLUMNs are non-destructive.
- The changeset review row is heavier (disposition/confidence are review-display; only the description is
  inline-editable there — full editing is post-apply via the tie dialog).

## Related Decisions

- ADR-021 (note confidence — the vocabulary + `confidenceTag` reused here), ADR-017 (the chronology interval
  this rides alongside), ADR-030 v3 (the standing-tie extraction that made asymmetric feeling worth
  capturing), ADR-032 (the editable tie `updateLink` this extends).

## References

- Schema: `db/schema.ts` `entityLink`; `drizzle/0010_yummy_mastermind.sql`; `EntityLink`/`ContextNeighbor`.
- Service/extraction: `link.service.ts` (`createLink`/`updateLink`/`getEntityContext`), `import.service.ts`
  (`validateExtraction`/`applyChangeset`), `claude.service.ts` (`formatRelationships`, extraction schema +
  `CHANGES_INSTRUCTIONS`).
- UI: `RelationshipEditor.tsx` (row + `TieEditDialog` + `LinkDialog`), `import-rows.tsx`
  (`RelationshipChangeRow`).
- Tests: `link.service.test`, `import.service.test`, `graph.service.test`, `recall-prompt.test`,
  `extract-prompt.test`.
