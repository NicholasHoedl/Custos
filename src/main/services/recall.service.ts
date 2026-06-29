import { lookup } from 'node:dns/promises'
import { eq } from 'drizzle-orm'
import type { RecallErrorKind, RecallMode, RecallRequest, RecallSource } from '@shared/recall-types'
import type { RelationshipView } from '@shared/graph-types'
import {
  RECALL_CHUNK_CHANNEL,
  RECALL_DONE_CHANNEL,
  RECALL_ERROR_CHANNEL
} from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import type { RetrievedChunk, VectorStore } from './vector-store.service'
import { embed, isModelReady } from './embedding.service'
import { getEntity } from './entity.service'
import { getPersona } from './persona.service'
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

type Send = (channel: string, payload: unknown) => void

const TOP_K = 8

function chunksToSources(chunks: RetrievedChunk[]): RecallSource[] {
  const seen = new Set<string>()
  const out: RecallSource[] = []
  for (const c of chunks) {
    const key = `${c.entityId}:${c.noteId ?? ''}`
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

async function isOnline(): Promise<boolean> {
  try {
    await lookup('api.anthropic.com')
    return true
  } catch {
    return false
  }
}

function classifyError(err: unknown): RecallErrorKind {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'no_key') return 'no_key'
  if (/network|fetch|ENOTFOUND|ECONN|timeout|getaddrinfo/i.test(msg)) return 'offline'
  return 'api'
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

    const queryVec = await embed(query)
    const denseChunks = store.search(queryVec, campaignId, TOP_K)
    // Hybrid retrieval: dense embeddings miss a misspelled proper noun ("glastav" → "Glasstaff").
    // Fuzzy-match the query against entity NAMES and fold those entities in (description + a few notes)
    // so the thing the player named always surfaces, even when the spelling is off.
    const fuzzy = store.fuzzyEntityChunks(
      campaignId,
      query,
      new Set(denseChunks.map((c) => c.entityId)),
      2
    )
    const chunks = fuzzy.length ? [...fuzzy, ...denseChunks] : denseChunks

    // Resolve effective mode + persona (fall back to factual when there's no active PC / no persona).
    let effectiveMode: RecallMode = 'factual'
    let persona: string | null = null
    let pcName: string | null = null
    if (mode === 'in_character' && pcId) {
      const p = getPersona(ctx, pcId)
      const pc = getEntity(ctx, pcId)
      if (p && pc) {
        effectiveMode = 'in_character'
        persona = p.brief
        pcName = pc.name
      }
    }

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

    const campaign = ctx.drizzle
      .select({ name: schema.campaign.name, description: schema.campaign.description })
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .get()
    const context: RecallContext = {
      campaignName: campaign?.name ?? 'the campaign',
      campaignDescription: campaign?.description ?? null,
      pcName,
      persona
    }

    // For each retrieved entity gather (a) its relationships — ownership/alliances/etc. that live in
    // entity_link and never reach Claude via embeddings, and (b) its current status. Plus the latest
    // session as the "present" anchor. Without these the model invents facts ("the staff is mine") and
    // treats resolved threads (a defeated NPC, a completed quest) as if they were still open.
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
