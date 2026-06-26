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
import type {
  ModelDownloadProgress,
  OnboardingStatus,
  PersonaBrief,
  RecallChunk,
  RecallDone,
  RecallError,
  RecallRequest
} from './recall-types'

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
    delete(id: string): Promise<void>
  }
  session: {
    list(campaignId: string): Promise<Session[]>
    get(id: string): Promise<Session | null>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: UpdateSessionInput): Promise<Session>
    delete(id: string): Promise<void>
  }
  entity: {
    list(campaignId: string, type?: EntityType): Promise<Entity[]>
    get(id: string): Promise<Entity | null>
    create(input: CreateEntityInput): Promise<Entity>
    update(id: string, patch: UpdateEntityInput): Promise<Entity>
    delete(id: string): Promise<void>
  }
  note: {
    list(entityId: string): Promise<Note[]>
    create(input: CreateNoteInput): Promise<Note>
    update(id: string, patch: { content?: string }): Promise<Note>
    delete(id: string): Promise<void>
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
    exists(): Promise<boolean>
    validate(): Promise<{ valid: boolean }>
    clear(): Promise<void>
  }
  recall: {
    query(input: RecallRequest): Promise<{ requestId: string }>
    cancel(requestId: string): Promise<void>
  }
  persona: {
    get(entityId: string): Promise<PersonaBrief | null>
    generate(entityId: string): Promise<PersonaBrief>
    update(entityId: string, brief: string): Promise<PersonaBrief>
  }
  onboarding: {
    status(): Promise<OnboardingStatus>
    downloadModel(): Promise<void>
    reindex(): Promise<number>
  }
  /** Subscribe to the main process asking the renderer to focus quick-add (global hotkey / Ctrl+K). */
  onQuickAddFocus(callback: () => void): () => void
  /** Streaming Recall events (filter by requestId in the renderer). Each returns an unsubscribe fn. */
  onRecallChunk(callback: (chunk: RecallChunk) => void): () => void
  onRecallDone(callback: (done: RecallDone) => void): () => void
  onRecallError(callback: (err: RecallError) => void): () => void
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): () => void
}

/** Channel names — the single source of truth shared by the preload and the main-process handlers. */
export const IPC = {
  campaignList: 'campaign:list',
  campaignGet: 'campaign:get',
  campaignCreate: 'campaign:create',
  campaignUpdate: 'campaign:update',
  campaignDelete: 'campaign:delete',
  sessionList: 'session:list',
  sessionGet: 'session:get',
  sessionCreate: 'session:create',
  sessionUpdate: 'session:update',
  sessionDelete: 'session:delete',
  entityList: 'entity:list',
  entityGet: 'entity:get',
  entityCreate: 'entity:create',
  entityUpdate: 'entity:update',
  entityDelete: 'entity:delete',
  noteList: 'note:list',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteDelete: 'note:delete',
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
  apikeyExists: 'apikey:exists',
  apikeyValidate: 'apikey:validate',
  apikeyClear: 'apikey:clear',
  recallQuery: 'recall:query',
  recallCancel: 'recall:cancel',
  personaGet: 'persona:get',
  personaGenerate: 'persona:generate',
  personaUpdate: 'persona:update',
  onboardingStatus: 'onboarding:status',
  modelDownload: 'onboarding:download-model',
  onboardingReindex: 'onboarding:reindex'
} as const

/** One-way channel: main -> renderer, asking the UI to focus the quick-add bar. */
export const QUICK_ADD_FOCUS_CHANNEL = 'ui:quick-add-focus'

// ---- One-way streaming channels: main -> renderer (Recall). Payloads are requestId-tagged. ----
export const RECALL_CHUNK_CHANNEL = 'stream:chunk'
export const RECALL_DONE_CHANNEL = 'stream:done'
export const RECALL_ERROR_CHANNEL = 'stream:error'
/** One-way: main -> renderer, embedding-model download progress (onboarding). */
export const MODEL_DOWNLOAD_PROGRESS_CHANNEL = 'onboarding:model-progress'

// ---- Phase 3 (declared for reference; NOT wired yet) ----
//   'suggest:query' -> SuggestResult (structured: 4 of 7 attitude recommendations)
