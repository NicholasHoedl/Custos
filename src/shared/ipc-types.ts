import type {
  AppSettings,
  Campaign,
  Entity,
  EntityLink,
  EntityType,
  EventLogEntry,
  Lifecycle,
  Note,
  NoteConfidence,
  Session,
  StatusHistoryEntry
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
import type { ConverseRequest, ConverseResult } from './converse-types'
import type { DeriveProfileRequest, DeriveProfileResult } from './derive-profile-types'
import type { SuggestRequest, SuggestResult } from './suggest-types'
import type { RecapChunk, RecapDone, RecapError, RecapRequest } from './recap-types'
import type { ApplyResult, ConfirmedChangeset, ExtractRequest, ExtractResult } from './import-types'
import type { CampaignExportResult } from './export-types'

// ---- Input payloads ----
export interface CreateCampaignInput {
  name: string
  description?: string
  /** ADR-029: the campaign's mandatory main character. When set, createCampaign also creates this pc
   *  entity and points main_character_id at it (atomically). The New Campaign dialog always sends it;
   *  omitted only by internal/legacy callers (which yield a grandfathered null-MC campaign). */
  mainCharacterName?: string
}
export interface UpdateCampaignInput {
  name?: string
  description?: string | null
  mainCharacterId?: string | null // a pc entity in this campaign, or null to clear (validated in the service)
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
  flaws?: string[]
  voiceExamples?: string[] // main-character-only (ADR-029); ignored for other entities
  attributes?: Record<string, unknown>
  status?: string
  lifecycle?: Lifecycle // chronology: defaults to the status heuristic when omitted
  /** Capture context: the session to stamp the baseline history row at. `undefined` = the live-capture
   *  fallback (latest session); EXPLICIT `null` = undated/PRE-TRACKING — the entity predates session 1
   *  (backstory-derived + undated imports, ADR-030). */
  sessionId?: string | null
}
export interface UpdateEntityInput {
  name?: string
  description?: string | null
  traits?: string[]
  goals?: string[]
  flaws?: string[]
  voiceExamples?: string[] // main-character-only (ADR-029)
  attributes?: Record<string, unknown>
  status?: string | null
  lifecycle?: Lifecycle
  /** Capture context: session to stamp a status/lifecycle change at. `undefined` = latest-session
   *  fallback; EXPLICIT `null` = undated/pre-tracking (see CreateEntityInput.sessionId, ADR-030). */
  sessionId?: string | null
}
export interface CreateNoteInput {
  campaignId: string // the note's home campaign (required); the note may tag 0..N entities
  entityIds: string[] // entities this note tags (M2M); may be empty (a campaign-level world fact)
  sessionId?: string
  content: string
  tags?: string[]
  confidence?: NoteConfidence // epistemic weight; defaults to 'confirmed'
}
export interface UpdateNoteInput {
  content?: string
  entityIds?: string[] // when present, replaces the note's entity associations
  tags?: string[]
  confidence?: NoteConfidence
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
  /** Tie enrichment (ADR-033): how each side feels (short free text, per direction) + epistemic weight. */
  fromDisposition?: string | null
  toDisposition?: string | null
  confidence?: NoteConfidence // defaults to 'confirmed'
  /** Capture context: session to stamp the interval start at. `undefined` = latest-session fallback;
   *  EXPLICIT `null` = a pre-tracking interval (open since before session 1 — ADR-030 undated imports). */
  sessionId?: string | null
}

/** Edit an existing relationship's context (ADR-032/033). The relation type + endpoints are immutable —
 *  changing those is semantically a sever + a new tie — so this touches the description, the per-direction
 *  dispositions, and the confidence only. Each field is applied only when present. */
export interface UpdateLinkInput {
  description?: string | null
  fromDisposition?: string | null
  toDisposition?: string | null
  confidence?: NoteConfidence
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
    /** Serialize the campaign to a JSON file via a save dialog (export-only, backup + portability). */
    export(campaignId: string): Promise<CampaignExportResult>
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
    /** Chronology: the entity's full status/lifecycle history, oldest first. */
    history(entityId: string): Promise<StatusHistoryEntry[]>
  }
  note: {
    list(entityId: string): Promise<Note[]>
    listAll(campaignId: string): Promise<Note[]>
    create(input: CreateNoteInput): Promise<Note>
    update(id: string, patch: UpdateNoteInput): Promise<Note>
    delete(id: string): Promise<void>
  }
  event: {
    list(sessionId: string): Promise<EventLogEntry[]>
    create(input: CreateEventInput): Promise<EventLogEntry>
  }
  link: {
    create(input: CreateLinkInput): Promise<EntityLink>
    /** Edit a relationship's context description (ADR-032). */
    update(id: string, patch: UpdateLinkInput): Promise<EntityLink>
    /** Sever a relationship without erasing it (chronology): closes its open interval at the session. */
    sever(id: string, sessionId?: string): Promise<void>
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
  suggest: {
    query(input: SuggestRequest): Promise<SuggestResult>
  }
  converse: {
    query(input: ConverseRequest): Promise<ConverseResult>
  }
  deriveProfile: {
    /** Derive a main character's profile fields from their backstory, for review (ADR-029). */
    query(input: DeriveProfileRequest): Promise<DeriveProfileResult>
  }
  recap: {
    generate(input: RecapRequest): Promise<{ requestId: string }>
    cancel(requestId: string): Promise<void>
  }
  import: {
    extract(input: ExtractRequest): Promise<ExtractResult>
    apply(payload: ConfirmedChangeset): Promise<ApplyResult>
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
  /** Streaming Recap events (filter by requestId). Each returns an unsubscribe fn. */
  onRecapChunk(callback: (chunk: RecapChunk) => void): () => void
  onRecapDone(callback: (done: RecapDone) => void): () => void
  onRecapError(callback: (err: RecapError) => void): () => void
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): () => void
}

/** Channel names — the single source of truth shared by the preload and the main-process handlers. */
export const IPC = {
  campaignList: 'campaign:list',
  campaignGet: 'campaign:get',
  campaignCreate: 'campaign:create',
  campaignUpdate: 'campaign:update',
  campaignDelete: 'campaign:delete',
  campaignExport: 'campaign:export',
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
  entityHistory: 'entity:history',
  noteList: 'note:list',
  noteListAll: 'note:listAll',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteDelete: 'note:delete',
  eventList: 'event:list',
  eventCreate: 'event:create',
  linkCreate: 'link:create',
  linkUpdate: 'link:update',
  linkSever: 'link:sever',
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
  recapGenerate: 'recap:generate',
  recapCancel: 'recap:cancel',
  suggestQuery: 'suggest:query',
  converseQuery: 'converse:query',
  deriveProfileQuery: 'derive-profile:query',
  importExtract: 'import:extract',
  importApply: 'import:apply',
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
// ---- One-way streaming channels: main -> renderer (Recap). Payloads are requestId-tagged. ----
export const RECAP_CHUNK_CHANNEL = 'recap:chunk'
export const RECAP_DONE_CHANNEL = 'recap:done'
export const RECAP_ERROR_CHANNEL = 'recap:error'
/** One-way: main -> renderer, embedding-model download progress (onboarding). */
export const MODEL_DOWNLOAD_PROGRESS_CHANNEL = 'onboarding:model-progress'
