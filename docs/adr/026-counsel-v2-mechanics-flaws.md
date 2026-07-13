# ADR-026: Counsel v2 — a mechanical layer, pillar/teamwork diversity, flaws, and surfacing entity data

## Status

Accepted — but its **mechanics layer is superseded by [ADR-048](048-counsel-narrative-cards.md)**. Counsel's
"in the moment" mode is now narrative-only: four plain-English title + explanation cards (+ category tags),
with the `pillar` / `mechanic` / `teamwork` fields removed. The flaws/persona/entity-surfacing decisions of
this ADR still stand.

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

Counsel (the Suggest "in the moment" lens) produced evocative, in-character actions but — measured against
real D&D best practice (the three pillars of play; skills → risk → consequence; teamwork; ideals/bonds/
**flaws**; player agency) — it advised the *fiction* while ignoring the *game* and the *party*. Investigation
of the code confirmed the diagnosis:

- Counsel **is** deeply grounded in the specific active PC (a persona brief built from the PC's
  name/ancestry/class/level/description/backstory/traits/goals/status, plus race/class + retrieved notes) —
  the eight options share a voice *by design*. The real gaps were **strategic homogeneity** and the absence
  of **mechanics, teamwork, and stakes**.
- The entity data model was **under-consumed**: `traits`/`goals` reached the model *only* distilled through
  the PC persona (never for non-PC entities); embeddings covered only `name + description`; most structured
  `attributes` (a creature's `weakness`/`tactics`, a faction's `alignment`) reached no tool. And there was
  **no Flaws field** — the single richest roleplay hook.

## Decision Drivers

* Make Counsel speak the *game*, not just the story — without turning it into a rules engine.
* Fix the data model's real problems (a missing field; good data invisible to the AI) rather than churn it.
* Reuse the proven Suggest pipeline; keep the strong PC-voice grounding intact.
* Keep the change low-risk: a single additive migration, no character-sheet stats (SPEC non-goal stands).

## Considered Options

- **Mechanical depth:** (a) full 5e crunch with DCs/advantage; (b) **name the skill + ability + stakes, no
  numbers**; (c) system-agnostic risk only. → **(b)** — actionable at the table without over-precising what
  the DM adjudicates, and edition-flavored without a rules engine.
- **New dimensions:** structured fields vs. prose-only. → **structured fields** (pillar/mechanic/teamwork)
  for a scannable, honest card.
- **Data model:** cut/merge vs. add-and-surface. → **add Flaws + surface** — the fields are D&D-relevant;
  the problem is consumption, not the shape.

## Decision

**1. A mechanical + structural layer on each option.** `MomentSuggestion` gains `pillar`
(`combat`/`social`/`exploration`), `mechanic` (the 5e check + governing ability + what it's opposed by, no
DCs and **no failure outcome** — the DM adjudicates failure), and `teamwork` (a coordination play naming a
*present* ally, or null). The schema requires them and
`validateMoment` validates/cleans them (invalid pillar or blank mechanic drops the option; empty teamwork →
null), alongside the existing 8-distinct-primary rule.

**2. An overhauled prompt.** `SUGGEST_INSTRUCTIONS` now demands: naming the 5e check + ability (never the
failure outcome — the DM's call); spanning the three pillars with both cooperative and adversarial options, calibrated to the scene's
real stakes (not combat-by-default); at least one teamwork option using a named present party member; at
least one **flaw/fear/bond-driven** option even when suboptimal; capability-awareness (favor what the class/
level can pull off); and biasing toward an optional player **goal**.

**3. First-class `flaws`.** A new `flaws: string[]` promoted field on `entity` (**migration 0008**, a plain
nullable `ADD COLUMN`, mirroring `traits`/`goals`), editable for pc/npc/faction, mined into the persona
brief (a `FLAW` line in its Lens).

**4. Surface the invisible data.** Embeddings now index `traits`/`goals`/`flaws` + the combat/social-salient
`attributes` (creature `tactics`/`weakness`/`abilities`, faction `alignment`, npc `role`) — so structured
character/creature/faction data is retrievable by Recall and Suggest, not just the free-text description.
Converse also fetches the target's `traits`/`goals`/`flaws` directly into its grounding.

**5. An optional goal input.** `SuggestRequest.goal` + a compact input in the Counsel pane steer the spread
toward the player's objective ("my goal is… I'll try…").

## Rationale

The output shape (structured briefing + typed cards) makes Suggest the right pipeline to extend, so Counsel
inherits its validated single-shot mechanism unchanged. Naming skills + stakes (not DCs) gives players the
mechanical handle they asked for while leaving adjudication to the DM. Flaws are the highest-leverage data
addition — they power the characterful "play to lose" option and cost one additive migration. The dead-weight
problem is a *consumption* gap, so enriching `entityText` (one function) turns a lot of already-entered data
into retrieval signal across every lens at once.

## Consequences

### Positive
- Counsel now spans the pillars, names its checks (leaving failure outcomes to the DM), uses the party, and
  leans on the character's flaws — closing the gap to real high-quality play.
- A single additive migration; the strong PC-voice grounding is untouched (the new dimensions add alongside
  the persona, never replace it).
- Non-PC traits/goals + salient attributes stop being dead weight; Converse gets richer for free.

### Negative
- A second consumer of the `suggestModel`/`suggestEffort` setting (Counsel already; unchanged) and a longer
  prompt (more tokens per call).
- Changing `entityText` invalidates every entity embedding, so **all entities re-embed once on next launch**
  (CPU-bound, off the hot path via the existing backfill).
- `pillar` is the three canonical pillars only; a pure downtime/prep move is mapped to its nearest pillar.

### Risks & Mitigations
- **Model omits or malforms the new fields** → schema marks them required; `validateMoment` drops malformed
  options and the service retries once, exactly as for tags.
- **Prompt over-steers toward violence** → an explicit "calibrate to the scene's actual stakes" instruction
  plus the pillar-spread requirement; covered by the prompt test.

## Related Decisions

- ADR-016 — Suggest v2 (multi-tag structured output); Counsel v2 extends its `MomentSuggestion` + pipeline.
- ADR-021 — note confidence; the same "surface structured signal to the AI" spirit, now for entity fields.
- ADR-017 — chronology; the goal/teamwork additions respect the existing as-of + scene grounding.
- ADR-025 — Converse; benefits from the same target traits/goals/flaws surfacing.
- SPEC §4/§7 — "not a character-sheet tool" stands: no stats/abilities; only narrative fields (incl. flaws).

## References

- `src/shared/suggest-types.ts` (SuggestPillar + MomentSuggestion + SuggestRequest.goal),
  `src/shared/entity-types.ts` / `entity-profiles.ts` (Entity.flaws + profile flag),
  `src/main/db/schema.ts` + `drizzle/0008_high_timeslip.sql`.
- `src/main/services/claude.service.ts` (SUGGEST_INSTRUCTIONS / SUGGEST_SCHEMA / buildSuggestUserContent +
  Converse nature block), `suggest.service.ts` (validateMoment + goal), `persona.service.ts` (FLAW line),
  `embedding-index.service.ts` (enriched entityText).
- `src/renderer/src/components/views/SuggestView.tsx` (goal input + MomentCard), `hooks/use-suggest.ts`,
  `components/entities/EntityForm.tsx` (flaws editor).
- Tests: `tests/unit/services/suggest.service.test.ts`, `suggest-prompt.test.ts`, `persona.service.test.ts`,
  `entity.service.test.ts`, `converse-prompt.test.ts`, `tests/integration/suggest.test.ts`.
