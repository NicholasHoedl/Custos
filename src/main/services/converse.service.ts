import { eq } from 'drizzle-orm'
import type {
  ConverseBriefing,
  ConverseFailureReason,
  ConverseQuestion,
  ConverseRequest,
  ConverseResult
} from '@shared/converse-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { resolveEntityState } from './chronology.service'
import { getEntity } from './entity.service'
import { generatePersona, getPersona } from './persona.service'
import { getEntityContext, listForEntity } from './link.service'
import { listSessions } from './session.service'
import { getSettings } from './settings.service'
import {
  converse as claudeConverse,
  formatRelationships,
  isAvailable,
  type SuggestContext
} from './claude.service'
import { classifyError, isOnline } from './ai-util'

function fail(reason: ConverseFailureReason): ConverseResult {
  return { ok: false, reason }
}

/**
 * Coerce the model's raw output to clean briefing lists + questions (the JSON schema can't enforce
 * shape/length). Returns null ONLY when the whole result is empty (no briefing content AND no questions)
 * — a target the party knows little about legitimately yields an all-questions result, which is the point.
 */
function validateConverse(raw: {
  briefing?: unknown
  questions?: unknown
}): { briefing: ConverseBriefing; questions: ConverseQuestion[] } | null {
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  const b = (raw.briefing ?? {}) as Record<string, unknown>
  const briefing: ConverseBriefing = {
    known: strList(b.known),
    openSuspected: strList(b.openSuspected),
    connections: strList(b.connections)
  }
  const questions: ConverseQuestion[] = []
  if (Array.isArray(raw.questions)) {
    for (const q of raw.questions) {
      if (!q || typeof q !== 'object') continue
      const qq = q as Record<string, unknown>
      const question = typeof qq.question === 'string' ? qq.question.trim() : ''
      if (!question) continue // a question with no text is useless; drop it
      questions.push({
        question,
        targetsThread: typeof qq.targetsThread === 'string' ? qq.targetsThread.trim() : '',
        why: typeof qq.why === 'string' ? qq.why.trim() : ''
      })
    }
  }
  const empty =
    questions.length === 0 &&
    briefing.known.length === 0 &&
    briefing.openSuspected.length === 0 &&
    briefing.connections.length === 0
  return empty ? null : { briefing, questions }
}

/**
 * Run a Converse query: resolve the asking PC + persona → gather the TARGET's grounding by DIRECT FETCH
 * (notes via getEntityContext; connections + the PC↔target tie via listForEntity, which is as-of-correct;
 * state via resolveEntityState) → ask Claude (structured, single-shot) for a briefing + in-character
 * questions → validate (retry once). Returns a discriminated ConverseResult so the renderer can show
 * offline / no-key / no-PC states without try/catch (ADR-008, ADR-009). No embedding model: direct fetch.
 */
export async function converse(
  ctx: DbContext,
  req: ConverseRequest,
  signal: AbortSignal
): Promise<ConverseResult> {
  const { campaignId, pcId, targetId, focus } = req
  // Chronology (ADR-017): clamp ties + reconstructed state to ≤ N when as-of is set.
  const asOf = req.asOfSession
  try {
    if (!pcId) return fail('no_pc')
    const pc = getEntity(ctx, pcId)
    if (!pc || pc.type !== 'pc') return fail('no_pc')
    const target = getEntity(ctx, targetId)
    if (!target || target.campaignId !== campaignId) return fail('invalid')
    // Key + online BEFORE persona regen, since generatePersona also needs the key.
    if (!isAvailable()) return fail('no_key')
    if (!(await isOnline())) return fail('offline')

    // The in-character brief is required; generate it (or refresh when stale).
    let persona = getPersona(ctx, pcId)
    if (!persona || persona.stale) persona = await generatePersona(ctx, pcId)

    const campaign = ctx.drizzle
      .select({ name: schema.campaign.name, description: schema.campaign.description })
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .get()
    // Race/class come from the PC's profile attributes (harmless context here; kept for prompt parity).
    const attrStr = (k: string): string | null => {
      const v = pc.attributes[k]
      return typeof v === 'string' && v.trim() ? v.trim() : null
    }
    const context: SuggestContext = {
      campaignName: campaign?.name ?? 'the campaign',
      campaignDescription: campaign?.description ?? null,
      pcName: pc.name,
      pcRace: attrStr('ancestry'),
      pcClass: attrStr('class'),
      persona: persona.brief
    }

    // Target grounding — DIRECT FETCH (no semantic search). getEntityContext gives the target's notes;
    // connections + the asker↔target tie come from listForEntity (as-of-correct via isIntervalLiveAt).
    const targetCtx = getEntityContext(ctx, targetId, 1)
    const targetState = resolveEntityState(ctx, target, asOf)
    const connections = formatRelationships(
      [{ name: target.name, views: listForEntity(ctx, targetId, asOf) }],
      24,
      24
    )
    const tie = formatRelationships([
      { name: pc.name, views: listForEntity(ctx, pcId, asOf).filter((v) => v.other.id === targetId) }
    ])

    const anchorLabel =
      asOf !== undefined
        ? `Session ${asOf}`
        : (() => {
            const latest = listSessions(ctx, campaignId)[0]
            return latest
              ? `Session ${latest.number}${latest.title ? ` — ${latest.title}` : ''}`
              : null
          })()

    const { suggestModel, suggestEffort } = getSettings()
    const callOnce = (): Promise<{ briefing: unknown; questions: unknown }> =>
      claudeConverse({
        target: {
          name: target.name,
          type: target.type,
          status: targetState.status,
          lifecycle: targetState.lifecycle,
          traits: target.traits,
          goals: target.goals,
          flaws: target.flaws
        },
        notes: targetCtx.notes,
        connections,
        tie,
        focus,
        anchorLabel,
        asOf: asOf !== undefined,
        context,
        model: suggestModel,
        effort: suggestEffort,
        signal
      })
    // One retry: the model occasionally returns malformed structured output.
    let out = validateConverse(await callOnce())
    if (!out) out = validateConverse(await callOnce())
    if (!out) return fail('invalid')
    return { ok: true, briefing: out.briefing, questions: out.questions }
  } catch (err) {
    if (signal.aborted) return fail('unknown')
    return {
      ok: false,
      reason: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
