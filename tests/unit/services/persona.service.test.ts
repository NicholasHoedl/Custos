import { describe, it, expect, vi } from 'vitest'

const { completeFn } = vi.hoisted(() => ({ completeFn: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, safeStorage: {} }))
vi.mock('../../../src/main/services/claude.service', () => ({ complete: completeFn }))
vi.mock('../../../src/main/services/settings.service', () => ({
  getSettings: () => ({ recallModel: 'claude-sonnet-4-6' })
}))

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity, updateEntity } from '../../../src/main/services/entity.service'
import {
  generatePersona,
  getPersona,
  markStaleIfChanged,
  updatePersona
} from '../../../src/main/services/persona.service'

describe('persona.service', () => {
  it('generates and stores a brief, round-tripping via getPersona', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, {
      campaignId,
      type: 'pc',
      name: 'Vargas',
      traits: ['greedy'],
      goals: ['get rich']
    })
    completeFn.mockResolvedValue('THE BRIEF')

    const p = await generatePersona(ctx, pc.id)
    expect(p.brief).toBe('THE BRIEF')
    expect(p.edited).toBe(false)
    expect(p.stale).toBe(false)
    expect(getPersona(ctx, pc.id)?.brief).toBe('THE BRIEF')
  })

  it('flags stale when the PC changes; editing sets the edited flag', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas', traits: ['greedy'] })
    completeFn.mockResolvedValue('BRIEF')
    await generatePersona(ctx, pc.id)
    expect(getPersona(ctx, pc.id)?.stale).toBe(false)

    updateEntity(ctx, pc.id, { traits: ['greedy', 'reckless'] })
    markStaleIfChanged(ctx, pc.id)
    expect(getPersona(ctx, pc.id)?.stale).toBe(true)

    const edited = updatePersona(ctx, pc.id, 'my hand-written brief')
    expect(edited.edited).toBe(true)
    expect(edited.brief).toBe('my hand-written brief')
  })

  it('refuses to generate a persona for a non-PC entity', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Glastav' })
    completeFn.mockResolvedValue('x')
    await expect(generatePersona(ctx, npc.id)).rejects.toThrow()
  })
})
