// AI usage + cost accounting (ROADMAP P0-4). A BYO-key product owes the user visibility: every model
// call records token usage + estimated USD centrally (main-process usage.service), and surfaces
// per-run cost on the result where a human is watching (the lenses, the close-out wizard, Illuminate).

/** Where a call came from — the Settings breakdown's rows. */
export type AiFeature =
  | 'lore'
  | 'counsel'
  | 'converse'
  | 'extraction'
  | 'illuminate'
  | 'recap'
  | 'persona'
  | 'backstory'

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  lore: 'Lore',
  counsel: 'Counsel',
  converse: 'Converse',
  extraction: 'Extraction (close-out & Transcribe)',
  illuminate: 'Illuminate',
  recap: 'Recaps',
  persona: 'Personas',
  backstory: 'Backstory derive'
}

/** Token counts for one call, as reported by the API. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One call's usage plus its estimated price. */
export interface AiRunCost extends AiUsage {
  usd: number
}

/** Sum per-run costs (retry-once loops, the Illuminate sweep, the close-out wizard's two tiers). */
export function addRunCost(a: AiRunCost | undefined, b: AiRunCost): AiRunCost {
  if (!a) return b
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    usd: a.usd + b.usd
  }
}

/** The Settings "AI usage" card: current month + lifetime, with a per-feature breakdown. */
export interface UsageSummary {
  /** e.g. "2026-07" */
  monthKey: string
  monthUsd: number
  monthCalls: number
  byFeature: Partial<Record<AiFeature, { calls: number; usd: number }>>
  lifetimeUsd: number
  lifetimeCalls: number
}
