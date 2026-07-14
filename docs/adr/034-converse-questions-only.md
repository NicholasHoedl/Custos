# ADR-034: Converse v2 — a questions-only tagged spread (+ as-of notes clamp)

## Status

Accepted — **implemented**. Converse changes from a hybrid *briefing + questions* lens to a spread of
**tagged, in-character questions, nothing else**, reframed as talking WITH a character. No migration
(reuses existing columns; the schema change is TypeScript-only, and the as-of fix is a query change).
Verified: typecheck + lint + the full suite (218 tests; new coverage for the validation, the target
guards, the prompt, and the as-of notes clamp). Revises the output-shape half of **ADR-025** (the
direct-fetch grounding decision there still holds).

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

In D&D, much story and lore is gated behind conversation — reachable only by players who ask good
questions. Custos already solves the *tracking* half (notes, ties, confidence, chronology). Converse
should own the *asking* half. The shipped lens (ADR-025) returned a **briefing** (known / suspected /
connections) plus generic **questions**. Two problems: the briefing **duplicates** what Codex and the
other lenses already surface, and the questions were **untyped and thin** — no sense of what makes a
probe land or cost anything.

A design pass (research across the D&D social pillar, CRPG dialogue design — Baldur's Gate 3, Disco
Elysium — and interview technique) produced three load-bearing ideas: **ask the gap, not the known**;
pair each question with a **"read"** (a Disco-Elysium-style beat of intent — what you suspect / why ask
now) so the line is intentional; and **funnel** the spread rapport → sensitive, since every question
spends or builds social capital and high-cost probes must be *earned* by standing. A sharpening from the
developer: you Converse **with** a character (an NPC or a fellow PC — the person across the table); what
you want to dig into (a third party, a topic, a rumor) is the optional **thread** (the "about").

The work also exposed a genuine bug: Converse's target notes came from `getEntityContext` →
`listNotesForEntity`, which had **no session filter**, so reconstructing "as of session N" leaked notes
from later sessions — contradicting ADR-025's as-of promise.

## Decision

- **Output is questions only.** `ConverseQuestion = { question; tag; read }`; `ConverseResult` ok-branch
  is `{ ok: true; questions }`. `ConverseBriefing` is deleted. The service still *fetches* notes/ties/
  state and the prompt still *reasons* over the known/suspected/missing delta internally — only the
  emitted payload shrank.
- **A 14-tag taxonomy** (`CONVERSE_TAGS`): open-probe, rapport, backstory-dig, feelings, motivation,
  opinion, lore, rumor-test, callback, secret-seeking, leading, challenge, flatter, empathetic-disclosure.
  The model emits only the `tag`; a static `CONVERSE_TAG_META` maps each to an **aim** (lore / character /
  both) and a **trust cost** (builds / low / med / high). The renderer derives the aim/cost badges and
  **funnel-orders** the spread by cost — the model never emits them.
- **Prompt (mirrors Counsel, ADR-026).** `CONVERSE_INSTRUCTIONS` is rewritten: ask the gap, turn a
  confirmed fact into a `callback`, route rumors to `rumor-test`/`secret-seeking`, open blanks with
  `open-probe`/`backstory-dig`/`lore`; each item = question (in the PC's voice) + one tag + a short read;
  the vocabulary is spelled out **grouped by trust-cost**; funnel the spread and **gate high-cost probes
  by standing** (the PC's tie + how each side feels, ADR-033). `CONVERSE_SCHEMA` is a single `questions`
  array with a `tag` enum; `converse()` uses `structuredArrayCall`; `validateConverse` mirrors Counsel's
  `validateMoment` — valid tag + non-empty question/read, **distinct tags**, cap 6, floor 4, retry once.
- **Target = a character you talk WITH.** The service rejects any target that is not `npc`/`pc`, and
  rejects the asking PC itself (reason `invalid`); the renderer's picker filters to NPCs + fellow PCs
  minus self. Fellow PCs/companions are first-class.
- **As-of notes clamp (bug fix).** `listNotesForEntity` and `getEntityContext` gain an optional `asOf`:
  a note is kept when its session number ≤ N **or** it has no session (null = pre-tracking baseline,
  always included — consistent with `stateAsOf`/`isIntervalLiveAt`). The filter lives once at the data
  seam (symmetry with `listForEntity(asOf)`); the optional param leaves every existing caller unchanged.
- **UI.** The briefing sections are gone; results render as a card grid (tag pill + aim/cost badges + the
  question + the read under a divider), funnel-sorted. The optional field is relabelled "thread".

## Consequences

### Positive
- The questions ARE the product — no briefing competing for attention or duplicating Codex.
- Typed, funnel-ordered questions give the player a Baldur's-Gate-style spread: safe openers through
  earned, high-cost probes, each with the read that motivates it.
- The aim axis (lore vs character) maps directly to the two things a player wants out of a conversation.
- As-of reconstruction is now correct for Converse's notes, closing a real spoiler leak.

### Negative / Risks
- **Aim/cost are static** (per tag kind, not the specific phrasing) — a card's badges reflect the tag,
  not a per-line judgement. Accepted: it's cheap, predictable, and drives the funnel deterministically.
- **The cost spread isn't code-enforced** (like Counsel's pillar spread) — validation only dedupes tags
  and enforces the floor/cap; the funnel is prompt-driven.
- **Losing the briefing** removes an at-a-glance "what do we know" summary from this surface; that
  information still lives in Codex, Lore, and the entity pages, so it is a relocation, not a loss.
- The model must map the tag to the right cost tier via the prompt; a mis-tagged question sorts oddly but
  is never wrong, only mis-ordered.

## Related Decisions

- **ADR-025** (Converse) — this revises its *output shape*; the direct-fetch grounding (persona +
  `getEntityContext` + `listForEntity(asOf)`, no embedding model) is unchanged.
- **ADR-026** (Counsel v2) — the tag-vocabulary + `validate*` + `structuredArrayCall` template mirrored here.
- **ADR-021** (note confidence) and **ADR-033** (per-direction tie disposition) — the confidence/feeling
  signals the questions and their reads key off.
- **ADR-017** (chronology) — the as-of interval the notes clamp now respects.

## References

- Types: `shared/converse-types.ts` (`CONVERSE_TAGS`, `CONVERSE_TAG_META`, `converseTagLabel`,
  `ConverseQuestion`, `ConverseResult`).
- Service/prompt: `converse.service.ts` (guards + `validateConverse`), `claude.service.ts`
  (`CONVERSE_INSTRUCTIONS`, `CONVERSE_SCHEMA`, `buildConverseUserContent`, `converse()`).
- As-of fix: `note.service.ts` (`listNotesForEntity`), `link.service.ts` (`getEntityContext`).
- UI: `views/ConverseView.tsx`, `hooks/use-converse.ts`.
- Tests: `tests/integration/converse.test.ts`, `tests/unit/services/converse-prompt.test.ts`,
  `tests/unit/services/note.service.test.ts`.
