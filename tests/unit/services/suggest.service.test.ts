import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AttitudeRecommendation, StorySuggestion } from '@shared/suggest-types'

// Exercise the REAL suggest orchestration + validation + vector store on an in-memory DB; mock only the
// modules that touch electron / the network / the Claude SDK. The hoisted fns are controllable per test.
const {
  claudeSuggestFn,
  claudeSuggestDirectionsFn,
  embedFn,
  isModelReadyFn,
  isAvailableFn,
  lookupFn
} = vi.hoisted(() => ({
  claudeSuggestFn: vi.fn(),
  claudeSuggestDirectionsFn: vi.fn(),
  embedFn: vi.fn(),
  isModelReadyFn: vi.fn(() => true),
  isAvailableFn: vi.fn(() => true),
  lookupFn: vi.fn(async () => ({ address: '127.0.0.1', family: 4 }))
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupFn }))
vi.mock('../../../src/main/services/embedding.service', () => ({
  isModelReady: isModelReadyFn,
  embed: embedFn
}))
vi.mock('../../../src/main/services/settings.service', () => ({
  getSettings: () => ({
    recallModel: 'claude-sonnet-4-6',
    suggestModel: 'claude-opus-4-8',
    suggestEffort: 'high',
    theme: 'dark',
    fontSize: 'md',
    hotkey: ''
  })
}))
vi.mock('../../../src/main/services/persona.service', () => ({
  getPersona: () => ({
    entityId: 'pc',
    brief: 'BRIEF',
    edited: false,
    stale: false,
    model: null,
    updatedAt: 0
  }),
  generatePersona: vi.fn()
}))
vi.mock('../../../src/main/services/claude.service', async (importOriginal) => {
  // Keep the REAL formatRelationships/formatState/formatCampaignThreads; stub only network-touching bits.
  const actual = await importOriginal<typeof import('../../../src/main/services/claude.service')>()
  return {
    ...actual,
    isAvailable: isAvailableFn,
    suggest: claudeSuggestFn,
    suggestDirections: claudeSuggestDirectionsFn
  }
})

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { BruteForceVectorStore } from '../../../src/main/services/vector-store.service'
import { suggest } from '../../../src/main/services/suggest.service'

function rec(
  attitude: string,
  action = 'do the thing',
  rationale = 'fits them'
): AttitudeRecommendation {
  return { attitude: attitude as AttitudeRecommendation['attitude'], action, rationale }
}

function dir(
  category: string,
  suggestion = 'go do a thing',
  rationale = 'fits them'
): StorySuggestion {
  return { category: category as StorySuggestion['category'], suggestion, rationale }
}

function setup() {
  const ctx = makeTestDb()
  const store = new BruteForceVectorStore(ctx)
  const campaignId = createCampaign(ctx, { name: 'C' }).id
  const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
  return { ctx, store, campaignId, pc }
}

const sig = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  vi.resetAllMocks()
  isModelReadyFn.mockReturnValue(true)
  isAvailableFn.mockReturnValue(true)
  lookupFn.mockResolvedValue({ address: '127.0.0.1', family: 4 })
  embedFn.mockResolvedValue(new Float32Array(384))
})

describe('suggest.service — attitudes mode', () => {
  it('returns 4 distinct recommendations on a valid response', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestFn.mockResolvedValue([rec('moral'), rec('hostile'), rec('cynical'), rec('friendly')])
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res.ok).toBe(true)
    if (res.ok && res.mode === 'attitudes')
      expect(res.recommendations.map((r) => r.attitude)).toEqual([
        'moral',
        'hostile',
        'cynical',
        'friendly'
      ])
    expect(claudeSuggestFn).toHaveBeenCalledTimes(1)
  })

  it('trims a 5+ response down to the first 4 distinct', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestFn.mockResolvedValue([
      rec('moral'),
      rec('hostile'),
      rec('cynical'),
      rec('friendly'),
      rec('selfish')
    ])
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res.ok).toBe(true)
    if (res.ok && res.mode === 'attitudes') expect(res.recommendations).toHaveLength(4)
    expect(claudeSuggestFn).toHaveBeenCalledTimes(1)
  })

  it('retries once, then fails with reason "invalid" when distinct attitudes < 4', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestFn.mockResolvedValue([rec('moral'), rec('moral'), rec('hostile'), rec('')])
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(claudeSuggestFn).toHaveBeenCalledTimes(2)
  })

  it('recovers on the retry when the first response is short', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestFn
      .mockResolvedValueOnce([rec('moral'), rec('hostile')])
      .mockResolvedValueOnce([rec('moral'), rec('hostile'), rec('cynical'), rec('friendly')])
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res.ok).toBe(true)
    expect(claudeSuggestFn).toHaveBeenCalledTimes(2)
  })

  it('drops entries with a blank action or unknown attitude', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestFn.mockResolvedValue([
      rec('moral'),
      rec('hostile', '   '), // blank action → dropped
      rec('bogus'), // not an attitude → dropped
      rec('cynical'),
      rec('friendly')
    ])
    // moral, cynical, friendly survive (3 distinct) → invalid both attempts
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
  })
})

describe('suggest.service — directions mode', () => {
  it('returns grouped story suggestions on a valid response', async () => {
    const { ctx, store, campaignId, pc } = setup()
    claudeSuggestDirectionsFn.mockResolvedValue([
      dir('quest'),
      dir('npc'),
      dir('location'),
      dir('party'),
      dir('story'),
      dir('personal')
    ])
    const res = await suggest(
      ctx,
      store,
      { campaignId, pcId: pc.id, situation: '', mode: 'directions' },
      sig()
    )
    expect(res.ok).toBe(true)
    if (res.ok && res.mode === 'directions') expect(res.suggestions).toHaveLength(6)
    expect(claudeSuggestDirectionsFn).toHaveBeenCalledTimes(1)
    expect(claudeSuggestFn).not.toHaveBeenCalled()
  })

  it('retries once, then fails "invalid" when fewer than 3 usable suggestions', async () => {
    const { ctx, store, campaignId, pc } = setup()
    // 1 valid (quest); 'bogus' category dropped; blank suggestion dropped
    claudeSuggestDirectionsFn.mockResolvedValue([dir('quest'), dir('bogus'), dir('npc', '   ')])
    const res = await suggest(
      ctx,
      store,
      { campaignId, pcId: pc.id, situation: '', mode: 'directions' },
      sig()
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(claudeSuggestDirectionsFn).toHaveBeenCalledTimes(2)
  })
})

describe('suggest.service guards', () => {
  it('no_model when the embedding model is not ready', async () => {
    const { ctx, store, campaignId, pc } = setup()
    isModelReadyFn.mockReturnValue(false)
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res).toEqual({ ok: false, reason: 'no_model' })
    expect(claudeSuggestFn).not.toHaveBeenCalled()
  })

  it('no_pc when the target is not a player character', async () => {
    const { ctx, store, campaignId } = setup()
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Glasstaff' })
    const res = await suggest(ctx, store, { campaignId, pcId: npc.id, situation: 'x' }, sig())
    expect(res).toEqual({ ok: false, reason: 'no_pc' })
  })

  it('no_key when no API key is stored', async () => {
    const { ctx, store, campaignId, pc } = setup()
    isAvailableFn.mockReturnValue(false)
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res).toEqual({ ok: false, reason: 'no_key' })
  })

  it('offline when the DNS lookup fails', async () => {
    const { ctx, store, campaignId, pc } = setup()
    lookupFn.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.anthropic.com'))
    const res = await suggest(ctx, store, { campaignId, pcId: pc.id, situation: 'x' }, sig())
    expect(res).toEqual({ ok: false, reason: 'offline' })
  })
})
