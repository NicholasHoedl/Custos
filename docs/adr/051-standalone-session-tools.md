# ADR-051: Standalone Extract / Illuminate / Transcribe on the Sessions page; decouple the Illuminate model

## Status

Accepted — supersedes the delivery mechanism of **ADR-035** (two-tier "Close out" wizard) and revises
**ADR-036** (Chronicle-header consolidation).

**Date:** 2026-07-14
**Deciders:** Solo developer

## Context

ADR-035 fused the two AI passes over a session — tier-1 **extraction** (chronicle log → entities/notes/
status) and tier-2 **Illuminate** (enrichment → ties/profile edits) — into one **locked "Close out
session" wizard** on the Chronicle header, and put both on the shared `extractionModel`/`extractionEffort`
knobs.

Two problems surfaced in use:

- **Cost.** Illuminate fires **one AI call per touched entity**, so a single run reached **~88¢** (the
  user was on Sonnet · high). Because it shared the extraction knobs, it couldn't be tuned down on its own.
- **Coupling.** The locked wizard forced extract→illuminate as one ritual, and Transcribe + Close-out
  crowded the Chronicle header. The user wanted the two steps (plus Transcribe) as independent tools they
  invoke per session, leaving Chronicle for capture only.

## Decision Drivers

- Let the cost driver (Illuminate) use a cheaper model without dragging down primary extraction quality.
- A simpler mental model: capture on Chronicle; process on Sessions, one tool at a time.
- Preserve the safety that made close-out cheap-to-trust: every proposal is **review-gated** and
  **dedup-safe** (ADR-031), so re-running is harmless.

## Decision

1. **Delete the `CloseOutDialog` wizard.** Its tier-1 half becomes a new standalone **`ExtractDialog`** — a
   plain, closeable dialog (not locked) that reads one session's chronicle, runs one `useImport({mode:
   'capture'})` extraction, and applies the reviewed changeset stamped at that session. No auto-chain into
   Illuminate; the done summary just points to it as the next step.
2. **Relocate the tools to the Sessions page.** The detail header now hosts **Extract · Illuminate ·
   Transcribe** (Illuminate's `EnrichDialog` was already there), each acting on the **selected** session.
   `TranscribeDialog` gained a `session` prop so it targets the selected session rather than the app-active
   one.
3. **Strip the Chronicle header** to just the active-session control (`SessionControl`). The **unclosed
   badge** (ADR-037) moves from the old Close-out button onto the Sessions-page **Extract** button.
4. **Decouple the Illuminate model.** New `illuminateModel` / `illuminateEffort` settings (own section in
   Settings), read by `enrich.service` — default **Haiku · medium**. Extraction (`import.service`) keeps
   `extractionModel` / `extractionEffort` (Sonnet · medium).

## Rationale

Illuminate is the cost driver and is fully review-gated, so a cheap model (Haiku) mostly costs the
occasional weaker suggestion the user skips — never bad data. Splitting the wizard trades a guided
sequence for user control + a calmer header; the loop (Chronicle → Extract → Illuminate → Ask) is still
taught by the Quickstart guide and the tutorial so the order stays discoverable.

## Consequences

### Positive
- Illuminate cost drops ~65–80% at the default (Haiku vs Sonnet), tunable independently of extraction.
- Chronicle is capture-only; Sessions is the single home for turning a session into world data.
- `ExtractDialog` reuses `useImport`, `ChangesetReview` (bulk + compact), `SetupCard`, and the failure/
  done scaffolding — little new code; the same validators and one-transaction apply run unchanged.

### Negative
- The guided extract→illuminate sequence is gone; the user must run the two steps themselves (mitigated by
  the loop teaching and by the Extract done-summary hint).

### Risks & Mitigations
- Illuminate proposals feel thin on Haiku → the Settings control makes bumping it to Sonnet/Opus one click.
- Old settings.json lacks the new keys → `{...DEFAULTS, ...raw}` backfills them; no migration needed.

## Related Decisions

- **ADR-035** (two-tier extraction) — its data model stays; only the wizard delivery is replaced.
- **ADR-036** (Chronicle-header consolidation) — revised: Transcribe + Close-out leave the header.
- **ADR-037** (session integrity / unclosed badge) — unchanged; the badge just re-homes to Extract.

## References

- `src/renderer/src/components/capture/ExtractDialog.tsx` (new), `sessions/EnrichDialog.tsx`,
  `capture/TranscribeDialog.tsx`, `views/SessionsView.tsx`, `capture/EventFeed.tsx`.
- `src/main/services/enrich.service.ts`, `settings.service.ts`; `src/shared/entity-types.ts` (`AppSettings`).
- `tests/e2e/extract.spec.ts` (replaces the deleted `close-out.spec.ts`).
