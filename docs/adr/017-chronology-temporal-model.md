# ADR-017: Chronology — a session-led temporal model (validity intervals + as-of reconstruction)

## Status

Accepted (design) — **implementation not yet started.**

**Date:** 2026-07-01
**Deciders:** Solo developer

Full design, limitations, testing plan, and decision log: [docs/design/chronology.md](../design/chronology.md).

## Context

Ledger stores only current, overwritten state: `entity.status`, relationships (`entity_link`), and
`attributes` each hold a single value. When the duke dies or an alliance flips, the prior truth is
lost — so the AI (Recall/Suggest) is blind to *when* facts were true and can present stale facts (a
dead NPC, a broken alliance) as current. We want Recall/Suggest to be time-aware — reconstruct state
"as of session N," separate past from present, and explain change — reliably enough to trust. Two
clocks exist (real capture time vs. in-fiction time); only session ordering (`session.number`) is
reliably recorded.

## Decision Drivers

* Time-correct AI grounding (never assert stale facts; can explain change over time).
* Determinism / reliability — this is a trust feature; history must be reproducible.
* Reuse the session spine, graph traversal, retrieval, and streaming — minimal new surface.
* Bounded prompt cost.
* Never fabricate history that wasn't captured.

## Considered Options

Condensed; every fork is recorded in the design doc's decision log.

- **Time model:** session-led hybrid *(chosen)* / in-world calendar first-class / session-only.
- **What is versioned:** status + relationships *(chosen)* / + attributes & goals / + descriptions.
- **Capture:** deterministic snapshot-on-edit *(chosen)* / explicit change events / LLM extraction.
- **History shape:** append-only trail + relationship validity intervals *(chosen)* / overwrite
  (status quo) / full bitemporal.
- **Grounding:** change-annotated present + on-demand as-of reconstruction *(chosen)* / current-only /
  lifecycle-flag-only.

## Decision

Adopt a **session-led, append-only** temporal model:

1. **Timeline = `session.number`.** In-world calendar dates are deferred (the schema leaves room).
2. **Version status + relationships only.** Add a versioned `lifecycle ∈ {active, ended, unknown}` to
   `entity`; keep free-text `status` for nuance. The flag is what history versions and what the AI
   trusts for past-vs-present.
3. **Deterministic snapshot-on-edit.** Status/lifecycle changes append a status-history row stamped
   with the active session; relationships gain `startSession`/`endSession` validity intervals —
   **severing sets `endSession`, never deletes.** No AI in the capture path; an "as-of session"
   override handles retroactive fixes.
4. **As-of reconstruction with a no-future-leak clamp.** A pure `stateAsOf(entity, N)` rebuilds
   lifecycle/status + live relationships at session N. An explicit UI selector chooses N; when set,
   **both** retrieval (notes/events `session ≤ N`) **and** state are clamped to ≤ N.
5. **Honest backfill.** A one-time migration marks existing facts "pre-tracking / origin unknown"
   (`sinceSession`/`startSession = NULL`) and derives `lifecycle` from current status by heuristic —
   no fabricated origin sessions.
6. **Minimal UI:** lifecycle selector, as-of edit override, as-of query selector, and an inline
   "Changed over time" disclosure for auditing. A full timeline view is deferred.

## Rationale

Session order is the only reliable clock the app already has, so it is the spine; in-world dates are
chronically under-recorded and stay optional. Deterministic snapshot-on-edit makes history
reproducible and keeps AI out of the trust-critical write path. Append-only trails + validity
intervals mean new edits never destroy the past — the precise failure today. Reconstructing as-of
state as a pure function makes the feature unit-testable, and the no-future-leak clamp is what makes
an as-of answer trustworthy. Versioning only status + relationships covers the "stale fact" risk
while sparing the capture burden of fuzzier dimensions (descriptions live as dated notes). The
controlled lifecycle flag lets the model answer "still in play as of N?" deterministically rather than
parsing free text.

## Consequences

### Positive
- Time-correct, change-aware Recall/Suggest; the past is never overwritten; deterministic and
  testable; reuses the spine/graph/retrieval/streaming; bounded prompt cost; honest about the
  pre-tracking gap.

### Negative / Risks
- History is only as good as in-app edits; session-granular (no intra-session or in-world dating);
  backfilled facts have unknown origin; only status + relationships are versioned.
- The **retrieval layer must gain a session filter** (a `vector-store` / note-retrieval change that
  extends ADR-012).
- The **`entity_link` unique index must relax** to allow a severed-then-reformed relationship.
- Null-`sessionId` notes need an explicit as-of rule.

## Related Decisions

- ADR-004 — SQLite/Drizzle + the FK-off-around-`migrate()` pattern used by the schema migration.
- ADR-011 — graph traversal (`getHierarchy` / `listForEntity`) reused by reconstruction.
- ADR-012 — brute-force retrieval; this **extends** it with a session-scoped filter for the as-of clamp.
- ADR-008 — the streaming IPC that Recall (now as-of-aware) rides on.
- ADR-015 — the current scene, whose "now" anchor is set to N under as-of.
- ADR-009 / ADR-016 — Suggest grounding, which consumes the change-annotated + as-of state.

## References

- `docs/design/chronology.md` — full design, limitations, testing, and decision log.
- `src/main/db/schema.ts` (`entity`, `entity_link`);
  `src/main/services/{entity,link,recall,suggest,vector-store}.service.ts` — impact sites.
- `../../SPEC.md` — product context (Recall/Suggest pillars).
