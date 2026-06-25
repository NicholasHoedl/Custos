import { useCallback, useEffect, useState } from 'react'
import type {
  Campaign,
  Entity,
  EntityType,
  EventLogEntry,
  Note,
  Session
} from '@shared/entity-types'
import type { RelationshipView } from '@shared/graph-types'
import { ledger } from '@renderer/lib/ipc'

// Thin data hooks over the typed `ledger.*` bridge. Each keys on its id(s) and exposes a `refresh()`
// to re-pull after a mutation. No external query library — useEffect + manual refresh is enough here.

export function useCampaigns(): { campaigns: Campaign[]; refresh: () => void } {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const refresh = useCallback(() => {
    ledger.campaign.list().then(setCampaigns)
  }, [])
  useEffect(() => refresh(), [refresh])
  return { campaigns, refresh }
}

export function useSessions(campaignId: string | null): { sessions: Session[]; refresh: () => void } {
  const [sessions, setSessions] = useState<Session[]>([])
  const refresh = useCallback(() => {
    if (!campaignId) return setSessions([])
    ledger.session.list(campaignId).then(setSessions)
  }, [campaignId])
  useEffect(() => refresh(), [refresh])
  return { sessions, refresh }
}

export function useEntities(
  campaignId: string | null,
  type?: EntityType
): { entities: Entity[]; refresh: () => void } {
  const [entities, setEntities] = useState<Entity[]>([])
  const refresh = useCallback(() => {
    if (!campaignId) return setEntities([])
    ledger.entity.list(campaignId, type).then(setEntities)
  }, [campaignId, type])
  useEffect(() => refresh(), [refresh])
  return { entities, refresh }
}

export function useEntity(id: string | null): { entity: Entity | null; refresh: () => void } {
  const [entity, setEntity] = useState<Entity | null>(null)
  const refresh = useCallback(() => {
    if (!id) return setEntity(null)
    ledger.entity.get(id).then(setEntity)
  }, [id])
  useEffect(() => refresh(), [refresh])
  return { entity, refresh }
}

export function useNotes(entityId: string | null): { notes: Note[]; refresh: () => void } {
  const [notes, setNotes] = useState<Note[]>([])
  const refresh = useCallback(() => {
    if (!entityId) return setNotes([])
    ledger.note.list(entityId).then(setNotes)
  }, [entityId])
  useEffect(() => refresh(), [refresh])
  return { notes, refresh }
}

export function useRelationships(entityId: string | null): {
  relationships: RelationshipView[]
  refresh: () => void
} {
  const [relationships, setRelationships] = useState<RelationshipView[]>([])
  const refresh = useCallback(() => {
    if (!entityId) return setRelationships([])
    ledger.link.listForEntity(entityId).then(setRelationships)
  }, [entityId])
  useEffect(() => refresh(), [refresh])
  return { relationships, refresh }
}

export function useEvents(sessionId: string | null): { events: EventLogEntry[]; refresh: () => void } {
  const [events, setEvents] = useState<EventLogEntry[]>([])
  const refresh = useCallback(() => {
    if (!sessionId) return setEvents([])
    ledger.event.list(sessionId).then(setEvents)
  }, [sessionId])
  useEffect(() => refresh(), [refresh])
  return { events, refresh }
}
