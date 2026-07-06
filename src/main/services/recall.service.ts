import { eq } from 'drizzle-orm'
import type { RecallMode, RecallRequest, RecallSource } from '@shared/recall-types'
import type { RelationshipView } from '@shared/graph-types'
import type { Lifecycle } from '@shared/entity-types'
import {
  RECALL_CHUNK_CHANNEL,
  RECALL_DONE_CHANNEL,
  RECALL_ERROR_CHANNEL
} from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { RetrievedChunk, VectorStore } from './vector-store.service'
import { resolveEntityState } from './chronology.service'
import { embed, isModelReady } from './embedding.service'
import { getEntity, listEntitiesByIds } from './entity.service'
import { generatePersona, getPersona } from './persona.service'
import { getSettings } from './settings.service'
import { listForEntity } from './link.service'
import { listSessions } from './session.service'
import {
  formatRelationships,
  formatState,
  isAvailable,
  recall as claudeRecall,
  type RecallContext
} from './claude.service'
import { gatherPinned, resolveScene } from './scene.service'
import { classifyError, isOnline } from './ai-util'

type Send = (channel: string, payload: unknown) => void

const TOP_K = 8

export function chunksToSources(chunks: RetrievedChunk[]): RecallSource[] {
  const seen = new Set<string>()
  const out: RecallSource[] = []
  for (const c of chunks) {
    const key = `${c.entityId ?? 'lore'}:${c.noteId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      entityId: c.entityId,
      entityType: c.entityType,
      entityName: c.entityName,
      noteId: c.noteId,
      sessionLabel: c.sessionLabel,
      snippet: c.content.length > 240 ? c.content.slice(0, 240) + '…' : c.content
    })
  }
  return out
}

/**
 * Run a Recall query: embed → vector search → resolve mode/persona → (offline/no-key fall back to the
 * retrieved notes) → stream the in-character or factual answer. Emits stream:chunk/done/error events.
 */
export async function ask(
  ctx: DbContext,
  store: VectorStore,
  send: Send,
  req: RecallRequest,
  signal: AbortSignal
): Promise<void> {
  const { requestId, query, campaignId, pcId, mode } = req
  try {
    if (!isModelReady()) {
      send(RECALL_ERROR_CHANNEL, {
        requestId,
        kind: 'no_model',
        message: 'The local search model is not downloaded yet.'
      })
      return
    }

    // Chronology (ADR-017): when asOfSession is set, clamp retrieval + reconstructed state to ≤ N.
    const asOf = req.asOfSession
    const queryVec = await embed(query)
    const denseChunks = store.search(queryVec, campaignId, TOP_K, asOf)
    // Hybrid retrieval: dense embeddings miss a misspelled proper noun ("glastav" → "Glasstaff").
    // Fuzzy-match the query against entity NAMES and fold those entities in (description + a few notes)
    // so the thing the player named always surfaces, even when the spelling is off.
    const fuzzy = store.fuzzyEntityChunks(
      campaignId,
      query,
      new Set(denseChunks.map((c) => c.entityId).filter((id): id is string => id !== null)),
      2,
      asOf
    )
    const chunks = fuzzy.length ? [...fuzzy, ...denseChunks] : denseChunks

    // In-character mode engages whenever there's a valid active PC — NOT only when a brief already
    // exists. The brief (which gives the character its voice and, crucially, tells the model WHO it is)
    // is resolved after the key/online gate below, since generating one needs Claude. Previously a PC
    // with no brief yet silently fell back to a faceless factual answer ("who are you playing?").
    const pc = mode === 'in_character' && pcId ? getEntity(ctx, pcId) : null
    const inCharacter = Boolean(pc && pc.type === 'pc')
    const effectiveMode: RecallMode = inCharacter ? 'in_character' : 'factual'

    if (!isAvailable()) {
      send(RECALL_DONE_CHANNEL, {
        requestId,
        mode: effectiveMode,
        sources: chunksToSources(chunks),
        reason: 'no_key'
      })
      return
    }
    if (!(await isOnline())) {
      send(RECALL_DONE_CHANNEL, {
        requestId,
        mode: effectiveMode,
        sources: chunksToSources(chunks),
        reason: 'offline'
      })
      return
    }

    // Resolve the in-character brief now that we know we'll call Claude: reuse the stored persona, or
    // generate one from the PC's own fields (refreshing a stale brief) — exactly as Suggest does.
    let persona: string | null = null
    if (inCharacter && pc) {
      let p = getPersona(ctx, pc.id)
      if (!p || p.stale) p = await generatePersona(ctx, pc.id)
      persona = p.brief
    }

    const campaign = ctx.drizzle
      .select({ name: schema.campaign.name, description: schema.campaign.description })
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .get()
    const context: RecallContext = {
      campaignName: campaign?.name ?? 'the campaign',
      campaignDescription: campaign?.description ?? null,
      pcName: pc?.name ?? null,
      persona
    }

    // For each retrieved entity gather (a) its relationships — ownership/alliances/etc. that live in
    // entity_link and never reach Claude via embeddings, and (b) its current status. Plus the latest
    // session as the "present" anchor. Without these the model invents facts ("the staff is mine") and
    // treats resolved threads (a defeated NPC, a completed quest) as if they were still open.
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
    // The "present" anchor is the as-of session when set, else the campaign's latest session.
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

    const sources = await claudeRecall({
      query,
      chunks,
      relationships,
      state,
      scene: scene.block,
      mode: effectiveMode,
      context,
      model: getSettings().recallModel,
      onText: (text) => send(RECALL_CHUNK_CHANNEL, { requestId, text }),
      signal
    })
    send(RECALL_DONE_CHANNEL, { requestId, mode: effectiveMode, sources, reason: 'ok' })
  } catch (err) {
    if (signal.aborted) return // user cancelled — swallow
    send(RECALL_ERROR_CHANNEL, {
      requestId,
      kind: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
