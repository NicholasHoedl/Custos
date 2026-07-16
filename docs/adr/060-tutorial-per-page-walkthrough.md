# ADR-060: Tutorial per-page walkthrough + Report-a-bug moves into Settings

## Status

Accepted — **implemented**. Revises **ADR-059** (the spotlight machinery — Spotlight primitives, the
`tutorialStep` resume, the pure gate, `data-tour` targets — all stands; the step table is replaced) and,
in passing, **ADR-057/058** (the bug-report *launcher*). No migration.

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

ADR-059's 9-step tour taught the tool groups from the sidebar without ever showing the pages. The user
wants the tour to *walk the app page by page*: after each forced action, show the actual page — content
fully visible, not greyed — with the explanation sitting over the navbar; give the Sessions page's four
tools individual highlights; use the lenses' key requirement as the natural segue into the API-key step;
let the user look (and scroll) around Settings read-only; and close on a front-and-center review card.

## Decision

1. **Two new step kinds** join ACTION/INFO in `onboarding/Spotlight.tsx`:
   - **PAGE** (`PageOverlay`): navigate to the view; a transparent full-viewport blocker makes the whole
     app view-only; only the sidebar is dimmed; the coach card is fixed **over the navbar** (left,
     vertically centered) so nothing covers the content being described. The settings stop passes a
     `scrollSelector` whose wheel events forward to the page's scroll container — look around,
     read-only.
   - **REVIEW** (`ReviewShell`): a dimmed backdrop + centered scrollable card.
2. **The 19-stop sequence** (welcome unchanged): campaign (ACTION) → Character page → Chronicle page →
   session (ACTION) → the composer (INFO, explain-only — user-confirmed, no forced first entry) →
   Sessions page → Extract → Illuminate → Transcribe → Generate recap (INFO each, new
   `data-tour="tool-*"` attrs; the newest session auto-selects so they render) → Codex → Web → Lore →
   Counsel → Converse → Continuity (PAGE each; Continuity's copy carries the key segue) → apikey
   (ACTION, key-only copy now) → Settings page (PAGE, scrollable; explains Settings + Report a bug's new
   home) → review (REVIEW: the loop via `LOOP_STEPS`, the tool purposes via `TOUR_GROUPS`/`TOOL_BLURBS`,
   the Quickstart pointer, and **`REVIEW_COPY` — a placeholder closing message the user writes**, the
   second such placeholder beside `WELCOME_COPY`).
3. **Report a bug moves into Settings** — a "Report a bug" section (after "Your data") owns the dialog;
   the sidebar launcher is deleted. The **window-snap-before-open is dropped end-to-end**
   (user-confirmed): from Settings the snap only ever captured Settings, so `bugreport:capture` (IPC +
   preload + `initialShot`) is removed and screenshots are attached by hand (paste/drag/picker — the
   dialog copy nudges).

## Consequences

* **+** The tour shows every page in its real state; explanations sit beside, not on top of, what they
  describe.
* **+** The composer, the four session tools, and the bug reporter each get taught exactly where they
  live.
* **−** 19 stops is long — mitigated by the resume machinery (quit any time, pick up where you left off)
  and by Next-through pacing on info/page stops.
* **−** Profiles mid-tour on the OLD step ids resume at `campaign` and fast-forward (validateResume's
  unknown-id fallback) — test profiles only; nothing shipped.
* Bug-report screenshots are now always manual; the auto-snap's occasional value is traded for the
  cleaner Settings home.

Verified: typecheck + lint + unit + the rewritten `tutorial.spec.ts` (all 20 stops) + `bugreport.spec.ts`
(Settings-first) + the full e2e suite.
