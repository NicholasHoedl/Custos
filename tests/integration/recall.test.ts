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
vi.mock('../../src/main/services/settings.service', () => ({
  getSettings: () => ({ recallModel: 'claude-sonnet-4-6', theme: 'dark', fontSize: 'md', hotkey: '' })
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => {
  // Keep the REAL formatRelationships/formatState so the gather -> format -> pass chain is exercised;
  // only stub the network-touching pieces (the SDK call + the key check).
  const actual = await importOriginal<typeof import('../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: () => true, recall: claudeRecall }
})

import { RECALL_CHUNK_CHANNEL, RECALL_DONE_CHANNEL } from '@shared/ipc-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createLink } from '../../src/main/services/link.service'
import { BruteForceVectorStore } from '../../src/main/services/vector-store.service'
import { ask } from '../../src/main/services/recall.service'

function unit(i: number): Float32Array {
  const v = new Float32Array(384)
  v[i] = 1
  return v
}

describe('recall RAG pipeline (mocked AI)', () => {
  it('embeds the query, retrieves the right note, streams the answer, returns sources', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const session = createSession(ctx, { campaignId })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric Vane' })
    const relevant = createNote(ctx, {
      entityIds: [npc.id],
      sessionId: session.id,
      content: 'Aldric warned the party about the north road ambush.'
    })
    const other = createNote(ctx, { entityIds: [npc.id], content: 'Aldric mentioned turnip prices.' })
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
    const note = createNote(ctx, { entityIds: [glasstaff.id], content: 'Glasstaff led the Redbrands.' })
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

  it('pins + states the current scene (location/quest) in the prompt', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const inn = createEntity(ctx, {
      campaignId,
      type: 'location',
      name: 'Stonehill Inn',
      status: 'Safe'
    })
    const quest = createEntity(ctx, {
      campaignId,
      type: 'quest',
      name: 'Rescue Gundren',
      status: 'Active',
      attributes: { objective: 'Free Gundren' }
    })
    embedFn.mockResolvedValue(unit(0))
    claudeRecall.mockResolvedValue([])

    await ask(
      ctx,
      store,
      () => {},
      {
        requestId: 'rs',
        query: 'what now',
        campaignId,
        pcId: null,
        mode: 'factual',
        scene: {
          locationId: inn.id,
          embarkedQuestId: quest.id,
          nearbyPcIds: [],
          timeOfDay: 'evening',
          inCombat: false
        }
      },
      new AbortController().signal
    )

    const call = claudeRecall.mock.calls.at(-1)![0] as { scene: string | null; state: string | null }
    expect(call.scene).toContain('Stonehill Inn')
    expect(call.scene).toContain('Rescue Gundren')
    expect(call.scene).toContain('When: Evening')
    // The pinned location's status surfaces into the state grounding even though it wasn't retrieved.
    expect(call.state).toContain('Stonehill Inn (location): Safe')
  })
})
