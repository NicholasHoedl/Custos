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
  traits: string[]
  goals: string[]
  status: string | null
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  entityId: string
  sessionId: string | null
  content: string
  tags: string[]
  createdAt: number
}

export interface EntityLink {
  id: string
  fromEntityId: string
  toEntityId: string
  relation: string
  campaignId: string
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
  hotkey: string
}
