import { describe, it, expect, vi, beforeEach } from 'vitest'

// D2 (audit follow-up): lock in the capture loop's core safety guarantee — "re-running is dedup-safe"
// (ADR-031). The dedup lives in `extract()`'s validateExtraction + the shared change validators, NOT in
// applyChangeset, so each test does the real round-trip: propose → apply → propose again, and asserts the
// second pass comes back empty. The model boundary is stubbed for determinism; everything else is REAL.
const { indexEntityFn, indexNoteFn, extractFn, enrichFn } = vi.hoisted(() => ({
  indexEntityFn: vi.fn(),
  indexNoteFn: vi.fn(),
  extractFn: vi.fn(),
  enrichFn: vi.fn()
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
vi.mock('../../src/main/services/settings.service', () => ({
  getSettings: () => ({
    extractionModel: 'claude-sonnet-4-6',
    extractionEffort: 'medium',
    illuminateModel: 'claude-haiku-4-5-20251001',
    illuminateEffort: 'medium'
  })
}))
vi.mock('../../src/main/services/ai-util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/services/ai-util')>()),
  isOnline: async () => true // keep the real classifyError; only bypass the network probe
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/services/claude.service')>()),
  isAvailable: () => true,
  extractChangeset: extractFn,
  enrichChangeset: enrichFn
}))

import type { ConfirmedChangeset, RawExtraction } from '@shared/import-types'
import type { RawEnrichment } from '@shared/enrich-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, getEntity } from '../../src/main/services/entity.service'
import { listForEntity } from '../../src/main/services/link.service'
import { listNotesForSession } from '../../src/main/services/note.service'
import { BruteForceVectorStore } from '../../src/main/services/vector-store.service'
import { applyChangeset, extract } from '../../src/main/services/import.service'
import { enrichEntity } from '../../src/main/services/enrich.service'

const signal = new AbortController().signal

beforeEach(() => vi.clearAllMocks())

describe('capture-loop idempotency (ADR-031: re-running yields a near-empty changeset)', () => {
  it('re-extracting the same log drops the verbatim note AND the status no-op → empty', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const sildar = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar Hallwinter' })

    // A note tagging an EXISTING entity + a status change on it — no NEW entity, so a clean re-run is
    // wholly empty (an entity would re-propose as a link-match; that case is covered separately below).
    const raw: RawExtraction = {
      entities: [],
      notes: [
        { content: 'Sildar fell defending the road.', entityRefs: [sildar.id], confidence: 'confirmed' }
      ],
      statusChanges: [{ entityRef: sildar.id, status: 'Dead' }]
    }
    extractFn.mockResolvedValue(raw)

    // First pass: propose + apply.
    const first = await extract(ctx, { campaignId, text: 'Sildar died.', mode: 'capture' }, signal)
    if (!first.ok) throw new Error(`first extract failed: ${first.reason}`)
    expect(first.proposal.notes).toHaveLength(1)
    expect(first.proposal.statusChanges).toHaveLength(1)

    applyChangeset(ctx, store, {
      campaignId,
      sessionId: session.id,
      entities: [],
      notes: first.proposal.notes.map((n) => ({ ...n, include: true })),
      statusChanges: first.proposal.statusChanges.map((s) => ({ ...s, include: true }))
    } as ConfirmedChangeset)
    expect(listNotesForSession(ctx, session.id)).toHaveLength(1)
    expect(getEntity(ctx, sildar.id)!.status).toBe('Dead')

    // Second pass, identical log: the note is a verbatim duplicate (dropped) and the status is a no-op
    // (dropped) → the whole extraction is empty. This IS the dedup guarantee.
    const second = await extract(ctx, { campaignId, text: 'Sildar died.', mode: 'capture' }, signal)
    expect(second).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('a re-created entity re-proposes as a link-match, not a duplicate', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })

    const raw: RawExtraction = {
      entities: [{ type: 'npc', name: 'Aldric Vane', description: 'A wary tavern-keeper.' }],
      notes: [{ content: 'Met Aldric; struck a deal.', entityRefs: ['#0'], confidence: 'confirmed' }],
      statusChanges: []
    }
    extractFn.mockResolvedValue(raw)

    const first = await extract(ctx, { campaignId, text: 'Met Aldric.', mode: 'capture' }, signal)
    if (!first.ok) throw new Error(`first extract failed: ${first.reason}`)
    applyChangeset(ctx, store, {
      campaignId,
      sessionId: session.id,
      entities: [{ index: 0, action: 'create', type: 'npc', name: 'Aldric Vane' }],
      notes: [
        {
          content: 'Met Aldric; struck a deal.',
          entityRefs: [{ kind: 'new', index: 0 }],
          tags: [],
          confidence: 'confirmed',
          include: true
        }
      ]
    } as ConfirmedChangeset)

    // Re-extract: the note drops (verbatim dup); the entity still surfaces, but with a ≥0.9 existing match
    // so the review defaults to LINK, never a duplicate create.
    const second = await extract(ctx, { campaignId, text: 'Met Aldric.', mode: 'capture' }, signal)
    if (!second.ok) throw new Error(`second extract unexpectedly failed: ${second.reason}`)
    expect(second.proposal.notes).toHaveLength(0)
    expect(second.proposal.entities).toHaveLength(1)
    expect(second.proposal.entities[0].matches[0]?.score ?? 0).toBeGreaterThanOrEqual(0.9)
  })

  it('re-illuminating drops the live tie and the already-present field add', async () => {
    const ctx = makeTestDb()
    const store = new BruteForceVectorStore(ctx)
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const sildar = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar Hallwinter' })
    const glasstaff = createEntity(ctx, { campaignId, type: 'npc', name: 'Glasstaff' })

    const raw: RawEnrichment = {
      relationshipChanges: [
        { fromRef: sildar.id, toRef: glasstaff.id, relation: 'ally_of', action: 'form', description: 'sworn allies' }
      ],
      fieldChanges: [{ entityRef: sildar.id, field: 'traits', op: 'add', value: 'Brave' }]
    }
    enrichFn.mockResolvedValue(raw)

    // First pass: propose + apply the tie + field.
    const first = await enrichEntity(ctx, { campaignId, sessionId: session.id, entityId: sildar.id }, signal)
    if (!first.ok) throw new Error(`first enrich failed: ${first.reason}`)
    expect(first.relationshipChanges).toHaveLength(1)
    expect(first.fieldChanges).toHaveLength(1)

    applyChangeset(ctx, store, {
      campaignId,
      sessionId: session.id,
      entities: [],
      notes: [],
      relationshipChanges: first.relationshipChanges.map((rc) => ({ ...rc, include: true })),
      fieldChanges: first.fieldChanges.map((fc) => ({ ...fc, include: true }))
    } as ConfirmedChangeset)
    expect(listForEntity(ctx, sildar.id)).toHaveLength(1)
    expect(getEntity(ctx, sildar.id)!.traits).toContain('Brave')

    // Second pass: the tie is live (dropped by findOpenLink) and the trait is present (add-when-present
    // dropped) → an empty enrichment, the expected steady-state of a re-run sweep.
    const second = await enrichEntity(ctx, { campaignId, sessionId: session.id, entityId: sildar.id }, signal)
    if (!second.ok) throw new Error(`second enrich failed: ${second.reason}`)
    expect(second.relationshipChanges).toHaveLength(0)
    expect(second.fieldChanges).toHaveLength(0)
  })
})
