# ADR-036: Chronicle-header consolidation — Transcribe becomes a dialog; the session selector moves in

## Status

Accepted — **implemented**. Transcribe left the main nav (revising ADR-032's promotion) for a button on
the Chronicle header that opens a dialog; the active-session selector moved from the Sidebar into the
same header. Renderer-only. Verified with the full suite + the reordered e2e capture spec.

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

Streamlining pass alongside ADR-035. Two observations drove it: (1) Transcribe is an occasional bulk
tool, not a daily destination — a top-level nav slot overweights it; (2) the **active session's true
footprint is capture-only**. A consumer audit found exactly three surfaces read `activeSessionId`:
Chronicle (log + entries + extraction apply), Transcribe's default target (overridable), and **Annals
manual notes** (`note.sessionId`). Every other surface a user might expect to follow it — entity
creates, Ctrl+K quick-add, status edits, tie creates — already ignores it and stamps via the
main-process **latest-session** fallback (`resolveCaptureSessionNumber`); SessionsView and recap are
fully decoupled. So the selector belongs on the capture hub, not in global chrome.

## Decision

- **Transcribe → `TranscribeDialog`** (`components/capture/TranscribeDialog.tsx`), opened from an
  out-of-the-way outline button on the Chronicle header. The body is the old ImportView wholesale
  (paste → extract → review → apply, keeping the active/specific/undated `SessionPicker`), now running
  tier-1 **'capture'** extraction (ADR-035). Nav cleanup: the `'import'` ViewKey, Sidebar NAV entry, and
  MainPanel route are deleted along with `views/ImportView.tsx` (zero inbound `setActiveView('import')`
  callers existed). **State survives close/reopen** — a paste isn't re-derivable, so an accidental Esc
  mid-review must not discard it; only Discard/apply/"Transcribe more" reset. (Contrast EnrichDialog,
  which resets on close: everything there is re-derivable from the DB.)
- **SessionControl → the Chronicle header.** Extracted verbatim from the Sidebar into
  `components/sessions/SessionControl.tsx` (+ a `className` prop) and mounted in the header's action
  cluster — which hosts THREE controls: **SessionControl · Transcribe · Close out session** (the
  ADR-035 ritual). **The auto-select-latest invariant survives the move:** MainPanel keeps every view mounted
  (hidden, not unmounted) and JournalView renders EventFeed whenever a campaign is active, so the
  relocated effect keeps healing `activeSessionId` (first load, deleted session — including deletes made
  from SessionsView) exactly as the always-visible Sidebar mount did.
- **Annals stays honest.** `NotesView` keeps stamping the active session but now shows a read-only
  "Filing under Session N" (or "Undated") hint in the composer footer — with the control on another
  view, filing must never be silent (a mis-filed note lands in the wrong recap and the wrong as-of
  window).

## Consequences

### Positive
- The sidebar slims to campaign + identity + nav; the session context lives where session-stamped
  capture happens — and Transcribe sits inside that same context.
- One fewer top-level view; the label↔code inventory shrinks.

### Negative / Risks
- The active session is only *changeable* from Chronicle; other views see it via the Annals hint (and
  Transcribe's picker). Acceptable for a solo, Chronicle-centric workflow.
- A historical Transcribe paste now needs a follow-up Illuminate run for ties/fields (ADR-035's split,
  restated here because the demotion is where users will feel it).
- The e2e capture spec had to create its session from the Chronicle header *before* navigating to Codex.

## Related Decisions
- ADR-032 (the nav structure this revises), ADR-035 (the tier split shipped alongside), ADR-020 (the
  per-campaign session persistence the selector rides on), ADR-017/021 (why a note's session number
  matters: recap membership + as-of reconstruction).

## References
- `components/capture/TranscribeDialog.tsx`, `components/capture/EventFeed.tsx` (header),
  `components/sessions/SessionControl.tsx`, `components/layout/{Sidebar,MainPanel}.tsx`,
  `store/ui-store.ts` (ViewKey), `components/views/NotesView.tsx` (filing hint);
  deleted: `components/views/ImportView.tsx`. Test: `tests/e2e/capture.spec.ts`.
