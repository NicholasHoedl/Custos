import { useCallback, useEffect, useState } from 'react'
import type {
  Campaign,
  Entity,
  EntityType,
  EventLogEntry,
  Note,
  Session
} from '@shared/entity-types'
import { toast } from 'sonner'
import type { RelationshipView } from '@shared/graph-types'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'

// Thin data hooks over the typed `ledger.*` bridge. Each keys on its id(s) and exposes a `refresh()`
// to re-pull after a mutation. No external query library — useEffect + manual refresh is enough here.

// A rejected background fetch used to fail silently (empty list forever). Surface it as ONE toast —
// the shared `id` dedupes, so a dead backend shows a single message, not one per hook (T2).
function fetchFailed(what: string) {
  return (err: unknown): void => {
    toast.error(`Couldn't load ${what}`, { id: 'ipc-fetch', description: String(err) })
  }
}

export function useCampaigns(): { campaigns: Campaign[]; refresh: () => void } {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const refresh = useCallback(() => {
    ledger.campaign.list().then(setCampaigns).catch(fetchFailed('campaigns'))
  }, [])
  useEffect(() => refresh(), [refresh])
  return { campaigns, refresh }
}

export function useSessions(campaignId: string | null): {
  sessions: Session[]
  loading: boolean
  refresh: () => void
} {
  const [sessions, setSessions] = useState<Session[]>([])
  // `loading` is true until the first list resolves — lets capture surfaces distinguish "still
  // restoring the session" from "this campaign genuinely has no sessions" (T3).
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    if (!campaignId) {
      setSessions([])
      setLoading(false)
      return
    }
    setLoading(true)
    ledger.session
      .list(campaignId)
      .then((s) => {
        setSessions(s)
        setLoading(false)
      })
      .catch((e) => {
        setLoading(false)
        fetchFailed('sessions')(e)
      })
  }, [campaignId])
  useEffect(() => refresh(), [refresh])
  return { sessions, loading, refresh }
}

export function useEntities(
  campaignId: string | null,
  type?: EntityType
): { entities: Entity[]; refresh: () => void } {
  const [entities, setEntities] = useState<Entity[]>([])
  // Refetch whenever ANY entity is created/updated/deleted (bumped via useUiStore.bumpEntities). Each
  // useEntities instance is independent, so without this a create in one component (e.g. quick-add)
  // leaves every other list — like the sidebar scene selectors — showing a stale set.
  const entitiesVersion = useUiStore((s) => s.entitiesVersion)
  const refresh = useCallback(() => {
    if (!campaignId) return setEntities([])
    ledger.entity.list(campaignId, type).then(setEntities).catch(fetchFailed('entities'))
  }, [campaignId, type])
  useEffect(() => refresh(), [refresh, entitiesVersion])
  return { entities, refresh }
}

export function useEntity(id: string | null): { entity: Entity | null; refresh: () => void } {
  const [entity, setEntity] = useState<Entity | null>(null)
  const refresh = useCallback(() => {
    if (!id) return setEntity(null)
    ledger.entity.get(id).then(setEntity).catch(fetchFailed('this entity'))
  }, [id])
  useEffect(() => refresh(), [refresh])
  return { entity, refresh }
}

export function useNotes(entityId: string | null): { notes: Note[]; refresh: () => void } {
  const [notes, setNotes] = useState<Note[]>([])
  const refresh = useCallback(() => {
    if (!entityId) return setNotes([])
    ledger.note.list(entityId).then(setNotes).catch(fetchFailed('notes'))
  }, [entityId])
  useEffect(() => refresh(), [refresh])
  return { notes, refresh }
}

export function useAllNotes(campaignId: string | null): { notes: Note[]; refresh: () => void } {
  const [notes, setNotes] = useState<Note[]>([])
  const refresh = useCallback(() => {
    if (!campaignId) return setNotes([])
    ledger.note.listAll(campaignId).then(setNotes).catch(fetchFailed('notes'))
  }, [campaignId])
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
    ledger.link.listForEntity(entityId).then(setRelationships).catch(fetchFailed('relationships'))
  }, [entityId])
  useEffect(() => refresh(), [refresh])
  return { relationships, refresh }
}

export function useEvents(sessionId: string | null): { events: EventLogEntry[]; refresh: () => void } {
  const [events, setEvents] = useState<EventLogEntry[]>([])
  const refresh = useCallback(() => {
    if (!sessionId) return setEvents([])
    ledger.event.list(sessionId).then(setEvents).catch(fetchFailed('the session log'))
  }, [sessionId])
  useEffect(() => refresh(), [refresh])
  return { events, refresh }
}
