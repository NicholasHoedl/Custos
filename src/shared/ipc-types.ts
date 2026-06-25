import type {
  AppSettings,
  Campaign,
  Entity,
  EntityType,
  EventLogEntry,
  Note,
  Session
} from './entity-types'

// ---- Input payloads (Phase 1 expands these) ----
export interface CreateCampaignInput {
  name: string
  description?: string
}
export interface CreateSessionInput {
  campaignId: string
  title?: string
}
export interface CreateEntityInput {
  campaignId: string
  type: EntityType
  name: string
  description?: string
}
export interface CreateNoteInput {
  entityId: string
  sessionId?: string
  content: string
}
export interface CreateEventInput {
  sessionId: string
  content: string
  entityId?: string
}

export interface EntitySearchResult {
  entityId: string
  type: EntityType
  name: string
  snippet: string
}

/** The typed surface exposed to the renderer as `window.ledger` (via the preload contextBridge). */
export interface LedgerApi {
  campaign: {
    list(): Promise<Campaign[]>
    get(id: string): Promise<Campaign | null>
    create(input: CreateCampaignInput): Promise<Campaign>
  }
  session: {
    list(campaignId: string): Promise<Session[]>
    create(input: CreateSessionInput): Promise<Session>
  }
  entity: {
    list(campaignId: string): Promise<Entity[]>
    get(id: string): Promise<Entity | null>
    create(input: CreateEntityInput): Promise<Entity>
    update(id: string, patch: Partial<Entity>): Promise<Entity>
  }
  note: {
    list(entityId: string): Promise<Note[]>
    create(input: CreateNoteInput): Promise<Note>
    update(id: string, patch: { content?: string }): Promise<Note>
  }
  event: {
    create(input: CreateEventInput): Promise<EventLogEntry>
  }
  search: {
    text(query: string, campaignId: string): Promise<EntitySearchResult[]>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<void>
  }
  apikey: {
    set(key: string): Promise<void>
    validate(): Promise<{ valid: boolean }>
  }
}

/** Channel names — the single source of truth shared by the preload and the main-process handlers. */
export const IPC = {
  campaignList: 'campaign:list',
  campaignGet: 'campaign:get',
  campaignCreate: 'campaign:create',
  sessionList: 'session:list',
  sessionCreate: 'session:create',
  entityList: 'entity:list',
  entityGet: 'entity:get',
  entityCreate: 'entity:create',
  entityUpdate: 'entity:update',
  noteList: 'note:list',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  eventCreate: 'event:create',
  searchText: 'search:text',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  apikeySet: 'apikey:set',
  apikeyValidate: 'apikey:validate'
} as const

// ---- Phase 2 (declared for reference; intentionally NOT wired in Phase 0) ----
//   'recall:query'  -> streamed tokens + final citations (streaming)
//   'suggest:query' -> SuggestResult (structured: 4 of 7 attitude recommendations)
//   'stream:chunk' | 'stream:done' | 'stream:error'
