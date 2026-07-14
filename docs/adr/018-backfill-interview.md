# ADR-018: Backfill interview — roster-then-beats guided import onto the timeline

## Status

Accepted — **implemented** (B1–B4: changeset-v2 extraction, session-scoped apply, the Backfill pane).
Verified: typecheck + the full unit/integration suite, plus a live changeset-v2 extraction against the
real Claude API (dated changes emitted against existing entity ids; notes normalized to third person).

**As-built notes:** apply reuses the chronology write path inside the existing import transaction
(nested `drizzle.transaction` = savepoints — exercised by the payoff test); a same-millisecond
baseline+change batch required `stateAsOf`'s tie-break to prefer the later-applied row; plain Import's
entity baselines now stamp at the batch's session (previously the latest-session fallback) — a
strictly more correct attribution.

**Date:** 2026-07-02
**Deciders:** Solo developer

Full design, edge cases, testing plan, and decision log:
[docs/design/backfill-interview.md](../design/backfill-interview.md).

## Context

The developer is adopting Custos ~10 sessions into a running campaign, with a backlog that is part
written notes, part memory. Paste-and-Extract Import (ADR-014) covers text ingestion but is passive
(a blank paste box), attaches every note to ONE session, and extracts no status/relationship changes
— so a backfilled past would be invisible to Chronology's as-of reconstruction (ADR-017) and the
timeline features would start blank. The fidelity target is a **present snapshot + key beats** at
coarse session attribution, not a full reconstruction.

## Decision Drivers

* Efficiently blend importing existing text with reconstructing from memory (prompted, not blank).
* Correct **session attribution** so the backfilled past feeds as-of/Recall.
* Nothing written without review; atomic per-batch apply (ADR-014's guarantees).
* Reuse Import's pipeline + review UI and Chronology's session-stamped writes — minimal new surface.
* Bounded prompts/cost (no mega-paste; no long-lived conversation state).

## Considered Options

### Option A: Session-scoped guided paste
- A session stepper + static prompts; extract→review→apply per session.
- **Pros:** leanest; one pipeline. **Cons:** feels like guided paste; static prompts don't jog memory.

### Option B: Conversational interviewer
- A multi-turn adaptive chat that accumulates a changeset.
- **Pros:** best memory extraction. **Cons:** a stateful conversation engine + orchestration for a
  one-time flow — over-engineered (YAGNI).

### Option C: Roster-then-beats interview (chosen)
- Phase 1 establishes the cast + current state; Phase 2 walks sessions with prompts **seeded by the
  roster**, extracting beats + dated changes per session.
- **Pros:** maps 1:1 onto snapshot+key-beats; best dedup (roster first) and memory-jogging; a
  superset of A. **Cons:** two phases + seeding to build.

## Decision

Build **Approach C** on a shared **"changeset v2"** backend:

1. **Changeset v2.** Extraction gains `statusChanges[]` (`{entityRef, lifecycle, status}`) and
   `relationshipChanges[]` (`{fromRef, toRef, relation, action: form|sever}`) alongside entities +
   notes, gated by a `withChanges` flag (the existing Import pane is unchanged). Refs reuse Import's
   `#index`/id union; notes are normalized to third person by the prompt.
2. **Timeline placement.** Roster entities apply as **baselines at their intro session** (default 1)
   capturing *initial* state; Phase-2 batches apply **dated changes** at their session N via the
   session-stamped writes Chronology M3 already built (`updateEntity`/`createLink`/`severLink` with
   `sessionId`); the current state emerges as the latest change. One transaction per batch,
   post-commit indexing, per-item skip on invalid relations.
3. **Interview flow.** A new **Backfill** Capture pane: Step 0 creates shell sessions 1…N; Phase 1
   prompts for the roster; Phase 2 walks sessions with roster-seeded prompts (the roster doubles as
   the extractor's `existing` dedup list). Each batch is independently reviewed and committed —
   resumable by construction.
4. **Edge rules.** Changes require a (best-guess) session; unplaceable facts become **undated notes**
   (timeless under as-of). Re-runs are safe: fuzzy dedup → link, open-only link idempotency, sever
   no-op, review-gated notes.

## Rationale

The roster-first shape mirrors how a DM actually remembers a campaign — cast and current state first,
then the turning points — and the roster then powers both dedup and prompt seeding, which is what
makes the interview feel guided without a conversation engine. Stamping beats to their session is
what turns a backlog into a *timeline*: it reuses the exact write path built for live capture
(ADR-017), so the deferred "as-of edit override" arrives as a service parameter rather than new
machinery. Everything probabilistic stays behind ADR-014's review + transaction gates.

## Consequences

### Positive
- A 10-session backlog becomes entities + notes + a **queryable history** (as-of works on the past).
- Superset of plain guided paste; reuses the Import pipeline, review UI, and Chronology writes.
- Resumable, review-gated, atomic per batch; existing Import pane untouched.

### Negative / Risks
- Baseline-vs-current slips (describing the roster in its *current* state) blur deep-past as-of —
  mitigated by prompts + review; never wrong about the present.
- Coarse attribution is approximate by design; several Claude calls across the interview (accepted
  for a one-time flow).
- Duplicate notes on re-runs are only review-gated (hash-dedup is a follow-up).

## Related Decisions

- ADR-014 — the extract→review→transactional-apply pipeline this extends (incl. its deferred
  `relations[]` step, which lands here as `relationshipChanges`).
- ADR-017 — the session-stamped history/interval writes that give the backfill a timeline to land on.
- ADR-009 — structured output + code-side validation (the change arrays follow the same pattern).
- ADR-013 — Recap; unchanged, but benefits from backfilled sessions.

## References

- `docs/design/backfill-interview.md` — full design.
- `src/shared/import-types.ts`, `src/main/services/import.service.ts`,
  `src/main/services/claude.service.ts` (extraction) — extension sites.
- `src/main/services/{entity,link}.service.ts` — the session-stamped writes (ADR-017 M3).
- `../../SPEC.md` §10 (to be updated when shipped).
