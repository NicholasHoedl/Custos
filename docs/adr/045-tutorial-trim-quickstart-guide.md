# ADR-045: Trim the first-run tutorial + an always-available Quickstart guide

## Status

Accepted — **implemented**. Revises **ADR-044**. The forced first-run tutorial drops its chronicle-entry
and close-out/Illuminate steps (now setup-only: name → campaign → main character → session → validated key
→ tool tour → done; 9 steps, was 11). The capture→close-out loop it used to run is instead taught by a new
**always-available Quickstart guide**, opened from an out-of-the-way button at the bottom of the sidebar.
Verified: typecheck + lint + 263 unit + **17 e2e**.

**Date:** 2026-07-12
**Deciders:** Solo developer

## Context

ADR-044's forced tutorial walked a new user through the entire usage loop on first run — add a chronicle
entry, then run a **real** close-out → Illuminate — before they could finish. That front-loaded the
hardest, most AI-dependent ritual (a live key + a real extraction call) just to get into the app. We want
first-run to guarantee a usable campaign *without* forcing the whole loop, and to teach the loop somewhere
that's always available rather than only once.

## Decision

**1. Trim the tutorial to setup-only.** Remove the `chronicle` (add-a-log-entry) and `closeout` steps from
`TutorialOverlay`'s step machine and all code coupled to them. Keep — per the user's explicit choices — the
auto-created first session (so they still finish with a campaign, main character, and an empty Session 1)
and the **hard-required, live-validated** Anthropic key step. New flow: welcome → campaign → character →
session → apikey → tour ×3 → done. The step machine is index/name-driven (`STEPS[stepIndex]`,
`totalSteps = STEPS.length`), so removal auto-renumbers with no hardcoded counts in the component.

**2. Expand the API-key step with "how to get a key."** With close-out gone the key step stands alone, so a
brand-new user needs to know how to obtain a key. The step now shows a numbered walkthrough (Console → sign
in → add a little credit → Create Key → paste) alongside the existing live-validate + error banner. The
same steps appear in the Quickstart guide.

**3. Add an always-available Quickstart guide.** A new `QuickstartGuide` dialog (shadcn `Dialog`) opened
from an unobtrusive `HelpCircle` "Guide" button pinned to the **bottom of the sidebar** (below the `flex-1`
nav, which had empty space). It covers the core loop (Chronicle → Close out → Illuminate → Ask), every tool
grouped as in the tutorial tour, and getting-started notes (key + search model, with the how-to-get-a-key
steps). It backstops the loop teaching the trimmed tutorial no longer runs, and it's reachable any time —
not just on first run.

**4. One shared content source.** The tool blurbs, tour groups, loop steps, and get-a-key steps move to
`lib/guide-content.tsx` (mirrors `lib/nav-items.tsx`), consumed by the tutorial tour, the Quickstart guide,
the Chronicle `LoopExplainer`, and the key step — so the surfaces never drift on copy.

The `tutorialCompleted` gate, the `LEDGER_SKIP_TUTORIAL` e2e seam, and the existing-campaign skip
(`listCampaigns(ctx).length > 0`) from ADR-044 are unchanged. The guide sits under the z-40 tutorial
overlay, so it's only reachable once onboarding is done.

## Consequences

### Positive
- First-run is lighter: a new user reaches a usable campaign without being forced through a live AI
  close-out, yet still can't finish without a validated key.
- The core loop is now taught somewhere permanent (the guide) instead of only once, and the key step tells
  users how to actually get a key.
- Copy for the tools/loop/key-steps has a single source, shared across four surfaces.

### Negative / Risks
- The loop is no longer *run* during onboarding — only described (the guide + the JournalView
  `LoopExplainer` card). Accepted: the guide is one click away, and the close-out button carries its own
  unclosed-session nudge (ADR-037).
- A user could finish onboarding and never open the guide; the `done` step points them to it explicitly.

## Related Decisions
- **Revises ADR-044** (forced first-run tutorial): same gate + seam, fewer steps, plus the guide.
- Reuses **ADR-035** (the close-out ritual — now taught, not run) and **ADR-041/043** (the fake-AI seam the
  e2e still uses for the key-validate step).

## References
- Renderer: `components/onboarding/TutorialOverlay.tsx` (trimmed + expanded key step),
  `components/onboarding/QuickstartGuide.tsx` (NEW), `components/onboarding/LoopExplainer.tsx` (shared
  steps), `components/layout/Sidebar.tsx` (bottom-left Guide button), `lib/guide-content.tsx` (NEW shared
  copy).
- Tests: `tests/e2e/tutorial.spec.ts` (trimmed flow + the guide-opens check).
