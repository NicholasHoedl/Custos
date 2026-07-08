import { eq } from 'drizzle-orm'
import {
  CONVERSE_TAGS,
  type ConverseFailureReason,
  type ConverseQuestion,
  type ConverseRequest,
  type ConverseResult,
  type ConverseTag
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

const TAG_SET = new Set<string>(CONVERSE_TAGS)
// A spread wants variety, not padding: at most 6 questions, and at least 4 must survive to be usable.
const CONVERSE_CAP = 6
const CONVERSE_FLOOR = 4

/**
 * Enforce what the JSON schema can't (ADR-034): a spread of questions with DISTINCT tags and a non-empty
 * question + read. Mirrors suggest's validateMoment — drops entries with an unknown tag, empty text, or a
 * repeated tag; caps at 6. Returns null if fewer than 4 usable distinct-tag questions survive (the caller
 * then retries once, then fails). Distinct tags keep the spread varied instead of six shades of one probe.
 */
function validateConverse(raw: ConverseQuestion[]): ConverseQuestion[] | null {
  const seen = new Set<string>()
  const clean: ConverseQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q.tag !== 'string' || !TAG_SET.has(q.tag)) continue
    if (typeof q.question !== 'string' || !q.question.trim()) continue
    if (typeof q.read !== 'string' || !q.read.trim()) continue
    if (seen.has(q.tag)) continue
    seen.add(q.tag)
    clean.push({ question: q.question.trim(), tag: q.tag as ConverseTag, read: q.read.trim() })
    if (clean.length === CONVERSE_CAP) break
  }
  return clean.length >= CONVERSE_FLOOR ? clean : null
}

/**
 * Run a Converse query: resolve the asking PC + persona → gather the TARGET's grounding by DIRECT FETCH
 * (notes via getEntityContext, as-of-clamped; connections + the PC↔target tie via listForEntity, which is
 * as-of-correct; state via resolveEntityState) → ask Claude (structured, single-shot) for a spread of
 * tagged in-character questions → validate (retry once). Returns a discriminated ConverseResult so the renderer can show
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
    // You talk WITH a character — an NPC or a fellow PC (ADR-034) — never a place/faction/item/quest, and
    // never the asking PC itself. The renderer's picker enforces this too; the service is the backstop.
    if (target.type !== 'npc' && target.type !== 'pc') return fail('invalid')
    if (target.id === pcId) return fail('invalid')
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
      persona: persona.brief,
      voiceExamples: pc.voiceExamples
    }

    // Target grounding — DIRECT FETCH (no semantic search). getEntityContext gives the target's notes;
    // connections + the asker↔target tie come from listForEntity (as-of-correct via isIntervalLiveAt).
    const targetCtx = getEntityContext(ctx, targetId, 1, asOf)
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
    const callOnce = (): Promise<ConverseQuestion[]> =>
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
    // One retry: the model occasionally returns too few or duplicate-tag questions.
    let out = validateConverse(await callOnce())
    if (!out) out = validateConverse(await callOnce())
    if (!out) return fail('invalid')
    return { ok: true, questions: out }
  } catch (err) {
    if (signal.aborted) return fail('unknown')
    return {
      ok: false,
      reason: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
