# ADR-052: Upgrade the local embedder (gte-base-en-v1.5 on Transformers.js v3) + add a cross-encoder reranker

## Status

Accepted — builds on **ADR-001/002** (local Transformers.js embeddings) and the hybrid retrieval feeding
the three AI lenses.

**Date:** 2026-07-14
**Deciders:** Solo developer

## Context

Semantic search ran `Xenova/all-MiniLM-L6-v2` (384-dim) on `@xenova/transformers@2.17`. Two weaknesses:

- **Mid-tier recall.** MiniLM-L6 is a 2021-era baseline; modern small models retrieve noticeably better.
- **Silent truncation.** MiniLM caps input at ~256 tokens, so a long campaign note is only *partly*
  embedded — its later content is invisible to search.

Retrieval feeds all three lenses (Lore/Counsel/Converse), so a better embedder is broadly leveraged. A
bi-encoder also can't tell which of two on-topic chunks actually answers *this* query (it compares
independently-embedded vectors), and the dense/fuzzy merge had no final relevance cap.

## Decision Drivers

- Better retrieval recall, and **full-note** embedding (fix the 256-token truncation).
- Stay **local / CPU / offline** — weights on disk, no network on the hot path.
- Preserve **graceful degradation**: fuzzy name-match still answers when the model is absent (pre-download,
  offline, e2e fake seam).
- Contain blast radius; validate feasibility before committing (a load-spike gate).

## Considered Options

### Option 1: Drop-in 384-dim upgrade (bge-small / gte-small)
- **Pros:** same dimension/size, no runtime change, no re-index dimension shift.
- **Cons:** still short-context (no truncation fix); smaller recall gain.

### Option 2: gte-base-en-v1.5 (768-dim, 8k context) on Transformers.js v3 — CHOSEN
- **Pros:** strong recall; long context fixes truncation; **no instruction prefixes** (unlike E5/BGE/nomic).
- **Cons:** its `"new"` architecture needs the v3 runtime → migrate `@xenova/transformers` →
  `@huggingface/transformers`; a dimension change (384→768) forces a full re-index.

### Option 3: nomic-embed-text-v1.5 (fallback)
- **Pros:** long context, works on more runtimes.
- **Cons:** requires `search_query:` / `search_document:` prefixes threaded through every embed call site.

A **de-risk spike** (throwaway harness) validated Option 2 on `@huggingface/transformers@3.8.1`: gte loads
(`dtype:'q8'`, cpu/onnxruntime-node — `device:'wasm'` is invalid in Node), emits 768-dim normalized vectors,
and reads **past 256 tokens** (two 480-token texts differing only in their tail embed differently). The
mxbai reranker loaded and ranked a relevant passage top. Option 3 stays the documented fallback if gte ever
regresses.

## Decision

1. **Runtime migration.** `@xenova/transformers@2.17` → `@huggingface/transformers@^3.8.1`. Backend =
   **onnxruntime-node (cpu)** — omit `device` (the status-quo Node backend; packaging unchanged); v2's
   `{ quantized: true }` becomes `{ dtype: 'q8' }`. Only `embedding.service.ts` imported the old package.
2. **Embedder → `Alibaba-NLP/gte-base-en-v1.5`** (768-dim). `EMBED_DIM = 768`. The ready-marker is now
   **derived from the model id**, so a swap makes `isModelReady()` false → an existing install re-downloads
   via the already-built "Download model" affordances (Settings/Lore/Counsel). **Migration 0012** (data-only)
   `DELETE`s both embedding tables so `backfill()` (content-hash-only) re-embeds the whole campaign at 768 —
   otherwise stale 384-dim rows would survive. `vector-store.search` now filters rows to the current model
   (defense against any mixed-dim state; the `dot()` `Math.min` would otherwise score them as garbage).
3. **Cross-encoder reranker → `mixedbread-ai/mxbai-rerank-xsmall-v1`** (`rerank.service.ts`, own ready-marker,
   downloaded after the embedder in the same flow). A shared **`hybridRetrieve`** (`retrieval.service.ts`)
   replaces the copy-pasted dense+fuzzy merge in Recall/Counsel/Converse: dense (a WIDER candidate pool when
   reranking) + fuzzy → dedupe → **rerank to top-N** when the reranker is present, else dedupe+cap. Always-on
   when downloaded (no setting); gated `isRerankerReady() && !fakeAiEnabled()` so it's inert under the e2e
   fake seam. Reranking also imposes the **final top-N cap** Recall/Counsel previously lacked.

## Rationale

gte-base-en-v1.5 is the sweet spot: a real recall gain *and* the truncation fix, with no prefix plumbing —
worth the one-time runtime migration and re-index. The reranker is usually a bigger precision win than the
embedder swap and unifies today's incomparable dense-vs-fuzzy scores; making it optional + graceful keeps
the offline/pre-download story intact. The spike removed the only serious unknown (does the new stack load
and read full notes on this runtime) before any of the refactor landed.

## Consequences

### Positive
- Better, **full-note** retrieval across all three lenses; a principled reranked top-N.
- Graceful degradation preserved (fuzzy-only offline / pre-download / under the fake seam).
- The dense/fuzzy merge is de-duplicated into one shared helper.

### Negative / one-time cost
- Existing users re-download **~225 MB** (gte ~140 + reranker ~84) and re-embed their whole campaign once —
  surfaced through the existing not-ready affordances (copy updated from "~25 MB").
- A native `onnxruntime-node` addon is in play — but it already was under v2, so packaging is unchanged.

### Risks & Mitigations
- v3 API drift beyond `dtype`/`device`/`env` → the spike verified the exact calls; nomic is the fallback.
- CPU latency on long-note embeds / rerank → measured in the spike (~0.3 s/long-embed, ~20 ms/rerank);
  candidate pool is bounded (24).
- gte logs a benign `"Unknown model class 'new'"` warning (constructs from base) — expected, not an error.

## Related Decisions

- **ADR-001/002** — local embeddings; this upgrades the model + runtime.
- **ADR-017** — as-of chronology clamp is preserved end-to-end through `hybridRetrieve`.
- **ADR-041/043** — the fake-AI seam; the reranker is inert under it (retrieval stays fuzzy-only).
- **ADR-004** — migration discipline; 0012 is a data-only migration (no schema change; snapshot re-chained).

## References

- `src/main/services/embedding-constants.ts`, `embedding.service.ts`, `rerank.service.ts` (new),
  `retrieval.service.ts` (new), `vector-store.service.ts`, `recall.service.ts`, `suggest.service.ts`,
  `converse.service.ts`, `ipc/onboarding.ts`, `index.ts`.
- `drizzle/0012_purge_embeddings.sql` (+ `_journal.json`, `meta/0012_snapshot.json`).
- `src/renderer/src/components/views/SettingsView.tsx` (download-size copy).
- Tests: `tests/unit/services/rerank.service.test.ts`, `vector-store.test.ts`, `integration/recall.test.ts`,
  `suggest.test.ts`, `integration/migrations.test.ts` (0012 purge + rebuild-safety scoped to < 0012).
