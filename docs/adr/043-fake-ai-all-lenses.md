# ADR-043: The fake-AI e2e seam, extended to every AI lens

## Status

Accepted — **implemented**. Extends the ADR-041 fake-AI seam from the close-out wizard's two calls to
**all** user-facing AI lenses (Transcribe · Counsel · Converse · Recall · Recap · Draft-from-backstory),
so every AI surface has a deterministic, offline e2e. No migration. Verified: typecheck + lint + 263 unit
(seam inert under vitest) + **16 e2e** (6 new/extended lens specs + the existing 10).

**Date:** 2026-07-10
**Deciders:** Solo developer

## Context

ADR-041 added `fakeAiEnabled()` (`LEDGER_FAKE_AI` + `!app.isPackaged`) and canned data at two service
call-sites so the close-out wizard could be e2e-tested offline. It proved the pattern but left the other
lenses uncovered — `suggest.spec.ts` still only checked an empty state, and Converse/Recall/Recap/Draft
had no e2e at all. This extends the same seam to every lens.

## Decision

**Apply the ADR-041 recipe per lens** — a `fakeX()` builder in `ai-fake.ts` returning the exact
pre-validation shape, branched in `fakeAiEnabled() ? fakeX() : await claudeX()` **after** the existing
`isAvailable()`/`isOnline()` guards. Transcribe needed *nothing* new (it reuses `import.extract` →
`fakeExtraction`). The new builders: `fakeSuggest` (6 distinct-tag moments), `fakeDirections`,
`fakeConverse` (4 distinct-tag questions), `fakeDerive`, and `FAKE_RECALL_TEXT`/`FAKE_RECAP_TEXT`.

Two cross-cutting wrinkles, each solved once:

- **Persona nested call.** Counsel/Converse/Recall call `generatePersona → complete()` (a *real* Claude
  call) before their own, and Draft regenerates a persona on apply. Rather than pre-seed a persona in
  every test, `persona.service.generatePersona` branches to a canned brief (`fakePersona`) under the flag
  — one change covers all four.

- **Embedding-model gate (Counsel/Recall).** Both hard-gate on `isModelReady()` in the service **and**
  the renderer (the submit button disables → a "download the model" card), and call `embed()` which throws
  with no model. Solved with (a) `ipc/onboarding.ts` reporting `modelReady: isModelReady() ||
  fakeAiEnabled()` — enabling the button while leaving `isModelReady()` honest so indexing still no-ops —
  and (b) each service bypassing the `no_model` gate and skipping `embed()`/dense `store.search` while
  **keeping the model-free `fuzzyEntityChunks`**. So Recall's Sources list is genuinely grounded (the
  query names a seeded entity and it surfaces), not canned.

**Streaming lenses (Recall/Recap)** emit canned prose through the service's existing `onText` callback
(→ `send(*_CHUNK_CHANNEL)`) then resolve, instead of returning a value; the done payload, hooks, views,
and Recap's `updateSession` persist all stay real.

Everything remains `fakeAiEnabled()`-gated: inert in dev, in any packaged build, and under vitest (the env
check short-circuits before `app.isPackaged`).

## Consequences

### Positive
- Every AI lens now has an offline, deterministic regression net — the flagship features (RAG search,
  in-combat counsel, in-character questions, recap, paste-import, backstory derive) are covered.
- The seam is now the established way to test any AI flow; new lenses follow the same one-branch recipe.

### Negative / Risks
- Counsel/Recall carry test-only branches in the retrieval + model-gate path (all flag-gated, inert in
  prod). Fuzzy grounding is real; only `embed`/dense is skipped under the flag.
- Canned data must track the validators (`fakeSuggest` = exactly 6 distinct primary tags; `fakeConverse` =
  ≥4 distinct tags) or the lens returns `invalid` — the specs assert the success UI, catching drift.
- Persona is faked globally under the flag, so any lens that (re)generates it in a test gets the canned
  brief (intended).

## Related Decisions
- ADR-041 (the seam this extends), ADR-035 (extraction/Transcribe), ADR-026 (Counsel), ADR-034 (Converse),
  ADR-013 (Recap), ADR-029/030 (Draft-from-backstory), ADR-017 (as-of retrieval the specs exercise).

## References
- Seam: `src/main/services/ai-fake.ts`; branch sites `persona.service.ts`, `suggest.service.ts`,
  `converse.service.ts`, `recall.service.ts`, `recap.service.ts`, `derive-profile.service.ts`,
  `src/main/ipc/onboarding.ts`.
- Harness: `tests/e2e/helpers.ts` (`createCampaign` / `plantKeyAndReload`); specs `suggest.spec.ts`
  (Counsel), `converse.spec.ts`, `recall.spec.ts`, `recap.spec.ts`, `transcribe.spec.ts`, `draft.spec.ts`.
