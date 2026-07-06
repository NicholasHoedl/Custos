import { and, eq, inArray } from 'drizzle-orm'
import type { Entity, EntityType, Lifecycle } from '@shared/entity-types'
import type { CreateEntityInput, UpdateEntityInput } from '@shared/ipc-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { lifecycleHeuristic } from './chronology.service'
import { resolveCaptureSessionNumber } from './session.service'
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

/** Batch-load entities by id in ONE query (grounding loops). Missing ids are simply absent. */
export function listEntitiesByIds(ctx: DbContext, ids: string[]): Map<string, Entity> {
  if (ids.length === 0) return new Map()
  const rows = ctx.drizzle.select().from(schema.entity).where(inArray(schema.entity.id, ids)).all()
  return new Map(rows.map((r) => [r.id, rowToEntity(r)]))
}

export function createEntity(ctx: DbContext, input: CreateEntityInput): Entity {
  const ts = now()
  const status = input.status ?? null
  // Chronology (ADR-017): lifecycle defaults to the status heuristic; the caller may override it.
  const lifecycle: Lifecycle = input.lifecycle ?? lifecycleHeuristic(status)
  const row = {
    id: newId(),
    campaignId: input.campaignId,
    type: input.type,
    name: input.name.trim(),
    description: input.description ?? null,
    traits: serializeArray(input.traits),
    goals: serializeArray(input.goals),
    attributes: serializeObject(input.attributes),
    status,
    lifecycle,
    createdAt: ts,
    updatedAt: ts
  }
  const sinceSessionNumber = resolveCaptureSessionNumber(ctx, input.sessionId, input.campaignId)
  ctx.drizzle.transaction((tx) => {
    tx.insert(schema.entity).values(row).run()
    // Seed a baseline history row so stateAsOf has a value from this entity's creation onward.
    tx.insert(schema.statusHistory)
      .values({ id: newId(), entityId: row.id, lifecycle, status, sinceSessionNumber, recordedAt: ts })
      .run()
  })
  return rowToEntity(row)
}

export function updateEntity(ctx: DbContext, id: string, patch: UpdateEntityInput): Entity {
  const before = getEntity(ctx, id)
  if (!before) throw new Error(`Entity ${id} not found`)
  const ts = now()
  const set: Partial<typeof schema.entity.$inferInsert> = { updatedAt: ts }
  if (patch.name !== undefined) set.name = patch.name.trim()
  if (patch.description !== undefined) set.description = patch.description
  if (patch.status !== undefined) set.status = patch.status
  if (patch.lifecycle !== undefined) set.lifecycle = patch.lifecycle
  if (patch.traits !== undefined) set.traits = serializeArray(patch.traits)
  if (patch.goals !== undefined) set.goals = serializeArray(patch.goals)
  if (patch.attributes !== undefined) set.attributes = serializeObject(patch.attributes)

  // Chronology: append a stamped history row iff status OR lifecycle actually changed.
  const newStatus = patch.status !== undefined ? patch.status : before.status
  const newLifecycle: Lifecycle = patch.lifecycle !== undefined ? patch.lifecycle : before.lifecycle
  const changed = newStatus !== before.status || newLifecycle !== before.lifecycle
  const sinceSessionNumber = changed
    ? resolveCaptureSessionNumber(ctx, patch.sessionId, before.campaignId)
    : null

  ctx.drizzle.transaction((tx) => {
    tx.update(schema.entity).set(set).where(eq(schema.entity.id, id)).run()
    if (changed) {
      tx.insert(schema.statusHistory)
        .values({
          id: newId(),
          entityId: id,
          lifecycle: newLifecycle,
          status: newStatus,
          sinceSessionNumber,
          recordedAt: ts
        })
        .run()
    }
  })
  const e = getEntity(ctx, id)
  if (!e) throw new Error(`Entity ${id} not found`)
  return e
}

/**
 * Deletes an entity. Foreign keys (with `foreign_keys = ON`) cascade the cleanup: its note_entity
 * links and every entity_link touching it (either end) are removed, and any event_log reference is set
 * to null (the session log entry survives). Notes are M2M and first-class campaign children (ADR-021),
 * so a note outlives losing this entity — a shared note stays under its others, and a note tagged only
 * to this one becomes entity-less campaign lore. See schema.ts onDelete.
 */
export function deleteEntity(ctx: DbContext, id: string): void {
  ctx.drizzle.delete(schema.entity).where(eq(schema.entity.id, id)).run()
}
