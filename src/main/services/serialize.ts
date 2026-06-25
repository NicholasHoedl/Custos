import { randomUUID } from 'node:crypto'
import type {
  Campaign,
  Entity,
  EntityLink,
  EntityType,
  EventLogEntry,
  Note,
  Session
} from '@shared/entity-types'
import * as schema from '../db/schema'

export const newId = (): string => randomUUID()
export const now = (): number => Date.now()

export function serializeArray(arr?: string[] | null): string {
  return JSON.stringify(arr ?? [])
}

export function parseArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function serializeObject(obj?: Record<string, unknown> | null): string {
  return JSON.stringify(obj ?? {})
}

export function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---- Row -> domain mappers ----
export function rowToCampaign(r: typeof schema.campaign.$inferSelect): Campaign {
  return r
}

export function rowToSession(r: typeof schema.session.$inferSelect): Session {
  return r
}

export function rowToEntity(r: typeof schema.entity.$inferSelect): Entity {
  return {
    id: r.id,
    campaignId: r.campaignId,
    type: r.type as EntityType,
    name: r.name,
    description: r.description,
    traits: parseArray(r.traits),
    goals: parseArray(r.goals),
    attributes: parseObject(r.attributes),
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

export function rowToNote(r: typeof schema.note.$inferSelect): Note {
  return {
    id: r.id,
    entityId: r.entityId,
    sessionId: r.sessionId,
    content: r.content,
    tags: parseArray(r.tags),
    createdAt: r.createdAt
  }
}

export function rowToLink(r: typeof schema.entityLink.$inferSelect): EntityLink {
  return {
    id: r.id,
    fromEntityId: r.fromEntityId,
    toEntityId: r.toEntityId,
    relation: r.relation,
    description: r.description,
    campaignId: r.campaignId,
    createdAt: r.createdAt
  }
}

export function rowToEvent(r: typeof schema.eventLog.$inferSelect): EventLogEntry {
  return r
}
