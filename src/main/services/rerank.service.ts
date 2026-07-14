import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { ModelDownloadProgress } from '@shared/recall-types'
import type { RetrievedChunk } from './vector-store.service'

// Cross-encoder reranker (ADR-052). A second, tiny model that re-scores the merged dense+fuzzy candidates by
// TRUE query↔passage relevance — a bi-encoder only compares independently-embedded vectors, so it can't tell
// which of two on-topic chunks actually answers THIS query. The reranker reads (query, passage) together and
// gives a single comparable score, producing a unified ordering and a principled top-N. Runs in the main
// process on onnxruntime-node (cpu); weights live in userData/models. OPTIONAL: retrieval degrades to the
// un-reranked merge when the model isn't downloaded (its own ready-marker, independent of the embedder).
const RERANK_MODEL = 'mixedbread-ai/mxbai-rerank-xsmall-v1'
const rlog = log.scope('rerank')

type Transformers = typeof import('@huggingface/transformers')
let tfMod: Transformers | null = null
async function tf(): Promise<Transformers> {
  if (!tfMod) tfMod = await import('@huggingface/transformers')
  return tfMod
}

// Minimal structural shapes — Transformers.js's own types are broad; we only need callable tokenizer + model.
type Tokenizer = (
  text: string[],
  opts: { text_pair: string[]; padding: boolean; truncation: boolean }
) => unknown
type SeqClsModel = (inputs: unknown) => Promise<{ logits: { tolist(): number[][] | number[] } }>

let rk: { tok: Tokenizer; model: SeqClsModel } | null = null
let loading: Promise<{ tok: Tokenizer; model: SeqClsModel }> | null = null

function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}
function readyMarker(): string {
  const slug = RERANK_MODEL.replace(/[^a-z0-9]+/gi, '-')
  return join(modelsDir(), `.${slug}.ready`)
}
async function configureEnv(allowRemote: boolean): Promise<void> {
  const { env } = await tf()
  env.cacheDir = modelsDir()
  env.allowRemoteModels = allowRemote
  env.allowLocalModels = true
}

export function isRerankerReady(): boolean {
  return existsSync(readyMarker())
}

async function getModel(): Promise<{ tok: Tokenizer; model: SeqClsModel }> {
  if (rk) return rk
  if (!loading) {
    loading = (async () => {
      await configureEnv(false) // never hit the network on the hot path
      const { AutoTokenizer, AutoModelForSequenceClassification } = await tf()
      const tok = (await AutoTokenizer.from_pretrained(RERANK_MODEL)) as unknown as Tokenizer
      const model = (await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
        dtype: 'q8'
      })) as unknown as SeqClsModel
      rk = { tok, model }
      return rk
    })()
  }
  return loading
}

/**
 * PURE: attach the cross-encoder relevance scores to the chunks, sort by score descending, take the top N.
 * Exported so the ordering can be unit-tested without loading a model (the model call is mocked away).
 */
export function applyRerankScores(
  chunks: RetrievedChunk[],
  scores: number[],
  topN: number
): RetrievedChunk[] {
  return chunks
    .map((c, i) => ({ ...c, score: scores[i] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

/**
 * Re-rank retrieved chunks by cross-encoder query↔passage relevance and return the top N. Falls back to the
 * input order (capped to N) when the model isn't ready or errors — reranking is a bonus, never load-bearing.
 */
export async function rerank(
  query: string,
  chunks: RetrievedChunk[],
  topN: number
): Promise<RetrievedChunk[]> {
  if (!isRerankerReady() || chunks.length === 0) return chunks.slice(0, topN)
  try {
    const { tok, model } = await getModel()
    const inputs = tok(new Array(chunks.length).fill(query), {
      text_pair: chunks.map((c) => c.content),
      padding: true,
      truncation: true
    })
    const raw = (await model(inputs)).logits.tolist()
    // Single-label cross-encoder: logits are [N, 1] → take column 0 (or a flat [N] on some exports).
    const scores = Array.isArray(raw[0]) ? (raw as number[][]).map((r) => r[0]) : (raw as number[])
    return applyRerankScores(chunks, scores, topN)
  } catch (err) {
    rlog.warn('rerank failed — falling back to input order', err)
    return chunks.slice(0, topN)
  }
}

/** Preload the reranker in the background (post-onboarding) so the first reranked query isn't slow. */
export function warmReranker(): void {
  if (isRerankerReady()) void getModel().catch(() => undefined)
}

/** Download + cache the reranker (onboarding, after the embedder). Retries transient failures; emits progress. */
export async function downloadReranker(
  onProgress: (p: ModelDownloadProgress) => void
): Promise<void> {
  mkdirSync(modelsDir(), { recursive: true })
  await configureEnv(true)
  const attempts = 3
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { AutoTokenizer, AutoModelForSequenceClassification } = await tf()
        const progress_callback = (info: {
          status?: string
          file?: string
          loaded?: number
          total?: number
        }): void => {
          if (info.status === 'progress') {
            onProgress({ status: 'downloading', file: info.file, loaded: info.loaded, total: info.total })
          }
        }
        const tok = (await AutoTokenizer.from_pretrained(RERANK_MODEL, {
          progress_callback
        })) as unknown as Tokenizer
        const model = (await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
          dtype: 'q8',
          progress_callback
        })) as unknown as SeqClsModel
        rk = { tok, model }
        writeFileSync(readyMarker(), new Date().toISOString())
        return
      } catch (err) {
        if (attempt >= attempts) throw err
        // Transient failure (e.g. ECONNRESET from the model CDN) — back off and retry.
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  } finally {
    await configureEnv(false)
  }
}
