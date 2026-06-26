# ADR-012: Brute-force JS cosine vector store for v1 (sqlite-vec deferred)

## Status

Accepted — refines ADR-003 (sqlite-vec) for the Phase 2 implementation.

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Phase 2 (Recall) needs a vector store for local semantic search over note + entity embeddings
(`Xenova/all-MiniLM-L6-v2`, 384-dim). ADR-003 chose the `sqlite-vec` extension co-located in the
SQLite file, and explicitly named **pure-JS brute-force cosine** as the accepted contingency. When it
came time to build, the trade-off favored the contingency for v1.

## Decision Drivers

- **Scale is tiny** (SPEC §8: hundreds–low-thousands of notes). 384-dim float32 = 1.5 KB/vector;
  2,000 vectors ≈ 3 MB in memory. A full cosine scan is sub-millisecond — an ANN index buys nothing.
- **The native `.dll` is the single biggest Phase-2 packaging risk.** `sqlite-vec` must `loadExtension`
  on the same `better-sqlite3` handle that is already ABI-rebuilt + `asarUnpack`-ed for Electron, and
  `better-sqlite3` must be compiled with extension loading enabled — real surface for a solo dev on
  Windows.
- Keep a clean seam so `sqlite-vec` can drop in later with zero caller changes.

## Decision

Implement a `VectorStore` interface with a **`BruteForceVectorStore`** for v1: embeddings are stored as
BLOBs in `note_embedding` / `entity_embedding` (normalized at embed time so cosine == dot product);
`search(queryVec, campaignId, k)` loads the campaign's vectors (joined to entity/note metadata),
computes dot products, and returns the top-k. A future `SqliteVecStore` implements the same interface
behind the same `getRawDb()` handle when scale or packaging warrants it.

## Considered Options

- **sqlite-vec now (ADR-003 as written):** SQL-native ANN; but native-extension packaging risk with no
  measurable benefit at MVP scale.
- **Brute-force JS cosine (chosen):** trivial, no native dependency, fast enough; swappable later.
- **A separate vector DB:** massive over-engineering for single-user local-first.

## Consequences

### Positive
- Zero added native dependency; robust packaging; the same SQLite file; instantly testable on
  in-memory DBs with deterministic mock embeddings.

### Negative
- O(n·dim) per query — irrelevant now, would matter only at 100k+ vectors (far beyond MVP).

### Risks & Mitigations
- Growth beyond brute-force comfort → swap in `SqliteVecStore` behind the unchanged `VectorStore`
  interface (mirrors the Phase 1 "LIKE-first behind SearchService, FTS5 later" decision).

## Related Decisions

- **Refines ADR-003** (vector store = sqlite-vec): same intent and schema shape; this defers the native
  extension to a later optimization.
- ADR-001/002 (Transformers.js + all-MiniLM-L6-v2), ADR-011 (raw `better-sqlite3` via `getRawDb()`).

## References

- `src/main/services/vector-store.service.ts`; Phase 2 plan (Recall).
