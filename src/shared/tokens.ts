// D1 (audit follow-up): a cheap, offline token estimate + the extraction size thresholds. Electron-free so
// both the main process (import.service pre-flight guard) and the renderer (ExtractDialog advisory) share it.

/** Rough token count — ~4 chars/token for English. Good enough for pre-flight size guards; no tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Hard pre-flight ceiling for a single extraction's INPUT (import.service.extract). Well under Claude's
 * ~200k context, but catches a pathological session before it 400s (context overflow) as a confusing
 * generic `api` error — the user instead gets a clean `too_long` + the guidance to split.
 */
export const MAX_EXTRACT_INPUT_TOKENS = 150_000

/**
 * Soft advisory threshold (ExtractDialog): a long session where the capped extraction OUTPUT may start to
 * truncate. NON-blocking — just a "extract in parts if it fails" heads-up.
 */
export const EXTRACT_ADVISORY_TOKENS = 12_000
