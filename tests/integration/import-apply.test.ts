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
import { createEntity, listEntities } from '../../src/main/services/entity.service'
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
          include: true
        },
        { content: 'left out', entityRefs: [{ kind: 'new', index: 0 }], tags: [], include: false }
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
