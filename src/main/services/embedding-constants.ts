// Embedding model identity, in an electron-free module so the vector store (and its unit tests) can
// import it without pulling in embedding.service's `electron`/Transformers.js dependencies.
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBED_DIM = 384
