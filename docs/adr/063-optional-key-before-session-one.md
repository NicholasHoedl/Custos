# ADR-063: The onboarding API key is optional (Skip for now) + before-session-1 needs-attention items

## Status

Accepted — **implemented**. A "Skip for now" button on the tutorial's apikey step; two new Home
needs-attention items ("Fill in your character", "Start your first session"); `PersonaEditor.generate`
now bumps `entitiesVersion`. No migration. Revises ADR-044/060's hard-required key.

**Date:** 2026-07-17
**Deciders:** Solo developer

## Context

The forced first-run tutorial (ADR-044, kept by ADR-060) made adding a **validated** Anthropic key a HARD
gate — the apikey step's only exit was a valid key. Yet the Home dashboard's "Needs attention" strip still
shows an "Add your Anthropic API key" nag, which reads as contradictory: onboarding required it, so why nag?
The reconciliation: make the key **optional**, so the Home nag becomes the honest reminder (appears iff no
key is saved, disappears once one is). Separately, a brand-new campaign has a bare main character (just a
name) and — for campaigns created outside onboarding — no session; the strip should nudge those
before-you-play setup tasks too.

## Decision

1. **Skippable key step.** The apikey ACTION step gains a "Skip for now" button (reusing the INFO steps'
   `nextRow` shape) that calls `advance('settings-page')`. `deriveTutorialDone` never inspected a key and
   the two remaining steps (settings-page, review) are key-agnostic, so a skip finishes the tour cleanly.
   Copy softened (apikey body + the Continuity segue) to say the key can be added later. `keyReady` /
   `apikey:exists` stay honest (only `apikey:validate` is faked for e2e), so a skipped tour lands on a Home
   that correctly shows the key reminder.
2. **"Fill in your character" needs-attention item.** Shown until the MC has a **generated persona** — the
   full signal that grounds Lore/Counsel/Converse, chosen over cheaper backstory/profile checks because the
   persona is the payoff that makes the AI speak as the character. Persona lives in `pc_persona` (not on the
   entity), so a local `useMcPersonaReady` hook reads `ledger.persona.get(mcId)` (refetch on
   `entitiesVersion`). For it to clear live, `PersonaEditor.generate` now bumps `entitiesVersion`
   (DeriveReview's post-derive generate already did). Action → the Character page.
3. **"Start your first session" needs-attention item.** Shown when a campaign has no sessions
   (`needsFirstSession(sessions)`, a pure `dashboard.ts` selector, loading-guarded). Won't fire right after
   onboarding (which creates Session 1) but covers campaigns created via the + button. Action → Chronicle.

Both new items render as `SetupCard`s (the accent, aspirational style the key/model nags use), grouped
before the neutral unclosed/health `AttentionRow`s. The "✓ The record itself is consistent" line stays
scoped to record consistency (health + unclosed) and coexists with setup nags, as before.

## Consequences

* **+** The Home key nag is now truthful — it's the reminder for a genuinely-skipped key, not a redundant
  prompt after a forced one.
* **+** A post-onboarding campaign gets a clear "what to do before session 1" list (fill in your character);
  a +button campaign additionally gets "start your first session". An established campaign (persona set, ≥1
  session) shows neither — no nagging.
* **+** Keyless users can complete onboarding and explore the app; each AI lens already renders a
  `!keyReady` empty/disabled state, so no new failure surface.
* **−** The character item costs one `persona.get` IPC per Home mount + on `entitiesVersion` (mirrors the
  record-health probe; trivial).
* Reverses ADR-044/060's "hard-required validated key." The tour stays linear/no-Back; the API-key step is
  now its one opt-out.
