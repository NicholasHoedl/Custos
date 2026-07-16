# ADR-044: Forced first-run tutorial (guided modal wizard)

## Status

Accepted — **implemented**. A non-skippable first-run wizard replaces the old optional onboarding cards:
it creates a real campaign + main character + session, teaches the capture→close-out loop by running a
**real** close-out, and tours every tool. The navbar is reordered to the teaching sequence (Chronicle
first). Verified: typecheck + lint + 263 unit + **17 e2e** (the new `tutorial.spec.ts` drives the whole
flow under the fake-AI seam; the other 16 auto-skip it).

> **Revised by [ADR-045](045-tutorial-trim-quickstart-guide.md) (2026-07-12):** the chronicle-entry and
> real-close-out steps described below were later **removed** — the first-run tutorial is now **setup-only**
> (it still creates the campaign + main character + session and requires a live-validated key), and the
> capture→close-out loop is taught by the always-available **Quickstart guide** instead. The rest of this
> ADR stands as the original decision.
>
> **Revised again by [ADR-059](059-spotlight-tutorial.md) (2026-07-16):** the wizard *presentation* was
> replaced by a welcome page + an in-app **spotlight tour** (the real controls, highlighted and forced),
> and the gate gained a `tutorialStep` mid-tour-resume clause. The purpose, key requirement, and
> non-skippability stand.

**Date:** 2026-07-11
**Deciders:** Solo developer

## Context

Onboarding was entirely optional — `OnboardingChecklist` + `LoopExplainer`, dismissible empty-state cards.
A brand-new user was dropped into a blank nine-view app with no guidance and no data. The goal: guarantee
that after first launch a user has a campaign, a character, and a session, and understands the core loop
and what each tool is for.

## Decision

**A forced, non-skippable guided modal wizard** (`components/onboarding/TutorialOverlay.tsx`), mounted in
`AppShell` above the whole app. Decisions taken with the user:

- **Guided modal wizard**, not interactive coach-marks — self-contained, robust, e2e-testable. Steps:
  name → campaign → main character (→ atomic `campaign.create({ name, mainCharacterName })`) → first
  session → add a real chronicle entry → **API key** → **real close-out** → a 3-screen tool tour → finish.
- **The API-key step is hard-required and live-validated.** `apikey.set` then `apikey.validate()` (a real
  auth call); the wizard advances only on a valid key. A user with no key cannot finish — the deliberate
  cost of "the tutorial can't be skipped" (the step links to where to get a key; the one-line softening if
  it ever proves too strict is a "set up later" escape).
- **The close-out is the real thing** — the wizard renders the actual `CloseOutDialog` (which portals
  above the overlay) and the user runs extract → review → apply → Illuminate → done, so they learn the
  ritual by doing it, not reading about it. It advances on the dialog's close (never trapping them).
- **Non-skippable** — a plain `fixed inset-0` overlay (not a Radix dialog): no close/X/Esc/overlay-click
  exit, and the app's Ctrl+K / Ctrl+F shortcuts are disabled while it's active. Only Back and each step's
  gated primary action move through it.
- **Navbar reordered** to the data lifecycle the tutorial teaches — **Chronicle · Sessions · Character ·
  Codex · Web · Lore · Counsel · Converse · Settings** (`NAV_ITEMS`, reordering the Sidebar + Ctrl+K
  palette together). This **revises ADR-030's "Character first-in-nav"** — Character stays the MC's home,
  just not first; the default landing (`ui-store` `activeView: 'journal'`) is already Chronicle.

**Gate + persistence.** `AppSettings` gains `userName?` (the Keeper's greeting) + `tutorialCompleted?`
(persisted in `settings.json`). `onboarding:status` returns a computed `tutorialDone`
(`getSettings().tutorialCompleted === true || tutorialSkipped()`); `AppShell` renders the overlay while
`tutorialDone === false` (and a blank canvas until the status resolves, so the app never flashes first).
On finish the wizard writes `tutorialCompleted: true` and dismisses the legacy `OnboardingChecklist` +
`LoopExplainer` localStorage flags (it supersedes them).

**e2e seam.** A fresh test DB has no settings → `tutorialCompleted` false → the overlay would block every
spec. `launchApp` sets **`LEDGER_SKIP_TUTORIAL`** by default (→ `tutorialSkipped()` in `ai-fake.ts`, same
`!app.isPackaged` guard as the AI seam); `launchApp({ tutorial: true })` opts in. The tutorial spec runs
under `fakeAi` so the key-validate (`apikey:validate` returns valid under the flag) and the close-out run
offline.

**Anthropic-only, by explicit decision.** The user also asked to accept OpenAI/Gemini keys. That is a full
AI-backend rebuild (provider abstraction over the Anthropic-only `claude.service`: three SDKs, per-provider
structured-output/streaming/models/pricing/validation/key storage) — **out of scope here and deferred** to
its own project (backlog in `docs/ROADMAP.md`). The tutorial validates an **Anthropic** key.

## Consequences

### Positive
- Every new user ends first-run with a working campaign/character/session and a mental model of the loop
  and the tools — no more blank-app cold start.
- The wizard reuses the real create/session/event seams and the real `CloseOutDialog`, so it teaches the
  actual product, and it's fully e2e-covered.

### Negative / Risks
- **Hard-required key blocks keyless users** (the user's explicit choice). A one-line "set up later" escape
  is the mitigation if needed.
- Reusing the real `CloseOutDialog` inside the overlay relies on the Radix portal stacking above the z-40
  overlay (verified in e2e). Its graceful-failure exit advances the wizard rather than trapping.
- Quitting mid-tutorial (before Finish) restarts it next launch and may leave a half-made campaign — an
  in-run create-once guard prevents duplicates within a run; across restarts it's an accepted edge.

## Related Decisions
- Revises **ADR-030** (Character-first nav). Reuses **ADR-029/030** (atomic campaign+MC), **ADR-035**
  (the close-out ritual it runs), **ADR-041/043** (the fake-AI seam the e2e rides + the validate fake).

## References
- Renderer: `components/onboarding/TutorialOverlay.tsx`; `components/layout/AppShell.tsx` (gate + shortcut
  disable); `lib/nav-items.tsx` (reorder).
- Main/shared: `shared/entity-types.ts` (`AppSettings`), `services/settings.service.ts`,
  `shared/recall-types.ts` (`OnboardingStatus.tutorialDone`), `ipc/onboarding.ts`, `ipc/settings.ts`
  (validate fake), `services/ai-fake.ts` (`tutorialSkipped`).
- Tests: `tests/e2e/helpers.ts` (`launchApp({ tutorial })`), `tests/e2e/tutorial.spec.ts`.
