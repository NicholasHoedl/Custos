import { describe, it, expect, vi, beforeEach } from 'vitest'

// Exercise the REAL derive validation/guards on an in-memory DB; mock electron / network / the Claude
// call. deriveProfileCall returns the raw model shape; we assert derive-profile.service cleans it.
const { deriveFn, isAvailableFn } = vi.hoisted(() => ({
  deriveFn: vi.fn(),
  isAvailableFn: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
vi.mock('../../../src/main/services/settings.service', () => ({
  getSettings: () => ({ suggestModel: 'claude-opus-4-8', suggestEffort: 'high' })
}))
vi.mock('../../../src/main/services/claude.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: isAvailableFn, deriveProfileCall: deriveFn }
})

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { deriveProfile } from '../../../src/main/services/derive-profile.service'

const sig = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  isAvailableFn.mockReturnValue(true)
})

describe('derive-profile.service (ADR-029)', () => {
  it('cleans the model output (trims, de-dupes, drops empties) and sends the backstory', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Vargas',
      attributes: { backstory: 'Raised in the gutters of Waterdeep.' }
    })
    deriveFn.mockResolvedValue({
      description: '  A gutter-born opportunist.  ',
      traits: ['Greedy', 'Greedy', ' Cunning ', ''],
      goals: ['Get rich'],
      flaws: [],
      voiceExamples: ['Coin first, questions later.', '']
    })

    const res = await deriveProfile(ctx, { campaignId, pcId: pc.id }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.profile.description).toBe('A gutter-born opportunist.')
    expect(res.profile.traits).toEqual(['Greedy', 'Cunning']) // trimmed + de-duped, empty dropped
    expect(res.profile.flaws).toEqual([])
    expect(res.profile.voiceExamples).toEqual(['Coin first, questions later.'])
    // The backstory (not just the name) is what feeds the model.
    const passed = deriveFn.mock.calls[0][0] as { ctx: { backstory: string } }
    expect(passed.ctx.backstory).toContain('Waterdeep')
  })

  it('returns no_backstory when the character has none (never calls the model)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Blank' })
    const res = await deriveProfile(ctx, { campaignId, pcId: pc.id }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('no_backstory')
    expect(deriveFn).not.toHaveBeenCalled()
  })

  it('rejects a non-pc / wrong-campaign target as invalid', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const npc = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Harrow',
      attributes: { backstory: 'x' }
    })
    const res = await deriveProfile(ctx, { campaignId, pcId: npc.id }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(deriveFn).not.toHaveBeenCalled()
  })

  it('maps a missing key to no_key without calling the model', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Vargas',
      attributes: { backstory: 'A tale.' }
    })
    isAvailableFn.mockReturnValue(false)
    const res = await deriveProfile(ctx, { campaignId, pcId: pc.id }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('no_key')
    expect(deriveFn).not.toHaveBeenCalled()
  })

  it('returns invalid when the model output is empty (after one retry)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Vargas',
      attributes: { backstory: 'A tale.' }
    })
    deriveFn.mockResolvedValue({
      description: '',
      traits: [],
      goals: [],
      flaws: [],
      voiceExamples: []
    })
    const res = await deriveProfile(ctx, { campaignId, pcId: pc.id }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(deriveFn).toHaveBeenCalledTimes(2) // one retry before giving up
  })
})
