import { eq } from 'drizzle-orm'
import type { CampaignExport } from '@shared/export-types'
import { CAMPAIGN_EXPORT_VERSION } from '@shared/export-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { serializeArray, serializeObject } from './serialize'
import { sourceHash } from './persona.service'

// Campaign IMPORT (ROADMAP P0-2) — the missing half of export.service. Restores a CampaignExport JSON
// into the live DB in ONE transaction, preserving ids + timestamps verbatim (chronology is
// session-number-stamped and numbers travel together inside a file, so nothing needs renumbering on
// import; the only in-app renumber is session.service.insertSessionBefore's uniform shift, ADR-062).
// UUIDs never collide across machines; the only
// realistic collision is re-importing a campaign that still exists, which is rejected by id up front.
// Rows are inserted in FK dependency order with runtime foreign_keys=ON as the net; the guards below
// additionally drop rows whose referents are missing from a hand-edited/corrupt file rather than
// aborting the whole restore. Embeddings are not in the file — the caller fires the backfill after.

export interface ImportedCampaign {
  campaignId: string
  name: string
  counts: { sessions: number; entities: number; notes: number; links: number; events: number }
}

/** Insert in slices — very large campaigns would otherwise overflow SQLite's bound-variable limit. */
function chunked<T>(rows: T[], run: (slice: T[]) => void, size = 50): void {
  for (let i = 0; i < rows.length; i += size) run(rows.slice(i, i + size))
}

/** Structural validation with user-readable failures — this parses files from disk, not our own calls. */
function assertShape(raw: unknown): CampaignExport {
  const bad = (): never => {
    throw new Error('This file is not a Custos campaign export.')
  }
  if (typeof raw !== 'object' || raw === null) bad()
  const d = raw as Partial<CampaignExport>
  if (typeof d.version !== 'number') bad()
  if (d.version !== CAMPAIGN_EXPORT_VERSION) {
    throw new Error(
      `This export is version ${d.version}; this build of Custos reads version ${CAMPAIGN_EXPORT_VERSION}.`
    )
  }
  if (typeof d.campaign !== 'object' || d.campaign === null) bad()
  if (typeof d.campaign!.id !== 'string' || typeof d.campaign!.name !== 'string') bad()
  for (const key of [
    'sessions',
    'entities',
    'statusHistory',
    'notes',
    'entityLinks',
    'eventLog',
    'personae'
  ] as const) {
    if (!Array.isArray(d[key])) bad()
  }
  return d as CampaignExport
}

export function importCampaign(ctx: DbContext, raw: unknown): ImportedCampaign {
  const data = assertShape(raw)
  const c = data.campaign

  const existing = ctx.drizzle
    .select({ id: schema.campaign.id })
    .from(schema.campaign)
    .where(eq(schema.campaign.id, c.id))
    .get()
  if (existing) {
    throw new Error(
      `"${c.name}" is already in your library — delete that campaign first to restore it from this file.`
    )
  }

  // FK-safety guards for hand-edited files: referents must exist or the row is skipped/nulled.
  const entityIds = new Set(data.entities.map((e) => e.id))
  const sessionIds = new Set(data.sessions.map((s) => s.id))
  const links = data.entityLinks.filter(
    (l) => entityIds.has(l.fromEntityId) && entityIds.has(l.toEntityId)
  )
  const history = data.statusHistory.filter((h) => entityIds.has(h.entityId))
  const events = data.eventLog.filter((ev) => sessionIds.has(ev.sessionId))
  const personae = data.personae.filter((p) => entityIds.has(p.entityId))
  const entityById = new Map(data.entities.map((e) => [e.id, e]))

  ctx.drizzle.transaction((tx) => {
    // Campaign first with the MC deferred — the campaign→entity FK is a benign cycle (schema.ts).
    tx.insert(schema.campaign)
      .values({
        id: c.id,
        name: c.name,
        description: c.description,
        mainCharacterId: null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      })
      .run()

    chunked(data.entities, (slice) =>
      tx
        .insert(schema.entity)
        .values(
          slice.map((e) => ({
            id: e.id,
            campaignId: c.id, // forced — a corrupt file must not write rows into another campaign
            type: e.type,
            name: e.name,
            description: e.description,
            image: e.image,
            traits: serializeArray(e.traits),
            goals: serializeArray(e.goals),
            flaws: serializeArray(e.flaws),
            voiceExamples: serializeArray(e.voiceExamples),
            attributes: serializeObject(e.attributes),
            status: e.status,
            lifecycle: e.lifecycle,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt
          }))
        )
        .run()
    )

    if (c.mainCharacterId && entityIds.has(c.mainCharacterId)) {
      tx.update(schema.campaign)
        .set({ mainCharacterId: c.mainCharacterId })
        .where(eq(schema.campaign.id, c.id))
        .run()
    }

    chunked(data.sessions, (slice) =>
      tx
        .insert(schema.session)
        .values(slice.map((s) => ({ ...s, campaignId: c.id })))
        .run()
    )

    chunked(data.notes, (slice) =>
      tx
        .insert(schema.note)
        .values(
          slice.map((n) => ({
            id: n.id,
            campaignId: c.id,
            sessionId: n.sessionId && sessionIds.has(n.sessionId) ? n.sessionId : null,
            content: n.content,
            tags: serializeArray(n.tags),
            confidence: n.confidence,
            createdAt: n.createdAt
          }))
        )
        .run()
    )
    const junction = data.notes.flatMap((n) =>
      n.entityIds
        .filter((id) => entityIds.has(id))
        .map((entityId) => ({ noteId: n.id, entityId, createdAt: n.createdAt }))
    )
    chunked(junction, (slice) => tx.insert(schema.noteEntity).values(slice).run())

    chunked(links, (slice) =>
      tx
        .insert(schema.entityLink)
        .values(slice.map((l) => ({ ...l, campaignId: c.id })))
        .run()
    )

    chunked(history, (slice) => tx.insert(schema.statusHistory).values(slice).run())

    chunked(events, (slice) =>
      tx
        .insert(schema.eventLog)
        .values(
          slice.map((ev) => ({
            ...ev,
            campaignId: c.id,
            entityId: ev.entityId && entityIds.has(ev.entityId) ? ev.entityId : null
          }))
        )
        .run()
    )

    // Personae: the export omits sourceHash — recompute against the just-imported entity so the
    // stale-detection invariant holds (persona.service.sourceHash is the single source of truth).
    chunked(personae, (slice) =>
      tx
        .insert(schema.pcPersona)
        .values(
          slice.map((p) => ({
            entityId: p.entityId,
            brief: p.brief,
            edited: p.edited ? 1 : 0,
            stale: p.stale ? 1 : 0,
            sourceHash: sourceHash(entityById.get(p.entityId)!),
            model: p.model,
            createdAt: p.updatedAt,
            updatedAt: p.updatedAt
          }))
        )
        .run()
    )
  })

  return {
    campaignId: c.id,
    name: c.name,
    counts: {
      sessions: data.sessions.length,
      entities: data.entities.length,
      notes: data.notes.length,
      links: links.length,
      events: events.length
    }
  }
}
