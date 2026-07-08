import { lookup } from 'node:dns/promises'

// Small shared helpers for the AI-backed features (Recall, Suggest, Recap, Import). Kept out of
// claude.service so they don't pull in the Anthropic SDK, and out of each orchestration service so the
// online check and error classification aren't copy-pasted per feature.

/** Cheap reachability probe: does api.anthropic.com resolve? Gate a Claude call behind this. */
export async function isOnline(): Promise<boolean> {
  try {
    await lookup('api.anthropic.com')
    return true
  } catch {
    return false
  }
}

/** True when a thrown error is an Anthropic auth failure — a missing, revoked, or invalid API key. */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid x-api-key|authentication_error|\b401\b/i.test(msg)
}

/** Map a thrown error to a coarse failure kind shared across the AI features. A present-but-REJECTED
 *  key (401) is reported as `bad_key`, distinct from `no_key` — "add a key" vs "your key was rejected"
 *  are different diagnoses (ADR-032). */
export function classifyError(err: unknown): 'no_key' | 'bad_key' | 'offline' | 'api' {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'no_key') return 'no_key'
  if (isAuthError(err)) return 'bad_key'
  if (/network|fetch|ENOTFOUND|ECONN|timeout|getaddrinfo/i.test(msg)) return 'offline'
  return 'api'
}
