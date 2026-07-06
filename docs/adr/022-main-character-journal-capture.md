# ADR-022: Main character + journal-driven capture

## Status

Accepted

**Date:** 2026-07-06
**Deciders:** Solo developer

## Context

Keeping a campaign's world-state current is manual: the user creates entities, writes notes, and links
relationships by hand. During live play that friction is highest exactly when attention is scarcest. Two
coupled needs emerged:

1. **No persisted "main character."** The app already has an *active PC* selector that drives the
   in-character Recall/Suggest voice (persona brief, ADR-007/016) — but it lives only in renderer
   `localStorage`, is wiped on every campaign switch, and must be re-picked. There was no durable notion of
   "the protagonist this user plays," so the lens never *defaults*.
2. **"Session beats" were a dead-end log.** The `event_log` table ("beats") held terse lines that fed only
   the neutral Recap. The user wanted these re-themed into a **journal** that is the *primary* at-the-table
   capture surface: jot a plain sentence of what happened, and let the AI propose the entities, notes,
   status changes, and relationship links it implies.

The unlocking realization: the **extract → review → transactional apply** engine (ADR-014, extended to
changeset **v2** in ADR-018) *already* proposes new entities, new notes, status/lifecycle changes, and
relationship form/sever — all **session-stamped**. The journal is that engine pointed at short live
entries, plus a persisted lens. This is recorded as one decision with three parts.

## Decision Drivers

* Collapse table-time bookkeeping to "write a sentence or two; AI does the rest."
* Reuse the existing extraction/apply engine and the active-PC/persona lens — no new AI machinery.
* Minimal migration risk against the live campaign (one nullable column at most).
* Preserve the deliberate `event_log` (party log) vs. `event` *entity* (world history) naming split (ADR-019).
* Preserve grounding-honesty (ADR-017) and the ≥1-entity-per-*extracted*-note rule (ADR-021).

## Considered Options

### Main-character storage
- **Renderer `localStorage` (per-campaign key)** — no migration, but lost on export/import and not
  server-validatable.
- **A `campaign.main_character_id` column (chosen)** — durable, travels with campaign export, and the
  main process can validate/enforce it.

### Main-character reach
- **A per-character knowledge horizon** — filter Recall/Suggest grounding to only what the PC witnessed.
  Powerful, but needs new per-session presence tracking — a feature in its own right.
- **Default lens only (chosen)** — the persona/voice lens already exists; the main character just makes it
  *durable and default*. The knowledge horizon is explicitly deferred.

### Journal authoring
- **AI-written in-character diary** — Claude composes the entry. Rejected: the user wants their *own* words
  as the durable record, and it's not the point.
- **User-written plain entries + AI extraction (chosen)** — the raw entry is the durable log; the AI does
  the bookkeeping (entities/notes/changes) for inline review. Matches the app's capture-then-synthesize
  pattern (like Recap).

### Journal ↔ engine
- **Extend the changeset with an "edit existing entity" op** — needed for "X is now level 5" as a field
  edit. Deferred: v2 already covers the stated needs; revealed facts land as notes in v1.
- **Reuse changeset v2 as-is (chosen)** — new entities, notes, status changes, and relationship form/sever
  are all already expressible and session-stamped.

### Rename depth
- **Rename internals** (`event_log`→`journal_entry`, IPC channels, types) — churny, needs a migration, and
  erodes the ADR-019 split.
- **User-facing copy only (chosen)** — continues the internal/external split; no migration, no wide refactor.

### Journal placement
- **Re-theme the existing Capture "session log" panel in place** — smaller, but doesn't make it primary.
- **A new top-level, default view (chosen)** — capture-by-writing becomes the main path; manual entity
  editing lives in Capture as the fallback.

## Decision

**1. `campaign.main_character_id`** — a nullable FK to `entity`, `ON DELETE SET NULL` (self-clears if the
PC is deleted). **Migration 0007** is a plain nullable `ALTER TABLE ... ADD COLUMN` (the `entity_link.createdAt`
"nullable so ADD COLUMN is clean" precedent); the Drizzle `.references(() => entity.id)` thunk handles the
benign `campaign`↔`entity` cycle, and the FK-off-around-`migrate()` guard (ADR-004) makes creation order
moot. `updateCampaign` validates the target is a `pc` in the *same* campaign (main-process guard; a bad
value rejects the update). On campaign open the renderer **seeds `activePcId` from `main_character_id`**
when none is set — a durable default, still overridable per session. **Recall/Suggest logic is unchanged**:
they already run off the active PC.

**2. The Journal** is the re-themed `event_log`, promoted to a **top-level, default view**. Internal
identifiers (`event_log`, `EventLogEntry`, `event:*` IPC, `useEvents`, the backfill `'beats'` phase key)
are **unchanged** — only user-facing copy becomes "Journal," continuing the ADR-019 split.

**3. Journal → extraction → inline review → apply.** On submit the raw entry is saved first via
`createEvent` (the durable log line — it stands even if the proposal is discarded); then, if an API key is
present, `import.extract({ withChanges: true })` proposes entities/notes/status/relationship changes,
reviewed inline via a shared **`ChangesetReview`** (over the existing import rows + `useImport`) and applied
via `applyChangeset` **stamped at the current session**. No engine change — v2 already expresses everything
the flow needs. Review is per-entry and one-at-a-time. **Field-level edits to existing entities are
deferred.**

## Rationale

The feature is ~90% reuse: the active-PC/persona lens and the changeset-v2 extract/apply engine already
existed, so the build is *persistence + a capture surface + wiring*. Default-lens-only delivers "the app
knows who I am" without the heavy per-character knowledge model. Storing the pointer on the campaign (not
`localStorage`) makes it durable and exportable and lets the main process reject invalid targets. Keeping
internals named `event_log` preserves the ADR-019 disambiguation and avoids a churny rename + migration.
User-written-plus-extraction keeps the user's words as the journal and matches capture-then-synthesize
(Recap). The one migration is a trivial nullable column.

## Consequences

### Positive
- Table workload collapses to a sentence or two; the AI proposes the bookkeeping; manual editing is the fallback.
- The main character is durable, exportable, and the default lens — no re-picking each session.
- Zero changes to the extraction/apply engine and to Recall/Suggest logic — low regression surface.
- Exactly one trivial migration (nullable `ADD COLUMN`).

### Negative
- The journal review is one-at-a-time (the next entry waits until the current proposal is applied/discarded).
- The journal appears both as the top-level view and (still) as a Capture panel — two entry points to one feed.
- Field-level entity edits aren't proposed yet, so "X is now level 5" lands as a note, not an attribute change.

### Risks & Mitigations
- **A pending review surviving a campaign switch could apply against the wrong campaign** (its entity refs
  belong to the old campaign) → `EventFeed` is keyed by `activeCampaignId`, resetting review state on switch.
- **A non-PC / cross-campaign main character** → validated in the main process; a bad value rejects the update.
- **Deleting the main-character PC** → `ON DELETE SET NULL` self-clears the pointer (0007 migration test).
- **Extraction taxing fast capture** → the raw entry is saved *before* extraction and extraction is skipped
  gracefully when there's no key / offline / empty / too-long; the log is never blocked on the AI.

## Related Decisions

- ADR-014 — the import extraction/apply pipeline the journal reuses.
- ADR-018 — changeset v2 (status/relationship changes, session-stamped) reused verbatim.
- ADR-017 — chronology: the current-session stamp feeds as-of reconstruction; the per-character *knowledge
  horizon* is explicitly NOT built here (future work).
- ADR-019 — the `event_log` (party log) vs. `event` *entity* (world history) split, preserved by the
  user-facing-only rename.
- ADR-004 — SQLite/Drizzle migration conventions (nullable `ADD COLUMN`, FK-off-around-`migrate()`).
- ADR-007 / ADR-016 — the Zustand active-PC selection + persona voice the main character now seeds.

## References

- `src/main/db/schema.ts` (`campaign.main_character_id`), `drizzle/0007_stale_loki.sql`
- `src/main/services/campaign.service.ts` (`resolveMainCharacter` validation)
- `src/shared/entity-types.ts` (`Campaign.mainCharacterId`), `src/shared/ipc-types.ts` (`UpdateCampaignInput`)
- `src/renderer/src/components/layout/Sidebar.tsx` (`ActivePcSelector` — seed effect + ★ toggle),
  `src/renderer/src/store/ui-store.ts` + `src/renderer/src/components/layout/MainPanel.tsx` (journal default view)
- `src/renderer/src/components/views/JournalView.tsx`, `src/renderer/src/components/capture/EventFeed.tsx`
  (journal + extraction), `src/renderer/src/components/capture/ChangesetReview.tsx` (shared review)
- `tests/unit/services/campaign.service.test.ts`, `tests/integration/migrations.test.ts` (0007)
- `../../SPEC.md` §10 (Delivered beyond the MVP), `../../ARCHITECTURE.md` (data model, RAG grounding)
