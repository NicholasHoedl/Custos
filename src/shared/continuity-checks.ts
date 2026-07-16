// Pure deterministic continuity checks (ADR-056) — the always-on, key-free half of the Continuity audit.
// Side-effect-free (no Electron/DB) so it unit-tests directly, mirroring lib/graph-reduce & lib/mention.
// The service resolves the DB facts and hands these plain records in; the pure predicates only compare.
// They flag PRECISE structural slips (a status/lifecycle mismatch, a live ally∧enemy pair) — the semantic
// contradictions, and anything time-relative (a dead entity still ACTING), are left to the AI pass. A
// dead entity merely still HOLDING a tie is NOT a slip: ties/notes persist past death by design.

import { ENTITY_TYPES, lifecycleLabel, type EntityType, type Lifecycle } from './entity-types'
import { profileFor } from './entity-profiles'
import type { ContinuityFinding } from './continuity-types'

/** The subset of an entity the checks read. */
export interface CheckEntity {
  id: string
  name: string
  type: EntityType
  status: string | null
  lifecycle: Lifecycle
}

/** A tie reduced to what the structural checks need. `live` = the interval is still open (endSessionNumber
 *  is null). `relation` is the free-text forward key. */
export interface CheckLink {
  /** Stable interval id (the entity_link PK) — carried so a faction-conflict fix can sever THIS exact tie. */
  id: string
  fromEntityId: string
  toEntityId: string
  relation: string
  live: boolean
}

// A preset's implied lifecycle "agrees" with the stored one when they're equal — OR when the preset says
// `ended` and the entity is `presumed_ended`. The "Presumed" toggle (ADR-021) flips `ended → presumed_ended`
// but leaves the status on its `ended`-lifecycle preset ("Dead"/"Destroyed"/…) — a standard workflow, NOT a
// mismatch. (No preset ever carries `presumed_ended`, so this is the only cross-case.)
function lifecycleAgrees(presetLifecycle: Lifecycle, stored: Lifecycle): boolean {
  if (presetLifecycle === stored) return true
  return presetLifecycle === 'ended' && stored === 'presumed_ended'
}

/**
 * A status preset's implied lifecycle disagrees with the stored lifecycle (a manual or legacy slip — AI
 * extraction can't cause it post-ADR-054). Fires ONLY for a known preset status; free text is skipped.
 */
export function statusLifecycleMismatches(entities: CheckEntity[]): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  for (const e of entities) {
    const status = e.status
    if (!status) continue
    // `entity.type` is free-text TEXT and campaign import doesn't validate it (an imported/legacy type could
    // be off-union) — skip unknown types so a bad row can't throw and reject the whole key-free audit.
    if (!ENTITY_TYPES.includes(e.type)) continue
    const preset = (profileFor(e.type).status ?? []).find(
      (p) => p.label.toLowerCase() === status.trim().toLowerCase()
    )
    if (preset && !lifecycleAgrees(preset.lifecycle, e.lifecycle)) {
      out.push({
        category: 'status-mismatch',
        severity: 'medium',
        source: 'check',
        summary: `${e.name}'s status "${status}" implies it is "${preset.lifecycle}", but it's marked "${e.lifecycle}"`,
        detail: `The preset status "${preset.label}" maps to the "${preset.lifecycle}" lifecycle, yet ${e.name} is recorded as "${e.lifecycle}".`,
        entityIds: [e.id],
        suggestedFix: `Re-pick ${e.name}'s status from the Status control, or adjust its lifecycle to match.`,
        fix: {
          actions: [
            {
              action: { kind: 'set-lifecycle', entityId: e.id, lifecycle: preset.lifecycle },
              label: `Set ${e.name} to "${lifecycleLabel(e.type, preset.lifecycle)}"`
            }
          ]
        }
      })
    }
  }
  return out
}

/** The same unordered pair carries a live `ally_of` AND a live `enemy_of` — they can't be both at once. The
 *  fix carries the SPECIFIC ally + enemy link ids so the GM can sever whichever no longer holds. */
export function factionConflicts(entities: CheckEntity[], links: CheckLink[]): ContinuityFinding[] {
  const nameOf = new Map(entities.map((e) => [e.id, e.name]))
  // "a|b" (sorted ids) -> the first live ally / enemy link id seen for that pair (one of each is the norm
  // given dedup; a rare duplicate resolves on the next Re-run).
  const pairs = new Map<string, { a: string; b: string; allyId?: string; enemyId?: string }>()
  for (const l of links) {
    if (!l.live) continue
    if (l.relation !== 'ally_of' && l.relation !== 'enemy_of') continue
    const [a, b] = [l.fromEntityId, l.toEntityId].sort()
    const key = `${a}|${b}`
    const rec = pairs.get(key) ?? { a, b }
    if (l.relation === 'ally_of') rec.allyId ??= l.id
    else rec.enemyId ??= l.id
    pairs.set(key, rec)
  }
  const out: ContinuityFinding[] = []
  for (const { a, b, allyId, enemyId } of pairs.values()) {
    if (allyId && enemyId) {
      const na = nameOf.get(a) ?? a
      const nb = nameOf.get(b) ?? b
      out.push({
        category: 'faction-conflict',
        severity: 'high',
        source: 'check',
        summary: `${na} and ${nb} are recorded as BOTH allies and enemies`,
        detail: `An "ally of" and an "enemy of" tie between ${na} and ${nb} are both open at the same time.`,
        entityIds: [a, b],
        suggestedFix: `Sever whichever tie no longer holds.`,
        fix: {
          actions: [
            { action: { kind: 'sever-tie', linkId: allyId }, label: `Sever the "ally of" tie` },
            { action: { kind: 'sever-tie', linkId: enemyId }, label: `Sever the "enemy of" tie` }
          ]
        }
      })
    }
  }
  return out
}

/** Run every deterministic check over the gathered campaign records. */
export function runDeterministicChecks(input: {
  entities: CheckEntity[]
  links: CheckLink[]
}): ContinuityFinding[] {
  return [
    ...statusLifecycleMismatches(input.entities),
    ...factionConflicts(input.entities, input.links)
  ]
}
