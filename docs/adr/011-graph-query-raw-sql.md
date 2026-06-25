# ADR-011: Raw SQL (recursive CTEs) for graph traversal; Drizzle for CRUD

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Phase 1 models entities as a typed property graph (ADR + Phase 1 plan). Two query shapes are
graph-specific and fall outside Drizzle's query builder: **containment-hierarchy traversal**
(`located_in`/`contains`, `member_of`/`has_member`) needs SQLite **recursive CTEs**
(`WITH RECURSIVE`), and the future search/FTS path benefits from raw access too. Drizzle has no
first-class recursive-CTE API.

## Decision Drivers

- The hierarchy traversal and the `getEntityContext` neighborhood gather need recursion / set
  operations Drizzle doesn't express.
- Keep ordinary CRUD typed, terse, and migration-managed (Drizzle's strengths).
- Don't add a second ORM or a graph database (over-engineering at this scale).

## Considered Options

### Option 1: Drizzle for CRUD + raw `better-sqlite3` for recursive/graph queries
- **Pros:** typed CRUD stays in Drizzle; recursion uses plain parameterized SQL via the existing
  `better-sqlite3` handle (`getRawDb()`); no new dependency; one database.
- **Cons:** two query styles in the codebase; raw SQL is unchecked by the type system (mitigated by
  keeping it in `link.service.ts` with typed wrappers + unit tests).

### Option 2: Emulate recursion in TypeScript (iterative BFS over Drizzle queries)
- **Pros:** all-Drizzle, no raw SQL.
- **Cons:** N queries per hop; reimplements what SQLite does in one statement; slower and more code.

### Option 3: A graph database / extension
- **Pros:** native traversal.
- **Cons:** massive over-engineering for hundreds–thousands of nodes, single-user, local-first.

## Decision

Use **Drizzle for all CRUD**, and **raw `better-sqlite3` (via `getRawDb()`) for the recursive-CTE
hierarchy traversal** (and, when needed, search). Both run on the **same** SQLite connection. Raw SQL
is confined to `src/main/services/link.service.ts` behind typed functions (`getHierarchy`,
`getEntityContext`) and covered by unit tests.

> Note: `getEntityContext` itself uses an iterative BFS over Drizzle edge queries (bounded depth +
> node cap) rather than a CTE, because it must hydrate full entity rows per hop; the recursive CTE is
> reserved for the pure-id hierarchy walk where it's clearly better.

## Consequences

### Positive
- Recursion is one fast SQL statement; CRUD stays typed; no extra dependency or datastore.

### Negative
- Two query idioms; raw SQL bypasses the type system.

### Risks & Mitigations
- Raw SQL drift / typos → keep it in one service module, parameterize all inputs, and unit-test the
  traversal (`tests/unit/services/graph.service.test.ts`).

## Related Decisions

- ADR-003/004 (sqlite-vec / SQLite + Drizzle) — same database; this governs how the graph is queried.

## References

- Phase 1 plan (graph-first + composite-for-hierarchy); `src/main/services/link.service.ts`
- SQLite recursive CTEs: https://sqlite.org/lang_with.html
