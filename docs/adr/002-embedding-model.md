# ADR-002: Embedding model — all-MiniLM-L6-v2

## Status

Accepted (CPU performance to be validated in Phase 2 — see Risks)

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Given the Transformers.js runtime (ADR-001), we need a concrete embedding model. It must be
small, CPU-friendly on Windows, good enough for semantic search over short D&D notes, and
available as an ONNX model for `@xenova/transformers`.

## Decision Drivers

* Small model and **vector size** (storage + query latency)
* **CPU-only** inference speed on a typical Windows machine
* Adequate **retrieval quality** at small scale (hundreds–low-thousands of short notes)
* **ONNX availability** for Transformers.js

## Considered Options

### Option 1: `Xenova/all-MiniLM-L6-v2` (22M params, 384-dim)
- **Pros:** tiny and fast on CPU; widely used, proven baseline quality; ~25 MB ONNX;
  first-class, battle-tested Transformers.js support.
- **Cons:** 384-dim is modest; not state-of-the-art on hard retrieval.

### Option 2: `gte-small` / `bge-small-en` (384-dim)
- **Pros:** stronger benchmark scores than MiniLM at the same vector size.
- **Cons:** slightly larger; marginal real-world gains at this data volume; CPU speed still
  needs validation. (Drop-in later since they're also 384-dim.)

### Option 3: Larger models (e.g. bge-base / e5-base, 768-dim)
- **Pros:** better retrieval quality.
- **Cons:** 2× vector size, slower CPU inference, bigger download — overkill for this scale.

## Decision

Use **`Xenova/all-MiniLM-L6-v2`** (384-dim) as the default embedding model.

## Rationale

At MVP data volume the retrieval-quality differences between small models are marginal, while
MiniLM's speed and size are excellent and its Transformers.js support is the most proven. It
is the lowest-risk default, and swapping to `gte-small`/`bge-small` later is a near-trivial
change (same 384-dim vectors).

## Consequences

### Positive
- Fast CPU embeds; small storage (384 × float32 = 1,536 bytes/vector); small download.

### Negative
- Not state-of-the-art retrieval quality.

### Risks & Mitigations
- Quality or CPU speed inadequate → switch to `gte-small`/`bge-small` (drop-in, same dims) or
  a quantized variant. A model change requires re-embedding existing notes — the backfill
  utility (ROADMAP P2-04) covers this. Validate in Phase 2 before committing.

## Related Decisions

- ADR-001 — runtime that executes this model
- ADR-003 — vector store sized to the 384-dim output

## References

- `../../ARCHITECTURE.md` §1, §5
- `../../ROADMAP.md` P2-02
