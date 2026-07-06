import { describe, it, expect, vi } from 'vitest'

// Mock the modules that touch electron / the network / the Claude SDK; exercise the REAL suggest
// orchestration + vector store + persona round-trip on an in-memory DB.
const { claudeSuggest, claudeSuggestDirections, embedFn } = vi.hoisted(() => ({
  claudeSuggest: vi.fn(),
  claudeSuggestDirections: vi.fn(),
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
  getSettings: () => ({
    recallModel: 'claude-sonnet-4-6',
    suggestModel: 'claude-opus-4-8',
    suggestEffort: 'high',
    theme: 'dark',
    fontSize: 'md',
    hotkey: ''
  })
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => {
  // Keep the REAL formatters so gather -> format -> pass is exercised; stub the SDK calls + key check.
  const actual = await importOriginal<typeof import('../../src/main/services/claude.service')>()
  return {
    ...actual,
    isAvailable: () => true,
    suggest: claudeSuggest,
    suggestDirections: claudeSuggestDirections
  }
})

import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createLink } from '../../src/main/services/link.service'
import { updatePersona } from '../../src/main/services/persona.service'
import { BruteForceVectorStore } from '../../src/main/services/vector-store.service'
import { suggest } from '../../src/main/services/suggest.service'

function unit(i: number): Float32Array {
  const v = new Float32Array(384)
  v[i] = 1
  return v
}

describe('suggest RAG pipeline (mocked AI)', () => {
  it('attitudes: grounds the structured call with persona, notes, state, and relationships', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId }) // Session 1 — the present anchor
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Vargas',
      attributes: { ancestry: 'half-elf', class: 'paladin' }
    })
    updatePersona(ctx, pc.id, 'PC BRIEF: greedy and bold')
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
    const note = createNote(ctx, {
      campaignId,
      entityIds: [glasstaff.id],
      content: 'Glasstaff led the Redbrands.'
    })
    store.upsertNote(note.id, unit(0), 'h')

    embedFn.mockResolvedValue(unit(0)) // the situation embeds toward the Glasstaff note
    claudeSuggest.mockResolvedValue([
      { primaryTag: 'religious', secondaryTags: ['merciful'], action: 'a', rationale: 'r' },
      { primaryTag: 'hostile', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'cunning', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'friendly', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'protective', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'merciful', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'honorable', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'bold', secondaryTags: [], action: 'a', rationale: 'r' }
    ])

    const res = await suggest(
      ctx,
      store,
      { campaignId, pcId: pc.id, situation: 'What should we do about Glasstaff?' },
      new AbortController().signal
    )

    expect(res.ok).toBe(true)
    if (res.ok && res.mode === 'attitudes') expect(res.recommendations).toHaveLength(8)

    expect(claudeSuggest).toHaveBeenCalledTimes(1)
    const call = claudeSuggest.mock.calls[0][0] as {
      context: {
        persona: string | null
        pcName: string | null
        pcRace: string | null
        pcClass: string | null
      }
      chunks: Array<{ content: string }>
      state: string | null
      relationships: string | null
      model: string
      effort: string
    }
    expect(call.context.persona).toBe('PC BRIEF: greedy and bold')
    expect(call.context.pcName).toBe('Vargas')
    expect(call.context.pcRace).toBe('half-elf') // from pc.attributes.ancestry
    expect(call.context.pcClass).toBe('paladin') // from pc.attributes.class
    expect(call.chunks.some((c) => c.content.includes('Redbrands'))).toBe(true)
    expect(call.state).toContain('Glasstaff (npc): Defeated') // resolved status surfaced
    expect(call.state).toMatch(/most recent session is Session 1/) // present anchor
    expect(call.relationships).toContain('Tresendar Manor') // edge gathered + formatted
    expect(call.model).toBe('claude-opus-4-8')
    expect(call.effort).toBe('high')
  })

  it('directions: grounds the call with open quests (objectives) and the other party members', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'PC BRIEF')
    // The rest of the party + an open and a finished quest.
    createEntity(ctx, { campaignId, type: 'pc', name: 'Elaria' })
    createEntity(ctx, {
      campaignId,
      type: 'quest',
      name: 'Rescue Gundren',
      status: 'Active',
      attributes: { objective: 'Find and free Gundren from the Cragmaws' }
    })
    createEntity(ctx, { campaignId, type: 'quest', name: 'Escort the Wagon', status: 'Completed' })

    embedFn.mockResolvedValue(unit(0))
    claudeSuggestDirections.mockResolvedValue([
      { category: 'quest', suggestion: 'a', rationale: 'r' },
      { category: 'party', suggestion: 'a', rationale: 'r' },
      { category: 'location', suggestion: 'a', rationale: 'r' }
    ])

    const res = await suggest(
      ctx,
      store,
      { campaignId, pcId: pc.id, situation: 'We just got back to town.', mode: 'directions' },
      new AbortController().signal
    )

    expect(res.ok).toBe(true)
    if (res.ok && res.mode === 'directions') expect(res.suggestions).toHaveLength(3)

    expect(claudeSuggestDirections).toHaveBeenCalledTimes(1)
    const call = claudeSuggestDirections.mock.calls[0][0] as {
      threads: string | null
      context: { persona: string | null }
      model: string
      effort: string
    }
    expect(call.context.persona).toBe('PC BRIEF')
    expect(call.threads).toContain('Rescue Gundren') // open quest surfaced
    expect(call.threads).toContain('Find and free Gundren') // its objective
    expect(call.threads).not.toContain('Escort the Wagon') // Completed → excluded
    expect(call.threads).toContain('Elaria') // other party member
    expect(call.model).toBe('claude-opus-4-8')
    expect(call.effort).toBe('high')
  })

  it('pins + states the current scene in the prompt', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const inn = createEntity(ctx, {
      campaignId,
      type: 'location',
      name: 'Stonehill Inn',
      status: 'Safe'
    })
    embedFn.mockResolvedValue(unit(0))
    claudeSuggest.mockResolvedValue([
      { primaryTag: 'religious', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'hostile', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'cunning', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'friendly', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'protective', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'merciful', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'honorable', secondaryTags: [], action: 'a', rationale: 'r' },
      { primaryTag: 'bold', secondaryTags: [], action: 'a', rationale: 'r' }
    ])

    const res = await suggest(
      ctx,
      store,
      {
        campaignId,
        pcId: pc.id,
        situation: 'what now',
        scene: {
          locationId: inn.id,
          embarkedQuestId: null,
          nearbyPcIds: [],
          presentEntityIds: [],
          sceneMode: 'combat',
          timeOfDay: 'night'
        }
      },
      new AbortController().signal
    )

    expect(res.ok).toBe(true)
    const call = claudeSuggest.mock.calls.at(-1)![0] as { scene: string | null; state: string | null }
    expect(call.scene).toContain('Stonehill Inn')
    expect(call.scene).toContain("What's happening: Combat")
    expect(call.state).toContain('Stonehill Inn (location): Safe')
  })
})
