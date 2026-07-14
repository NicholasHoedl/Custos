import { eq } from 'drizzle-orm'
import type { RecallMode, RecallRequest, RecallSource } from '@shared/recall-types'
import type { RelationshipView } from '@shared/graph-types'
import type { Lifecycle } from '@shared/entity-types'
import type { AiRunCost } from '@shared/usage-types'
import {
  RECALL_CHUNK_CHANNEL,
  RECALL_DONE_CHANNEL,
  RECALL_ERROR_CHANNEL,
  RECALL_SOURCES_CHANNEL
} from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { RetrievedChunk, VectorStore } from './vector-store.service'
import { resolveEntityState } from './chronology.service'
import { isModelReady } from './embedding.service'
import { hybridRetrieve } from './retrieval.service'
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
import { classifyError, isOnline } from './ai-util'
import { FAKE_RECALL_TEXT, fakeAiEnabled } from './ai-fake'

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
    // e2e fake-AI seam (ADR-043): bypass the model gate; retrieval below skips embed/dense and keeps fuzzy.
    if (!isModelReady() && !fakeAiEnabled()) {
      send(RECALL_ERROR_CHANNEL, {
        requestId,
        kind: 'no_model',
        message: 'The local search model is not downloaded yet.'
      })
      return
    }

    // Chronology (ADR-017): when asOfSession is set, clamp retrieval + reconstructed state to ≤ N.
    const asOf = req.asOfSession
    // Hybrid retrieval (ADR-052): dense embeddings + model-free fuzzy name-match (so a misspelled proper
    // noun like "glastav" → "Glasstaff" still surfaces), reranked to the top TOP_K.
    const chunks = await hybridRetrieve(store, query, { campaignId, asOf, finalK: TOP_K })

    // Instant grounding (overhaul): push the retrieved sources NOW, before the LLM streams — the Sources
    // list shows in ~1s. The done event later marks which of these the answer actually cited.
    send(RECALL_SOURCES_CHANNEL, { requestId, sources: chunksToSources(chunks) })

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
      persona,
      voiceExamples: pc?.voiceExamples
    }

    // For each retrieved entity gather (a) its relationships — ownership/alliances/etc. that live in
    // entity_link and never reach Claude via embeddings, and (b) its current status. Plus the latest
    // session as the "present" anchor. Without these the model invents facts ("the staff is mine") and
    // treats resolved threads (a defeated NPC, a completed quest) as if they were still open.
    const seen = new Set<string>()
    const relItems: { name: string; views: RelationshipView[] }[] = []
    const stateItems: {
      name: string
      type: string
      status: string | null
      lifecycle: Lifecycle
    }[] = []
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

    let cost: AiRunCost | undefined
    const onText = (text: string): void => send(RECALL_CHUNK_CHANNEL, { requestId, text })
    // e2e fake-AI seam (ADR-043): emit canned prose through onText, and return the REAL fuzzy-grounded
    // sources (chunksToSources over the chunks retrieved above) so the Sources list is genuine.
    let sources: RecallSource[]
    if (fakeAiEnabled()) {
      onText(FAKE_RECALL_TEXT)
      sources = chunksToSources(chunks)
    } else {
      sources = await claudeRecall({
        query,
        chunks,
        relationships,
        state,
        mode: effectiveMode,
        context,
        // Overhaul: 'quick' → Sonnet + concise; 'deep'/unset → the Settings model + full synthesis.
        model: req.speed === 'quick' ? 'claude-sonnet-4-6' : getSettings().recallModel,
        concise: req.speed === 'quick',
        history: req.history,
        onText,
        onCost: (c) => (cost = c), // per-run cost rides the done event (P0-4)
        signal
      })
    }
    send(RECALL_DONE_CHANNEL, { requestId, mode: effectiveMode, sources, reason: 'ok', cost })
  } catch (err) {
    if (signal.aborted) return // user cancelled — swallow
    send(RECALL_ERROR_CHANNEL, {
      requestId,
      kind: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
