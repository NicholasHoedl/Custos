# Chronology — Design

**Status:** Accepted — implemented (M1–M5); see ADR-017 "Implementation notes" for as-built deltas
**Date:** 2026-07-01
**Owner:** Solo developer
**ADR:** [ADR-017](../adr/017-chronology-temporal-model.md)
**Product context:** [SPEC.md](../../SPEC.md)

---

## 1. Summary

Make Recall & Suggest **time-aware**: reconstruct campaign state "as of session N," distinguish
past from present, and explain how status and relationships changed over time — without ever
asserting a stale fact (a dead NPC, a broken alliance) as current. Session order is the timeline,
capture is a deterministic by-product of editing, and history is append-only.

## 2. Understanding summary

- **What:** temporal awareness for the AI grounding path (Recall/Suggest).
- **Why:** the app stores only current, overwritten state, so the AI can't reason about *when* and
  presents stale facts as current.
- **Who:** the solo player/DM; single-user, local-first — unchanged.
- **Backbone:** session order (`session.number`); in-world calendar dates deferred.
- **Scope of history:** entity **status + relationships** only.
- **Primary consumer:** the AI grounding path — not a new human-facing UI (a small history view is
  included only for trust/audit).

## 3. Decision log

| # | Decision | Why |
|---|---|---|
| 1 | **Session-led hybrid time model** — `session.number` authoritative; in-world dates optional/deferred. | Session order is the only reliable existing clock; in-world dates are chronically under-recorded. |
| 2 | **Primary goal: the AI reasons with time.** Timeline UI / contradiction-check / time-travel are secondary. | Matches "I want the AI to be aware of time"; highest leverage, least new UI. |
| 3 | **Version status + relationships only** (not attributes/goals/descriptions). | These two carry the "stale fact" risk; the rest is capture burden for fuzzier value (descriptions → dated notes). |
| 4 | **Deterministic snapshot-on-edit**, anchored to the active session, override allowed. | Reliability + low friction; keeps AI out of the trust-critical write path. |
| 5 | **Lifecycle flag `{active, ended, unknown}`** on the entity + keep free-text `status`. | Deterministic "still in play as of N?"; free-text stays for nuance but isn't trusted for logic. |
| 6 | **Change-annotated present + on-demand as-of-session-N reconstruction.** | Delivers both "no stale facts" and "how did X change," plus true past-time queries. |
| 7 | **As-of via explicit selector**; hard **no-future-leak clamp** (retrieval + state ≤ N). | Deterministic time-scoping; an as-of answer must not cite the future. |
| 8 | **Backfill = "pre-tracking, origin unknown."** | Existing facts are usable without fabricating a false origin session. |
| 9 | **v1 UI:** lifecycle selector + as-of edit override + as-of query selector + inline history disclosure. Full timeline view deferred. | Smallest surface that still lets you *audit* the auto-capture. |
| 10 | **Amendment (ADR-062):** session numbers are assigned once and never *reordered*, but a uniform +1 **insert-shift** is sanctioned — `insertSessionBefore` renumbers the anchor + everything later AND every denormalized stamp (`status_history.since_session_number`, `entity_link.start/end_session_number`) atomically. NULL (pre-tracking) stamps are never touched. | Mid-campaign adopters need to backfill earlier sessions; a uniform shift preserves all relative order, so no validity interval can invert. |

## 4. Design

### 4.1 Data model (append-only, non-destructive)

- **Lifecycle flag** on `entity`: `lifecycle ∈ {active, ended, unknown}` — the current value, cheap to
  read; free-text `status` retained for nuance.
- **Status-history trail** (new table, append-only): one row per status/lifecycle change —
  `{ id, entityId, lifecycle, status, sinceSession (nullable), recordedAt }`. Current = latest by
  session / `recordedAt`. A null `sinceSession` marks the pre-tracking baseline.
- **Relationship validity intervals**: add `startSession` + `endSession` (both nullable) to
  `entity_link`. A live relationship has `endSession IS NULL`. **Severing a relationship sets
  `endSession` — it is never deleted.** Backfilled links carry `startSession = NULL`.
- **Backfill:** a one-time migration stamps existing facts as pre-tracking
  (`sinceSession`/`startSession = NULL`) and derives each entity's `lifecycle` from its current
  free-text status by heuristic (dead/deceased/destroyed/ruined/disbanded/abandoned/gone → `ended`;
  empty → `unknown`; else → `active`), user-correctable. **No origin sessions are fabricated.**

### 4.2 Capture — deterministic snapshot-on-edit

- Hook in `entity.service`: on a status/lifecycle change, append a status-history row stamped with
  the **active session** (an "as-of session" override handles retroactive fixes).
- Hook in `link.service`: creating a relationship sets `startSession = active session`; severing sets
  `endSession = active session` (soft close).
- **No AI in the write path** — capture is fully deterministic and reproducible.

### 4.3 Reconstruction — a pure function

`stateAsOf(entityId, N)`:
- **lifecycle/status** = the latest status-history row with `sinceSession ≤ N` (or the pre-tracking
  baseline if none).
- **relationships** = `entity_link` rows with `startSession ≤ N` (or NULL) **and**
  (`endSession IS NULL` **or** `endSession > N`).

Pure and deterministic over the history tables → trivially unit-testable.

### 4.4 AI grounding

- **Always (present queries):** `formatState` / `formatRelationships` gain change-trails and
  past-markers, so grounded entities show "current + how they got here" (e.g. *"Duke Halric — ended
  (died S5); allied with the Guild S2–S4, hostile since"*). History is added **only for entities
  already grounded** (pinned scene + retrieved), so prompt cost stays bounded.
- **As-of (explicit selector = N):** a hard **no-future-leak clamp** — retrieval is filtered to
  notes/events with `session ≤ N`, and state is swapped for `stateAsOf(·, N)`; the current-scene
  "now" anchor is set to N. Pre-tracking facts surface with an "origin unknown" marker so the model
  never invents an origin session.

### 4.5 UI surface (v1)

- Lifecycle selector in the entity editor (alongside free-text status).
- "As of [session]" override on status/relationship edits (default = active session).
- As-of **query selector** on Recall & Suggest (default "Now (latest)").
- Inline, collapsible **"Changed over time"** disclosure on the entity detail pane (status
  transitions + relationship intervals, by session) — lets you audit the auto-capture.
- *Deferred:* a full campaign/entity timeline view.

## 5. Consistency & reliability

- **Deterministic capture** (no AI writes) → reproducible history.
- **No-future-leak clamp** → as-of answers cannot cite the future.
- **Append-only + intervals** → the past is never overwritten (the exact failure today).
- **Controlled lifecycle flag** → deterministic "still in play as of N?"; free-text stays flavor.
- **Honest backfill** → no fabricated origins.
- **Auditable inline history** → you can verify what capture recorded.
- **Pure `stateAsOf` + clamp** → deterministic, easy to unit-test (matches the repo's service-test
  culture).

## 6. Limitations

- History is only as good as your in-app edits (snapshot-on-edit, not omniscient).
- Session-granular: no "three days later" within a session; no in-world dates.
- Backfilled facts have unknown origin — as-of *before* rollout is coarse.
- Only status + relationships are versioned (attributes/goals/descriptions evolve via dated notes).
- Notes with a null `sessionId` are ambiguous under as-of (needs a rule — see §7).
- Modest prompt-cost growth for change-heavy entities (bounded to grounded entities).
- Explicit selector only — no natural-language "as of" detection in v1.

## 7. Open design details (resolve during build)

- **Unique index:** `entity_link`'s `(from, to, relation)` unique index must relax to allow a
  severed-then-reformed relationship (two interval rows) — e.g. include `endSession`, or enforce
  "at most one *open* interval per (from, to, relation)."
- **Null-`sessionId` notes under as-of:** include always (treat as timeless) vs. exclude. Proposed:
  include, but mark as undated.
- **Ended-entity ranking:** whether `ended` entities are down-ranked in normal (now) retrieval.

## 8. Testing strategy

- **Unit:** `stateAsOf` across intervals (open/closed, pre-tracking baseline); the lifecycle
  heuristic; the retrieval session-clamp (proves no future leak); the unique-index relaxation.
- **Integration:** capture→history on status/link edits; an as-of query returns pre-N state and
  excludes post-N notes; the backfill migration marks pre-tracking + derives lifecycle without
  fabricating origins (mirror `tests/integration/migrations.test.ts`).
- **Prompt:** the change-annotated grounding renders past vs. present correctly (extend the existing
  recall/suggest prompt tests).

## 9. Rollout / migration

- One Drizzle migration: add `entity.lifecycle`; create `status_history`; add
  `entity_link.startSession`/`endSession`; relax the unique index. Use the FK-off-around-`migrate()`
  pattern (ADR-004) if a table rebuild is triggered. Backfill runs in the same migration
  (deterministic).
- No re-seed required; existing rows get the pre-tracking baseline.

## 10. Out of scope / future

In-world calendar dates; a full timeline view; contradiction-checking; natural-language as-of;
LLM-assisted historical backfill; history for attributes/goals/descriptions; a movable global "now"
cursor beyond per-query as-of.
