// Domain shapes shared across the main and renderer processes.
// These are the parsed/typed forms; the DB row forms (JSON-as-text) live in src/main/db/schema.ts.

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
