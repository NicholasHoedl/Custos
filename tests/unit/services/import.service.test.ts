import { describe, it, expect, vi, beforeEach } from 'vitest'

// Exercise the REAL extract validation/dedup on an in-memory DB; mock electron / network / the Claude
// SDK call. extractChangeset returns the raw model shape; we assert import.service cleans it.
const { extractFn, isAvailableFn } = vi.hoisted(() => ({
  extractFn: vi.fn(),
  isAvailableFn: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
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
vi.mock('../../../src/main/services/embedding-index.service', () => ({
  indexEntity: vi.fn(),
  indexNote: vi.fn(),
  backfill: vi.fn()
}))
vi.mock('../../../src/main/services/claude.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: isAvailableFn, extractChangeset: extractFn }
})

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { extract } from '../../../src/main/services/import.service'

const sig = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  isAvailableFn.mockReturnValue(true)
})

describe('import.service — extract (validate + dedup)', () => {
  it('cleans entities (dropping bad types), preserves original indices, and normalizes note refs', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    extractFn.mockResolvedValue({
      entities: [
        { type: 'npc', name: 'Sister Garaele', attributes: [{ key: 'race', value: 'Elf' }] },
        { type: 'bogus', name: 'Nope' }, // invalid type → dropped (index 1 disappears)
        { type: 'location', name: 'Phandalin' }
      ],
      notes: [
        { content: 'Garaele is in Phandalin', entityRefs: ['#0', '#2'] },
        { content: 'dangling', entityRefs: ['#9'] } // unresolvable ref → note dropped
      ]
    })

    const res = await extract(ctx, { campaignId, text: 'some text' }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.entities.map((e) => e.name)).toEqual(['Sister Garaele', 'Phandalin'])
    expect(res.proposal.entities.map((e) => e.index)).toEqual([0, 2]) // original positions kept
    expect(res.proposal.entities[0].attributes).toEqual({ race: 'Elf' })
    expect(res.proposal.notes).toHaveLength(1)
    expect(res.proposal.notes[0].entityRefs).toEqual([
      { kind: 'new', index: 0 },
      { kind: 'new', index: 2 }
    ])
  })

  it('collapses intra-batch duplicate names (rewriting refs) and surfaces existing matches', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createEntity(ctx, { campaignId, type: 'npc', name: 'Glasstaff' })
    extractFn.mockResolvedValue({
      entities: [
        { type: 'npc', name: 'Glastaff' }, // typo of the existing entity → match surfaced
        { type: 'npc', name: 'Iarno' },
        { type: 'npc', name: 'Iarno' } // duplicate within the batch → collapsed onto #1
      ],
      notes: [{ content: 'note', entityRefs: ['#0', '#2'] }]
    })

    const res = await extract(ctx, { campaignId, text: 'Glastaff and Iarno' }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.entities.map((e) => e.name)).toEqual(['Glastaff', 'Iarno'])
    expect(res.proposal.entities[0].matches.some((m) => m.name === 'Glasstaff')).toBe(true)
    // ref to the dropped duplicate (#2) is rewritten to the canonical kept index (#1)
    expect(res.proposal.notes[0].entityRefs).toEqual([
      { kind: 'new', index: 0 },
      { kind: 'new', index: 1 }
    ])
  })

  it('returns "empty" when nothing valid survives', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    extractFn.mockResolvedValue({ entities: [{ type: 'bogus', name: 'x' }], notes: [] })
    const res = await extract(ctx, { campaignId, text: 'text' }, sig())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('empty')
  })

  it('guards on no key (and never calls the model) and on empty text', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    isAvailableFn.mockReturnValue(false)
    expect(await extract(ctx, { campaignId, text: 'text' }, sig())).toEqual({
      ok: false,
      reason: 'no_key'
    })
    expect(extractFn).not.toHaveBeenCalled()

    isAvailableFn.mockReturnValue(true)
    expect(await extract(ctx, { campaignId, text: '   ' }, sig())).toEqual({
      ok: false,
      reason: 'empty'
    })
    expect(extractFn).not.toHaveBeenCalled()
  })
})

describe('import.service — changeset v2 (status + relationship changes, ADR-018)', () => {
  it('resolves status-change refs, validates or derives lifecycles, and drops unusable entries', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    extractFn.mockResolvedValue({
      entities: [{ type: 'npc', name: 'Duke Halric' }],
      notes: [],
      statusChanges: [
        { entityRef: '#0', lifecycle: 'ended', status: 'Slain' }, // valid, new ref
        { entityRef: manor.id, status: 'Ruined by fire' }, // no lifecycle → derived 'ended'
        { entityRef: '#0', lifecycle: 'bogus', status: 'Wounded' }, // bad lifecycle → derived 'active'
        { entityRef: '#9', lifecycle: 'ended' }, // dangling ref → dropped
        { entityRef: '#0' } // neither lifecycle nor status → dropped
      ],
      relationshipChanges: []
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.statusChanges).toEqual([
      { entityRef: { kind: 'new', index: 0 }, lifecycle: 'ended', status: 'Slain' },
      {
        entityRef: { kind: 'existing', entityId: manor.id },
        lifecycle: 'ended',
        status: 'Ruined by fire'
      },
      { entityRef: { kind: 'new', index: 0 }, lifecycle: 'active', status: 'Wounded' }
    ])
  })

  it('validates relationship changes: refs, known relation, type-allowedness on form, dedup', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const inn = createEntity(ctx, { campaignId, type: 'location', name: 'Stonehill Inn' })
    extractFn.mockResolvedValue({
      entities: [
        { type: 'npc', name: 'Aldric' },
        { type: 'npc', name: 'Mirna' }
      ],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        { fromRef: '#0', toRef: inn.id, relation: 'located_in', action: 'form' }, // valid form
        { fromRef: '#0', toRef: '#1', relation: 'ally_of', action: 'sever' }, // valid sever
        { fromRef: '#0', toRef: inn.id, relation: 'owns', action: 'form' }, // npc→location disallowed
        { fromRef: '#0', toRef: inn.id, relation: 'buddies', action: 'form' }, // unknown relation
        { fromRef: '#0', toRef: '#0', relation: 'ally_of', action: 'form' }, // self-reference
        { fromRef: '#0', toRef: '#9', relation: 'ally_of', action: 'form' }, // dangling ref
        { fromRef: '#0', toRef: inn.id, relation: 'located_in', action: 'form' } // exact duplicate
      ]
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.relationshipChanges).toEqual([
      {
        fromRef: { kind: 'new', index: 0 },
        toRef: { kind: 'existing', entityId: inn.id },
        relation: 'located_in',
        action: 'form'
      },
      {
        fromRef: { kind: 'new', index: 0 },
        toRef: { kind: 'new', index: 1 },
        relation: 'ally_of',
        action: 'sever'
      }
    ])
  })

  it('rewrites change refs onto collapsed intra-batch duplicates', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    extractFn.mockResolvedValue({
      entities: [
        { type: 'npc', name: 'Iarno' },
        { type: 'npc', name: 'Iarno' } // duplicate → collapsed onto #0
      ],
      notes: [],
      statusChanges: [{ entityRef: '#1', lifecycle: 'ended', status: 'Dead' }],
      relationshipChanges: []
    })
    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.statusChanges[0].entityRef).toEqual({ kind: 'new', index: 0 })
  })

  it('a proposal carrying ONLY changes is not "empty"; absent arrays validate to empty', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Glasstaff' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [{ entityRef: npc.id, lifecycle: 'ended', status: 'Dead' }],
      relationshipChanges: []
    })
    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true) // a lone status change is a real proposal

    // Plain-import shape (no change arrays at all) still validates, with empty change arrays.
    extractFn.mockResolvedValue({ entities: [{ type: 'npc', name: 'Sildar' }], notes: [] })
    const res2 = await extract(ctx, { campaignId, text: 't' }, sig())
    expect(res2.ok).toBe(true)
    if (!res2.ok) return
    expect(res2.proposal.statusChanges).toEqual([])
    expect(res2.proposal.relationshipChanges).toEqual([])
  })
})
