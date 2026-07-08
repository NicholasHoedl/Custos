import { eq } from 'drizzle-orm'
import type { Campaign } from '@shared/entity-types'
import type { CreateCampaignInput, UpdateCampaignInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { createEntity } from './entity.service'
import { newId, now, rowToCampaign } from './serialize'

export function listCampaigns(ctx: DbContext): Campaign[] {
  return ctx.drizzle
    .select()
    .from(schema.campaign)
    .orderBy(schema.campaign.name)
    .all()
    .map(rowToCampaign)
}

export function getCampaign(ctx: DbContext, id: string): Campaign | null {
  const r = ctx.drizzle.select().from(schema.campaign).where(eq(schema.campaign.id, id)).get()
  return r ? rowToCampaign(r) : null
}

// Creating a campaign optionally creates its MANDATORY main character (ADR-029) in the same transaction:
// the campaign row, then a `pc` entity named `mainCharacterName`, then `main_character_id` pointed at it.
// The New Campaign dialog always sends a name; internal/legacy callers omit it (a grandfathered null-MC
// campaign). The entity insert sees the just-inserted campaign row within the txn, so its FK is satisfied.
export function createCampaign(ctx: DbContext, input: CreateCampaignInput): Campaign {
  const ts = now()
  const id = newId()
  const mcName = input.mainCharacterName?.trim()
  ctx.drizzle.transaction(() => {
    ctx.drizzle
      .insert(schema.campaign)
      .values({
        id,
        name: input.name.trim(),
        description: input.description ?? null,
        mainCharacterId: null,
        createdAt: ts,
        updatedAt: ts
      })
      .run()
    if (mcName) {
      const mc = createEntity(ctx, { campaignId: id, type: 'pc', name: mcName })
      ctx.drizzle
        .update(schema.campaign)
        .set({ mainCharacterId: mc.id, updatedAt: now() })
        .where(eq(schema.campaign.id, id))
        .run()
    }
  })
  const c = getCampaign(ctx, id)
  if (!c) throw new Error(`Campaign ${id} not found`)
  return c
}

// A main-character pointer must reference a pc entity that lives in THIS campaign (or be null to clear).
// Validated in the main process so a stale/hostile renderer can't point a campaign at a non-PC or an
// entity from another campaign; a bad value rejects the update (the renderer only ever sends a PC it
// listed for this campaign).
function resolveMainCharacter(
  ctx: DbContext,
  campaignId: string,
  entityId: string | null
): string | null {
  if (entityId === null) return null
  const e = ctx.drizzle
    .select({ type: schema.entity.type, campaignId: schema.entity.campaignId })
    .from(schema.entity)
    .where(eq(schema.entity.id, entityId))
    .get()
  if (!e || e.campaignId !== campaignId || e.type !== 'pc') {
    throw new Error('Main character must be a player character in this campaign')
  }
  return entityId
}

export function updateCampaign(ctx: DbContext, id: string, patch: UpdateCampaignInput): Campaign {
  const set: Partial<typeof schema.campaign.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) set.name = patch.name.trim()
  if (patch.description !== undefined) set.description = patch.description
  if (patch.mainCharacterId !== undefined) {
    set.mainCharacterId = resolveMainCharacter(ctx, id, patch.mainCharacterId)
  }
  ctx.drizzle.update(schema.campaign).set(set).where(eq(schema.campaign.id, id)).run()
  const c = getCampaign(ctx, id)
  if (!c) throw new Error(`Campaign ${id} not found`)
  return c
}

// Deletes a campaign and everything under it. Sessions, entities, links, event-log entries, notes,
// embeddings, and personas all cascade away via their foreign keys (onDelete: 'cascade'). Notes now
// carry a first-class campaign_id FK (ADR-021), so entity-less lore is swept with the campaign too;
// note_embedding then cascades off the deleted note rows.
export function deleteCampaign(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.campaign).where(eq(schema.campaign.id, id)).run()
}
