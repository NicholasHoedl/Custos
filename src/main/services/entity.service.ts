import { and, eq } from 'drizzle-orm'
import type { Entity, EntityType } from '@shared/entity-types'
import type { CreateEntityInput, UpdateEntityInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { newId, now, rowToEntity, serializeArray, serializeObject } from './serialize'

export function listEntities(ctx: DbContext, campaignId: string, type?: EntityType): Entity[] {
  const where = type
    ? and(eq(schema.entity.campaignId, campaignId), eq(schema.entity.type, type))
    : eq(schema.entity.campaignId, campaignId)
  return ctx.drizzle
    .select()
    .from(schema.entity)
    .where(where)
    .orderBy(schema.entity.name)
    .all()
    .map(rowToEntity)
}

export function getEntity(ctx: DbContext, id: string): Entity | null {
  const r = ctx.drizzle.select().from(schema.entity).where(eq(schema.entity.id, id)).get()
  return r ? rowToEntity(r) : null
}

export function createEntity(ctx: DbContext, input: CreateEntityInput): Entity {
  const ts = now()
  const row = {
    id: newId(),
    campaignId: input.campaignId,
    type: input.type,
    name: input.name.trim(),
    description: input.description ?? null,
    traits: serializeArray(input.traits),
    goals: serializeArray(input.goals),
    attributes: serializeObject(input.attributes),
    status: input.status ?? null,
    createdAt: ts,
    updatedAt: ts
  }
  ctx.drizzle.insert(schema.entity).values(row).run()
  return rowToEntity(row)
}

export function updateEntity(ctx: DbContext, id: string, patch: UpdateEntityInput): Entity {
  const set: Partial<typeof schema.entity.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) set.name = patch.name.trim()
  if (patch.description !== undefined) set.description = patch.description
  if (patch.status !== undefined) set.status = patch.status
  if (patch.traits !== undefined) set.traits = serializeArray(patch.traits)
  if (patch.goals !== undefined) set.goals = serializeArray(patch.goals)
  if (patch.attributes !== undefined) set.attributes = serializeObject(patch.attributes)
  ctx.drizzle.update(schema.entity).set(set).where(eq(schema.entity.id, id)).run()
  const e = getEntity(ctx, id)
  if (!e) throw new Error(`Entity ${id} not found`)
  return e
}

/**
 * Deletes an entity. Foreign keys (with `foreign_keys = ON`) cascade the cleanup: its notes and all
 * links touching it (either end) are removed, and any event_log reference is set to null (the session
 * log entry survives). See schema.ts onDelete rules.
 */
export function deleteEntity(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.entity).where(eq(schema.entity.id, id)).run()
}
