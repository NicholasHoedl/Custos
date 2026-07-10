# ADR-041: An env-gated fake-AI seam for e2e (the close-out wizard)

## Status

Accepted — **implemented** (ROADMAP P2-6). A test-only `LEDGER_FAKE_AI` seam lets the Playwright suite
drive the "Close out session" wizard end to end without a real Anthropic key or network. First AI-mocking
seam in the e2e harness. No migration. Verified: typecheck + lint + full unit suite (263, seam inert) +
e2e (10 tests, incl. the new `close-out.spec.ts` — 2 cases).

**Date:** 2026-07-10
**Deciders:** Solo developer

## Context

The **"Close out session" wizard** (`capture/CloseOutDialog.tsx`) is the most complex, highest-risk UI in
Ledger — a *locked* multi-step ritual: extract → review → apply (DB) → Illuminate scan → enrich → review →
apply → done. It had **zero** automated coverage, because the flow calls Claude twice (tier-1 extraction,
tier-2 enrichment) and the e2e harness is keyless/offline. `suggest.spec.ts` had already conceded that the
live-AI path "requires a real API key + network and is covered by the manual harness, not e2e." So the
riskiest UI in the app was also the least-tested — the gap ROADMAP P2-6 named.

## Decision

**Add a test-only, env-gated fake-AI seam and drive the wizard through it — not a mock HTTP server.**

When `process.env['LEDGER_FAKE_AI']` is set **and** `!app.isPackaged`, the two close-out AI calls return
CANNED raw proposals instead of calling Claude. The branch lives at the two **call sites** in the
orchestration services, so everything downstream is the real thing:
- `import.service.ts` `extract()` → `fakeExtraction()` (one NPC + one note) instead of `claudeExtract(...)`.
- `enrich.service.ts` `enrichEntity()` → `fakeEnrichment(subject.id)` (one trait `add`) instead of
  `enrichChangeset(...)`.
- `ai-util.ts` `isOnline()` returns `true` under the flag, so the flow needs no DNS/network.

The canned data (`services/ai-fake.ts`) is deliberately minimal but real-shaped: capture-mode extraction
references the new entity positionally (`#0`, no ids needed); enrichment is anchored to the **real subject
UUID** (in scope at the call site) so it survives enrich's real-id-only validator and subject-only +
field-whitelist post-filter → a non-empty tier-2 review. The **real** IPC handlers, `validateExtraction`,
the shared enrich validators, and the DB `applyChangeset` transaction all run unchanged — only the network
call to Claude is replaced.

**Chosen over `ANTHROPIC_BASE_URL` → a local mock server.** The SDK client omits `baseURL`, so setting
that env var *would* redirect calls with zero source change — but that route is strictly more work here for
no benefit: it still has to touch prod code (the `isOnline` DNS gate is independent of `baseURL`), stand up
an HTTP server returning valid `Message` JSON, discriminate extract vs enrich by request body, and — the
real blocker — recover the subject's UUID from the request to satisfy enrich's validator. The call-site
seam gets that id for free.

**Safety.** Two guards make the seam inert outside tests: it activates only when the env var is set **and**
`!app.isPackaged`, so a distributed installer can never trigger it even if the variable were somehow
present; and the env check is evaluated first (short-circuit) so `app.isPackaged` is never touched — and
the flag is never read — in a normal launch or under vitest (where `electron` is mocked). It is set in
exactly one place: `tests/e2e/helpers.ts` (`launchApp({ fakeAi: true })`).

**The test.** `close-out.spec.ts` plants a dummy key (`window.ledger.apikey.set` — the wizard gates on key
*presence*, not validity) and reloads so `useOnboarding` refetches `keyReady`. Two cases: the full both-tier
happy path (extract → review → apply → Illuminate → enrich → review → apply → done, then confirm the NPC
exists in the Codex), and the reject path (reject the tier-1 proposal → confirm → exit the lock → confirm
nothing was applied). Assertions are on **structural** strings (section headings, button labels, step text)
— never on model-dependent counts.

Facts that kept it small: **embeddings already no-op without the model** (`embedding.service.isModelReady()`
is a file check; `indexEntity`/`indexNote` early-return and are fire-and-forget after commit), so
`applyChangeset` completes in e2e with no embedding stub; and `test:e2e` is `electron-vite build &&
playwright test`, so the new main-process branch is compiled into `out/` before the run.

## Consequences

### Positive
- The riskiest, most complex UI now has a deterministic regression net covering both tiers and the locked
  exit — offline, keyless, ~14s for two cases.
- The seam is reusable: any future AI lens (Counsel, Converse, Recall, Transcribe) can be e2e-tested the
  same way, lifting the standing "no e2e for AI paths" limitation.
- The real IPC + validators + DB-apply path is exercised; only the model call is replaced.

### Negative / Risks
- A test-only branch now lives in production services (three call sites). Mitigated by the double gate
  (`env` + `!app.isPackaged`), the short-circuit, and the single, clearly-commented `ai-fake.ts` home.
- The fake bypasses the SDK/HTTP/JSON-parse/usage layer, so this test doesn't exercise that plumbing — it's
  covered by unit tests and isn't the wizard's risk surface. (The `done` summary's cost line is blank under
  the fake; the test doesn't assert on it.)
- Planting the key needs `safeStorage` (DPAPI), available under real Electron on Windows; a headless Linux
  CI runner without a keyring would fail `apikey.set` — flagged for a future CI decision.

## Related Decisions
- ADR-035 (two-tier extraction — the close-out ritual this covers), ADR-037 (session integrity / the
  close-out button), ADR-020 (the `isAvailable`/`isOnline` guards the seam threads through).

## References
- Seam: `src/main/services/ai-fake.ts`; call sites `import.service.ts` (`extract`), `enrich.service.ts`
  (`enrichEntity`), `ai-util.ts` (`isOnline`).
- Harness: `tests/e2e/helpers.ts` (`launchApp({ fakeAi })`); test `tests/e2e/close-out.spec.ts`.
