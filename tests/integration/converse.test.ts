import { describe, it, expect, vi, beforeEach } from 'vitest'

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

/** A question item in the model's array response (ADR-034: questions only, each { question, tag, read }). */
const Q = (tag: string, question: string, read: string): { tag: string; question: string; read: string } => ({
  question,
  tag,
  read
})

// A valid model response: a spread with DISTINCT tags, at or above the floor of 4.
const OK = [
  Q('open-probe', 'What brings you to Phandalin?', 'a broad opener to get him talking'),
  Q('rumor-test', 'They say you lead the Redbrands — is that so?', 'put the rumor to him'),
  Q('backstory-dig', 'Where does a man like you learn such tricks?', 'his past'),
  Q('secret-seeking', 'Who do you really answer to?', 'find his master')
]

const sig = (): AbortSignal => new AbortController().signal

describe('converse pipeline (mocked AI)', () => {
  // The mock is module-level; reset call history + implementation between tests so call-count assertions
  // (retry behaviour) are per-test.
  beforeEach(() => claudeConverse.mockReset())

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

    const res = await converse(ctx, { campaignId, pcId: pc.id, targetId: glasstaff.id }, sig())

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.questions).toHaveLength(4)

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
    await converse(ctx, { campaignId, pcId: pc.id, targetId: iarno.id, asOfSession: 1 }, sig())
    const at1 = (claudeConverse.mock.calls.at(-1)![0] as { connections: string | null }).connections
    expect(at1).toContain('The Redbrands')

    // At Session 2 the interval has closed → the tie is gone.
    await converse(ctx, { campaignId, pcId: pc.id, targetId: iarno.id, asOfSession: 2 }, sig())
    const at2 = (claudeConverse.mock.calls.at(-1)![0] as { connections: string | null }).connections
    expect(at2 == null || !at2.includes('The Redbrands')).toBe(true)
  })

  it('as-of clamps the target notes to what was known by that session (the notes leak fix)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId }) // number 1 (advances the counter so the next is number 2)
    const s2 = createSession(ctx, { campaignId }) // number 2
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const iarno = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })
    createNote(ctx, { campaignId, entityIds: [iarno.id], content: 'BASELINE note' }) // null session
    createNote(ctx, { campaignId, entityIds: [iarno.id], content: 'LATER note', sessionId: s2.id })

    claudeConverse.mockResolvedValue(OK)

    // As of Session 1: the pre-tracking baseline note is in; the session-2 note must NOT leak.
    await converse(ctx, { campaignId, pcId: pc.id, targetId: iarno.id, asOfSession: 1 }, sig())
    const at1 = (claudeConverse.mock.calls.at(-1)![0] as { notes: Array<{ content: string }> }).notes
    expect(at1.some((n) => n.content.includes('BASELINE'))).toBe(true)
    expect(at1.some((n) => n.content.includes('LATER'))).toBe(false)

    // "Now" (no as-of): both notes present.
    await converse(ctx, { campaignId, pcId: pc.id, targetId: iarno.id }, sig())
    const now = (claudeConverse.mock.calls.at(-1)![0] as { notes: Array<{ content: string }> }).notes
    expect(now.some((n) => n.content.includes('BASELINE'))).toBe(true)
    expect(now.some((n) => n.content.includes('LATER'))).toBe(true)
  })

  it('an empty target (no notes, no ties) still yields a questions-only result', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const stranger = createEntity(ctx, { campaignId, type: 'npc', name: 'The Hooded Stranger' })

    claudeConverse.mockResolvedValue([
      Q('open-probe', 'Who are you?', 'we know nothing'),
      Q('rapport', 'Cold night to be out — care for a drink?', 'warm them up'),
      Q('backstory-dig', 'Where do you hail from?', 'get a first thread'),
      Q('motivation', 'What is it you want in Phandalin?', 'their aim')
    ])

    const res = await converse(ctx, { campaignId, pcId: pc.id, targetId: stranger.id }, sig())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.questions).toHaveLength(4)
  })

  it('rejects a non-character target and the asking PC itself (you talk WITH a character)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    const mine = createEntity(ctx, { campaignId, type: 'location', name: 'Wave Echo Cave' })

    const asLocation = await converse(ctx, { campaignId, pcId: pc.id, targetId: mine.id }, sig())
    expect(asLocation.ok).toBe(false)
    if (!asLocation.ok) expect(asLocation.reason).toBe('invalid')

    const asSelf = await converse(ctx, { campaignId, pcId: pc.id, targetId: pc.id }, sig())
    expect(asSelf.ok).toBe(false)
    if (!asSelf.ok) expect(asSelf.reason).toBe('invalid')

    expect(claudeConverse).not.toHaveBeenCalled() // guards fire before the model call
  })

  it('fails no_pc when no PC is set, and invalid for an unknown target', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })

    const noPc = await converse(ctx, { campaignId, pcId: '', targetId: 'x' }, sig())
    expect(noPc.ok).toBe(false)
    if (!noPc.ok) expect(noPc.reason).toBe('no_pc')

    const bad = await converse(ctx, { campaignId, pcId: pc.id, targetId: 'nonexistent' }, sig())
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('invalid')
  })

  it('validates the spread: drops invalid tags, blank text, and duplicate tags; caps at 6', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })

    claudeConverse.mockResolvedValue([
      { question: 'q1', tag: 'open-probe', read: 'r' },
      { question: 'dup', tag: 'open-probe', read: 'r' }, // duplicate tag → dropped
      { question: 'x', tag: 'not-a-tag', read: 'r' }, // unknown tag → dropped
      { question: '   ', tag: 'lore', read: 'r' }, // blank question → dropped
      { question: 'q2', tag: 'feelings', read: '   ' }, // blank read → dropped
      { question: 'q3', tag: 'backstory-dig', read: 'r' },
      { question: 'q4', tag: 'rumor-test', read: 'r' },
      { question: 'q5', tag: 'motivation', read: 'r' },
      { question: 'q6', tag: 'callback', read: 'r' },
      { question: 'q7', tag: 'flatter', read: 'r' },
      { question: 'q8', tag: 'challenge', read: 'r' } // 7th valid distinct → capped out
    ])

    const res = await converse(ctx, { campaignId, pcId: pc.id, targetId: npc.id }, sig())
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.questions).toHaveLength(6) // capped at 6
      const tags = res.questions.map((q) => q.tag)
      expect(new Set(tags).size).toBe(6) // all distinct
      expect(tags).not.toContain('not-a-tag')
    }
  })

  it('retries once, then fails invalid when too few usable questions survive', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })

    claudeConverse.mockResolvedValue([
      Q('open-probe', 'q1', 'r'),
      Q('lore', 'q2', 'r')
    ]) // only 2 < floor 4

    const res = await converse(ctx, { campaignId, pcId: pc.id, targetId: npc.id }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(claudeConverse).toHaveBeenCalledTimes(2) // one retry
  })

  it('recovers when the retry returns a usable spread', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    createSession(ctx, { campaignId })
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Vargas' })
    updatePersona(ctx, pc.id, 'BRIEF')
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })

    claudeConverse
      .mockResolvedValueOnce([Q('open-probe', 'q1', 'r')]) // too few
      .mockResolvedValueOnce(OK) // good on retry

    const res = await converse(ctx, { campaignId, pcId: pc.id, targetId: npc.id }, sig())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.questions).toHaveLength(4)
    expect(claudeConverse).toHaveBeenCalledTimes(2)
  })
})
