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
import { stateAsOf } from '../../src/main/services/chronology.service'
import { listNotesForSession } from '../../src/main/services/note.service'
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
