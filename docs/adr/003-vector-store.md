# ADR-003: Vector store — sqlite-vec co-located in the SQLite database

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Recall needs nearest-neighbor search over note embeddings. The app already uses SQLite for
relational data (ADR-004). Options range from an embedded SQLite vector extension to a
separate vector database or a pure-JS index. Scale is single-user: hundreds to low-thousands
of vectors.

## Decision Drivers

* Keep the vector index **local and co-located** with relational data
* **Zero** extra services/processes
* **Trivial packaging**
* Adequate ANN at small scale
* Native-extension packaging **acceptable** to the developer (confirmed)

## Considered Options

### Option 1: `sqlite-vec` extension, co-located in the same SQLite DB
- **Pros:** one file, one connection, no extra process; SQL-native vector queries; brute-force
  / `vec0` search is fast at this scale; backed up atomically with the database.
- **Cons:** a native `.dll` must be bundled and `loadExtension`-ed on Windows (developer
  confirmed this is acceptable); younger project than some alternatives.

### Option 2: Pure-JS index (hnswlib-node, or brute-force cosine in JS)
- **Pros:** avoids a native SQLite extension.
- **Cons:** a separate index file to keep in sync with SQLite; hnswlib-node is itself a native
  addon; brute-force JS works at small scale but reinvents what sqlite-vec gives for free.

### Option 3: Dedicated vector DB (Chroma, LanceDB, Qdrant)
- **Pros:** scalable, feature-rich.
- **Cons:** an extra process/service or a heavy dependency; overkill for single-user local;
  more packaging burden.

## Decision

Use the **`sqlite-vec` extension co-located in the main SQLite database**.

## Rationale

It keeps the entire data layer in one file and one connection with no extra process — the best
fit for a local-first single-user app — and the developer has confirmed that bundling/loading
a native `.dll` is acceptable, which removes the only real objection. ANN at MVP volume is
trivially fast.

## Consequences

### Positive
- Single-file data layer; atomic backups; SQL-native vector queries; no sync between two stores.

### Negative
- Must bundle and load a platform-specific `.dll`; coupled to sqlite-vec's maturity.

### Risks & Mitigations
- Native-extension packaging/loading issues in the Electron build → fall back to **pure-JS
  brute-force cosine** (retained as a contingency), accepting a separate in-memory/disk index.

## Related Decisions

- ADR-004 — the SQLite datastore this rides inside
- ADR-001 / ADR-002 — producers of the vectors stored here

## References

- `../../ARCHITECTURE.md` §4 (Vector Index)
- `../../ROADMAP.md` P2-03
