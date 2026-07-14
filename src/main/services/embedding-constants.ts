// Embedding model identity, in an electron-free module so the vector store (and its unit tests) can
// import it without pulling in embedding.service's `electron`/Transformers.js dependencies.
// ADR-052: upgraded from Xenova/all-MiniLM-L6-v2 (384-dim, ~256-token cap) to gte-base-en-v1.5 (768-dim,
// long-context — full notes are embedded, not truncated). Changing EMBED_MODEL invalidates the on-disk
// ready-marker (embedding.service `readyMarker`) AND requires purging old-dim vectors (migration 0012).
export const EMBED_MODEL = 'Alibaba-NLP/gte-base-en-v1.5'
export const EMBED_DIM = 768
