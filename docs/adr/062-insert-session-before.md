# ADR-062: Insert session before — backfilling earlier sessions via a uniform renumber shift

## Status

Accepted — **implemented**. `session.service.insertSessionBefore` (+ `session:insertBefore` IPC), an
"Insert before" action on the Sessions detail header, and unit/integration/e2e coverage. No migration
(pure DML). Amends the ADR-017 premise that session numbers are "assigned once and never renumbered".

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

A player who adopts Custos mid-campaign starts tracking at what the app calls "Session 1" even though
it's really (say) session 3 of their table's story. They need to BACKFILL the earlier sessions so the
timeline reads true. But session **numbers are the campaign's timeline axis** (ADR-017): every tie
interval (`entity_link.start/end_session_number`) and status change (`status_history.since_session_number`)
is stamped with a session number, denormalized with no FK, precisely because numbers were never supposed
to change.

## Options considered

1. **Explicit numbers at create** ("New session as #2") — pushes uniqueness/ordering bookkeeping onto
   the user, and still needs the same cascade whenever the chosen number is occupied.
2. **Move/reorder existing sessions** — rejected. Moving a session across a sever point inverts a tie's
   `[start, end)` interval (start > end), which silently vanishes the tie from every as-of view. Any
   general move needs an inversion guard and a UX for refusals; the actual need doesn't require it.
3. **Insert a NEW empty session before an existing one — a uniform +1 shift** (chosen). The anchor and
   everything later (and all their chronology stamps) shift together, so the relative order of existing
   sessions is invariant: no interval can invert, no history changes meaning.

## Decision

`insertSessionBefore(ctx, { campaignId, beforeSessionId })`, ONE transaction, four writes:

1. **Session numbers — negate two-phase.** Empirically verified on this repo's better-sqlite3: a naive
   `UPDATE session SET number = number + 1 WHERE number >= k` FAILS — SQLite checks the
   `(campaign_id, number)` UNIQUE index **per row** during UPDATE (no deferred constraints), and
   UPDATE's `ORDER BY` (even with `LIMIT -1` under `ENABLE_UPDATE_DELETE_LIMIT`) only scopes rows, it
   does **not** control write order. So: `number → -(number + 1)` for rows ≥ k, then `negatives → -number`.
   Intermediate negatives can't collide with live positives; flipped results (k+1…) can't collide with
   unshifted rows (< k).
2. **`status_history.since_session_number` +1** where ≥ k, scoped through the campaign's entities (the
   table has no campaign column).
3. **`entity_link.start_session_number` / `end_session_number` +1** where ≥ k (plain single-statement
   updates — no unique constraint spans the values; a non-NULL→non-NULL end never changes membership in
   the partial `link_open_unique_idx ... WHERE end_session_number IS NULL`).
4. **Insert the new session at k** (empty, `date` = today, same shape as `createSession`).

SQL `>= k` is never true for NULL, so pre-tracking baselines (NULL since/start) and OPEN intervals
(NULL end) are untouched by construction — locked by tests.

Everything else already resolves session id → number at query time (note as-of clamps, lens labels,
unclosed badges, the Web slider, the dashboard), and notes/events reference sessions by **id**, so they
travel with their renumbered session for free. `deleteSession` deliberately still does NOT renumber.

**UI:** an "Insert before" button on the Sessions detail header (select-then-act, like Extract/Edit/
Delete) opening a confirm dialog that spells out the renumber; on apply it bumps `sessionsVersion` +
`entitiesVersion` and selects the new session. The Chronicle header's "New session" stays append-only;
the left rail gets no extra affordance (no row menus exist anywhere in the app — revisit if
discoverability proves weak).

## Consequences

* **+** Mid-campaign adopters can make the timeline read true; the shift is invisible to chronology —
  the integration test asserts every as-of read at n+1 equals the pre-shift read at n.
* **+** No migration; no new deps; one new IPC channel mirroring the existing six.
* **−** The session right after the anchor now finds a NEW empty session as its `number − 1` recap
  predecessor until the user fills it — semantically correct (it IS the story predecessor now).
* **−** Renderer-held as-of numbers (lens views, the Web slider) denote one story-step earlier after a
  shift. Every held number remains a valid session, so nothing dangles; no reset machinery (it would
  also fire on every ordinary append). Accepted.
* "Before tracking" (NULL) stays before EVERYTHING, including backfilled sessions — this tool does not
  backdate pre-tracking facts onto new sessions (per ADR-017's no-fabricated-origins stance); the
  dialog copy says so.
* The schema comments and `docs/design/chronology.md` now read "assigned once; the ONE sanctioned
  renumber is insertSessionBefore's uniform shift" — the never-renumbered premise is retired, narrowly.
