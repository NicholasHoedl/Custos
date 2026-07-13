# ADR-049: Converse — a follow-up loop, per-query speed, and restored voice

## Status

Accepted — **implemented**. Extends [ADR-034](034-converse-questions-only.md) (Converse questions-only).
Adds a multi-turn **follow-up loop** (feed the target's answer back → follow-up questions grounded in it), a
per-query **Quick/Deep speed toggle** (mirrors Lore/Counsel), and **restores the MC voice examples** to
Converse's prompt — fixing a regression from [ADR-048](048-counsel-narrative-cards.md), whose plain-English
Counsel fix removed voice grounding from the shared `suggestSystemBlocks` helper that Converse also uses.
Renderer + main + prompt + tests + docs; no migration. Verified: typecheck + lint + full unit suite + e2e.

**Date:** 2026-07-13
**Deciders:** Solo developer

## Context

Converse was the last un-reworked lens after the Lore and Counsel overhauls, and the leanest: a single-shot
spread of tagged questions, no speed control, and no way to continue the conversation. Two gaps and a bug:

- **No follow-up.** A conversation is a back-and-forth: you ask, they answer, you ask again based on what
  they said. Converse only produced the opening spread — the moment the NPC actually said something, the
  tool had nothing more to offer. This is the loop Lore already got (its follow-up transcript).
- **No speed control.** Lore and Counsel both gained a Quick (Sonnet, table-fast) / Deep (Settings model)
  per-query toggle; Converse still rode the Settings model with no fast path.
- **Voice regression.** ADR-048 removed the MC voice examples from the *shared* `suggestSystemBlocks` helper
  (correct for Counsel — they fought its plain-English advice). But Converse uses the same helper, and its
  output is the opposite case: the questions ARE dialogue in the PC's voice. So Converse's prompt kept
  asking for that voice while the sample lines silently stopped reaching the model.

Unlike Counsel, Converse needs no plain-English reshape — in-character questions are the point.

## Decision

1. **Follow-up loop.** `ConverseRequest` gains `history?: string[]` (the target's prior answers this
   conversation, oldest-first). The renderer holds a light transcript of `ConverseTurn`s (the opening
   spread, then follow-up turns each carrying the answer that prompted it); `use-converse` grows
   `followUp(answer)`, which re-asks with the accumulated answers. `buildConverseUserContent` folds a
   "conversation so far" block into the prompt, and a new `CONVERSE_INSTRUCTIONS` paragraph tells the model
   those questions are follow-ups that build on what was just said. `ConverseView` renders the thread (a
   "They said…" breadcrumb + the funnel spread per turn) with a "Continue — what did they say?" composer at
   the bottom.

2. **Per-query speed.** `ConverseRequest.speed?: 'quick' | 'deep'`, resolved once in `converse.service`
   (quick → Sonnet + medium; deep/unset → the Settings model/effort). A `SpeedToggle` in the controls,
   lifted from the other two lenses. Default Quick.

3. **Restore the voice for Converse only.** `suggestSystemBlocks(ctx, instructions, includeVoice = false)`
   gains the flag: `buildConverseSystem` passes `true` (re-append `voiceExamplesBlock` after the persona),
   `buildSuggestSystem` / `buildDirectionsSystem` keep it OFF. The **voice on/off split** is deliberate:
   Converse restores it (dialogue), Counsel/Directions omit it (plain advice — ADR-048).

The spread is now **exactly four** questions (cap 4 / floor 4 in `validateConverse`, down from the 4–6
range; the prompt asks for four), and each card renders the `question` line **in double quotes** as spoken
dialogue. `validateConverse`'s distinct-tag + retry-once rule and the direct-fetch grounding are unchanged.

## Consequences

- Converse is now a conversation tool, not a one-shot question generator: it keeps up as the exchange
  unfolds, and its questions sound like the character again.
- Shared state grows a renderer-facing `ConverseTurn` (mirrors `RecallTurn`); it never crosses IPC. No
  migration — all runtime shapes.
- The shared `suggestSystemBlocks` now encodes the voice split as a parameter; future lenses choose voice
  on/off explicitly.
- The fake-AI seam (`fakeConverse`) is unchanged; the e2e drives a real follow-up round through it.

## References

- Extends: [ADR-034](034-converse-questions-only.md) (Converse questions-only). Fixes the voice-drop
  regression from [ADR-048](048-counsel-narrative-cards.md). Mirrors the Lore follow-up transcript and the
  Lore/Counsel speed toggle.
- Code: `src/shared/converse-types.ts` (`speed`, `history`, `ConverseTurn`),
  `src/main/services/converse.service.ts` (speed resolve + history passthrough),
  `src/main/services/claude.service.ts` (`suggestSystemBlocks` `includeVoice`, `buildConverseUserContent`
  history block, one instruction line), `src/renderer/src/hooks/use-converse.ts` (`followUp` + turns),
  `src/renderer/src/components/views/ConverseView.tsx` (thread + `SpeedToggle` + follow-up composer).
