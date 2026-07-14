import type { ExtractFailureReason } from '@shared/import-types'

/**
 * Summarize the FAILED rows of an Illuminate sweep so the dialog can render an honest failure state
 * instead of "nothing new" when per-entity enrich calls errored (A1 — the class of bug that hid the Haiku
 * 400). In a settled sweep a `state: 'failed'` row is always a NON-global failure (`no_key`/`bad_key`/
 * `offline` abort the sweep and route to the error/review states). Returns null when nothing failed.
 */
export function summarizeFailures(
  progress: { state: string; reason?: ExtractFailureReason }[]
): { count: number; reasons: ExtractFailureReason[] } | null {
  const failed = progress.filter((p) => p.state === 'failed')
  if (failed.length === 0) return null
  const reasons = [...new Set(failed.map((p) => p.reason ?? 'api'))]
  return { count: failed.length, reasons }
}
