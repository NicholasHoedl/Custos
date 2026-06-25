import type {
  AppSettings,
  Campaign,
  Entity,
  EntityLink,
  EntityType,
  EventLogEntry,
  Note,
  Session
} from './entity-types'
import type { RelationKey } from './relations'
import type { EntityContext, HierarchyView, RelationshipView } from './graph-types'

// ---- Input payloads ----
export interface CreateCampaignInput {
  name: string
  description?: string
}
export interface UpdateCampaignInput {
  name?: string
  description?: string | null
}
export interface CreateSessionInput {
  campaignId: string
  title?: string
}
export interface UpdateSessionInput {
  title?: string | null
  summary?: string | null
  date?: string | null
}
export interface CreateEntityInput {
  campaignId: string
  type: EntityType
  name: string
  description?: string
  traits?: string[]
  goals?: string[]
  attributes?: Record<string, unknown>
  status?: string
}
export type UpdateEntityInput = Partial<
  Pick<Entity, 'name' | 'description' | 'traits' | 'goals' | 'attributes' | 'status'>
>
export interface CreateNoteInput {
  entityId: string
  sessionId?: string
  content: string
  tags?: string[]
}
export interface CreateEventInput {
  sessionId: string
  content: string
  entityId?: string
}
export interface CreateLinkInput {
  campaignId: string
  fromEntityId: string
  toEntityId: string
  relation: RelationKey
  description?: string
}

export interface EntitySearchResult {
  entityId: string
  type: EntityType
  name: string
  snippet: string
}

export type HierarchyKind = 'location' | 'faction'

/** The typed surface exposed to the renderer as `window.ledger` (via the preload contextBridge). */
export interface LedgerApi {
  campaign: {
    list(): Promise<Campaign[]>
    get(id: string): Promise<Campaign | null>
    create(input: CreateCampaignInput): Promise<Campaign>
    update(id: string, patch: UpdateCampaignInput): Promise<Campaign>
  }
  session: {
    list(campaignId: string): Promise<Session[]>
    get(id: string): Promise<Session | null>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: UpdateSessionInput): Promise<Session>
  }
  entity: {
    list(campaignId: string, type?: EntityType): Promise<Entity[]>
    get(id: string): Promise<Entity | null>
    create(input: CreateEntityInput): Promise<Entity>
    update(id: string, patch: UpdateEntityInput): Promise<Entity>
  }
  note: {
    list(entityId: string): Promise<Note[]>
    create(input: CreateNoteInput): Promise<Note>
    update(id: string, patch: { content?: string }): Promise<Note>
  }
  event: {
    list(sessionId: string): Promise<EventLogEntry[]>
    create(input: CreateEventInput): Promise<EventLogEntry>
  }
  link: {
    create(input: CreateLinkInput): Promise<EntityLink>
    delete(id: string): Promise<void>
    listForEntity(entityId: string): Promise<RelationshipView[]>
  }
  graph: {
    context(entityId: string, depth?: number): Promise<EntityContext>
    hierarchy(entityId: string, kind: HierarchyKind): Promise<HierarchyView>
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
  /** Subscribe to the main process asking the renderer to focus quick-add (global hotkey / Ctrl+K). */
  onQuickAddFocus(callback: () => void): () => void
}

/** Channel names — the single source of truth shared by the preload and the main-process handlers. */
export const IPC = {
  campaignList: 'campaign:list',
  campaignGet: 'campaign:get',
  campaignCreate: 'campaign:create',
  campaignUpdate: 'campaign:update',
  sessionList: 'session:list',
  sessionGet: 'session:get',
  sessionCreate: 'session:create',
  sessionUpdate: 'session:update',
  entityList: 'entity:list',
  entityGet: 'entity:get',
  entityCreate: 'entity:create',
  entityUpdate: 'entity:update',
  noteList: 'note:list',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  eventList: 'event:list',
  eventCreate: 'event:create',
  linkCreate: 'link:create',
  linkDelete: 'link:delete',
  linkListForEntity: 'link:listForEntity',
  graphContext: 'graph:context',
  graphHierarchy: 'graph:hierarchy',
  searchText: 'search:text',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  apikeySet: 'apikey:set',
  apikeyValidate: 'apikey:validate'
} as const

/** One-way channel: main -> renderer, asking the UI to focus the quick-add bar. */
export const QUICK_ADD_FOCUS_CHANNEL = 'ui:quick-add-focus'

// ---- Phase 2 (declared for reference; intentionally NOT wired in Phase 1) ----
//   'recall:query'  -> streamed tokens + final citations (streaming)
//   'suggest:query' -> SuggestResult (structured: 4 of 7 attitude recommendations)
//   'stream:chunk' | 'stream:done' | 'stream:error'
