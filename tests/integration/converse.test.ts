import { describe, it, expect, vi } from 'vitest'

// Mock the modules that touch electron / the network / the Claude SDK; exercise the REAL converse
// orchestration + grounding assembly on an in-memory DB. No embedding model — grounding is direct fetch.
const { claudeConverse } = vi.hoisted(() => ({ claudeConverse: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
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
  // Keep the REAL formatters so gather -> format -> pass is exercised; stub the SDK call + key check.
  const actual = await importOriginal<typeof import('../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: () => true, converse: claudeConverse }
})

import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createLink, severLink } from '../../src/main/services/link.service'
import { updatePersona } from '../../src/main/services/persona.service'
import { converse } from '../../src/main/services/converse.service'

const OK = {
  briefing: { known: ['Leads the Redbrands.'], openSuspected: [], connections: [] },
  questions: [{ question: 'Who do you answer to?', targetsThread: 'loyalties', why: 'find his master' }]
}

describe('converse pipeline (mocked AI)', () => {
  it('grounds the call with persona, the target, its confidence-tagged notes, connections, and the asker tie', async () => {
    const ctx = makeTestDb()
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
      status: 'Cornered'
    })
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    createLink(ctx, {
      campaignId,
      fromEntityId: glasstaff.id,
      toEntityId: manor.id,
      relation: 'located_in'
    })
    createLink(ctx, {
      campaignId,
      fromEntityId: pc.id,
      toEntityId: glasstaff.id,
      relation: 'enemy_of'
    })
    createNote(ctx, { campaignId, entityIds: [glasstaff.id], content: 'Glasstaff led the Redbrands.' })
    createNote(ctx, {
      campaignId,
      entityIds: [glasstaff.id],
      content: 'He may answer to the Black Spider.',
      confidence: 'rumored'
    })

    claudeConverse.mockResolvedValue(OK)

    const res = await converse(
      ctx,
      { campaignId, pcId: pc.id, targetId: glasstaff.id },
      new AbortController().signal
    )

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.questions).toHaveLength(1)

    expect(claudeConverse).toHaveBeenCalledTimes(1)
    const call = claudeConverse.mock.calls[0][0] as {
      context: {
        persona: string | null
        pcName: string | null
        pcRace: string | null
        pcClass: string | null
      }
      target: { name: string; status: string | null }
      notes: Array<{ content: string; confidence: string }>
      connections: string | null
      tie: string | null
      model: string
      effort: string
    }
    expect(call.context.persona).toBe('PC BRIEF: greedy and bold')
    expect(call.context.pcName).toBe('Vargas')
    expect(call.context.pcRace).toBe('half-elf') // from pc.attributes.ancestry
    expect(call.context.pcClass).toBe('paladin') // from pc.attributes.class
    expect(call.target.name).toBe('Glasstaff')
    expect(call.target.status).toBe('Cornered') // resolved state surfaced
    expect(call.notes.some((n) => n.content.includes('Redbrands'))).toBe(true)
    expect(call.notes.some((n) => n.confidence === 'rumored')).toBe(true) // the rumor is carried
    expect(call.connections).toContain('Tresendar Manor') // the target's 1-hop tie
    expect(call.tie).toContain('Glasstaff') // the asker's OWN tie to the target
    expect(call.model).toBe('claude-opus-4-8')
    expect(call.effort).toBe('high')
  })

  it('as-of: a tie severed by session N drops out of the connections at N', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const s1 = createSession(ctx, { campaignId }) // Session 1
    const s2 = createSession(ctx, { campaignId }) // Session 2
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const iarno = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })
    const cult = createEntity(ctx, { campaignId, type: 'faction', name: 'The Redbrands' })
    const link = createLink(ctx, {
      campaignId,
      fromEntityId: iarno.id,
      toEntityId: cult.id,
      relation: 'member_of',
      sessionId: s1.id
    })
    severLink(ctx, link.id, s2.id) // interval [1, 2)

    claudeConverse.mockResolvedValue(OK)

    // Live at Session 1 → the tie is present.
    await converse(
      ctx,
      { campaignId, pcId: pc.id, targetId: iarno.id, asOfSession: 1 },
      new AbortController().signal
    )
    const at1 = (claudeConverse.mock.calls.at(-1)![0] as { connections: string | null }).connections
    expect(at1).toContain('The Redbrands')

    // At Session 2 the interval has closed → the tie is gone.
    await converse(
      ctx,
      { campaignId, pcId: pc.id, targetId: iarno.id, asOfSession: 2 },
      new AbortController().signal
    )
    const at2 = (claudeConverse.mock.calls.at(-1)![0] as { connections: string | null }).connections
    expect(at2 == null || !at2.includes('The Redbrands')).toBe(true)
  })

  it('an empty target (no notes, no ties) still yields a questions-only result', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const stranger = createEntity(ctx, { campaignId, type: 'npc', name: 'The Hooded Stranger' })

    claudeConverse.mockResolvedValue({
      briefing: { known: [], openSuspected: [], connections: [] },
      questions: [{ question: 'Who are you?', targetsThread: 'identity', why: 'we know nothing' }]
    })

    const res = await converse(
      ctx,
      { campaignId, pcId: pc.id, targetId: stranger.id },
      new AbortController().signal
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.briefing.known).toHaveLength(0)
      expect(res.questions).toHaveLength(1)
    }
  })

  it('fails no_pc when no PC is set, and invalid for an unknown target', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })

    const noPc = await converse(
      ctx,
      { campaignId, pcId: '', targetId: 'x' },
      new AbortController().signal
    )
    expect(noPc.ok).toBe(false)
    if (!noPc.ok) expect(noPc.reason).toBe('no_pc')

    const bad = await converse(
      ctx,
      { campaignId, pcId: pc.id, targetId: 'nonexistent' },
      new AbortController().signal
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('invalid')
  })
})
