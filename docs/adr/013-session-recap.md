# ADR-013: Session recap — neutral streamed summary saved to the session

## Status

Accepted

**Date:** 2026-06-30
**Deciders:** Solo developer

## Context

Weeks pass between D&D sessions and the table opens with "wait, where were we?". Ledger already
stores a session's beats (the `event_log`) and its notes, so it can produce a "Previously on…"
recap on demand. This is the feature the MVP spec deferred as "automated session summarization"
(SPEC §4, out of scope) — now in scope.

Unlike Recall and Suggest, a recap is about ONE known session, not a similarity search over the
whole campaign.

## Decision Drivers

* Grounded strictly in that session's real content — no invented beats.
* Read-aloud-able at the table (a narrator "previously on", not a data dump).
* Cheap to reach for: minimal setup, works even before the embedding model exists.
* Reuse the existing streaming machinery rather than inventing a new one.
* Persist the result so it survives restarts and feeds the next recap.

## Considered Options

### Option 1: Neutral narrator; gather the session's own beats+notes; stream; save to `session.summary`
- **Pros:** grounded in exactly the session's material; no persona dependency; no vector search
  or embedding-model gate (it reads a known session); reuses Recall's stream IPC + token-buffer
  hook; the `summary` column already exists.
- **Cons:** not in the PC's voice (a deliberate trade — see below).

### Option 2: In-character recap (reuse the persona engine)
- **Pros:** matches the app's in-character identity.
- **Cons:** needs a persona brief + active PC; a table recap is conventionally a neutral
  narrator; more prompt/UI surface. Deferred (could become a voice toggle later).

### Option 3: RAG summary (embed + retrieve, like Recall)
- **Pros:** reuses Recall wholesale.
- **Cons:** wrong tool — a recap wants the session's *complete* beats in order, not the top-k
  most similar chunks; it would miss beats and pull cross-session noise.

## Decision

Generate a **neutral, past-tense** recap of a chosen session (default: newest). Gather the
session's `event_log` beats (chronological) + its notes (`listNotesForSession`) + the involved
entities' status/relationships + the **prior** session's summary (for continuity), and stream the
recap from Claude (`claude.service.recap`), reusing the Recall streaming IPC (a `recap:generate`
ack + `recap:*` channels + a `use-recap` token buffer). Save the finished text to
**`session.summary`** (overwrite-confirmed in the UI). No embedding and **no model-ready gate** —
only the key + online checks. A session with zero beats and zero notes short-circuits to an
`empty` result (no Claude call, so it cannot hallucinate from nothing).

## Rationale

A recap's job is to faithfully retell one session, so the session's own beats/notes are the right
input — not a similarity search. Dropping the persona and the embedding gate makes the feature
simpler and usable even on a fresh install. Reusing the streaming spine kept the new surface
tiny. Persisting to the existing `summary` column means recaps chain and survive restarts at no
schema cost.

## Consequences

### Positive
- One-click "previously on"; grounded; no migration; works model-less; consistent streaming UX.

### Negative / Risks
- Quality depends on how well the session was captured — a thin session yields a thin recap
  (mitigated: thin → short, never padded; the `empty` short-circuit).
- Regenerating overwrites a hand-edited summary → confirm-before-overwrite in the UI.
- Neutral-only voice for now → an in-character toggle is a possible follow-up.

## Related Decisions

- ADR-008 — streaming over the typed IPC layer (recap reuses it with its own `recap:*` channels)
- ADR-009 — Suggest's structured output (recap is the streaming sibling, no schema)

## References

- `src/main/services/recap.service.ts`; `src/main/services/claude.service.ts` (recap prompt/stream)
- `src/main/services/note.service.ts` (`listNotesForSession`)
- `src/shared/recap-types.ts`; `src/main/ipc/recap.ts`; `src/renderer/src/components/views/RecapView.tsx`
- `../../SPEC.md` §10 (Delivered beyond the MVP)
