import { embed, isModelReady } from './embedding.service'
import { isRerankerReady, rerank } from './rerank.service'
import { fakeAiEnabled } from './ai-fake'
import type { RetrievedChunk, VectorStore } from './vector-store.service'

// Shared hybrid retrieval (ADR-052). One place for the dense + fuzzy + rerank pipeline that Recall, Counsel,
// and Converse's focus-context all use (the dense/fuzzy merge was previously copy-pasted across the three).
// When the reranker is present it fetches a WIDER candidate pool and trims it back to `finalK` by true
// query↔passage relevance; otherwise it just dedupes and caps. Graceful degradation is preserved: dense is
// skipped when the embedding model isn't ready (or under the e2e fake seam), and the model-free fuzzy match
// always runs — so retrieval still returns grounded chunks offline / before the model is downloaded.

/** Wide candidate pool pulled from dense search when a reranker will trim it back to finalK. */
export const RERANK_CANDIDATES = 24

export interface HybridOptions {
  campaignId: string
  /** Chronology clamp (ADR-017): only notes from sessions ≤ asOf; undated notes always pass. */
  asOf?: number
  /** How many chunks to return after reranking/capping. */
  finalK: number
  /** Max entities the fuzzy name-match may fold in (default 2). */
  fuzzyLimit?: number
  /** Drop this entity's chunks (Converse's own target, already grounded by direct fetch). */
  excludeEntityId?: string
}

export async function hybridRetrieve(
  store: VectorStore,
  query: string,
  opts: HybridOptions
): Promise<RetrievedChunk[]> {
  const { campaignId, asOf, finalK, fuzzyLimit = 2, excludeEntityId } = opts
  const rerankReady = isRerankerReady() && !fakeAiEnabled()
  const denseK = rerankReady ? RERANK_CANDIDATES : finalK

  let dense: RetrievedChunk[] = []
  if (isModelReady() && !fakeAiEnabled()) {
    try {
      dense = store.search(await embed(query), campaignId, denseK, asOf)
    } catch {
      dense = [] // retrieval is a bonus — a broken/absent model must never sink the lens
    }
  }

  // Fuzzy name-match (model-free) folds in entities the query names but the dense pass missed (misspellings,
  // proper nouns). Exclude entities already surfaced densely — and the caller's own target — to avoid dupes.
  const excludeIds = new Set<string>(
    dense.map((c) => c.entityId).filter((id): id is string => id !== null)
  )
  if (excludeEntityId) excludeIds.add(excludeEntityId)
  const fuzzy = store.fuzzyEntityChunks(campaignId, query, excludeIds, fuzzyLimit, asOf)

  // Merge (fuzzy first, so a named entity leads), dedupe by source identity, drop the excluded target.
  const seen = new Set<string>()
  const merged: RetrievedChunk[] = []
  for (const c of [...fuzzy, ...dense]) {
    if (excludeEntityId && c.entityId === excludeEntityId) continue
    const key = `${c.entityId ?? 'lore'}:${c.noteId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }

  return rerankReady ? rerank(query, merged, finalK) : merged.slice(0, finalK)
}
