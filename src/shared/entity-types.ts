// Domain shapes shared across the main and renderer processes.
// These are the parsed/typed forms; the DB row forms (JSON-as-text) live in src/main/db/schema.ts.

// 'event' = WORLD-SCALE history (a city destroyed, a king assassinated — ADR-019), NOT a session
// beat; the party's own beats live in the event_log table.
export type EntityType = 'npc' | 'location' | 'faction' | 'quest' | 'item' | 'pc' | 'event'

export const ENTITY_TYPES: readonly EntityType[] = [
  'npc',
  'location',
  'faction',
  'quest',
  'item',
  'pc',
  'event'
]

/** Human labels for entity types (UI). */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  npc: 'NPC',
  location: 'Location',
  faction: 'Faction',
  quest: 'Quest',
  item: 'Item',
  pc: 'Player Character',
  event: 'Event'
}

/** Chronology (ADR-017): the coarse lifecycle the AI trusts for past-vs-present reasoning. */
export type Lifecycle = 'active' | 'ended' | 'unknown'

export const LIFECYCLES: readonly Lifecycle[] = ['active', 'ended', 'unknown']

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  active: 'Active',
  ended: 'Ended',
  unknown: 'Unknown'
}

export interface Campaign {
  id: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  campaignId: string
  number: number
  title: string | null
  summary: string | null
  date: string | null
  createdAt: number
}

export interface Entity {
  id: string
  campaignId: string
  type: EntityType
  name: string
  description: string | null
  traits: string[] // promoted (Suggest reads these)
  goals: string[] // promoted
  attributes: Record<string, unknown> // open bag of type-specific fields
  status: string | null
  lifecycle: Lifecycle // chronology: coarse state the AI trusts; free-text `status` stays for nuance
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  entityIds: string[] // the entities this note is associated with (M2M); always ≥1
  sessionId: string | null
  content: string
  tags: string[]
  createdAt: number
}

export interface EntityLink {
  id: string
  fromEntityId: string
  toEntityId: string
  relation: string // forward RelationKey (see @shared/relations)
  description: string | null // the "why/when" of the edge — the RAG-context lever
  campaignId: string
  createdAt: number | null
  startSessionNumber: number | null // chronology: interval start; null = pre-tracking
  endSessionNumber: number | null // chronology: interval end; null = still live (open)
}

/** One row of an entity's status/lifecycle history over time (chronology, ADR-017). */
export interface StatusHistoryEntry {
  id: string
  entityId: string
  lifecycle: Lifecycle
  status: string | null
  sinceSessionNumber: number | null // null = pre-tracking baseline
  recordedAt: number
}

export interface EventLogEntry {
  id: string
  sessionId: string
  campaignId: string
  content: string
  entityId: string | null
  timestamp: number
}

export type ThemeMode = 'dark'
export type FontSize = 'sm' | 'md' | 'lg'

export interface AppSettings {
  theme: ThemeMode
  fontSize: FontSize
  recallModel: 'claude-sonnet-4-6' | 'claude-opus-4-8'
  suggestModel: 'claude-sonnet-4-6' | 'claude-opus-4-8'
  suggestEffort: 'medium' | 'high'
  hotkey: string
}
