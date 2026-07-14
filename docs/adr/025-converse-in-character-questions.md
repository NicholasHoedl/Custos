# ADR-025: Converse — an in-character question lens

## Status

Accepted

**Date:** 2026-07-07
**Deciders:** Solo developer

## Context

A core loop of tabletop play is drawing out another PC's or an NPC's backstory and goals. Doing it well is
a whole cognitive chain: hold what's been revealed about the target, notice the open threads and suspicions,
recall their web of connections to quests / places / people, register how the *asking* character would feel
about them — and only then phrase an actual question in that character's voice. Custos already stores every
input to that chain (entities, notes with **confidence**, **Ties**, **chronology**, **PC personas**), but
nothing assembles them into "what could my character *ask*?"

This is the third AI lens, completing **Consult** (Recall — factual answers) · **Counsel** (Suggest —
action ideas) · **Converse** (in-character questions). Given the active PC (the asker) and a chosen target,
it returns a short **briefing** about the target, then **in-character questions** to draw them out.

## Decision Drivers

* **Reuse, don't rebuild** — the persona, formatters, structured-call, and chronology helpers already exist.
* **Discovered-only grounding** — mine everything recorded; the gaps and the Whispered/Hearsay notes *are*
  the questions. No spoiler/omniscient mode.
* **As-of correctness** — the briefing must respect a chosen session's knowledge horizon (no future leak).
* **In character** — grounded in the asker's persona voice, like Counsel.
* **No new storage** — a read-only feature should not touch the schema or settings.

## Considered Options

### Option 1: Mirror Recall (streaming prose)
- **Pros:** reuses the streaming pipeline; conversational feel.
- **Cons:** the output is inherently **structured** (a briefing *object* + a questions *array* rendered as
  cards), which fights token streaming and citations; wrong shape.

### Option 2: Mirror Suggest (single-shot structured) + direct-fetch grounding — **chosen**
- **Pros:** Suggest already returns validated structured output via `structuredObjectCall`; the grounding is
  a **single target entity**, so a direct fetch is more precise than similarity search; reuses
  `SuggestContext` / `suggestSystemBlocks` / `formatState` / `formatRelationships` / persona wholesale.
- **Cons:** needs one genuine design call — as-of threading (below).

### Option 3: Retrieval-based grounding (embed the target, vector-search the notes)
- **Pros:** consistent with Recall/Suggest retrieval.
- **Cons:** unnecessary and *less* precise for a known single entity — we want **all** of a target's notes
  and ties, not the top-k semantically nearest; pulls in the embedding model for no benefit.

## Decision

Build Converse as a **single-shot structured call mirroring Suggest**, grounded by **direct fetch**:

- **One IPC round-trip** — `converse:query` → a `ConverseResult` discriminated union (`{ ok: true; briefing;
  questions }` | `{ ok: false; reason }`). **No streaming, no cancel, no vector store, no embedding model,
  no `no_model` gate, no scene.**
- **Grounding (direct fetch)** — `getEntityContext(target, 1)` for the target's root + notes;
  `resolveEntityState(target, asOf)` for status; **`getPersona`** for the asker's voice; and the asker↔target
  tie via `listForEntity(pc, asOf).filter(other === target)`.
- **The as-of pivot (the one real judgment call).** `getEntityContext` has no as-of support and must stay
  stable, so it supplies only root + notes. **Connections** come from **`listForEntity(target, asOf)`**,
  which already applies `isIntervalLiveAt` — so a single code path is as-of-correct for both "now" and past
  sessions. Notes have no per-note chronology, so they are anchored by the prompt's "as of Session N"
  framing (exactly how `formatState` already presents as-of), not hard-filtered.
- **Output** — a briefing (`known` / `openSuspected` / `connections`) + `question[]` (each with the thread
  it targets and why). JSON Schema can't bound array length, so the service **validates and coerces**,
  failing only when *everything* is empty (a target with no notes legitimately yields an all-questions result
  — that's the feature).
- **No new storage** — reuses `getSettings().suggestModel` / `suggestEffort` (Opus 4.8 / high). **No
  migration, no `AppSettings` change.**

## Rationale

The output shape (structured briefing + question cards) makes **Suggest**, not Recall, the right sibling —
so Converse inherits Suggest's proven single-shot `structuredObjectCall` + code-side validation path.
Because the subject is one *known* entity, direct fetch beats retrieval on precision (we want the target's
whole footprint, not the nearest-k) and drops the embedding-model dependency entirely. As-of correctness
falls out for free from `listForEntity`'s existing interval filtering, which is why connections (not
`getEntityContext`) carry the temporal query. Reusing the persona + formatters keeps the asker's voice and
the `[ended]` / confidence hedging identical to the rest of the app.

## Consequences

### Positive
- A new marquee AI feature assembled almost entirely from existing, tested helpers; the backend is
  Suggest-minus-retrieval.
- As-of-correct briefings with a hard no-future-leak clamp, reusing the chronology layer verbatim.
- Zero schema/settings footprint; a target with sparse data degrades gracefully to a questions-only result.

### Negative
- Notes are anchored by prompt framing rather than hard as-of filtering (they carry no per-note session), so
  the as-of guarantee on *connections/status* is stronger than on *notes* — an accepted, documented limit.
- A second consumer (`converse` and Suggest) now depends on `suggestModel` / `suggestEffort`; a future
  per-lens model setting would need to split them.

### Risks & Mitigations
- **Model invents facts about the target** → the prompt is discovered-only (confirmed = solid, rumored/
  suspected = uncertain leads, invent nothing); confidence tags ride into the prompt via `confidenceTag`.
- **Empty/near-empty target crashes or returns nothing** → `validateConverse` treats an all-questions result
  as valid; integration tests cover the empty-target and as-of-severed-tie paths.

## Related Decisions

- ADR-016 — Suggest v2 (multi-tag structured output); Converse mirrors its single-shot `structuredObjectCall`
  mechanism and `SuggestContext` / persona plumbing.
- ADR-017 — chronology; Converse reuses `listForEntity(asOf)` / `resolveEntityState` for as-of grounding.
- ADR-021 — note confidence; surfaced into the briefing so the model hedges rumors and hypotheses.
- ADR-015 — current scene; **deliberately not used** by Converse (the target, not a scene, is the subject).

## References

- `src/shared/converse-types.ts` (contract), `src/main/services/converse.service.ts` (orchestration),
  `src/main/ipc/converse.ts` (`converse:query` handler), `src/main/services/claude.service.ts`
  (`CONVERSE_INSTRUCTIONS` / `CONVERSE_SCHEMA` / `buildConverseSystem` / `buildConverseUserContent` /
  `converse`).
- `src/renderer/src/components/views/ConverseView.tsx`, `src/renderer/src/hooks/use-converse.ts`,
  `src/renderer/src/store/ui-store.ts` (`'converse'` view key), `src/renderer/src/components/layout/Sidebar.tsx`.
- Tests: `tests/unit/services/converse-prompt.test.ts`, `tests/integration/converse.test.ts`.
- `../../SPEC.md` §10, `../../ARCHITECTURE.md` §6.
