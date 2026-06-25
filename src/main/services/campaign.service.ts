import { eq } from 'drizzle-orm'
import type { Campaign } from '@shared/entity-types'
import type { CreateCampaignInput, UpdateCampaignInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
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

export function createCampaign(ctx: DbContext, input: CreateCampaignInput): Campaign {
  const ts = now()
  const row = {
    id: newId(),
    name: input.name.trim(),
    description: input.description ?? null,
    createdAt: ts,
    updatedAt: ts
  }
  ctx.drizzle.insert(schema.campaign).values(row).run()
  return rowToCampaign(row)
}

export function updateCampaign(ctx: DbContext, id: string, patch: UpdateCampaignInput): Campaign {
  const set: Partial<typeof schema.campaign.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) set.name = patch.name.trim()
  if (patch.description !== undefined) set.description = patch.description
  ctx.drizzle.update(schema.campaign).set(set).where(eq(schema.campaign.id, id)).run()
  const c = getCampaign(ctx, id)
  if (!c) throw new Error(`Campaign ${id} not found`)
  return c
}
