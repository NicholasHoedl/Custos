import { describe, it, expect, vi, beforeEach } from 'vitest'

// applyChangeset against a REAL in-memory DB; spy on the fire-and-forget embedding so we can assert it
// runs once per created item AFTER commit (and not at all on rollback).
const { indexEntityFn, indexNoteFn } = vi.hoisted(() => ({
  indexEntityFn: vi.fn(),
  indexNoteFn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../src/main/services/embedding-index.service', () => ({
  indexEntity: indexEntityFn,
  indexNote: indexNoteFn,
  backfill: vi.fn()
}))

import type { ConfirmedChangeset } from '@shared/import-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, getEntity, listEntities } from '../../src/main/services/entity.service'
import { createLink, listForEntity } from '../../src/main/services/link.service'
import { getEntityHistory, stateAsOf } from '../../src/main/services/chronology.service'
import { listNotesForEntity, listNotesForSession } from '../../src/main/services/note.service'
import { BruteForceVectorStore } from '../../src/main/services/vector-store.service'
import { applyChangeset } from '../../src/main/services/import.service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('import.service — applyChangeset', () => {
  it('creates entities then notes, resolves refs, links onto existing, attaches the session', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const phandalin = createEntity(ctx, { campaignId, type: 'location', name: 'Phandalin' })

    const payload: ConfirmedChangeset = {
      campaignId,
      sessionId: session.id,
      entities: [
        { index: 0, action: 'create', type: 'npc', name: 'Sister Garaele', attributes: { race: 'Elf' } },
        { index: 1, action: 'link', type: 'location', name: 'Phandalin', linkToEntityId: phandalin.id }
      ],
      notes: [
        {
          content: 'Garaele lives in Phandalin',
          entityRefs: [
            { kind: 'new', index: 0 },
            { kind: 'existing', entityId: phandalin.id }
          ],
          tags: ['npc'],
          confidence: 'confirmed',
          include: true
        },
        {
          content: 'left out',
          entityRefs: [{ kind: 'new', index: 0 }],
          tags: [],
          confidence: 'confirmed',
          include: false
        }
      ]
    }

    const result = applyChangeset(ctx, store, payload)

    expect(result.createdEntityIds).toHaveLength(1) // only the npc; the location was linked
    expect(result.linkedEntityIds).toEqual([phandalin.id])
    expect(result.createdNoteIds).toHaveLength(1) // the excluded note was skipped

    const npcs = listEntities(ctx, campaignId, 'npc')
    const garaele = npcs.find((e) => e.name === 'Sister Garaele')
    expect(garaele).toBeTruthy()
    expect(garaele!.attributes.race).toBe('Elf')

    const sessionNotes = listNotesForSession(ctx, session.id)
    expect(sessionNotes).toHaveLength(1)
    expect([...sessionNotes[0].entityIds].sort()).toEqual([garaele!.id, phandalin.id].sort())

    // embeddings queued post-commit: once per created entity + note (the linked entity isn't re-indexed)
    expect(indexEntityFn).toHaveBeenCalledTimes(1)
    expect(indexNoteFn).toHaveBeenCalledTimes(1)
  })

  it('rolls back the whole batch when a write fails and queues no embeddings', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id

    const payload: ConfirmedChangeset = {
      campaignId,
      sessionId: null,
      entities: [{ index: 0, action: 'create', type: 'npc', name: 'Created First' }],
      // a note pointing at a non-existent entity id → FK violation when its note_entity row inserts
      notes: [
        {
          content: 'bad',
          entityRefs: [{ kind: 'existing', entityId: 'does-not-exist' }],
          tags: [],
          confidence: 'confirmed',
          include: true
        }
      ]
    }

    expect(() => applyChangeset(ctx, store, payload)).toThrow()
    // the entity created before the failing note is rolled back with the transaction
    expect(listEntities(ctx, campaignId, 'npc')).toHaveLength(0)
    // the post-commit embedding loop never ran
    expect(indexEntityFn).not.toHaveBeenCalled()
    expect(indexNoteFn).not.toHaveBeenCalled()
  })
})

describe('import.service — applyChangeset v2 (backfill changes, ADR-018)', () => {
  it('PAYOFF: a backfilled baseline + dated changes make the past as-of-queryable', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s1 = createSession(ctx, { campaignId }) // 1
    createSession(ctx, { campaignId }) // 2
    createSession(ctx, { campaignId }) // 3
    createSession(ctx, { campaignId }) // 4
    const s5 = createSession(ctx, { campaignId }) // 5
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })

    // One session-5 batch: Duke first appeared in session 1 (baseline), was slain in session 5, and
    // moved into the manor in session 5.
    const result = applyChangeset(ctx, store, {
      campaignId,
      sessionId: s5.id,
      entities: [
        {
          index: 0,
          action: 'create',
          type: 'npc',
          name: 'Duke Halric',
          status: 'Alive and well',
          sessionId: s1.id // intro session ≠ batch session
        }
      ],
      notes: [],
      statusChanges: [
        { entityRef: { kind: 'new', index: 0 }, lifecycle: 'ended', status: 'Slain', include: true }
      ],
      relationshipChanges: [
        {
          fromRef: { kind: 'new', index: 0 },
          toRef: { kind: 'existing', entityId: manor.id },
          relation: 'located_in',
          action: 'form',
          include: true
        }
      ]
    })

    expect(result.statusChangesApplied).toBe(1)
    expect(result.relationshipChangesApplied).toBe(1)
    const duke = listEntities(ctx, campaignId, 'npc')[0]

    // Present: dead, in the manor.
    expect(getEntity(ctx, duke.id)?.lifecycle).toBe('ended')
    expect(getEntity(ctx, duke.id)?.status).toBe('Slain')
    // As of session 3: alive (baseline at 1), and NOT yet in the manor (interval opens at 5).
    expect(stateAsOf(ctx, duke.id, 3)).toEqual({ lifecycle: 'active', status: 'Alive and well' })
    expect(listForEntity(ctx, duke.id, 3)).toHaveLength(0)
    // As of session 6: dead, in the manor.
    expect(stateAsOf(ctx, duke.id, 6)).toEqual({ lifecycle: 'ended', status: 'Slain' })
    expect(listForEntity(ctx, duke.id, 6)).toHaveLength(1)
  })

  it('severs the matching open edge at the batch session; a missing edge is skipped, not fatal', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createSession(ctx, { campaignId }) // 1
    const s2 = createSession(ctx, { campaignId }) // 2
    createSession(ctx, { campaignId }) // 3
    const s4 = createSession(ctx, { campaignId }) // 4
    const aldric = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const mirna = createEntity(ctx, { campaignId, type: 'npc', name: 'Mirna' })
    const sildar = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar' })
    createLink(ctx, {
      campaignId,
      fromEntityId: aldric.id,
      toEntityId: mirna.id,
      relation: 'ally_of',
      sessionId: s2.id
    })

    const result = applyChangeset(ctx, store, {
      campaignId,
      sessionId: s4.id,
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        {
          fromRef: { kind: 'existing', entityId: mirna.id }, // inverse authoring direction still matches
          toRef: { kind: 'existing', entityId: aldric.id },
          relation: 'ally_of',
          action: 'sever',
          include: true
        },
        {
          fromRef: { kind: 'existing', entityId: aldric.id },
          toRef: { kind: 'existing', entityId: sildar.id },
          relation: 'ally_of', // no such live edge between these two → skipped
          action: 'sever',
          include: true
        }
      ]
    })

    expect(result.relationshipChangesApplied).toBe(1)
    expect(result.skipped.some((s) => s.kind === 'change' && /no live/.test(s.reason))).toBe(true)
    expect(listForEntity(ctx, aldric.id)).toHaveLength(0) // live view: severed
    expect(listForEntity(ctx, aldric.id, 3)).toHaveLength(1) // as of 3: still allied
  })

  it('re-applying a batch is harmless: one open interval, unchanged reconstruction', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s1 = createSession(ctx, { campaignId })
    const inn = createEntity(ctx, { campaignId, type: 'location', name: 'Stonehill Inn' })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'Toblen' })

    const payload: ConfirmedChangeset = {
      campaignId,
      sessionId: s1.id,
      entities: [],
      notes: [],
      statusChanges: [
        { entityRef: { kind: 'existing', entityId: npc.id }, lifecycle: 'active', status: 'Busy', include: true }
      ],
      relationshipChanges: [
        {
          fromRef: { kind: 'existing', entityId: npc.id },
          toRef: { kind: 'existing', entityId: inn.id },
          relation: 'located_in',
          action: 'form',
          include: true
        }
      ]
    }
    applyChangeset(ctx, store, payload)
    applyChangeset(ctx, store, payload) // re-run (e.g. a resumed sitting re-applies)

    expect(listForEntity(ctx, npc.id)).toHaveLength(1) // still exactly one live edge (idempotent form)
    expect(stateAsOf(ctx, npc.id, 5)).toEqual({ lifecycle: 'active', status: 'Busy' })
  })
})

describe('import.service — applyChangeset undated batch (pre-campaign background, ADR-030)', () => {
  it('an explicit null session applies as PRE-TRACKING: baselines + ties predate session 1; notes undated', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createSession(ctx, { campaignId }) // 1
    createSession(ctx, { campaignId }) // 2 — the old latest-session fallback would have stamped here
    const mc = createEntity(ctx, { campaignId, type: 'pc', name: 'Alaeric' })

    applyChangeset(ctx, store, {
      campaignId,
      sessionId: null, // undated: backstory material predates the campaign
      entities: [{ index: 0, action: 'create', type: 'npc', name: 'Victor' }],
      notes: [
        {
          content: 'Victor taught Alaeric everything he knows',
          entityRefs: [{ kind: 'new', index: 0 }],
          tags: [],
          confidence: 'confirmed',
          include: true
        }
      ],
      statusChanges: [],
      relationshipChanges: [
        {
          fromRef: { kind: 'existing', entityId: mc.id },
          toRef: { kind: 'new', index: 0 },
          relation: 'ally_of',
          action: 'form',
          include: true
        }
      ]
    })

    const victor = listEntities(ctx, campaignId, 'npc')[0]
    // Baseline is pre-tracking (since NULL) — NOT stamped at the latest session.
    expect(getEntityHistory(ctx, victor.id)[0].sinceSessionNumber).toBeNull()
    // The tie is a pre-tracking interval: already live as of session 1.
    expect(listForEntity(ctx, mc.id, 1)).toHaveLength(1)
    // The note is undated (timeless under as-of).
    expect(listNotesForEntity(ctx, victor.id)[0].sessionId).toBeNull()
  })
})

describe('import.service — applyChangeset status presets (ADR-031 as-built)', () => {
  it('a created entity whose status matches a preset adopts the preset lifecycle (npc "Missing" → presumed lost)', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id

    applyChangeset(ctx, store, {
      campaignId,
      sessionId: null,
      entities: [{ index: 0, action: 'create', type: 'npc', name: 'Mira', status: 'Missing' }],
      notes: []
    })

    const mira = listEntities(ctx, campaignId, 'npc')[0]
    // The heuristic can never derive presumed_ended (ADR-021) — the preset's explicit lifecycle must win.
    expect(mira.lifecycle).toBe('presumed_ended')
    expect(mira.status).toBe('Missing')
  })
})

describe('import.service — applyChangeset field changes (ADR-028)', () => {
  it('applies add/cut/alter to lists + attributes, compounding within the batch; skips excluded + missing', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const glasstaff = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      traits: ['Cautious'],
      flaws: []
    })
    const nothic = createEntity(ctx, {
      campaignId,
      type: 'creature',
      name: 'Nothic',
      attributes: { weakness: 'daylight', abilities: ['Rotting Gaze'] }
    })
    const ex = (entityId: string) => ({ kind: 'existing' as const, entityId })

    const result = applyChangeset(ctx, store, {
      campaignId,
      sessionId: null,
      entities: [],
      notes: [],
      fieldChanges: [
        { entityRef: ex(glasstaff.id), field: 'traits', op: 'add', value: 'Reckless', oldValue: null, include: true },
        { entityRef: ex(glasstaff.id), field: 'traits', op: 'alter', value: 'Wary', oldValue: 'Cautious', include: true }, // compounds
        { entityRef: ex(glasstaff.id), field: 'flaws', op: 'add', value: 'Greedy', oldValue: null, include: true },
        { entityRef: ex(nothic.id), field: 'weakness', op: 'alter', value: 'fire', oldValue: null, include: true }, // scalar set
        { entityRef: ex(nothic.id), field: 'abilities', op: 'add', value: 'Reality Warp', oldValue: null, include: true },
        { entityRef: ex(nothic.id), field: 'abilities', op: 'cut', value: null, oldValue: 'Rotting Gaze', include: true }, // compounds
        { entityRef: ex(glasstaff.id), field: 'traits', op: 'add', value: 'Excluded', oldValue: null, include: false }, // not applied
        { entityRef: ex('does-not-exist'), field: 'traits', op: 'add', value: 'X', oldValue: null, include: true } // skipped
      ]
    })

    expect(result.fieldChangesApplied).toBe(6)
    expect(result.skipped.some((s) => s.kind === 'change' && /field change/.test(s.reason))).toBe(true)

    const g = getEntity(ctx, glasstaff.id)!
    expect(g.traits).toEqual(['Wary', 'Reckless']) // Cautious→Wary after Reckless appended (re-read compounds)
    expect(g.flaws).toEqual(['Greedy'])
    const n = getEntity(ctx, nothic.id)!
    expect(n.attributes.weakness).toBe('fire')
    expect(n.attributes.abilities).toEqual(['Reality Warp']) // Rotting Gaze cut after Reality Warp added
  })
})

describe('import.service — applyChangeset (Illuminate payload, ADR-035)', () => {
  it('applies a rel+field-only changeset stamped at session N: ties open at N, description hits the real column', () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createSession(ctx, { campaignId }) // Session 1
    const s2 = createSession(ctx, { campaignId }) // Session 2 — the enriched session
    const glasstaff = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      description: 'A wizard.',
      traits: ['Cautious']
    })
    const redbrands = createEntity(ctx, { campaignId, type: 'faction', name: 'The Redbrands' })
    const ex = (entityId: string) => ({ kind: 'existing' as const, entityId })

    const payload: ConfirmedChangeset = {
      campaignId,
      sessionId: s2.id,
      entities: [],
      notes: [],
      statusChanges: [],
      relationshipChanges: [
        {
          fromRef: ex(glasstaff.id),
          toRef: ex(redbrands.id),
          relation: 'member_of',
          action: 'form',
          include: true,
          description: 'secretly leads them',
          fromDisposition: 'possessive',
          toDisposition: 'loyal',
          confidence: 'confirmed'
        }
      ],
      fieldChanges: [
        {
          entityRef: ex(glasstaff.id),
          field: 'description',
          op: 'alter',
          value: 'Iarno Albrek in disguise, leading the Redbrands.',
          oldValue: null,
          include: true
        },
        { entityRef: ex(glasstaff.id), field: 'traits', op: 'add', value: 'Duplicitous', oldValue: null, include: true }
      ]
    }

    const result = applyChangeset(ctx, store, payload)
    expect(result.relationshipChangesApplied).toBe(1)
    expect(result.fieldChangesApplied).toBe(2)
    expect(result.createdEntityIds).toHaveLength(0)
    expect(result.createdNoteIds).toHaveLength(0)

    // The tie opens its interval AT the enriched session (decision #6): live at 2, absent at 1.
    const at2 = listForEntity(ctx, glasstaff.id, 2)
    expect(at2).toHaveLength(1)
    expect(at2[0].link.startSessionNumber).toBe(2)
    expect(at2[0].link.description).toBe('secretly leads them')
    expect(listForEntity(ctx, glasstaff.id, 1)).toHaveLength(0)

    // F1 regression: description writes the REAL column, never the attributes bag.
    const g = getEntity(ctx, glasstaff.id)!
    expect(g.description).toBe('Iarno Albrek in disguise, leading the Redbrands.')
    expect(g.attributes.description).toBeUndefined()
    expect(g.traits).toEqual(['Cautious', 'Duplicitous'])

    // Re-apply is idempotent for the tie (createLink returns the live edge; no duplicate interval).
    applyChangeset(ctx, store, payload)
    expect(listForEntity(ctx, glasstaff.id)).toHaveLength(1)
  })
})
