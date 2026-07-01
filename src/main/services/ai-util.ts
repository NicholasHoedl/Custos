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

/** Map a thrown error to a coarse failure kind shared across the AI features. */
export function classifyError(err: unknown): 'no_key' | 'offline' | 'api' {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'no_key') return 'no_key'
  if (/network|fetch|ENOTFOUND|ECONN|timeout|getaddrinfo/i.test(msg)) return 'offline'
  return 'api'
}
