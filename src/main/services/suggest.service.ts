import { lookup } from 'node:dns/promises'
import { eq } from 'drizzle-orm'
import {
  ATTITUDES,
  SUGGEST_CATEGORIES,
  type Attitude,
  type AttitudeRecommendation,
  type StorySuggestion,
  type SuggestCategory,
  type SuggestFailureReason,
  type SuggestRequest,
  type SuggestResult
} from '@shared/suggest-types'
import type { Entity } from '@shared/entity-types'
import type { RelationshipView } from '@shared/graph-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { RetrievedChunk, VectorStore } from './vector-store.service'
import { embed, isModelReady } from './embedding.service'
import { getEntity, listEntities } from './entity.service'
import { generatePersona, getPersona } from './persona.service'
import { getSettings } from './settings.service'
import { listForEntity } from './link.service'
import { listSessions } from './session.service'
import {
  formatCampaignThreads,
  formatRelationships,
  formatState,
  isAvailable,
  suggest as claudeSuggest,
  suggestDirections as claudeSuggestDirections,
  type SuggestContext
} from './claude.service'
import { gatherPinned, resolveScene } from './scene.service'

const TOP_K = 8
const ATTITUDE_SET = new Set<string>(ATTITUDES)

async function isOnline(): Promise<boolean> {
  try {
    await lookup('api.anthropic.com')
    return true
  } catch {
    return false
  }
}

function classifyError(err: unknown): SuggestFailureReason {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'no_key') return 'no_key'
  if (/network|fetch|ENOTFOUND|ECONN|timeout|getaddrinfo/i.test(msg)) return 'offline'
  return 'api'
}

function fail(reason: SuggestFailureReason): SuggestResult {
  return { ok: false, reason }
}

/**
 * Enforce the rule the JSON schema can't: exactly 4 recommendations with DISTINCT attitudes and
 * non-empty action + rationale. Drops malformed/duplicate entries and trims extras; returns null if
 * fewer than 4 valid distinct attitudes survive (caller then retries / fails).
 */
function validateAttitudes(recs: AttitudeRecommendation[]): AttitudeRecommendation[] | null {
  const seen = new Set<string>()
  const clean: AttitudeRecommendation[] = []
  for (const r of recs) {
    if (!r || typeof r.attitude !== 'string' || !ATTITUDE_SET.has(r.attitude)) continue
    if (typeof r.action !== 'string' || !r.action.trim()) continue
    if (typeof r.rationale !== 'string' || !r.rationale.trim()) continue
    if (seen.has(r.attitude)) continue
    seen.add(r.attitude)
    clean.push({
      attitude: r.attitude as Attitude,
      action: r.action.trim(),
      rationale: r.rationale.trim()
    })
    if (clean.length === 4) break
  }
  return clean.length === 4 ? clean : null
}

const CATEGORY_SET = new Set<string>(SUGGEST_CATEGORIES)
const RESOLVED_QUEST_STATUSES = new Set(['completed', 'failed'])

/** A quest is "open" unless its status reads as resolved (Completed/Failed). Untagged counts as open. */
function isOpenQuest(status: string | null): boolean {
  return !status || !RESOLVED_QUEST_STATUSES.has(status.toLowerCase())
}

function questObjective(q: Entity): string | null {
  const v = q.attributes.objective
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Directions validation: drop entries with an unknown category or empty suggestion/rationale, cap at
 * ~10, and require at least 3 usable suggestions (caller then retries / fails). No fixed count.
 */
function validateDirections(suggestions: StorySuggestion[]): StorySuggestion[] | null {
  const clean: StorySuggestion[] = []
  for (const s of suggestions) {
    if (!s || typeof s.category !== 'string' || !CATEGORY_SET.has(s.category)) continue
    if (typeof s.suggestion !== 'string' || !s.suggestion.trim()) continue
    if (typeof s.rationale !== 'string' || !s.rationale.trim()) continue
    clean.push({
      category: s.category as SuggestCategory,
      suggestion: s.suggestion.trim(),
      rationale: s.rationale.trim()
    })
    if (clean.length >= 10) break
  }
  return clean.length >= 3 ? clean : null
}

/**
 * Run a Suggest query: resolve the PC + persona (regenerating a stale brief) → embed the situation →
 * vector search + fuzzy name match → gather relationships/state → ask Claude (structured, single-shot)
 * for 4 attitude-based actions → validate (retry once). Returns a discriminated SuggestResult so the
 * renderer can show offline / no-key / no-PC states without try/catch (ADR-008, ADR-009).
 */
export async function suggest(
  ctx: DbContext,
  store: VectorStore,
  req: SuggestRequest,
  signal: AbortSignal
): Promise<SuggestResult> {
  const { campaignId, pcId, situation } = req
  const mode = req.mode ?? 'attitudes'
  try {
    if (!isModelReady()) return fail('no_model')
    if (!pcId) return fail('no_pc')
    const pc = getEntity(ctx, pcId)
    if (!pc || pc.type !== 'pc') return fail('no_pc')
    if (!isAvailable()) return fail('no_key')
    if (!(await isOnline())) return fail('offline')

    // The in-character brief is required for Suggest; generate it (or refresh when stale).
    let persona = getPersona(ctx, pcId)
    if (!persona || persona.stale) persona = await generatePersona(ctx, pcId)

    // Directions mode allows an empty situation; fall back to the PC's name so retrieval still runs.
    const queryText = situation.trim() || pc.name
    const situationVec = await embed(queryText)
    const denseChunks = store.search(situationVec, campaignId, TOP_K)
    // Hybrid retrieval (same as Recall): fold in entities whose NAME the query fuzzily matches.
    const fuzzy = store.fuzzyEntityChunks(
      campaignId,
      queryText,
      new Set(denseChunks.map((c) => c.entityId)),
      2
    )
    const chunks: RetrievedChunk[] = fuzzy.length ? [...fuzzy, ...denseChunks] : denseChunks

    const campaign = ctx.drizzle
      .select({ name: schema.campaign.name, description: schema.campaign.description })
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .get()
    const context: SuggestContext = {
      campaignName: campaign?.name ?? 'the campaign',
      campaignDescription: campaign?.description ?? null,
      pcName: pc.name,
      persona: persona.brief
    }

    // Per retrieved entity: its relationships (ownership/alliances from entity_link, invisible to
    // embeddings) and current status, plus the latest session as the present-moment anchor.
    const scene = resolveScene(ctx, req.scene, pcId)
    const seen = new Set<string>()
    const relItems: { name: string; views: RelationshipView[] }[] = []
    const stateItems: { name: string; type: string; status: string | null }[] = []
    // Pin the current-scene entities into grounding first so they're always present, even off-vector.
    gatherPinned(ctx, scene.pinned, seen, relItems, stateItems)
    for (const c of chunks) {
      if (seen.has(c.entityId)) continue
      seen.add(c.entityId)
      relItems.push({ name: c.entityName, views: listForEntity(ctx, c.entityId) })
      stateItems.push({
        name: c.entityName,
        type: c.entityType,
        status: getEntity(ctx, c.entityId)?.status ?? null
      })
    }
    const relationships = formatRelationships(relItems)
    const latest = listSessions(ctx, campaignId)[0]
    const latestLabel = latest
      ? `Session ${latest.number}${latest.title ? ` — ${latest.title}` : ''}`
      : null
    const state = formatState(latestLabel, stateItems)

    const { suggestModel, suggestEffort } = getSettings()

    if (mode === 'directions') {
      // Open-ended: ground in the campaign's unfinished business + the rest of the party.
      const openQuestEntities = listEntities(ctx, campaignId, 'quest').filter((q) =>
        isOpenQuest(q.status)
      )
      // Pin the embarked quest even if it has been completed/failed, so directions can build on it.
      const sceneQuest = scene.quest
      if (sceneQuest && !openQuestEntities.some((q) => q.id === sceneQuest.id)) {
        openQuestEntities.push(sceneQuest)
      }
      const openQuests = openQuestEntities.map((q) => ({
        name: q.name,
        status: q.status,
        objective: questObjective(q)
      }))
      const otherPcs = listEntities(ctx, campaignId, 'pc')
        .filter((p) => p.id !== pcId)
        .map((p) => ({ name: p.name }))
      const threads = formatCampaignThreads(openQuests, otherPcs)
      const callOnce = (): Promise<StorySuggestion[]> =>
        claudeSuggestDirections({
          situation,
          threads,
          chunks,
          relationships,
          state,
          scene: scene.block,
          context,
          model: suggestModel,
          effort: suggestEffort,
          signal
        })
      // One retry: the model occasionally returns too few usable suggestions.
      let suggestions = validateDirections(await callOnce())
      if (!suggestions) suggestions = validateDirections(await callOnce())
      if (!suggestions) return fail('invalid')
      return { ok: true, mode: 'directions', suggestions }
    }

    const callOnce = (): Promise<AttitudeRecommendation[]> =>
      claudeSuggest({
        situation,
        chunks,
        relationships,
        state,
        scene: scene.block,
        context,
        model: suggestModel,
        effort: suggestEffort,
        signal
      })
    // One retry: the model occasionally returns fewer than 4 or a duplicate attitude.
    let recs = validateAttitudes(await callOnce())
    if (!recs) recs = validateAttitudes(await callOnce())
    if (!recs) return fail('invalid')
    return { ok: true, mode: 'attitudes', recommendations: recs }
  } catch (err) {
    if (signal.aborted) return fail('unknown')
    return {
      ok: false,
      reason: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
