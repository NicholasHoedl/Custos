# ADR-010: Global quick-add hotkey behavior

## Status

Accepted — **Option A (focus/show the main window with the quick-add bar focused)** shipped: a single-instance lock + a configurable `globalShortcut` in `src/main/index.ts` that focuses the window and sends the quick-add-focus channel to the renderer. The dedicated popup (Option B) was not built. *(Finalized 2026-07-01 to match the implementation.)*

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

The developer wants a **system-level global quick-add hotkey** so they can capture a note while
another app (a VTT, a PDF, a browser) is focused at the table. The window/main architecture must
support it from Phase 0 (single-instance lock + `globalShortcut` — scaffolded in ROADMAP P0-07).
The open sub-decision is **what the hotkey does when pressed**.

## Decision Drivers

* **Minimal disruption** to live play
* Fast capture into the active campaign/session
* Simple, reliable window behavior on Windows
* Reuse of the existing quick-add UI where possible

## Considered Options

### Option A: Focus/show the main window with the quick-add bar focused
- **Pros:** reuses the existing `QuickAddBar`; simplest to build; one window to manage.
- **Cons:** pulls the user out of their current app into the full Ledger window — a heavier
  context switch at the table.

### Option B: A dedicated frameless, always-on-top quick-capture popup
- **Pros:** least disruptive — a small overlay that captures to the active campaign/session and
  dismisses, leaving the user in their game; feels purpose-built.
- **Cons:** a second `BrowserWindow` with its own minimal UI and lifecycle; a bit more code; it
  must share state/services with the main window.

## Decision

**Accepted: Option A** — the global hotkey shows/focuses the main window with the `QuickAddBar`
focused (`src/main/index.ts`; the hotkey is configurable). Option B (a dedicated frameless
quick-capture popup) was considered lower-priority and deferred; Option A shipped as the pragmatic,
low-effort choice and has proven sufficient in practice.

## Rationale

The point of a global hotkey is to capture **without leaving the moment of play**; a small popup
serves that far better than raising the full app. But the popup is more work — so for v1 the
low-effort **Option A** shipped and has proven sufficient; the popup (Option B) remains a possible
future enhancement.

## Consequences

### Positive
- (B) Minimal interruption; purpose-built capture.

### Negative
- (B) An extra window + UI + state-sharing. (A) Simpler, but more disruptive.

### Risks & Mitigations
- A global shortcut may conflict with another app's binding → make the hotkey **configurable**.
- Both options require `app.requestSingleInstanceLock()` + `globalShortcut` (P0-07) regardless of
  the choice.

## Related Decisions

- ADR-006 — the second window (if Option B) is built with the same tooling

## References

- `../../ARCHITECTURE.md` §3 (Global Quick-Add Hotkey)
- `../../ROADMAP.md` P0-07, P1-07
- `../../SPEC.md` Flow B
