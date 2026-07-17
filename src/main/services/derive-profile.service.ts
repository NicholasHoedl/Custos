import type {
  DeriveProfileRequest,
  DeriveProfileResult,
  DerivedProfile
} from '@shared/derive-profile-types'
import type { DbContext } from './db-context'
import { getEntity } from './entity.service'
import { getSettings } from './settings.service'
import { deriveProfileCall, isAvailable } from './claude.service'
import { classifyError, isOnline } from './ai-util'
import { fakeAiEnabled, fakeDerive } from './ai-fake'

/**
 * Clean the model's raw output into a DerivedProfile — strings trimmed, list items trimmed + de-duped +
 * non-empty. Returns null when NOTHING usable survives, so the caller reports 'invalid'. The JSON schema
 * guarantees the keys exist; this enforces the shape the review UI + apply path expect.
 */
function validateDerived(raw: Record<string, unknown>): DerivedProfile | null {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const list = (v: unknown): string[] => {
    if (!Array.isArray(v)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of v) {
      const s = typeof x === 'string' ? x.trim() : ''
      if (s && !seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
    return out
  }
  const profile: DerivedProfile = {
    description: str(raw.description),
    traits: list(raw.traits),
    goals: list(raw.goals),
    flaws: list(raw.flaws),
    voiceExamples: list(raw.voiceExamples)
  }
  const empty =
    !profile.description &&
    profile.traits.length === 0 &&
    profile.goals.length === 0 &&
    profile.flaws.length === 0 &&
    profile.voiceExamples.length === 0
  return empty ? null : profile
}

/**
 * Derive a main character's profile from their backstory (ADR-029): resolve the pc + its backstory → ask
 * Claude (single-shot, structured) for description/traits/goals/flaws/voice/persona → validate (retry
 * once). Returns a discriminated result so the renderer can show offline / no-key / no-backstory without
 * try/catch. NOTHING is written here — the renderer reviews + approves, then applies via entity.update +
 * persona.update. No embedding model (direct fetch of the one entity's fields).
 */
export async function deriveProfile(
  ctx: DbContext,
  req: DeriveProfileRequest,
  signal: AbortSignal
): Promise<DeriveProfileResult> {
  const { pcId, campaignId } = req
  try {
    const pc = getEntity(ctx, pcId)
    if (!pc || pc.type !== 'pc' || pc.campaignId !== campaignId) {
      return { ok: false, reason: 'invalid' }
    }
    const backstory = typeof pc.attributes.backstory === 'string' ? pc.attributes.backstory.trim() : ''
    if (!backstory) return { ok: false, reason: 'no_backstory' }
    if (!isAvailable()) return { ok: false, reason: 'no_key' }
    if (!(await isOnline())) return { ok: false, reason: 'offline' }

    const attrStr = (k: string): string | null => {
      const v = pc.attributes[k]
      return typeof v === 'string' && v.trim() ? v.trim() : null
    }
    const { suggestModel, suggestEffort } = getSettings()
    const callOnce = (): Promise<Record<string, unknown>> =>
      deriveProfileCall({
        ctx: {
          name: pc.name,
          ancestry: attrStr('ancestry'),
          class: attrStr('class'),
          backstory
        },
        model: suggestModel,
        effort: suggestEffort,
        signal
      })
    // One retry: the model occasionally returns malformed structured output.
    // e2e fake-AI seam (ADR-043): canned profile (already the validated shape); no retry under the flag.
    let profile = fakeAiEnabled() ? fakeDerive() : validateDerived(await callOnce())
    if (!profile) profile = validateDerived(await callOnce())
    if (!profile) return { ok: false, reason: 'invalid' }
    return { ok: true, profile }
  } catch (err) {
    if (signal.aborted) return { ok: false, reason: 'api' }
    return {
      ok: false,
      reason: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
