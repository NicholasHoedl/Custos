# Architecture Decision Records — Ledger

This directory records the significant architecture decisions for **Ledger**, a local-first
Electron desktop app for D&D narrative tracking with Claude-powered Recall (RAG) and a
multi-tag Counsel feature.

Each ADR captures the **context**, the **options considered**, the **decision**, and its
**consequences**. An ADR is immutable once **Accepted** — to change a decision, write a new
ADR that supersedes the old one (don't edit the old one).

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](001-embeddings-runtime.md) | Embeddings runtime: Transformers.js vs. Python sidecar | Accepted | 2026-06-25 |
| [002](002-embedding-model.md) | Embedding model: all-MiniLM-L6-v2 | Accepted | 2026-06-25 |
| [003](003-vector-store.md) | Vector store: sqlite-vec co-located in SQLite | Accepted | 2026-06-25 |
| [004](004-local-datastore.md) | Local datastore: SQLite + better-sqlite3 + Drizzle ORM | Accepted | 2026-06-25 |
| [005](005-api-key-storage.md) | API key storage: Electron safeStorage (DPAPI) | Accepted | 2026-06-25 |
| [006](006-build-tooling.md) | Build tooling: electron-vite | Accepted | 2026-06-25 |
| [007](007-renderer-state-management.md) | Renderer state management: Zustand | Accepted | 2026-06-25 |
| [008](008-streaming-ipc-protocol.md) | Streaming IPC protocol: custom typed channels | Accepted | 2026-06-25 |
| [009](009-suggest-output-model.md) | Suggest output model: multi-attitude structured output | Superseded by [016](016-suggest-multitag-overhaul.md) | 2026-06-25 |
| [010](010-global-hotkey-behavior.md) | Global quick-add hotkey behavior | Accepted | 2026-06-25 |
| [011](011-graph-query-raw-sql.md) | Raw SQL (recursive CTEs) for graph traversal; Drizzle for CRUD | Accepted | 2026-06-25 |
| [012](012-vector-store-bruteforce.md) | Brute-force JS cosine vector store for v1 (refines ADR-003) | Accepted | 2026-06-25 |
| [013](013-session-recap.md) | Session recap: neutral streamed summary saved to the session | Accepted | 2026-06-30 |
| [014](014-import-extraction-apply.md) | Import: LLM extraction with human-in-the-loop transactional apply | Accepted | 2026-06-30 |
| [015](015-current-scene.md) | Current scene: a renderer-selected present moment pinned into grounding | Accepted | 2026-06-30 |
| [016](016-suggest-multitag-overhaul.md) | Suggest output model v2: multi-tag moments + directions mode (supersedes ADR-009) | Accepted | 2026-06-30 |
| [017](017-chronology-temporal-model.md) | Chronology: session-led temporal model (validity intervals + as-of reconstruction) | Accepted | 2026-07-01 |
| [018](018-backfill-interview.md) | Backfill interview: roster-then-beats guided import onto the timeline | Accepted | 2026-07-02 |
| [019](019-event-entity-rescope.md) | Event entities re-scoped: world history, not party beats | Accepted | 2026-07-02 |
| [020](020-operational-hardening.md) | Operational hardening: DB backups, logging, startup recovery | Accepted | 2026-07-02 |
| [021](021-creature-confidence-lore.md) | Creature type, `presumed_ended` lifecycle, note confidence, entity-less campaign lore | Accepted | 2026-07-06 |
| [022](022-main-character-journal-capture.md) | Main character + journal-driven capture | Accepted | 2026-07-06 |
| [023](023-post-journal-refinements.md) | Post-journal capture & UI refinements (removals + relocations) | Accepted | 2026-07-06 |
| [024](024-grim-retheme.md) | Grim dark-fantasy re-theme ("Ash & Ember"): palette, glossary, death motif | Accepted | 2026-07-06 |
| [025](025-converse-in-character-questions.md) | Converse: an in-character question lens (single-shot structured, direct-fetch grounding) | Accepted | 2026-07-07 |
| [026](026-counsel-v2-mechanics-flaws.md) | Counsel v2: mechanical layer, pillar/teamwork diversity, flaws, and surfacing entity data | Accepted | 2026-07-07 |
| [027](027-scene-counsel-only.md) | Scene is Counsel-only; Consult is a scene-free out-of-character notes narrator (drops Time of Day) | Accepted | 2026-07-07 |
| [028](028-changeset-field-changes.md) | Changeset field changes: add/cut/alter to existing entities' traits/goals/flaws & attributes | Accepted | 2026-07-07 |
| [029](029-main-character-overhaul.md) | Main character overhaul: mandatory single-lens protagonist, main-char-only depth, Voice Examples & derive-from-backstory | Accepted | 2026-07-07 |
| [030](030-character-page-unified-persona.md) | Character page (first-in-nav home for the main character) + unified single-canonical persona generator | Accepted | 2026-07-07 |
| [031](031-changeset-dedup-hardening.md) | Changeset dedup hardening: near-duplicate notes, already-live ties, no-op changes | Accepted | 2026-07-08 |
| [032](032-ux-consolidation.md) | UX consolidation: nav restructure (Sessions/Transcribe), naming (Lore, Draft, Keeper voice), shared failure copy, note/tie editability | Accepted | 2026-07-08 |
| [033](033-tie-enrichment.md) | Tie enrichment: per-direction disposition + epistemic confidence (+ AI-populated descriptions), migration 0010 | Accepted | 2026-07-08 |
| [034](034-converse-questions-only.md) | Converse v2: questions-only tagged spread (talk WITH a character) + as-of notes clamp; revises ADR-025 output | Accepted | 2026-07-08 |
| [035](035-two-tier-extraction.md) | Two-tier extraction: 'capture' note-taker (entities+notes+status) + per-entity "Illuminate" enrichment from full note history | Accepted | 2026-07-08 |
| [036](036-chronicle-header-consolidation.md) | Chronicle-header consolidation: Transcribe becomes a header dialog; the session selector moves out of the Sidebar (revises ADR-032) | Accepted | 2026-07-08 |
| [037](037-session-integrity.md) | Session integrity: a derived "unclosed" signal (no stamp column) + editable chronicle entries | Accepted | 2026-07-09 |
| [038](038-entity-merge.md) | Entity merge: re-point only, cascade-swept dedup (no explicit pre-delete) | Accepted | 2026-07-09 |
| [039](039-entity-portraits.md) | Entity portraits: a base64 JPEG thumbnail in a nullable column (migration 0011), not files | Accepted | 2026-07-10 |
| [040](040-relationship-graph.md) | Relationship graph: a d3-force "Web" view over live ties (new 9th nav view) | Accepted | 2026-07-10 |
| [041](041-e2e-fake-ai-seam.md) | An env-gated fake-AI seam (`LEDGER_FAKE_AI`) for e2e — driving the close-out wizard offline | Accepted | 2026-07-10 |
| [042](042-distribution-autoupdate.md) | Distribution: electron-updater auto-update via public GitHub Releases + a tag-triggered CI release, proprietary license, unsigned/cert-ready (revises ADR-020) | Accepted | 2026-07-10 |
| [043](043-fake-ai-all-lenses.md) | The fake-AI e2e seam extended to every AI lens (persona + model-gate/fuzzy-retrieval handling); extends ADR-041 | Accepted | 2026-07-10 |
| [044](044-first-run-tutorial.md) | Forced first-run tutorial (guided modal wizard); hard-required validated key + real close-out; navbar reorder (revises ADR-030); multi-provider deferred | Accepted | 2026-07-11 |
| [045](045-tutorial-trim-quickstart-guide.md) | Trim the first-run tutorial (drop chronicle-entry + close-out steps) + an always-available Quickstart guide from a sidebar button (revises ADR-044) | Accepted | 2026-07-12 |

## Status legend

- **Proposed** — recommended but not yet confirmed (e.g., to settle during Phase 0)
- **Accepted** — decided; build accordingly
- **Deprecated** — no longer relevant
- **Superseded** — replaced by a later ADR (linked)
- **Rejected** — considered but not adopted

## Creating a new ADR

1. Copy `template.md` to `NNN-short-title.md` (next number).
2. Fill it in; set **Status** to *Proposed*.
3. When decided, set **Status** to *Accepted* and add a row to the Index above.
4. To reverse a past decision, write a new ADR that **Supersedes** it — don't edit the old one.

These ADRs formalize the significant architecture decisions; see `../../SPEC.md` for product
scope (including §10, Delivered beyond the MVP).
