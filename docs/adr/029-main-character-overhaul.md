# ADR-029: Main character overhaul — mandatory single-lens protagonist, main-char-only depth, Voice Examples & derive-from-backstory

## Status

Accepted — **implemented**. Each campaign now has one **mandatory main character** (created with the
campaign) that is the **sole in-character lens**; **backstory + persona + voice examples** are
main-character-only; a new **Voice Examples** promoted field grounds Counsel/Converse; and an AI
**derive-from-backstory** tool proposes the profile for per-field approval. The ADR-024 "Saga" glossary
is reverted to **"Campaign."** Verified: typecheck + lint + the full suite (192 tests, incl. campaign
MC-creation, voiceExamples round-trip, persona voice + staleness, the voice prompt block, and the
derive-profile service).

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

The main character (ADR-022) shipped as a *soft* per-campaign default: a ★ you could put on any PC, sitting
beside a free **active-PC switcher**, while `backstory` and a `persona` existed on *every* PC. In practice
the app has one protagonist — the character you play — and the in-character lenses (Counsel, Converse) only
make sense in that one voice. The soft model diluted this: any PC could be the lens, deep character fields
were spread across the whole cast, and there was no fast way to turn a written backstory into a filled
profile. The developer wanted the main character to be the campaign's mandatory, singular protagonist and
the only lens, to concentrate character depth on it, and to bootstrap that depth from a backstory.

## Decision Drivers

* One protagonist per campaign, always present — the lens should never be ambiguous or empty by accident.
* Concentrate the deep, voice-defining fields (backstory, persona, voice examples) on the one character
  the AI speaks as; keep other PCs lightweight.
* Make an authored backstory do more work — derive the rest of the profile from it, review-gated.
* Ground the in-character voice in the character's *own words*, not just inferred traits.
* Reuse the established machinery (structured lens, promoted column, review-and-apply) — minimal new surface.

## Decision

1. **Mandatory single main character (the lens).** `createCampaign` takes an optional `mainCharacterName`;
   when present it creates the campaign, a `pc` entity of that name, and points `main_character_id` at it —
   **atomically**, in one transaction. Every creation surface (the New Campaign dialog, the onboarding
   checklist) requires it. The **active-PC switcher is removed**: a `MainCharacterBadge` displays the MC,
   locks the store's `activePcId` to it, and lets you *re-designate* it (a rare action). The lenses
   (Suggest/Counsel/Converse/Recall) read `activePcId` unchanged — they now always speak as the MC.
2. **Main-character-only depth.** `backstory` (a `pc` profile field) gains a `mainCharacterOnly` flag; the
   entity editor/detail render it — and the **persona** (PersonaEditor) — only for the MC. Other PCs keep
   name/ancestry/class/level/traits/goals/flaws; they lose backstory + persona.
3. **Voice Examples** — a first-class **promoted column** `voice_examples` (`string[]`, **migration 0009**,
   a clean nullable ADD COLUMN like traits/goals/flaws), main-character-only, edited via a `TagInput`. It
   feeds persona generation (a Voice-examples block in `personaUserPrompt`, hashed into `sourceText` so
   edits re-flag the brief stale) and is injected as a **cached "Voice examples" block right after the
   persona block** in `suggestSystemBlocks` (Counsel + Converse) and `buildSystem` (Recall in-char).
4. **Derive from backstory** — a new single-shot structured lens (`derive-profile.service` +
   `deriveProfileCall`), modelled on Converse: it reads the MC's backstory and proposes
   `{description, traits, goals, flaws, voiceExamples, persona}`. A `DeriveReview` dialog shows each field
   with an accept toggle; Apply writes accepted entity fields (`entity.update`) + the accepted persona
   (`persona.update`, now clearing `stale` + re-syncing the source hash so it isn't regenerated away).
   Nothing writes without approval; the prompt grounds strictly in the backstory.
5. **Wording** — the ADR-024 Campaign→Saga rename is reverted to **Campaign** (copy only; the rest of the
   Ash & Ember glossary stands).

## Rationale

Collapsing "active PC" into "main character" is the honest model: only the MC has a persona, so no other PC
*can* be a grounded lens — a switcher was a trap. Making the MC mandatory-at-creation guarantees the lens is
always present, and doing it atomically keeps the invariant true at the data layer. Voice examples are the
highest-leverage grounding we can add — a character's own lines pin diction/rhythm/attitude better than any
inferred trait — so they earn a promoted column (uniform with traits/goals/flaws) and ride the same cached
prefix as the persona. The derive tool turns the one thing a player always writes (a backstory) into the
whole profile, while the per-field review keeps the human in control of their own canon. Everything reuses
an existing pattern: the structured-lens shape (Converse), the promoted-column plumbing (flaws, ADR-026),
and the toggle-and-apply review (ADR-028).

## Consequences

### Positive
- Counsel/Converse always speak as one well-grounded protagonist, in that character's actual voice.
- Character depth is concentrated where it matters; other PCs stay lightweight.
- A written backstory bootstraps the entire profile in one review-gated pass.
- No new subsystems — promoted column + structured lens + review, all established patterns.

### Negative
- Removing the switcher is a behavior change; the badge MUST allow re-designation or it's a trap.
- The derive tool is a new AI surface (mitigated: main-char-only, review-gated, backstory-grounded).

### Risks & Mitigations
- **Grandfathered campaigns** with `main_character_id = null` (pre-029, or an odd import) → the badge shows
  "Set a main character" and the lenses keep their existing empty state until one is set. No data migration.
- **Non-main PCs with a legacy backstory/persona** → the value stays in the DB but is hidden/unused. Harmless.
- **The derived persona being regenerated away** → `updatePersona` now clears `stale` and re-syncs the
  source hash, so an approved brief sticks even though applying fields flags the old one stale.
- **Migration 0009** needs a full restart; clean nullable ADD COLUMN (no rebuild). Does **not** re-embed
  (`entityText` is unchanged — voice lines aren't retrieval facts).

## Related Decisions

- ADR-022 — main character + journal capture; this **supersedes its soft-default** parts (the ★-on-any-PC
  model + the active-PC switcher).
- ADR-024 — the grim re-theme; this **partially reverses** it (Saga → Campaign).
- ADR-026 — promoted `flaws` + the per-type profile fields the derive tool edits; the persona brief template.
- ADR-025 — Converse; the single-shot structured-lens shape the derive tool + voice grounding reuse.
- ADR-017 — chronology; deliberately **not** extended (voice/backstory aren't as-of versioned).

## References

- `src/main/db/schema.ts` (`entity.voice_examples`), `drizzle/0009_superb_shatterstar.sql`.
- `src/shared/{entity-types,ipc-types,entity-profiles,derive-profile-types}.ts`.
- `src/main/services/{campaign,entity,persona,derive-profile}.service.ts`,
  `src/main/services/claude.service.ts` (`voiceExamplesBlock`, `SuggestContext`/`RecallContext`,
  `deriveProfileCall`), `src/main/ipc/derive-profile.ts`.
- Renderer: `components/layout/Sidebar.tsx` (`MainCharacterBadge` + New Campaign dialog),
  `components/entities/{EntityForm,EntityDetail,DeriveReview}.tsx`, `hooks/use-derive-profile.ts`,
  `components/OnboardingChecklist.tsx`.
- Tests: `campaign.service.test.ts`, `entity.service.test.ts`, `persona.service.test.ts`,
  `suggest-prompt.test.ts`, `derive-profile.service.test.ts`.
