# ADR-056: Continuity — a read-only campaign consistency audit

## Status

Accepted — **implemented**. A new tool (the label ↔ code-name convention of ADR-024/047 continues:
**Continuity**, code name `continuity`). Builds on the time-aware model — chronology (ADR-017), note
confidence (ADR-021), and the typed status→lifecycle presets tightened in ADR-054. New shared pure module +
main service + Claude call + IPC + a renderer view + tests + docs; **no migration** (read-only over existing
data). **Follow-up:** deterministic findings now carry a one-click `fix` (set-lifecycle / sever-tie, applied
via the existing entity/link IPC). Verified: typecheck + lint + unit+integration (337) + `continuity.spec` e2e.

**Date:** 2026-07-15
**Deciders:** Solo developer

## Context

As a campaign's AI-grown memory accumulates, contradictions creep in — a "fallen" NPC still referenced as
acting, two notes asserting opposite facts, a rumor a later scene resolved but whose confidence was never
updated, an entity whose status doesn't match its lifecycle. The app was strong at CAPTURE (Chronicle →
Extract → Illuminate), RECALL (Lore), and ACT-IN-THE-MOMENT (Counsel/Converse), but nothing helped *tend*
the growing memory — even though the data model (chronology + confidence + typed presets) is built for
exactly this. Continuity is the maintenance tool that surfaces inconsistencies so the GM can fix them.

## Decision Drivers

* Catch the contradictions the model can't self-report — a memory grown by AI extraction needs a guardian.
* Be useful with **no key and no network** — many checks are computable without AI.
* Stay **token-safe** for a mature campaign, but still catch **cross-entity** contradictions.
* Informational, not autonomous — consistency judgments are the GM's; the tool surfaces, it doesn't rewrite.

## Considered Options

### A whole-campaign single pass (chosen)
Always-on deterministic checks + one token-bounded AI call over the campaign's memory → a unified report.
- **Pros:** one-button UX; the AI call sees the whole picture, so it catches cross-entity contradictions;
  realistic campaign sizes fit comfortably under the 150k-token guard; the deterministic layer covers any
  truncated tail.
- **Cons:** on a very large campaign the AI pass is best-effort over the most-recent notes (with an advisory).

### A per-entity sweep (like Illuminate)
A checklist → one AI call per entity → merged report.
- **Pros:** token-bounded at any scale; reuses the sweep UX.
- **Cons:** misses pure **cross-entity** contradictions (each call sees one entity's notes); more clicks.

## Decision

Ship the **whole-campaign pass** as a new lens **Continuity** (Ask group), with two sources unified into one
findings report:

1. **Deterministic checks** — a pure, unit-tested `@shared/continuity-checks.ts` (mirrors `graph-reduce` /
   `mention`): a status preset whose lifecycle ≠ the stored lifecycle; a pair with a live `ally_of` AND
   `enemy_of`. Precise, instant, **no key** (the service resolves the DB facts and hands plain records to the
   pure predicates). A dead entity still HOLDING a tie is deliberately NOT flagged — ties/notes persist past
   death; the semantic "still acting" leak is left to the AI pass.
2. **An additive AI pass** — one `structuredArrayCall` (feature `continuity`, `arrayKey: 'findings'`) over a
   token-bounded whole-campaign gather (entity states with `[ended]` marks, ties, notes newest-first +
   confidence-tagged), for the semantic contradictions the checks can't see. Out-of-character (no persona).

The result **always** returns the deterministic findings; the AI part reports its own status
(`skipped`/`failed`/`ok`), so the tool is useful with no key. Each finding links the entities involved (click
to jump) and carries an optional advisory `suggestedFix`. **Deterministic findings also carry a structured,
one-click `fix`** (a follow-up): a status-mismatch offers "set the lifecycle", a faction-conflict offers
"sever the ally tie / the enemy tie" — the GM clicks, it applies through the existing `entity.update` /
`link.sever` IPC (no AI, no key), and the resolved finding is optimistically pruned. AI findings stay advisory
(their resolution is a judgment, not a diff); nothing edits notes. The `speed` toggle (quick=Sonnet /
deep=Settings model) mirrors the other lenses.

## Consequences

### Positive
- No migration, no new dependency; the service/Claude half clones Converse, the renderer half clones Suggest.
- Degrades gracefully: the deterministic checks run offline / keyless, and cover the whole campaign even when
  the AI pass truncates or is skipped.
- Turns the underused confidence + chronology model into a live "what's inconsistent" report.
- `LensPromptInfo` gained an optional `queryLabel` so a button-driven tool can title its third help section
  "What it checks" instead of "Writing a good query" — a small, backward-compatible generalization.

### Negative / trade-offs
- v1 audits the **live "now"** picture; an as-of audit ("was the record consistent at session N?") is a
  reserved extension (the request type carries no `asOfSession` yet).
- The AI pass is best-effort under the token cap on a very large campaign (surfaced by the omitted-notes
  advisory); the deterministic layer still covers everything.
- Only the DETERMINISTIC findings have a one-click fix; AI findings (contradiction / timeline-leak) stay
  advisory — their resolution is a judgment, not a structured change.

### Deferred
- One-click **apply a fix** for the deterministic findings is now built (a follow-up: `set-lifecycle` /
  `sever-tie` via the existing entity/link IPC — no changeset path needed for a single reversible op); a
  structured fix for AI findings, or any note edit/delete, is deliberately NOT. Per-entity/per-pair deep
  coverage for very large campaigns. An **open-threads / unresolved-rumor tracker** (a separate tool;
  Continuity stays focused on contradictions).

## Related Decisions

- [ADR-017](017-chronology-temporal-model.md) — the chronology the timeline checks read.
- [ADR-021](021-creature-confidence-lore.md) — the note confidence the AI pass reasons over.
- [ADR-054](054-enum-only-status-type-aware-lifecycle.md) — the status→lifecycle presets the mismatch check uses.
- [ADR-034](034-converse-questions-only.md) / [ADR-048](048-counsel-narrative-cards.md) — the structured-lens
  shape this clones.

## References

- `src/shared/continuity-checks.ts` / `continuity-types.ts` — the pure checks + types.
- `src/main/services/continuity.service.ts` — gather + deterministic + AI merge.
- `src/main/services/claude.service.ts` — `CONTINUITY_INSTRUCTIONS` / `CONTINUITY_SCHEMA` / `continuity()`.
- `src/renderer/src/components/views/ContinuityView.tsx` / `hooks/use-continuity.ts` — the report + the
  `applyFix` handler (dispatches a `ContinuityFixAction` to `entity.update` / `link.sever`, then prunes).
- `tests/unit/shared/continuity-checks.test.ts`, `tests/unit/services/continuity-prompt.test.ts`,
  `tests/integration/continuity-fix.test.ts` (the fix round-trip), `tests/e2e/continuity.spec.ts`.
