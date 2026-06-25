# Architecture Decision Records — Ledger

This directory records the significant architecture decisions for **Ledger**, a local-first
Electron desktop app for D&D narrative tracking with Claude-powered Recall (RAG) and a
multi-attitude Suggest feature.

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
| [009](009-suggest-output-model.md) | Suggest output model: multi-attitude structured output | Accepted | 2026-06-25 |
| [010](010-global-hotkey-behavior.md) | Global quick-add hotkey behavior | Proposed | 2026-06-25 |
| [011](011-graph-query-raw-sql.md) | Raw SQL (recursive CTEs) for graph traversal; Drizzle for CRUD | Accepted | 2026-06-25 |

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

These ADRs formalize the decisions summarized in `../../ARCHITECTURE.md` §11 and `../../ROADMAP.md`.
