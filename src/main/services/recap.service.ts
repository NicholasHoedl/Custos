import type { RecapRequest } from '@shared/recap-types'
import type { RelationshipView } from '@shared/graph-types'
import type { Lifecycle } from '@shared/entity-types'
import { RECAP_CHUNK_CHANNEL, RECAP_DONE_CHANNEL, RECAP_ERROR_CHANNEL } from '@shared/ipc-types'
import type { DbContext } from './db-context'
import { listEntitiesByIds } from './entity.service'
import { getSettings } from './settings.service'
import { listForEntity } from './link.service'
import { getSession, listSessions, updateSession } from './session.service'
import { listEvents } from './event.service'
import { listNotesForSession } from './note.service'
import {
  formatRelationships,
  formatState,
  isAvailable,
  recap as claudeRecap,
  type RecapInput
} from './claude.service'
import { classifyError, isOnline } from './ai-util'
import { FAKE_RECAP_TEXT, fakeAiEnabled } from './ai-fake'

type Send = (channel: string, payload: unknown) => void

/**
 * Generate a "Previously on…" recap of ONE session: gather its beats (event log, chronological) + notes
 * + the involved entities' status/relationships (+ the prior session's summary for continuity) → stream
 * a neutral recap via Claude → save it to `session.summary`. Unlike Recall there is NO embedding/vector
 * search and NO model gate — a recap reads a known session, it doesn't retrieve. Emits recap:chunk/done/
 * error (requestId-tagged); an empty session or a missing key/offline ends with a reason and no text.
 */
export async function generateRecap(
  ctx: DbContext,
  send: Send,
  req: RecapRequest,
  signal: AbortSignal
): Promise<void> {
  const { requestId, campaignId, sessionId } = req
  try {
    const session = getSession(ctx, sessionId)
    if (!session) {
      send(RECAP_ERROR_CHANNEL, { requestId, kind: 'unknown', message: 'Session not found.' })
      return
    }

    const events = listEvents(ctx, sessionId)
    const notes = listNotesForSession(ctx, sessionId)
    if (events.length === 0 && notes.length === 0) {
      send(RECAP_DONE_CHANNEL, { requestId, sessionId, reason: 'empty' })
      return
    }
    if (!isAvailable()) {
      send(RECAP_DONE_CHANNEL, { requestId, sessionId, reason: 'no_key' })
      return
    }
    if (!(await isOnline())) {
      send(RECAP_DONE_CHANNEL, { requestId, sessionId, reason: 'offline' })
      return
    }

    // The entities involved this session (notes' tags ∪ events' entityId) give the recap the same FACT
    // scaffolding Recall builds — current status (so a death/quest-completion this session reads as done)
    // and relationships — so the summary doesn't drift or invent.
    const involvedIds = new Set<string>()
    for (const n of notes) for (const id of n.entityIds) involvedIds.add(id)
    for (const e of events) if (e.entityId) involvedIds.add(e.entityId)
    const nameById = new Map<string, string>()
    const relItems: { name: string; views: RelationshipView[] }[] = []
    const stateItems: { name: string; type: string; status: string | null; lifecycle: Lifecycle }[] =
      []
    // One batched read for the involved entities (instead of a getEntity per id).
    const entitiesById = listEntitiesByIds(ctx, [...involvedIds])
    for (const id of involvedIds) {
      const ent = entitiesById.get(id)
      if (!ent) continue
      nameById.set(id, ent.name)
      relItems.push({ name: ent.name, views: listForEntity(ctx, id) })
      stateItems.push({ name: ent.name, type: ent.type, status: ent.status, lifecycle: ent.lifecycle })
    }
    const relationships = formatRelationships(relItems)
    const state = formatState(null, stateItems) // null anchor: recap a specific session, not "the present"

    const priorSummary =
      listSessions(ctx, campaignId).find((s) => s.number === session.number - 1)?.summary ?? null
    const sessionLabel = `Session ${session.number}${session.title ? ` — ${session.title}` : ''}`

    const input: RecapInput = {
      sessionLabel,
      priorSummary,
      beats: events.map((e) => e.content),
      notes: notes.map((n) => ({
        names: n.entityIds.map((id) => nameById.get(id) ?? 'Unknown').join(', '),
        content: n.content
      })),
      state,
      relationships
    }

    let full = ''
    const onText = (text: string): void => {
      full += text
      send(RECAP_CHUNK_CHANNEL, { requestId, text })
    }
    // e2e fake-AI seam (ADR-043): emit canned prose through the same onText → the persist + done below run real.
    if (fakeAiEnabled()) onText(FAKE_RECAP_TEXT)
    else await claudeRecap({ input, model: getSettings().recallModel, onText, signal })
    updateSession(ctx, sessionId, { summary: full.trim() })
    send(RECAP_DONE_CHANNEL, { requestId, sessionId, reason: 'ok' })
  } catch (err) {
    if (signal.aborted) return // user cancelled — swallow
    send(RECAP_ERROR_CHANNEL, {
      requestId,
      kind: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
