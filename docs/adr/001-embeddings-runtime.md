# ADR-001: Embeddings runtime — Transformers.js vs. Python sidecar

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Recall (semantic search) requires text embeddings generated **on-device**, so that the app
stays local-first and the retrieval step works offline (Anthropic offers no first-party
embeddings endpoint, so embeddings come from a local model regardless). There are two
realistic ways to run an embedding model from an Electron app: in the Node main process via a
JS/ONNX runtime, or in a bundled Python sidecar process. The developer is strong in Python,
which makes a sidecar tempting.

## Decision Drivers

* Local-first and **offline retrieval** (no embeddings API call)
* Minimal **packaging complexity** for a solo-dev Electron app on Windows
* Small **distributable size**
* Few moving parts / low failure surface
* Acceptable **CPU-only** inference at modest data volume (hundreds–low-thousands of notes)

## Considered Options

### Option 1: Transformers.js (`@xenova/transformers`) in the Electron main process
- **Pros:** one language/runtime (TypeScript) shared with the rest of the main process; no
  second process to spawn / health-check / shut down; ~tens of MB model file; trivial
  packaging; runs the same ONNX weights as the Python model, so **equal embedding quality**.
- **Cons:** JS ML ecosystem is thinner than Python's; first-run model download to handle.

### Option 2: Python sidecar (sentence-transformers)
- **Pros:** plays to the developer's Python strength; the most mature ML ecosystem.
- **Cons:** a second runtime to bundle (PyInstaller or similar); process lifecycle management
  (spawn, health-check, graceful shutdown, crash recovery); a much larger distributable
  (Python + torch/sentence-transformers + numpy is several hundred MB); stdio/HTTP IPC adds
  failure surface.

## Decision

Run embeddings with **Transformers.js in the Electron main process**. No Python sidecar.

## Rationale

For a single-user, local-first desktop app the decisive factors are packaging simplicity,
distributable size, and few moving parts — all of which favor the all-Node path.
Transformers.js runs the **same ONNX weights** as the Python equivalent, so there is no
embedding-quality penalty. The developer's Python strength does not justify a second runtime
plus its packaging and lifecycle overhead.

## Consequences

### Positive
- One language/runtime across the main process; embeddings sit next to the SQLite/vector code.
- Negligible packaging delta and no inter-process plumbing.

### Negative
- Bound to the JS/ONNX ecosystem.
- A first-run model download is required (handled by the onboarding step — see ROADMAP P2-02).

### Risks & Mitigations
- CPU inference too slow on the dev machine → fall back to a Python sidecar (this ADR would be
  superseded) or a smaller/quantized model. Validate during Phase 2 before locking the model.

## Related Decisions

- ADR-002 — embedding model run by this runtime
- ADR-003 — vector store the embeddings are written to
- ADR-004 — datastore that co-locates the vectors

## References

- `../../ARCHITECTURE.md` §2 (Why NOT a Python Sidecar)
- `../../ROADMAP.md` P2-02
