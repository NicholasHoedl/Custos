# ADR-004: Local datastore — SQLite (better-sqlite3) + Drizzle ORM

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

All campaigns, sessions, entities, notes, links, and events persist locally on the user's
machine. We need an embedded, zero-install datastore with good Node bindings and typed access
that can also host the vector index (ADR-003). The data model is relational (an entity graph
with notes, links, sessions).

## Decision Drivers

* **Embedded / local-first**, single file on disk
* **Simple** main-process code (synchronous access is fine at this scale)
* **Typed** schema and queries; managed migrations
* Co-locates with `sqlite-vec`
* Battle-tested, low-risk

## Considered Options

### Option 1: SQLite via `better-sqlite3` + Drizzle ORM
- **Pros:** synchronous API simplifies main-process services; single file; excellent Node
  bindings; Drizzle is TypeScript-first, lightweight, schema-as-code, with typed queries and
  migrations; `sqlite-vec` rides in the same DB.
- **Cons:** synchronous calls block the main thread (fine at this scale; heavy ops can be
  offloaded).

### Option 2: SQLite + Prisma
- **Pros:** popular, great DX, mature migrations.
- **Cons:** heavier; ships a query-engine binary; async-only; more than this app needs.

### Option 3: SQLite with no ORM (raw `better-sqlite3`)
- **Pros:** fewest dependencies.
- **Cons:** hand-rolled types and migrations; more boilerplate.

### Option 4: Document/KV store (LevelDB, lowdb)
- **Pros:** simple JSON storage.
- **Cons:** no relational queries/links; a poor fit for the entity-graph model.

## Decision

Use **SQLite via `better-sqlite3`, with Drizzle ORM** for schema, migrations, and typed queries.

## Rationale

The data model is relational, so SQLite fits naturally. `better-sqlite3`'s synchronous API
keeps service code simple in the main process, and Drizzle adds type safety and migrations
without Prisma's weight or a separate engine binary. It co-locates cleanly with `sqlite-vec`.

## Consequences

### Positive
- A single local DB file; typed, migration-managed schema; simple synchronous services; one
  store for both relational and vector data.

### Negative
- Synchronous DB calls can block the main thread under heavy load; Drizzle is younger than Prisma.

### Risks & Mitigations
- A slow query blocks the event loop → keep queries indexed and small; move heavy batch
  operations (e.g. embedding backfill) off the hot path.

## Related Decisions

- ADR-003 — vector index hosted in this database
- ADR-008 — services exposed to the renderer over IPC

## References

- `../../ARCHITECTURE.md` §1, §4
- `../../ROADMAP.md` P0-03
