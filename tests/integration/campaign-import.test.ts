import { describe, it, expect, vi } from 'vitest'

// Campaign import (ROADMAP P0-2) round-trip against REAL in-memory DBs: seed → export → import into a
// FRESH db → export again → the two snapshots must be identical (ids + timestamps preserved verbatim).
// Arrays are order-normalized by id before comparing — list order can differ on created_at ties.

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../src/main/services/embedding-index.service', () => ({
  indexEntity: vi.fn(),
  indexNote: vi.fn(),
  backfill: vi.fn()
}))

import type { CampaignExport } from '@shared/export-types'
import * as schema from '../../src/main/db/schema'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign, getCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../src/main/services/entity.service'
import { createLink } from '../../src/main/services/link.service'
import { createNote } from '../../src/main/services/note.service'
import { createEvent } from '../../src/main/services/event.service'
import { getPersona } from '../../src/main/services/persona.service'
import { buildCampaignExport } from '../../src/main/services/export.service'
import { importCampaign } from '../../src/main/services/import-campaign.service'

/** Order-insensitive, time-insensitive view of a snapshot (exportedAt differs by definition). */
function normalized(x: CampaignExport): Omit<CampaignExport, 'exportedAt'> {
  const byId = <T extends { id: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id))
  return {
    version: x.version,
    campaign: x.campaign,
    sessions: byId(x.sessions),
    entities: byId(x.entities),
    statusHistory: byId(x.statusHistory),
    notes: byId(x.notes),
    entityLinks: byId(x.entityLinks),
    eventLog: byId(x.eventLog),
    personae: [...x.personae].sort((a, b) => a.entityId.localeCompare(b.entityId))
  }
}

function seed() {
  const ctx = makeTestDb()
  const campaign = createCampaign(ctx, { name: 'Lost Mine', mainCharacterName: 'Vex' })
  const s1 = createSession(ctx, { campaignId: campaign.id })
  const s2 = createSession(ctx, { campaignId: campaign.id })
  const gundren = createEntity(ctx, {
    campaignId: campaign.id,
    type: 'npc',
    name: 'Gundren',
    traits: ['gruff'],
    attributes: { race: 'Dwarf' }
  })
  const manor = createEntity(ctx, { campaignId: campaign.id, type: 'location', name: 'Manor' })
  // Status change ⇒ a dated status-history row beyond the creation baselines. The portrait (P2-2) is
  // set here too so the round-trip proves image survives export → import (the field-by-field values map).
  updateEntity(ctx, gundren.id, { status: 'Captured', image: 'data:image/jpeg;base64,PORTRAIT' })
  createLink(ctx, {
    campaignId: campaign.id,
    fromEntityId: gundren.id,
    toEntityId: manor.id,
    relation: 'located_in',
    description: 'held in the cellar'
  })
  createNote(ctx, {
    campaignId: campaign.id,
    entityIds: [gundren.id, manor.id],
    content: 'Gundren is held beneath the manor.',
    confidence: 'suspected',
    sessionId: s2.id
  })
  createNote(ctx, { campaignId: campaign.id, entityIds: [], content: 'Zero-entity campaign lore.' })
  createEvent(ctx, { sessionId: s1.id, content: 'We reached town.' })
  // A persona brief for the MC (seed hash is deliberately wrong — import must RECOMPUTE it).
  const mcId = getCampaign(ctx, campaign.id)!.mainCharacterId!
  ctx.drizzle
    .insert(schema.pcPersona)
    .values({
      entityId: mcId,
      brief: 'I am Vex, and I remember everything.',
      edited: 1,
      stale: 0,
      sourceHash: 'stale-seed-hash',
      model: 'claude-test',
      createdAt: 111,
      updatedAt: 222
    })
    .run()
  return { ctx, campaignId: campaign.id, mcId, gundrenId: gundren.id }
}

describe('import-campaign.service — round-trip', () => {
  it('export → import into a fresh DB → export again is identical (ids/timestamps verbatim)', () => {
    const { ctx, campaignId, mcId, gundrenId } = seed()
    const snapshot = buildCampaignExport(ctx, campaignId)
    // Simulate the file: what the handler JSON.parses is a plain-object clone.
    const fileContents: unknown = JSON.parse(JSON.stringify(snapshot))

    const fresh = makeTestDb()
    const res = importCampaign(fresh, fileContents)
    expect(res.campaignId).toBe(campaignId)
    expect(res.counts.entities).toBe(snapshot.entities.length)
    expect(res.counts.notes).toBe(snapshot.notes.length)

    const roundTripped = buildCampaignExport(fresh, campaignId)
    expect(normalized(roundTripped)).toEqual(normalized(snapshot))

    // The portrait (P2-2) rode through the field-by-field entity values map intact.
    expect(roundTripped.entities.find((e) => e.id === gundrenId)!.image).toBe(
      'data:image/jpeg;base64,PORTRAIT'
    )

    // MC survives the deferred-FK two-step, and the persona hash was recomputed (≠ the stale seed)
    // against the imported entity — the stale-detection invariant holds post-restore.
    expect(getCampaign(fresh, campaignId)!.mainCharacterId).toBe(mcId)
    const personaRow = fresh.drizzle
      .select()
      .from(schema.pcPersona)
      .all()
      .find((r) => r.entityId === mcId)!
    expect(personaRow.sourceHash).not.toBe('stale-seed-hash')
    expect(personaRow.sourceHash).toHaveLength(40) // sha1 hex
    expect(getPersona(fresh, mcId)?.brief).toBe('I am Vex, and I remember everything.')
  })

  it('rejects re-importing a campaign that still exists, by id', () => {
    const { ctx, campaignId } = seed()
    const snapshot = JSON.parse(JSON.stringify(buildCampaignExport(ctx, campaignId))) as unknown
    expect(() => importCampaign(ctx, snapshot)).toThrow(/already in your library/)
  })

  it('rejects unknown export versions and non-export files with readable messages', () => {
    const { ctx, campaignId } = seed()
    const snapshot = JSON.parse(JSON.stringify(buildCampaignExport(ctx, campaignId))) as Record<
      string,
      unknown
    >
    const fresh = makeTestDb()
    expect(() => importCampaign(fresh, { ...snapshot, version: 99 })).toThrow(/version 99/)
    expect(() => importCampaign(fresh, { nonsense: true })).toThrow(/not a Ledger campaign export/)
    expect(() => importCampaign(fresh, 'a string')).toThrow(/not a Ledger campaign export/)
  })

  it('drops rows whose referents are missing (hand-edited file) instead of aborting', () => {
    const { ctx, campaignId } = seed()
    const snapshot = JSON.parse(
      JSON.stringify(buildCampaignExport(ctx, campaignId))
    ) as CampaignExport
    // Corrupt: a link to a ghost entity + an event in a ghost session.
    snapshot.entityLinks.push({ ...snapshot.entityLinks[0], id: 'ghost-link', toEntityId: 'ghost' })
    snapshot.eventLog.push({ ...snapshot.eventLog[0], id: 'ghost-event', sessionId: 'ghost' })

    const fresh = makeTestDb()
    const res = importCampaign(fresh, snapshot)
    expect(res.counts.links).toBe(snapshot.entityLinks.length - 1)
    expect(res.counts.events).toBe(snapshot.eventLog.length - 1)
  })
})
