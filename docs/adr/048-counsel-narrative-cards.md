# ADR-048: Counsel "in the moment" — narrative cards, four options, no D&D mechanics

## Status

Accepted — **implemented**. Supersedes the mechanics layer of
[ADR-026](026-counsel-v2-mechanics-flaws.md): the "in the moment" spread drops the `pillar` / `mechanic` /
`teamwork` fields, shrinks from six options to **four**, and reshapes each card into a plain-English
**title + explanation (+ category tags)**. The prompt now forbids D&D rules and combat-turn tactics and
mandates clear modern English. Renderer + main + prompt + tests + docs; no migration. Verified: typecheck +
lint + full unit suite + e2e green.

**Date:** 2026-07-12
**Deciders:** Solo developer

## Context

ADR-026 gave Counsel a "mechanical + structural layer" — every option carried a D&D pillar, a 5e
ability-check `mechanic`, and a `teamwork` coordination play — on the theory that advising the *fiction*
while ignoring the *game* and the *party* left value on the table. In live play the opposite proved true.
Two representative cards:

- **"Sildar Halwinter uses the Help action; Alaeric makes an attack roll with advantage, qualifying for
  Sneak Attack."** — the `mechanic` + `teamwork` fields turned Counsel into a rules engine and a
  combat-turn planner. That is the DM's and the initiative tracker's job, not a memory tool's.
- **"Alaeric reads the enemy's chain of command in three seconds flat, then barks a crisp order in their
  register — wrong direction, wrong target… One round of hesitation is enough."** — the `action` field,
  written "in their register", produced ornate, hard-to-parse prose about a combat-turn deception.

Counsel's job is narrative counsel — *what could my character do here, and why* — not turn tactics. The
mechanics belonged to a different tool; the stylized in-character voice hurt clarity; and six dense options
were more than a player needs mid-scene.

## Decision

1. **Four narrative options, reshaped.** `MomentSuggestion` becomes
   `{ primaryTag, secondaryTags, title, explanation }`. `title` is a short sentence that starts with an
   action verb ("Question the bandit about who sent them."); `explanation` is one or two plain-English
   sentences saying what the move is and why it fits this character. The category **tags** stay (one
   primary + up to two secondary) as glanceable variety and the distinctness key. The `pillar`, `mechanic`,
   `teamwork`, `action`, and `rationale` fields — and `SUGGEST_PILLARS` / `PILLAR_LABELS` / `SuggestPillar`
   — are removed. `validateMoment` now enforces **exactly four** distinct-primary options with a non-empty
   title + explanation.

2. **A narrative, plain-English prompt.** `SUGGEST_INSTRUCTIONS` is rewritten: give four distinct ways the
   character might play the moment as title + explanation + tags; write in **plain, clear, modern English**
   (no "register"/diction, no ornate or grim prose); **never** mention dice, checks, saves, attacks, combat
   actions, advantage, DCs, rounds, or turns — suggest the *choice*, not how it resolves; and **even in a
   fight, stay in the fiction** (talk down / flee / intimidate / distract / improvise), never turn tactics.
   The character-fit, flaw-driven-option, grounding, spread, goal, and present-scene guidance is kept. The
   MC's **voice examples are no longer appended** to the Counsel system prompt — they push in-character
   diction that fights plain English; the persona brief alone grounds who the PC is. (Recall keeps them.)

3. **A flat card.** `MomentCard` drops the per-card expand, the mechanic badge, the teamwork block, and the
   pillar row: it renders the tag chips, a bold Fraunces **title**, then a muted **explanation** — all
   always visible. The four cards lay out two-up. The Quick/Deep speed toggle and the Refine re-roll (from
   the prior overhaul) are unchanged; the refine block now serializes the prior spread by tag + title.

## Consequences

- Counsel is a cleaner narrative aid: a scannable four-card spread of concrete choices in plain words, with
  no rules to wade through and nothing that pretends to run combat.
- The `scene` grounding ([ADR-027](027-scene-counsel-only.md)) still feeds Counsel; only the *output* shape
  changes. Scene "combat" mode now steers the *fiction* of a fight, not its mechanics.
- ADR-026's premise (that Counsel should speak 5e) is reversed for the "in the moment" mode. The historical
  ADR-026 record stands; this ADR supersedes its mechanics/pillar/teamwork decision. The "directions"
  ("what's next") mode is untouched.
- No migration — `MomentSuggestion` is a runtime shape, not a stored one. The fake-AI seam, the prose
  serializer, and the unit/integration/prompt/e2e tests move to the new fields.

## References

- Supersedes: [ADR-026](026-counsel-v2-mechanics-flaws.md) (mechanics / pillar / teamwork layer).
- Related: [ADR-025](025-converse-in-character-questions.md), [ADR-027](027-scene-counsel-only.md) (scene
  grounds Counsel), [ADR-029](029-main-character-overhaul.md) (persona + voice examples).
- Code: `src/shared/suggest-types.ts` (`MomentSuggestion`), `src/main/services/claude.service.ts`
  (`SUGGEST_INSTRUCTIONS`, `SUGGEST_SCHEMA`, `suggestSystemBlocks`, `buildSuggestUserContent`),
  `src/main/services/suggest.service.ts` (`validateMoment`),
  `src/renderer/src/components/views/SuggestView.tsx` (`MomentCard`),
  `src/renderer/src/lib/lens-prose.ts` (`momentsProse`), `src/main/services/ai-fake.ts` (`fakeSuggest`).
```
