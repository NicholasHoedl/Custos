# ADR-059: Spotlight tutorial — a welcome page, then a guided tour of the real app

## Status

Accepted — **implemented**. Supersedes the *presentation* of ADR-044/045 (the full-screen 9-step wizard);
the gate's purpose, the validated-key requirement, non-skippability, the `LEDGER_SKIP_TUTORIAL` e2e seam,
and the Quickstart guide all stand. New: `onboarding/Spotlight.tsx` + `WelcomeCard.tsx`;
`TutorialOverlay.tsx` rewritten in place as the tour controller; a pure `onboarding-gate.ts` +
`AppSettings.tutorialStep` for mid-tour resume. No migration (settings are JSON).

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

The ADR-044/045 wizard owned its own forms: a user typed the campaign, character, session, and key into
tutorial pages and never touched the application itself — then was dropped into an interface they had
never seen. The user wants onboarding to *teach the real app*: capture the name on one welcome page, then
guide every remaining step **inside the application**, forcing the real controls and explaining the tool
groups where they actually live (the sidebar), plus the newer surfaces the wizard never covered (Report a
bug, the Quickstart guide).

## Decision

1. **One full-screen page only** (`WelcomeCard`): a welcome message (`WELCOME_COPY` in
   `guide-content.tsx`, **placeholder copy — to be rewritten**) + the user's name. Submit writes
   `userName` + `tutorialStep:'campaign'` (awaited) and drops into the app.
2. **A spotlight tour for everything else** (`Spotlight.tsx`): four click-blocking scrim rects around a
   ring-highlighted cutout over one real control (found via new **`data-tour` attributes** — the repo's
   first and only test/tour hooks), with a non-dismissable Radix Popover coach mark anchored to the
   cutout. Layering verified: the scrim renders inline in AppShell at z-40, so every Radix portal
   (the campaign dialog, this popover — z-50 at body end) sits above it and stays interactive.
3. **Steps** (linear, no Back): campaign (ACTION — the real `CreateCampaignDialog`, which creates the
   main character atomically per ADR-029, so one step covers both) → character (INFO — the Character nav)
   → session (ACTION — the Chronicle header's New-session button) → apikey (ACTION — auto-navigates to
   Settings, whose orientation folds into this popup; requires a **validated** key, today's bar) → the
   three nav-group INFO steps (`TOUR_GROUPS`, with **Continuity added to the ask group** — a fix the
   Quickstart guide inherits) → Report a bug (INFO) → Guide (INFO, Finish).
4. **Action steps advance by watching state**, not by owning forms: campaigns list non-empty /
   `activeSessionId` set / key validates. That makes them **idempotent** — already-satisfied steps
   fast-forward, which is the whole resume story. The key step gets its missing push signal via a
   `keySavedNonce` in the ui-store, bumped by `SettingsView.saveKey`; the tour validates once per bump
   (one extra cheap auth ping after SettingsView's own validation — accepted).
5. **`tutorialStep` persistence + gate rework.** Each advance fire-and-forgets
   `settings.set({tutorialStep})`; Finish writes `tutorialCompleted` and clears the step. The gate becomes
   the pure `deriveTutorialDone`: `completed || skipped || (campaigns > 0 && tutorialStep === undefined)`.
   The new clause fixes a real bug: the tour creates a REAL campaign at step 1, so the old bare
   "campaigns exist ⇒ onboarded" would silently mark a mid-tour relaunch done and strand the rest of the
   tour. Grandfathering matrix: pre-tutorial data (campaigns, no step) → done; mid-tour (step set) →
   resume; fresh → welcome; completed → done.

## Consequences

* **+** Onboarding teaches the actual interface; every artifact (campaign/MC/session/key) is created
  through the same UI the user will use forever.
* **+** Resume-safe (`tutorialStep` + idempotent detectors + a campaign-auto-select guard for a wiped
  localStorage); unit-tested gate.
* **−** Pointer-blocking only — Tab can still reach greyed controls (parity with the old overlay, which
  had no focus trap either); the detectors keep the tour consistent regardless.
* **−** A Radix dialog opened mid-step adds its own overlay dim above the scrim (double-dim; cosmetic).
* **−** EventFeed's secondary "Start session" empty-state button is scrim-blocked during the session step
  (single forced path); the state-based detector would accept it anyway if reached.
* A user who quit inside the OLD wizard after creating a campaign (no `tutorialStep`) now counts as
  grandfathered-done rather than restarting — acceptable.

Verified: typecheck + lint + unit (incl. the new `onboarding-gate` cases) + the rewritten
`tutorial.spec.ts` e2e; manual walk-through + resume + grandfathering per the plan's recipe.
