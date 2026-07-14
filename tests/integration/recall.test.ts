import { describe, it, expect, vi } from 'vitest'

// Mock the modules that touch electron / the network / the Claude SDK; exercise the REAL recall
// orchestration + vector store on an in-memory DB.
const { claudeRecall, embedFn } = vi.hoisted(() => ({
  claudeRecall: vi.fn(),
  embedFn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
vi.mock('../../src/main/services/embedding.service', () => ({
  isModelReady: () => true,
  embed: embedFn
}))
// ADR-052: hybridRetrieve now imports the reranker. Stub it OFF (isRerankerReady=false) + identity so the
// retrieval order (asserted below) is unchanged and no cross-encoder model is loaded in the test.
vi.mock('../../src/main/services/rerank.service', () => ({
  isRerankerReady: () => false,
  rerank: async (_q: string, chunks: unknown[], topN: number) => chunks.slice(0, topN)
}))
vi.mock('../../src/main/services/settings.service', () => ({
  getSettings: () => ({ recallModel: 'claude-sonnet-4-6', hotkey: '' })
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => {
  // Keep the REAL formatRelationships/formatState so the gather -> format -> pass chain is exercised;
  // only stub the network-touching pieces (the SDK call + the key check).
  const actual = await importOriginal<typeof import('../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: () => true, recall: claudeRecall }
})
// Simulate a PC with no brief yet: getPersona returns null, so in-character recall must GENERATE one
// (stubbed here to avoid a real Claude call) rather than silently falling back to factual.
vi.mock('../../src/main/services/persona.service', () => ({
  getPersona: () => null,
  generatePersona: async () => ({
    entityId: 'pc',
    brief: 'CHARACTER BRIEF — a steady cleric of Tymora',
    edited: false,
    stale: false,
    model: null,
    updatedAt: 0
  })
}))

import { RECALL_CHUNK_CHANNEL, RECALL_DONE_CHANNEL } from '@shared/ipc-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createLink } from '../../src/main/services/link.service'
import {
  BruteForceVectorStore,
  type RetrievedChunk
} from '../../src/main/services/vector-store.service'
import { ask, chunksToSources } from '../../src/main/services/recall.service'

function unit(i: number): Float32Array {
  const v = new Float32Array(384)
  v[i] = 1
  return v
}

describe('chunksToSources (retrieval-only fallback sources)', () => {
  const loreChunk = (noteId: string, content: string): RetrievedChunk => ({
    kind: 'note',
    entityId: null,
    entityName: null,
    entityType: null,
    noteId,
    sessionId: null,
    sessionLabel: null,
    content,
    confidence: 'confirmed',
    score: 1
  })

  it('keeps two distinct lore notes as separate sources with null entity fields', () => {
    const sources = chunksToSources([
      loreChunk('n1', 'first world fact'),
      loreChunk('n2', 'second world fact')
    ])
    expect(sources).toHaveLength(2) // distinct noteIds → not collapsed by the dedupe key
    expect(sources.every((s) => s.entityId === null && s.entityName === null)).toBe(true)
    expect(sources.map((s) => s.noteId)).toEqual(['n1', 'n2'])
  })
})

describe('recall RAG pipeline (mocked AI)', () => {
  it('embeds the query, retrieves the right note, streams the answer, returns sources', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const session = createSession(ctx, { campaignId })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric Vane' })
    const relevant = createNote(ctx, {
      campaignId,
      entityIds: [npc.id],
      sessionId: session.id,
      content: 'Aldric warned the party about the north road ambush.'
    })
    const other = createNote(ctx, { campaignId, entityIds: [npc.id], content: 'Aldric mentioned turnip prices.' })
    store.upsertNote(relevant.id, unit(0), 'h1')
    store.upsertNote(other.id, unit(1), 'h2')

    // The query embeds to the same direction as the relevant note.
    embedFn.mockResolvedValue(unit(0))
    claudeRecall.mockImplementation(
      async (p: {
        chunks: Array<{ entityId: string; entityType: string; entityName: string; noteId: string | null; sessionLabel: string | null }>
        onText: (t: string) => void
      }) => {
        p.onText('Aldric warned us about the north road.')
        const c = p.chunks[0]
        return [
          {
            entityId: c.entityId,
            entityType: c.entityType,
            entityName: c.entityName,
            noteId: c.noteId,
            sessionLabel: c.sessionLabel
          }
        ]
      }
    )

    const events: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const send = (channel: string, payload: unknown): void => {
      events.push({ channel, payload: payload as Record<string, unknown> })
    }

    await ask(
      ctx,
      store,
      send,
      { requestId: 'r1', query: 'what did Aldric say about the road', campaignId, pcId: null, mode: 'factual' },
      new AbortController().signal
    )

    // The relevant note was the top retrieved chunk handed to Claude.
    expect(claudeRecall).toHaveBeenCalledTimes(1)
    const passedChunks = claudeRecall.mock.calls[0][0].chunks as Array<{ content: string }>
    expect(passedChunks[0].content).toContain('north road')

    // The answer streamed and a done event carried the correct source.
    const chunkEvent = events.find((e) => e.channel === RECALL_CHUNK_CHANNEL)
    const doneEvent = events.find((e) => e.channel === RECALL_DONE_CHANNEL)
    expect(String(chunkEvent?.payload.text)).toContain('Aldric')
    expect(doneEvent?.payload.reason).toBe('ok')
    const sources = doneEvent?.payload.sources as Array<{ entityName: string }>
    expect(sources[0].entityName).toBe('Aldric Vane')
  })

  it('passes the retrieved entities’ status + relationships + present anchor to Claude', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const glasstaff = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      status: 'Defeated'
    })
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    createLink(ctx, {
      campaignId,
      fromEntityId: glasstaff.id,
      toEntityId: manor.id,
      relation: 'located_in'
    })
    const note = createNote(ctx, { campaignId, entityIds: [glasstaff.id], content: 'Glasstaff led the Redbrands.' })
    store.upsertNote(note.id, unit(0), 'h')
    embedFn.mockResolvedValue(unit(0))
    claudeRecall.mockResolvedValue([])

    await ask(
      ctx,
      store,
      () => {},
      { requestId: 'r2', query: 'who is Glasstaff', campaignId, pcId: null, mode: 'factual' },
      new AbortController().signal
    )

    // calls accumulate across tests in this file — read THIS test's (the most recent) call.
    const call = claudeRecall.mock.calls.at(-1)![0] as {
      state: string | null
      relationships: string | null
    }
    expect(call.state).toContain('Glasstaff (npc): Defeated') // resolved status surfaced
    expect(call.state).toMatch(/most recent session is Session 1/) // present anchor
    expect(call.relationships).toContain('Glasstaff') // edge gathered + formatted
    expect(call.relationships).toContain('Tresendar Manor')
  })

  it('in-character: tells Claude who the active PC is even with no brief yet (generates one)', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Brother Cassius' })
    embedFn.mockResolvedValue(unit(0))
    claudeRecall.mockResolvedValue([])

    await ask(
      ctx,
      store,
      () => {},
      {
        requestId: 'ric',
        query: 'What do I think of Kaelen?',
        campaignId,
        pcId: pc.id,
        mode: 'in_character'
      },
      new AbortController().signal
    )

    const call = claudeRecall.mock.calls.at(-1)![0] as {
      mode: string
      context: { pcName: string | null; persona: string | null }
    }
    expect(call.mode).toBe('in_character') // NOT silently downgraded to factual
    expect(call.context.pcName).toBe('Brother Cassius') // the model is told whose head it's in
    expect(call.context.persona).toContain('cleric of Tymora') // the brief reached the prompt
  })

  it('as-of clamps retrieval AND reconstructs past state (no future-knowledge leak)', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const s1 = createSession(ctx, { campaignId }) // 1
    createSession(ctx, { campaignId }) // 2
    const s3 = createSession(ctx, { campaignId }) // 3

    // An NPC alive in session 1, killed in session 3.
    const duke = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Duke Halric',
      status: 'Alive',
      sessionId: s1.id
    })
    updateEntity(ctx, duke.id, { status: 'Slain', lifecycle: 'ended', sessionId: s3.id })

    const pastNote = createNote(ctx, {
      campaignId,
      entityIds: [duke.id],
      sessionId: s1.id,
      content: 'The Duke pledged aid on the north road.'
    })
    const futureNote = createNote(ctx, {
      campaignId,
      entityIds: [duke.id],
      sessionId: s3.id,
      content: 'The Duke was slain at the feast.'
    })
    store.upsertNote(pastNote.id, unit(0), 'hp')
    store.upsertNote(futureNote.id, unit(0), 'hf')
    embedFn.mockResolvedValue(unit(0))
    claudeRecall.mockResolvedValue([])

    // AS OF session 2 — before the death and before the session-3 note.
    await ask(
      ctx,
      store,
      () => {},
      { requestId: 'asof', query: 'the Duke', campaignId, pcId: null, mode: 'factual', asOfSession: 2 },
      new AbortController().signal
    )
    const asOfCall = claudeRecall.mock.calls.at(-1)![0] as {
      chunks: Array<{ content: string }>
      state: string | null
    }
    const asOfContents = asOfCall.chunks.map((c) => c.content).join('\n')
    expect(asOfContents).toContain('pledged aid') // session-1 note is in
    expect(asOfContents).not.toContain('slain at the feast') // session-3 note clamped OUT
    expect(asOfCall.state).toMatch(/AS OF Session 2/) // as-of anchor, not "the present"
    expect(asOfCall.state).toContain('Alive') // reconstructed status at session 2
    expect(asOfCall.state).not.toContain('[ended]') // the Duke was alive then

    // NOW — the Duke is ended and the later note is retrievable again.
    await ask(
      ctx,
      store,
      () => {},
      { requestId: 'now', query: 'the Duke', campaignId, pcId: null, mode: 'factual' },
      new AbortController().signal
    )
    const nowCall = claudeRecall.mock.calls.at(-1)![0] as {
      chunks: Array<{ content: string }>
      state: string | null
    }
    const nowContents = nowCall.chunks.map((c) => c.content).join('\n')
    expect(nowContents).toContain('slain at the feast') // future note now visible
    expect(nowCall.state).toContain('Duke Halric (npc) [ended]') // now dead
  })
})
