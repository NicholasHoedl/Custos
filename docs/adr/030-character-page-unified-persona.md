# ADR-030: Character page + unified persona

## Status

Accepted — **implemented**. A single canonical persona generator (the derive tool stops emitting its own
persona), and a dedicated **first-in-nav Character page** that is the one home for the main character —
set/re-designate it there, manage its full profile. The sidebar badge becomes a read-only "Playing as X"
indicator; Codex marks the main character with a ★ that redirects to the page. Verified: typecheck + lint +
the full suite (192 tests).

**As-built refinement:** the dashboard was reworked from a reused `EntityDetail` into a **bespoke,
two-column** component (`CharacterDashboard.tsx`) — text fields edit in place and save on blur (silent
autosave; error-toast only), and the **Suggest** action lives on the backstory card: disabled with a hint
when there's no backstory, and disabled after a run until the backstory changes (a session-local guard).
It composes the same self-contained pieces (`PersonaEditor`, `StatusCombobox`, `RelationshipEditor`,
`EntityHistory`, `DeriveReview`). `EntityDetail` still serves Codex (its main-character derive surface was
removed — dead code once Codex redirects the MC here).

**As-built v3:** (a) the four promoted **lists** (traits/goals/flaws/voice) are **read-only chips** with a
per-card **Edit → `ListEditDialog`** popup (editable rows + delete + add; explicit Save/Cancel; one batched
write per editing session — replacing the inline TagInputs and their save-race machinery). (b) **Suggest is
a two-step wizard**: Step 1 = the profile fields (as before); Step 2 = the backstory run through the
**shared changeset engine** (`useImport({withChanges:true})` + `ChangesetReview`) proposing **new entities,
notes, and relationship ties**, applied **undated** — an explicit `sessionId: null` now means
**PRE-TRACKING** in `createEntity`/`createLink`/`updateEntity` (baselines + interval starts `NULL`, i.e.
pre-campaign background; `undefined` keeps the live-capture latest-session fallback). Field changes are
stripped from Step 2 (the MC's fields are Step 1's job); the re-run lock engages on either step's apply.
(c) An **info popover** next to Suggest documents what it does + best practices.

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

Two rough edges remained after ADR-029:

1. **Two divergent persona generators.** `generatePersona` (the detailed `PERSONA_SYSTEM` brief —
   Lens/Stakes/Voice, ~220 words, purpose-built for the in-character inner voice) and the derive tool's
   own inline `persona` output (a ~180-word looser prose spec) both wrote `pc_persona.brief` from
   *different prompts* — so the same character got a different brief depending on which button you pressed.
2. **Main-character management was scattered** — the sidebar badge set it, `EntityDetail` held the persona
   editor + derive tool, and there was no single "manage my character" home.

## Decision Drivers

* One persona template everywhere — the in-character AI (Counsel/Converse) should read a consistent,
  best-quality brief regardless of how it was produced.
* A single, obvious home for the protagonist the whole app revolves around.
* Reuse what ADR-029 already built (`EntityDetail`, `PersonaEditor`, the derive flow, the Converse
  view-add pattern) — composition, not new subsystems.

## Decision

1. **One canonical persona generator.** The derive-from-backstory tool no longer proposes a persona —
   `persona` is removed from `DerivedProfile`, `DERIVE_PROFILE_SCHEMA`, `DERIVE_PROFILE_INSTRUCTIONS`, and
   `validateDerived`. It proposes only the structured fields (description/traits/goals/flaws/voice). On
   apply, `DeriveReview` writes the accepted fields (`entity.update`) then **rebuilds the persona from the
   full profile via `persona.generate`** (the one `PERSONA_SYSTEM` template). `PersonaEditor`
   (generate/regenerate/hand-edit) is unchanged and becomes the *only* persona surface.
2. **A dedicated Character page.** A new top-level `character` view, **first** in the navbar (wired like
   Converse: `ViewKey` → `NAV` → `MainPanel` VIEWS → `views/CharacterView.tsx`). It is the single home for
   the main character: a picker to set/re-designate it (or create a new PC), and the **full dashboard** —
   a bespoke, two-column, inline-editing `CharacterDashboard` (see the as-built note) covering profile,
   persona, the derive "Suggest" tool, relationships, notes, and history. A grandfathered/null-MC campaign
   shows a "set your main character" card.
3. **Sidebar badge → read-only indicator.** `MainCharacterBadge` drops the picker and renders a compact
   **"Playing as {name}"** (★) button that navigates to the Character page. It keeps the lens-lock effect
   (`activePcId = mainCharacterId`, keyed off the loaded campaign) since the sidebar is always mounted.
4. **Codex redirect.** The main character stays listed in Codex (`EntityBrowser`) marked with a **★**;
   selecting it renders a small redirect card ("your main character — manage it on the Character page" + a
   button) in place of `EntityDetail` (`CaptureView`). The persona/derive UI therefore renders only on the
   Character page.

## Rationale

Collapsing to one persona template is the whole point of "most useful for the in-character AI" — the
`PERSONA_SYSTEM` brief is the detailed, voice-first one, so making it the sole generator (fed by the
backstory tool's approved fields) removes the divergence without losing the field-filling value. The
Character page is the natural consolidation: the app already revolves around one protagonist, and reusing
`EntityDetail` as its dashboard means the page is mostly composition. Keeping the main character in Codex
(with a redirect) preserves the "it's a real entity" model while steering all editing to the one place —
so the persona/derive surfaces live in exactly one spot.

## Consequences

### Positive
- One persona brief for a character, always — no more "which button did I press?" divergence.
- A single, prominent home for the main character; the sidebar just *shows* who you're playing.
- Almost entirely composition/reuse; no schema change, no new AI subsystem.

### Negative
- The dashboard is now a bespoke inline-editing component (`CharacterDashboard`) rather than a reused
  `EntityDetail`, so editing is in place (no dialog). The inline saves must re-read attributes fresh before
  writing (updateEntity replaces `attributes` wholesale) — handled in the save helper.

### Risks & Mitigations
- **Derive persona removed** changes the ADR-029 contract → the derive tests + types were updated; the
  persona is now guaranteed by `persona.generate` on apply (best-effort — if it fails the fields are still
  saved and the user can Regenerate on the page).
- **Lens-lock placement** — the effect stays in the (now read-only) badge; the sidebar is always mounted so
  the lens is set regardless of the active view. No change to how the lenses read `activePcId`.

## Related Decisions

- ADR-029 — the main-character overhaul; this **supersedes** its derive-tool *persona output* and its
  *badge-as-setter* (the badge is now read-only; setting moved to the Character page).
- ADR-025 — Converse; the top-level view-add pattern this reuses.
- ADR-026 — the `PERSONA_SYSTEM` brief template that is now the single persona generator.

## References

- `src/main/services/claude.service.ts` (`DERIVE_PROFILE_*` minus persona), `derive-profile.service.ts`
  (`validateDerived`), `src/shared/derive-profile-types.ts` (`DerivedProfile`).
- Renderer: `store/ui-store.ts` (`ViewKey`), `components/layout/{Sidebar,MainPanel}.tsx`, new
  `components/views/CharacterView.tsx`, `components/entities/{DeriveReview,EntityBrowser,PersonaEditor}.tsx`,
  `components/views/CaptureView.tsx` (the Codex redirect).
- Tests: `derive-profile.service.test.ts`.
