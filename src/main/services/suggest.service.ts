import { eq } from 'drizzle-orm'
import {
  SUGGEST_TAGS,
  SUGGEST_CATEGORIES,
  type MomentSuggestion,
  type StorySuggestion,
  type SuggestCategory,
  type SuggestFailureReason,
  type SuggestRequest,
  type SuggestResult,
  type SuggestTag
} from '@shared/suggest-types'
import type { Entity, Lifecycle } from '@shared/entity-types'
import type { RelationshipView } from '@shared/graph-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { RetrievedChunk, VectorStore } from './vector-store.service'
import { resolveEntityState, stateAsOf } from './chronology.service'
import { embed, isModelReady } from './embedding.service'
import { getEntity, listEntities, listEntitiesByIds } from './entity.service'
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
import { classifyError, isOnline } from './ai-util'

const TOP_K = 8
const TAG_SET = new Set<string>(SUGGEST_TAGS)

function fail(reason: SuggestFailureReason): SuggestResult {
  return { ok: false, reason }
}

/**
 * Enforce the rules the JSON schema can't: exactly 8 suggestions with DISTINCT primary tags and
 * non-empty action + rationale. Secondary tags are cleaned (valid enum, deduped, ≤2, never equal to the
 * primary). Drops malformed/duplicate-primary entries and trims extras; returns null if fewer than 8
 * valid distinct-primary suggestions survive (caller then retries / fails).
 */
function validateMoment(recs: MomentSuggestion[]): MomentSuggestion[] | null {
  const seen = new Set<string>()
  const clean: MomentSuggestion[] = []
  for (const r of recs) {
    if (!r || typeof r.primaryTag !== 'string' || !TAG_SET.has(r.primaryTag)) continue
    if (typeof r.action !== 'string' || !r.action.trim()) continue
    if (typeof r.rationale !== 'string' || !r.rationale.trim()) continue
    if (seen.has(r.primaryTag)) continue
    const primary = r.primaryTag as SuggestTag
    const secondary: SuggestTag[] = []
    if (Array.isArray(r.secondaryTags)) {
      for (const t of r.secondaryTags) {
        if (typeof t !== 'string' || !TAG_SET.has(t)) continue
        if (t === primary || secondary.includes(t as SuggestTag)) continue
        secondary.push(t as SuggestTag)
        if (secondary.length === 2) break
      }
    }
    seen.add(primary)
    clean.push({
      primaryTag: primary,
      secondaryTags: secondary,
      action: r.action.trim(),
      rationale: r.rationale.trim()
    })
    if (clean.length === 8) break
  }
  return clean.length === 8 ? clean : null
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
 * for 8 tagged actions → validate (retry once). Returns a discriminated SuggestResult so the
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
  // Chronology (ADR-017): clamp retrieval + reconstructed state to ≤ N when as-of is set.
  const asOf = req.asOfSession
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
    const denseChunks = store.search(situationVec, campaignId, TOP_K, asOf)
    // Hybrid retrieval (same as Recall): fold in entities whose NAME the query fuzzily matches.
    const fuzzy = store.fuzzyEntityChunks(
      campaignId,
      queryText,
      new Set(denseChunks.map((c) => c.entityId).filter((id): id is string => id !== null)),
      2,
      asOf
    )
    const chunks: RetrievedChunk[] = fuzzy.length ? [...fuzzy, ...denseChunks] : denseChunks

    const campaign = ctx.drizzle
      .select({ name: schema.campaign.name, description: schema.campaign.description })
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .get()
    // Race/class come from the PC's profile attributes; they tell the prompt which race/class tags are
    // legal for this character (a dwarf paladin may be tagged "dwarf"/"paladin", never "elf").
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

    // Per retrieved entity: its relationships (ownership/alliances from entity_link, invisible to
    // embeddings) and current status, plus the latest session as the present-moment anchor.
    const scene = resolveScene(ctx, req.scene, pcId, asOf)
    const seen = new Set<string>()
    const relItems: { name: string; views: RelationshipView[] }[] = []
    const stateItems: { name: string; type: string; status: string | null; lifecycle: Lifecycle }[] =
      []
    // Pin the current-scene entities into grounding first so they're always present, even off-vector.
    gatherPinned(ctx, scene.pinned, seen, relItems, stateItems, asOf)
    // One batched read for the retrieved entities (instead of a getEntity per chunk).
    const entitiesById = listEntitiesByIds(
      ctx,
      chunks.map((c) => c.entityId).filter((id): id is string => id !== null)
    )
    for (const c of chunks) {
      if (!c.entityId || !c.entityName) continue // campaign-lore note: no entity to ground
      if (seen.has(c.entityId)) continue
      seen.add(c.entityId)
      relItems.push({ name: c.entityName, views: listForEntity(ctx, c.entityId, asOf) })
      const ent = entitiesById.get(c.entityId)
      if (ent) {
        const st = resolveEntityState(ctx, ent, asOf)
        stateItems.push({
          name: c.entityName,
          type: ent.type,
          status: st.status,
          lifecycle: st.lifecycle
        })
      }
    }
    const relationships = formatRelationships(relItems)
    const anchorLabel =
      asOf !== undefined
        ? `Session ${asOf}`
        : (() => {
            const latest = listSessions(ctx, campaignId)[0]
            return latest
              ? `Session ${latest.number}${latest.title ? ` — ${latest.title}` : ''}`
              : null
          })()
    const state = formatState(anchorLabel, stateItems, asOf !== undefined)

    const { suggestModel, suggestEffort } = getSettings()

    if (mode === 'directions') {
      // Open-ended: ground in the campaign's unfinished business + the rest of the party.
      const openQuestEntities = listEntities(ctx, campaignId, 'quest').filter((q) => {
        if (asOf === undefined) return isOpenQuest(q.status)
        const st = stateAsOf(ctx, q.id, asOf)
        return st !== null && isOpenQuest(st.status) // null => the quest didn't exist yet at N
      })
      // Pin the embarked quest even if it has been completed/failed, so directions can build on it.
      const sceneQuest = scene.quest
      if (sceneQuest && !openQuestEntities.some((q) => q.id === sceneQuest.id)) {
        openQuestEntities.push(sceneQuest)
      }
      const openQuests = openQuestEntities.map((q) => ({
        name: q.name,
        status: resolveEntityState(ctx, q, asOf).status,
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

    const callOnce = (): Promise<MomentSuggestion[]> =>
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
    // One retry: the model occasionally returns fewer than 8 or a duplicate primary tag.
    let recs = validateMoment(await callOnce())
    if (!recs) recs = validateMoment(await callOnce())
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
