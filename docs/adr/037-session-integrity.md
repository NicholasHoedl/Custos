# ADR-037: Session integrity — a derived "unclosed" signal + editable chronicle entries

## Status

Accepted — **implemented**. Two small session-integrity features from the professional-grade audit
([docs/ROADMAP.md](../ROADMAP.md) P1-2 + P1-4). No migration (the unclosed signal is derived from
existing timestamps; entry edit/delete uses existing columns). Verified: typecheck + lint + full suite
(252 tests; new coverage for `unclosedCounts` and event edit/delete).

**Date:** 2026-07-09
**Deciders:** Solo developer

## Context

The two-tier extraction ritual (ADR-035) makes close-out the only path from raw chronicle entries to
recorded entities/notes. Two gaps the audit surfaced:

1. **Nothing tells you a session has un-extracted entries.** A forgotten close-out silently loses the
   drift — no badge, no count. ADR-035 flagged this as deferred.
2. **Chronicle entries were immortal.** `event.service` was create/list only; a typo in a logged line
   could never be fixed or removed.

## Decision

**Unclosed signal — DERIVE it, don't add a `lastClosedOut` column.** Close-out already stamps its
notes at the session (`applyChangeset` → `createNote` with `sessionId`, `createdAt = now()`), so the
newest note time per session *is* the last-close-out marker. A session's entry is "unclosed" when its
`event_log.timestamp` is newer than that session's newest `note.createdAt`.
`session.service.unclosedCounts(campaignId)` computes this with two grouped reads combined in memory
(event volume per campaign is small; mirrors `enrich.service.listTouchedEntities`' style) and returns a
sparse `Record<sessionId, count>`. Illuminate proposes no notes, so it never moves the marker; a
campaign-lore note (null session) stamps nothing. A zero-entry session is never flagged.

*Why derive rather than stamp:* a `lastClosedOutAt` column would need a migration, a write on every
close-out, and would drift from the notes it's meant to track (re-running close-out, undated batches).
The timestamp comparison is exact, needs no schema change, and self-corrects. The renderer surfaces it
as a count badge on the Chronicle header's **Close out session** button (active session) and on the
Sessions-list rows, via `useUnclosedSessions` (refetched on the sessions version bump, which entry
add/edit/delete and close-out apply all fire).

**Chronicle entry edit/delete — allow ALWAYS (not gated on close-out).** `event_log` has no inbound
FKs, so delete is an unconstrained single row delete; `updateEvent` changes content and leaves the
timestamp untouched so the entry keeps its position in the oldest-first log. Editing/deleting an entry
**after** close-out does not retroactively change the notes already extracted from it — they're
independent records (ADR-014/035). A per-entry hint (`title` on the edit action) says so. Gating edits
on the unclosed signal was considered and rejected: it adds coupling for no data-integrity benefit
(the raw log is a capture surface, not the system of record). The UI reuses the P0-1 pattern —
hover/focus-revealed actions + a shared confirm dialog (`DeleteEventDialog`, modeled on
`DeleteNoteDialog`); edit swaps the line for an inline textarea (Ctrl+Enter saves, Esc cancels).

## Consequences

### Positive
- A forgotten close-out is now visible at a glance, in both places a user would look.
- Typos in the at-the-table log are fixable; the log is no longer append-only.
- Zero schema change, zero migration — consistent with the whole audit arc.

### Negative / Risks
- The unclosed signal is a heuristic on timestamps, not a recorded fact: a manual note added to a
  session (via Annals) after entries would clear the badge even though those entries weren't extracted.
  Accepted — Annals notes at a session are themselves a form of "recorded," and the badge is a nudge,
  not an audit.
- Editing an entry after close-out can make the log and the extracted notes disagree; the hint
  discloses this rather than preventing it.

## Related Decisions
- ADR-035 (two-tier extraction / close-out — the ritual this nudges toward; deferred this nudge),
  ADR-014 (changeset apply — notes are independent records), ADR-017 (session-number chronology),
  ADR-036 (the Chronicle header that hosts the badge).

## References
- Services: `session.service.ts` (`unclosedCounts`), `event.service.ts` (`updateEvent`/`deleteEvent`).
- IPC/types: `session:unclosed`, `event:update`, `event:delete` (`ipc/session.ts`, `ipc/event.ts`,
  `shared/ipc-types.ts`, `preload/index.ts`).
- Renderer: `hooks/use-ledger.ts` (`useUnclosedSessions`), `capture/EventFeed.tsx` (badge + `EntryRow`),
  `capture/DeleteEventDialog.tsx`, `views/SessionsView.tsx` (row badge).
- Tests: `tests/unit/services/session-integrity.test.ts`.
