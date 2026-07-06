# Backfill Interview — Design

**Status:** Accepted — implemented (B1–B4), then **UI removed in ADR-023** (the roster-then-beats
interview is gone; its changeset-v2 engine lives on in Import + the Journal). Retained as historical
design context. See ADR-018 "Status" for as-built notes.
**Date:** 2026-07-02
**Owner:** Solo developer
**ADR:** [ADR-018](../adr/018-backfill-interview.md)
**Product context:** [SPEC.md](../../SPEC.md); builds on Import (ADR-014) and Chronology (ADR-017)

---

## 1. Summary

A **guided, session-aware backfill interview** for adopting Ledger mid-campaign (~10 sessions in):
the app prompts the user (roster first, then session by session), turning freeform answers + partial
pasted notes into structured entities, notes, and **dated status/relationship changes** — attributed
to the right session, reviewed, and applied in one transaction per batch. The backfilled past becomes
as-of-queryable (ADR-017) instead of a pile of notes pinned to "now".

## 2. Understanding summary

- **What:** a roster-then-beats interview that backfills a long-running campaign.
- **Why:** today's Import is a passive paste box that attaches everything to ONE session, extracts no
  status/relationship changes, and doesn't help pull history out of memory — so a 10-session backlog
  is slow to enter and invisible to Chronology's as-of reconstruction.
- **Who:** the solo player/DM, doing a one-time catch-up (normal capture resumes afterward).
- **Backlog shape:** partial written notes + memory — the flow must blend importing text with
  reconstructing gaps.
- **Fidelity:** present snapshot + key beats at *coarse* session attribution. Full per-session
  reconstruction is out of scope.
- **Consumers:** Recall/Suggest grounding (incl. as-of), the entity graph, and the history disclosure.

## 3. Decision log

| # | Decision | Why |
|---|---|---|
| 1 | Backlog = **partial notes + memory** | Rules out pure parse-my-doc and pure manual entry. |
| 2 | Fidelity = **snapshot + key beats**, coarse attribution | Bounds the reconstruction effort; ~80% of the value. |
| 3 | Working mode = **guided interview** | Prompted Q&A beats a blank paste box for pulling from memory. |
| 4 | **Approach C: roster-then-beats** over a shared session-aware "changeset v2" backend | Maps 1:1 onto the fidelity target; best dedup + memory-jogging; a superset of plain guided paste; a conversational engine (Approach B) is YAGNI for a one-time flow. |
| 5 | Timeline model: **roster → baselines (initial state); beats → dated changes; current = latest change** | The only mapping that makes as-of correct at every point. |
| 6 | **Reuse** Import's extract→validate→review→apply + `existing`-seeding + review UI; the session-stamped write side already exists (Chronology M3) | The new engineering is two arrays + an apply loop + a pane, not a new pipeline. |

## 4. Design

### 4.1 Changeset v2 (the shared backend)

Import's changeset (`{ entities[], notes[] }`) grows two arrays and becomes session-scoped:

```
InterviewChangeset            (carries a session N — or "pre-tracking" for the roster)
  entities[]                  — as today: create-new or link-to-existing (type/status/desc)
  notes[]                     — as today: content + entityRefs; normalized to THIRD PERSON
  statusChanges[]             — { entityRef, lifecycle, status }        e.g. Duke → ended / "slain"
  relationshipChanges[]       — { fromRef, toRef, relation, action: "form" | "sever" }
```

- `entityRef` reuses Import's union — `#index` (new in this batch) or a real id (existing) — so a
  change can target an entity created in the same answer.
- Every item in a batch shares the batch's session: **attribution is implicit**, never per-item.
- Extraction emits the change arrays only when asked (a `withChanges` flag), so the existing Import
  pane's behavior is unchanged.

### 4.2 Timeline placement (apply semantics)

> **Roster = baselines. Beats = dated changes. Current state = the latest change.**

- Roster entities are created with their baseline stamped at their **first-appearance session**
  (default session 1; a later intro session K for mid-campaign arrivals, so as-of before K correctly
  shows *didn't exist yet*).
- The baseline captures the entity's **initial / earliest-known** state — NOT its current one. The
  current state emerges from the last dated change. (If the Duke's baseline were *dead* and a beat
  also says "died in S5", as-of S3 would wrongly show him dead; baseline *alive* + a dated S5 death is
  right at every point.) Prompts + review steer this; a slip only blurs deep-past as-of, never the
  present.

Apply for one batch — a single transaction, then post-commit indexing (mirrors ADR-014):

1. `entities` → `createEntity(…, sessionId = introSession)` or link → build the `#index → id` map
2. `statusChanges` → `updateEntity(resolve(ref), { status, lifecycle, sessionId: N })`
3. `relationshipChanges` → `createLink(…, sessionId: N)` / `severLink(id, N)`
4. `notes` → attach to N

The session-stamped writes **already exist** (Chronology M3): `createEntity`/`updateEntity` seed and
append `status_history`; `createLink`/`severLink` set interval endpoints. Applying a status change "as
of N" *is* `updateEntity` with a session — the deferred as-of edit override, arriving as a service
call rather than a form control.

### 4.3 Interview flow

**Where:** a new **"Backfill" Capture pane** (sibling of Notes / Recap / Import), reusing Import's
review rows (`EntityRow`, `NoteRow`) plus a new `ChangeRow`.

- **Step 0 — timeline:** "How many sessions so far?" → create shell sessions 1…N (numbered, titles
  optional). Beats need sessions to attach to; coarse attribution makes "around session 5" fine.
- **Phase 1 — roster:** broad prompts ("Who are the main people, places, factions, quests? A sentence
  each. Still active or ended? Anyone who first appeared partway in?"). Freeform answers or pasted
  cast lists → extract (entities + initial status + stable relationships) → review (link-vs-create) →
  apply as **baselines** at each entity's intro session.
- **Phase 2 — beats:** walk the sessions (in order or jumping to the memorable ones). Each session's
  prompt is **seeded with the roster** ("Session 3: of Glasstaff, Sildar, Mirna… who appeared? Any
  deaths, betrayals, alliances, quest changes?") → extract a changeset for that session → review →
  apply stamped at K. Seeding is nearly free: the extractor already takes an `existing` entity list,
  which doubles as dedup grounding.
- **Resumable by construction:** each batch is its own committed transaction — stop/resume freely.

### 4.4 Edge cases

- **Can't-place beats:** a status/relationship change **requires** a session (best guess is fine); a
  plain note may be **undated** (timeless — still retrievable, passes every as-of clamp). "I know it
  happened, not when" → an undated note, never a mis-dated death.
- **Idempotent re-runs:** entity fuzzy dedup (roster passed as `existing`) surfaces re-mentions as
  *link*; `createLink` is open-only-idempotent and `severLink` is a no-op on a severed edge; a
  duplicate status row is harmless to reconstruction. Notes are the one real dup risk — gated by the
  review step (content+session hash-dedup is a follow-up).
- **Note hygiene:** the extraction prompt rewrites notes to **neutral third person** ("the party
  killed Glasstaff") so in-character Recall never misattributes a first-person voice.
- **Big answers:** the per-session structure *is* the chunking strategy — each batch is one bounded
  session. Import's soft length warning stays; true chunking remains deferred.
- **Review-gated, atomic:** nothing is written without per-item review (entities, notes, AND changes),
  and each batch applies in one transaction (ADR-014's guarantees carry over).

## 5. Testing strategy

- **Unit (extraction/validation):** a `RawExtraction` carrying the new arrays → refs resolved
  (`#index`/id), invalid entries dropped (bad ref, unknown relation, disallowed type pair, bad
  lifecycle), dedup preserved.
- **Integration (apply v2):** applying a session-N changeset yields a baseline at the intro session, a
  `status_history` row at N, interval endpoints at N, notes on N — atomically (a throw rolls back).
- **The payoff test:** backfill a roster + an S5 death + an S5 betrayal → `stateAsOf(3)` = alive &
  allied; `stateAsOf(6)` = dead & severed. Proves the backfill feeds as-of.
- **Idempotency:** re-applying a batch creates no duplicate entities (linked instead), keeps exactly
  one open relationship interval, and only adds harmless status rows.
- **UI:** typecheck + manual (matching the repo's renderer convention); third-person normalization is
  eyeballed in a live run.

## 6. Build sequence

- **B1 — changeset-v2 types + extraction:** extend `import-types` + the extraction prompt/schema
  (gated by `withChanges`; third-person rule) + `validateExtraction`. Unit tests.
- **B2 — apply v2:** extend `applyChangeset` to walk the change arrays with sessions, per-item skip on
  invalid relations. Integration tests (apply + payoff + idempotency).
- **B3 — Backfill pane:** Step 0 shells, Phase 1 roster, Phase 2 seeded sessions; `ChangeRow`;
  `use-backfill` hook + IPC.
- **B4 — verify + review + finalize:** full verification, code review, live sanity run, flip ADR-018
  to implemented, SPEC §10 entry.

## 7. Out of scope / future

Conversational adaptive interviewer (Approach B); note content-hash dedup; chunking for oversized
single answers; in-world dates; ongoing at-scale capture beyond QuickAdd/Notes (deemed secondary —
revisit if it still hurts after the backfill); LLM-proposed session attribution ("this sounds like
session 4").
