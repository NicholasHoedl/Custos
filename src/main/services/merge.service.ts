import { and, eq, or } from 'drizzle-orm'
import type { Entity } from '@shared/entity-types'
import type { RelationKey } from '@shared/relations'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { getEntity } from './entity.service'
import { getCampaign } from './campaign.service'
import { findOpenLink } from './link.service'

// Entity merge (ROADMAP P1-6) — RE-POINT ONLY. Extraction dedup (ADR-031) is prevention; this is the
// repair path for the duplicates that slip through anyway ("Sildar" vs "Sildar Hallwinter"). The LOSER's
// notes, relationships, chronology, and event refs move to the SURVIVOR, then the loser is deleted. The
// survivor's OWN profile fields are untouched (re-point only — decided), so nothing needs re-embedding
// (its embedded text is unchanged; the loser's embedding row cascades away on delete).
//
// The two hazards a naive re-point hits, and how this avoids them (both by LEAVING the colliding loser
// row in place so deleteEntity's FK cascade sweeps it — never an explicit pre-delete that could race the
// unique index):
//   • note_entity has a composite PK (noteId, entityId): re-pointing a note the survivor ALREADY tags
//     would duplicate the PK. We only move junctions for notes the survivor doesn't already tag.
//   • entity_link's partial unique index forbids two OPEN (from, to, relation) rows: re-pointing both
//     endpoints can make a self-loop or an open duplicate. We skip those; the cascade removes them.

export interface MergeRequest {
  survivorId: string
  loserId: string
}

export function mergeEntities(ctx: DbContext, req: MergeRequest): Entity {
  const { survivorId, loserId } = req
  if (survivorId === loserId) throw new Error('Cannot merge an entity into itself')
  const survivor = getEntity(ctx, survivorId)
  const loser = getEntity(ctx, loserId)
  if (!survivor) throw new Error(`Survivor entity ${survivorId} not found`)
  if (!loser) throw new Error(`Loser entity ${loserId} not found`)
  if (survivor.campaignId !== loser.campaignId) {
    throw new Error('Entities are in different campaigns')
  }

  const campaign = getCampaign(ctx, survivor.campaignId)
  const loserIsMainCharacter = campaign?.mainCharacterId === loserId
  // Carrying the main-character crown to the survivor requires a PC survivor (resolveMainCharacter's
  // invariant); merging the MC into a non-PC is almost certainly a mistake, so reject it outright.
  if (loserIsMainCharacter && survivor.type !== 'pc') {
    throw new Error('Cannot merge the main character into a non-player-character')
  }

  ctx.drizzle.transaction((tx) => {
    const txCtx: DbContext = { drizzle: tx, raw: ctx.raw }

    // Chronology + event refs: no uniqueness, straight re-point.
    tx.update(schema.statusHistory)
      .set({ entityId: survivorId })
      .where(eq(schema.statusHistory.entityId, loserId))
      .run()
    tx.update(schema.eventLog)
      .set({ entityId: survivorId })
      .where(eq(schema.eventLog.entityId, loserId))
      .run()

    // note_entity: move only the notes the survivor doesn't already tag; the rest (would-be PK dupes)
    // stay on the loser and cascade away with it.
    const survivorNotes = new Set(
      tx
        .select({ noteId: schema.noteEntity.noteId })
        .from(schema.noteEntity)
        .where(eq(schema.noteEntity.entityId, survivorId))
        .all()
        .map((r) => r.noteId)
    )
    const loserNotes = tx
      .select({ noteId: schema.noteEntity.noteId })
      .from(schema.noteEntity)
      .where(eq(schema.noteEntity.entityId, loserId))
      .all()
    for (const { noteId } of loserNotes) {
      if (!survivorNotes.has(noteId)) {
        tx.update(schema.noteEntity)
          .set({ entityId: survivorId })
          .where(and(eq(schema.noteEntity.noteId, noteId), eq(schema.noteEntity.entityId, loserId)))
          .run()
      }
    }

    // entity_link: re-point each edge touching the loser. Skip self-loops and open duplicates (checked
    // through txCtx so it sees edges re-pointed earlier in THIS loop); the skipped rows cascade away.
    const loserLinks = tx
      .select()
      .from(schema.entityLink)
      .where(
        or(eq(schema.entityLink.fromEntityId, loserId), eq(schema.entityLink.toEntityId, loserId))
      )
      .all()
    for (const link of loserLinks) {
      const from2 = link.fromEntityId === loserId ? survivorId : link.fromEntityId
      const to2 = link.toEntityId === loserId ? survivorId : link.toEntityId
      if (from2 === to2) continue // a merge can't create a self-relationship
      if (
        link.endSessionNumber === null &&
        findOpenLink(txCtx, from2, to2, link.relation as RelationKey)
      ) {
        continue // survivor already has this open edge (or its inverse) — drop the duplicate
      }
      tx.update(schema.entityLink)
        .set({ fromEntityId: from2, toEntityId: to2 })
        .where(eq(schema.entityLink.id, link.id))
        .run()
    }

    // Carry the main-character pointer before the loser is deleted (else it self-nulls).
    if (loserIsMainCharacter) {
      tx.update(schema.campaign)
        .set({ mainCharacterId: survivorId })
        .where(eq(schema.campaign.id, survivor.campaignId))
        .run()
    }

    // Delete the loser. FK cascade sweeps its persona, embedding, and any junction/link rows left in
    // place above (the PK-dupe notes and the duplicate/self-loop links).
    tx.delete(schema.entity).where(eq(schema.entity.id, loserId)).run()
  })

  const merged = getEntity(ctx, survivorId)
  if (!merged) throw new Error(`Survivor entity ${survivorId} vanished during merge`)
  return merged
}
