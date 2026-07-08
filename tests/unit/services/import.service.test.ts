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
vi.mock('electron-log/main', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createLink } from '../../../src/main/services/link.service'
import { createNote } from '../../../src/main/services/note.service'
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

  it('maps a truncated model response to the too_long reason (big-paste guidance)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    // A paste too large to extract in one shot exhausts the output budget → structuredCall throws
    // 'truncated'; the user should be told to split it, not shown the generic "couldn't read that".
    extractFn.mockRejectedValue(new Error('truncated'))

    const res = await extract(ctx, { campaignId, text: 'an enormous paste' }, sig())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('too_long')
  })

  it('maps a rejected API key (401) to the bad_key reason', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    extractFn.mockRejectedValue(
      new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
    )

    const res = await extract(ctx, { campaignId, text: 'some notes' }, sig())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('bad_key')
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
        action: 'form',
        description: null,
        fromDisposition: null,
        toDisposition: null,
        confidence: 'confirmed'
      },
      {
        fromRef: { kind: 'new', index: 0 },
        toRef: { kind: 'new', index: 1 },
        relation: 'ally_of',
        action: 'sever',
        description: null,
        fromDisposition: null,
        toDisposition: null,
        confidence: 'confirmed'
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
    expect(res2.proposal.fieldChanges).toEqual([])
  })
})

describe('import.service — dedup hardening (ADR-031)', () => {
  it('drops verbatim-duplicate notes (normalized + intra-batch) and flags near-duplicates for review', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const victor = createEntity(ctx, { campaignId, type: 'npc', name: 'Victor' })
    createNote(ctx, {
      campaignId,
      entityIds: [victor.id],
      content: 'Victor was hanged for a killing they shared.'
    })
    createNote(ctx, {
      campaignId,
      entityIds: [victor.id],
      content: 'Victor taught Alaeric to steal, scam, pickpocket, and pick locks'
    })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [
        // Verbatim (differs only by case/punctuation) → dropped outright.
        { content: 'victor was hanged for a killing they shared', entityRefs: [victor.id] },
        // Near-duplicate (one detail added) → kept but flagged so review defaults it OFF.
        {
          content: 'Victor taught Alaeric to steal, scam, pickpocket, and pick locks in Waterdeep',
          entityRefs: [victor.id]
        },
        // Genuinely new → kept, unflagged.
        { content: 'Mira vanished on the docks three years ago', entityRefs: [victor.id] },
        // Intra-batch duplicate of the previous → dropped.
        { content: 'Mira vanished on the docks, three years ago!', entityRefs: [victor.id] }
      ]
    })

    const res = await extract(ctx, { campaignId, text: 't' }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.notes).toHaveLength(2)
    expect(res.proposal.notes[0].possibleDuplicate).toBe(true)
    expect(res.proposal.notes[0].content).toMatch(/Waterdeep/)
    expect(res.proposal.notes[1].possibleDuplicate).toBeUndefined()
  })

  it('drops form proposals whose live tie already exists (either authoring direction); sever unaffected', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const mirna = createEntity(ctx, { campaignId, type: 'npc', name: 'Mirna' })
    const sildar = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar' })
    createLink(ctx, { campaignId, fromEntityId: aldric.id, toEntityId: mirna.id, relation: 'ally_of' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        { fromRef: aldric.id, toRef: mirna.id, relation: 'ally_of', action: 'form' }, // already live → dropped
        { fromRef: mirna.id, toRef: aldric.id, relation: 'ally_of', action: 'form' }, // inverse authoring → dropped
        { fromRef: aldric.id, toRef: sildar.id, relation: 'ally_of', action: 'form' }, // new tie → kept
        { fromRef: aldric.id, toRef: mirna.id, relation: 'ally_of', action: 'sever' } // sever → kept
      ]
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.relationshipChanges).toEqual([
      {
        fromRef: { kind: 'existing', entityId: aldric.id },
        toRef: { kind: 'existing', entityId: sildar.id },
        relation: 'ally_of',
        action: 'form',
        description: null,
        fromDisposition: null,
        toDisposition: null,
        confidence: 'confirmed'
      },
      {
        fromRef: { kind: 'existing', entityId: aldric.id },
        toRef: { kind: 'existing', entityId: mirna.id },
        relation: 'ally_of',
        action: 'sever',
        description: null,
        fromDisposition: null,
        toDisposition: null,
        confidence: 'confirmed'
      }
    ])
  })

  it('collapses direction-equivalent duplicates within one batch (symmetric + directed pairs)', async () => {
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
        { fromRef: '#0', toRef: '#1', relation: 'ally_of', action: 'form' },
        { fromRef: '#1', toRef: '#0', relation: 'ally_of', action: 'form' }, // same symmetric tie → collapsed
        { fromRef: '#0', toRef: inn.id, relation: 'located_in', action: 'form' },
        { fromRef: inn.id, toRef: '#0', relation: 'contains', action: 'form' } // same directed edge → collapsed
      ]
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.relationshipChanges).toHaveLength(2)
  })

  it('drops a status change equal to the entity’s current state (guaranteed no-op)', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Toblen', status: 'Alive' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [
        { entityRef: npc.id, lifecycle: npc.lifecycle, status: 'Alive' }, // current state → dropped
        { entityRef: npc.id, lifecycle: 'active', status: 'Wounded' } // real change → kept
      ],
      relationshipChanges: []
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.statusChanges).toHaveLength(1)
    expect(res.proposal.statusChanges[0].status).toBe('Wounded')
  })

  it('snaps statuses to the type’s canonical preset (label + explicit lifecycle) before the no-op drop', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const pc = createEntity(ctx, { campaignId, type: 'pc', name: 'Alaeric', status: 'Active' })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Toblen', status: 'Alive' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [
        // Lowercase variant of the current preset → normalized "Active" → equals current → dropped.
        { entityRef: pc.id, lifecycle: 'active', status: 'active' },
        // Preset wins over a contradictory model lifecycle: "dead" → "Dead" + ended.
        { entityRef: pc.id, lifecycle: 'active', status: 'dead' },
        // Presets are the ONLY path to presumed_ended — the heuristic never derives it (ADR-021).
        { entityRef: npc.id, status: 'missing' },
        // Genuinely novel status stays free text with the model's lifecycle.
        { entityRef: npc.id, lifecycle: 'active', status: 'Wounded' }
      ],
      relationshipChanges: []
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.statusChanges).toEqual([
      { entityRef: { kind: 'existing', entityId: pc.id }, lifecycle: 'ended', status: 'Dead' },
      { entityRef: { kind: 'existing', entityId: npc.id }, lifecycle: 'presumed_ended', status: 'Missing' },
      { entityRef: { kind: 'existing', entityId: npc.id }, lifecycle: 'active', status: 'Wounded' }
    ])
  })

  it('normalizes a proposed entity’s baseline status to the canonical preset casing', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    extractFn.mockResolvedValue({
      entities: [{ type: 'npc', name: 'Sildar', status: 'alive' }],
      notes: []
    })
    const res = await extract(ctx, { campaignId, text: 't' }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.entities[0].status).toBe('Alive')
  })

  it('drops scalar field no-ops: alter/add to the current value, cut of an empty key', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const nothic = createEntity(ctx, {
      campaignId,
      type: 'creature',
      name: 'Nothic',
      attributes: { weakness: 'daylight' }
    })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [],
      fieldChanges: [
        { entityRef: nothic.id, field: 'weakness', op: 'alter', value: 'daylight', oldValue: '' }, // no-op → dropped
        { entityRef: nothic.id, field: 'weakness', op: 'add', value: 'daylight', oldValue: '' }, // no-op → dropped
        { entityRef: nothic.id, field: 'habitat', op: 'cut', value: '', oldValue: '' }, // nothing to clear → dropped
        { entityRef: nothic.id, field: 'weakness', op: 'alter', value: 'fire', oldValue: '' } // real change → kept
      ]
    })

    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.fieldChanges).toHaveLength(1)
    expect(res.proposal.fieldChanges[0].value).toBe('fire')
  })
})

describe('import.service — tie enrichment (ADR-033)', () => {
  it('carries description + directional disposition + confidence on form ties; ignores them on sever', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const b = createEntity(ctx, { campaignId, type: 'npc', name: 'Mira' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        {
          fromRef: a.id,
          toRef: b.id,
          relation: 'related_to',
          action: 'form',
          description: 'siblings from the dock ward',
          fromDisposition: 'protective, guilty',
          toDisposition: 'adoring',
          confidence: 'rumored'
        },
        // A sever carries no enrichment; confidence normalizes to confirmed.
        {
          fromRef: a.id,
          toRef: b.id,
          relation: 'ally_of',
          action: 'sever',
          description: 'ignored',
          fromDisposition: 'ignored',
          confidence: 'suspected'
        }
      ]
    })
    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [form, sever] = res.proposal.relationshipChanges
    expect(form).toMatchObject({
      description: 'siblings from the dock ward',
      fromDisposition: 'protective, guilty',
      toDisposition: 'adoring',
      confidence: 'rumored'
    })
    expect(sever).toMatchObject({
      action: 'sever',
      description: null,
      fromDisposition: null,
      toDisposition: null,
      confidence: 'confirmed'
    })
  })

  it('snaps an invalid confidence to confirmed', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'A' })
    const b = createEntity(ctx, { campaignId, type: 'npc', name: 'B' })
    extractFn.mockResolvedValue({
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        { fromRef: a.id, toRef: b.id, relation: 'knows', action: 'form', confidence: 'definitely' }
      ]
    })
    const res = await extract(ctx, { campaignId, text: 't', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.relationshipChanges[0].confidence).toBe('confirmed')
  })
})

describe('import.service — changeset v2 field changes (ADR-028)', () => {
  it('validates field changes: add/cut/alter on lists + attributes; drops #index, off-profile, unmatched', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const glasstaff = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      traits: ['Cautious'],
      goals: ['Guard the manor']
    })
    const nothic = createEntity(ctx, {
      campaignId,
      type: 'creature',
      name: 'Nothic',
      attributes: { weakness: 'daylight', abilities: ['Rotting Gaze'] }
    })
    extractFn.mockResolvedValue({
      entities: [{ type: 'npc', name: 'A Newcomer' }], // makes '#0' a real proposed (new) ref
      notes: [],
      statusChanges: [],
      relationshipChanges: [],
      fieldChanges: [
        { entityRef: glasstaff.id, field: 'traits', op: 'add', value: 'Reckless', oldValue: '' }, // keep
        { entityRef: glasstaff.id, field: 'traits', op: 'alter', value: 'Wary', oldValue: 'Cautious' }, // keep
        { entityRef: glasstaff.id, field: 'traits', op: 'cut', value: '', oldValue: 'Nonexistent' }, // drop: unmatched
        { entityRef: glasstaff.id, field: 'flaws', op: 'add', value: 'Greedy', oldValue: '' }, // keep: npc has flaws
        { entityRef: nothic.id, field: 'goals', op: 'add', value: 'Escape', oldValue: '' }, // drop: creature has no goals
        { entityRef: nothic.id, field: 'weakness', op: 'alter', value: 'fire', oldValue: '' }, // keep: scalar set
        { entityRef: nothic.id, field: 'abilities', op: 'add', value: 'Reality Warp', oldValue: '' }, // keep: list add
        { entityRef: nothic.id, field: 'abilities', op: 'cut', value: '', oldValue: 'Missing' }, // drop: unmatched item
        { entityRef: '#0', field: 'traits', op: 'add', value: 'Brave', oldValue: '' } // drop: existing-only
      ]
    })

    const res = await extract(ctx, { campaignId, text: 'Glasstaff and the Nothic', withChanges: true }, sig())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.fieldChanges).toEqual([
      { entityRef: { kind: 'existing', entityId: glasstaff.id }, field: 'traits', op: 'add', value: 'Reckless', oldValue: null },
      { entityRef: { kind: 'existing', entityId: glasstaff.id }, field: 'traits', op: 'alter', value: 'Wary', oldValue: 'Cautious' },
      { entityRef: { kind: 'existing', entityId: glasstaff.id }, field: 'flaws', op: 'add', value: 'Greedy', oldValue: null },
      { entityRef: { kind: 'existing', entityId: nothic.id }, field: 'weakness', op: 'alter', value: 'fire', oldValue: null },
      { entityRef: { kind: 'existing', entityId: nothic.id }, field: 'abilities', op: 'add', value: 'Reality Warp', oldValue: null }
    ])
  })
})
