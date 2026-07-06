import type { Lifecycle } from './entity-types'

// The single status→lifecycle mapping, shared by the main process (entity/import/chronology services) and
// the renderer (the merged Status control derives lifecycle for a free-text status). It MUST keep mirroring
// the SQL `CASE` in migration 0005 so backfilled rows and runtime writes agree.

export const ENDED_KEYWORDS = [
  'dead',
  'deceased',
  'destroyed',
  'ruined',
  'disbanded',
  'abandoned',
  'gone'
]

/**
 * Derive a coarse lifecycle from free-text status: dead/destroyed/… → `ended`; blank → `unknown`; else
 * `active`. Never yields `presumed_ended` — that is an explicit user choice (the "presumed" toggle).
 */
export function lifecycleHeuristic(status: string | null): Lifecycle {
  if (status === null || status.trim() === '') return 'unknown'
  const s = status.toLowerCase()
  return ENDED_KEYWORDS.some((k) => s.includes(k)) ? 'ended' : 'active'
}
