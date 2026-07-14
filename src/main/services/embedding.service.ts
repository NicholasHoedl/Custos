import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelDownloadProgress } from '@shared/recall-types'
import { EMBED_DIM, EMBED_MODEL } from './embedding-constants'

// Local sentence embeddings via Transformers.js (ADR-001/002; ADR-052 upgraded the runtime to v3 + the
// gte-base-en-v1.5 embedder). Runs in the main process; weights live in userData/models so a normal launch
// never touches the network (offline-retrieval guarantee). @huggingface/transformers is ESM-only, but the
// main bundle is CJS — so it is loaded via dynamic import(). Backend = onnxruntime-node (cpu); NOT wasm
// (invalid in Node) — so `device` is omitted (defaults to cpu) and `dtype: 'q8'` gives the quantized weights.

export { EMBED_DIM, EMBED_MODEL }

type EmbedPipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array }>

type Transformers = typeof import('@huggingface/transformers')
let tfMod: Transformers | null = null
async function tf(): Promise<Transformers> {
  if (!tfMod) tfMod = await import('@huggingface/transformers')
  return tfMod
}

let pipe: EmbedPipeline | null = null
let loading: Promise<EmbedPipeline> | null = null

function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}
function readyMarker(): string {
  // Model-specific marker (ADR-052): swapping EMBED_MODEL invalidates the old model's readiness, so an
  // existing install re-downloads the new weights via the "Download model" affordances (Settings/Lore/
  // Counsel) instead of falsely reporting ready while holding stale, wrong-dimension vectors.
  const slug = EMBED_MODEL.replace(/[^a-z0-9]+/gi, '-')
  return join(modelsDir(), `.${slug}.ready`)
}

async function configureEnv(allowRemote: boolean): Promise<void> {
  const { env } = await tf()
  env.cacheDir = modelsDir()
  env.allowRemoteModels = allowRemote
  env.allowLocalModels = true
}

export function isModelReady(): boolean {
  return existsSync(readyMarker())
}

async function getPipeline(): Promise<EmbedPipeline> {
  if (pipe) return pipe
  if (!loading) {
    loading = (async () => {
      await configureEnv(false) // never hit the network on the hot path
      const { pipeline } = await tf()
      pipe = (await pipeline('feature-extraction', EMBED_MODEL, {
        dtype: 'q8' // int8-quantized weights (v3 replaced v2's `quantized: true`); device omitted → cpu
      })) as unknown as EmbedPipeline
      return pipe
    })()
  }
  return loading
}

/** Embed text → a 768-dim normalized Float32Array (so cosine similarity == dot product). */
export async function embed(text: string): Promise<Float32Array> {
  const p = await getPipeline()
  const out = await p(text, { pooling: 'mean', normalize: true })
  return out.data
}

/** Preload the pipeline in the background (post-onboarding) so the first real query isn't slow. */
export function warm(): void {
  if (isModelReady()) void getPipeline().catch(() => undefined)
}

/** Download + cache the model (onboarding). Retries transient network failures; emits progress. */
export async function downloadModel(
  onProgress: (p: ModelDownloadProgress) => void
): Promise<void> {
  mkdirSync(modelsDir(), { recursive: true })
  await configureEnv(true)
  const attempts = 3
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { pipeline } = await tf()
        pipe = (await pipeline('feature-extraction', EMBED_MODEL, {
          dtype: 'q8',
          progress_callback: (info: {
            status?: string
            file?: string
            loaded?: number
            total?: number
          }) => {
            if (info.status === 'progress') {
              onProgress({
                status: 'downloading',
                file: info.file,
                loaded: info.loaded,
                total: info.total
              })
            }
          }
        })) as unknown as EmbedPipeline
        writeFileSync(readyMarker(), new Date().toISOString())
        onProgress({ status: 'ready' })
        return
      } catch (err) {
        if (attempt >= attempts) {
          const message = err instanceof Error ? err.message : String(err)
          onProgress({ status: 'error', message: `Download failed: ${message}` })
          throw err
        }
        // Transient failure (e.g. ECONNRESET from the model CDN) — back off and retry.
        onProgress({ status: 'downloading', message: `Connection issue — retrying (${attempt + 1}/${attempts})…` })
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  } finally {
    await configureEnv(false)
  }
}
