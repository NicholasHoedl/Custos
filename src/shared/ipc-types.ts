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
import type { CampaignGraph, EntityContext, HierarchyView, RelationshipView } from './graph-types'
import type {
  ModelDownloadProgress,
  OnboardingStatus,
  PersonaBrief,
  RecallChunk,
  RecallDone,
  RecallError,
  RecallRequest,
  RecallSourcesEvent
} from './recall-types'
import type { ConverseRequest, ConverseResult } from './converse-types'
import type { ContinuityRequest, ContinuityResult } from './continuity-types'
import type { DeriveProfileRequest, DeriveProfileResult } from './derive-profile-types'
import type { SuggestRequest, SuggestResult } from './suggest-types'
import type { RecapChunk, RecapDone, RecapError, RecapRequest } from './recap-types'
import type { ApplyResult, ConfirmedChangeset, ExtractRequest, ExtractResult } from './import-types'
import type { EnrichEntityRequest, EnrichEntityResult, TouchedEntity } from './enrich-types'
import type { CampaignExportResult, CampaignImportResult } from './export-types'
import type { UsageSummary } from './usage-types'

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
  image?: string | null // portrait data URL (P2-2)
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
  image?: string | null // portrait data URL (P2-2)
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
export interface UpdateEventInput {
  content: string
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
    /** Serialize the campaign to a JSON file via a save dialog (backup + portability). */
    export(campaignId: string): Promise<CampaignExportResult>
    /** Restore a campaign from an export file via an open dialog (P0-2 — ids preserved verbatim). */
    import(): Promise<CampaignImportResult>
  }
  session: {
    list(campaignId: string): Promise<Session[]>
    get(id: string): Promise<Session | null>
    create(input: CreateSessionInput): Promise<Session>
    update(id: string, patch: UpdateSessionInput): Promise<Session>
    delete(id: string): Promise<void>
    /** Per-session count of chronicle entries added since the last close-out (P1-2); sparse map. */
    unclosed(campaignId: string): Promise<Record<string, number>>
  }
  entity: {
    list(campaignId: string, type?: EntityType): Promise<Entity[]>
    get(id: string): Promise<Entity | null>
    create(input: CreateEntityInput): Promise<Entity>
    update(id: string, patch: UpdateEntityInput): Promise<Entity>
    delete(id: string): Promise<void>
    /** Merge the loser into the survivor (P1-6, re-point only); returns the surviving entity. */
    merge(survivorId: string, loserId: string): Promise<Entity>
    /** Chronology: the entity's full status/lifecycle history, oldest first. */
    history(entityId: string): Promise<StatusHistoryEntry[]>
    /** Open a native file dialog, thumbnail the pick → a portrait data URL, or null on cancel (P2-2). */
    pickImage(): Promise<string | null>
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
    /** Edit a chronicle entry's content (P1-4). Timestamp/position unchanged. */
    update(id: string, patch: UpdateEventInput): Promise<EventLogEntry>
    delete(id: string): Promise<void>
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
    campaign(campaignId: string, asOf?: number): Promise<CampaignGraph>
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
    /** Abort the in-flight Counsel call by requestId (P1-5). */
    cancel(requestId: string): Promise<void>
  }
  converse: {
    query(input: ConverseRequest): Promise<ConverseResult>
    /** Abort the in-flight Converse call by requestId (P1-5). */
    cancel(requestId: string): Promise<void>
  }
  continuity: {
    /** Audit the campaign for inconsistencies (ADR-056): deterministic checks + an additive AI pass. */
    query(input: ContinuityRequest): Promise<ContinuityResult>
    /** Abort the in-flight Continuity AI call by requestId. */
    cancel(requestId: string): Promise<void>
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
    /** Abort an in-flight Transcribe extraction by requestId (P1-5). Apply is not cancellable. */
    cancelExtract(requestId: string): Promise<void>
  }
  /** Illuminate (tier-2 enrichment, ADR-035): the pre-flight checklist + one focused call per entity. */
  enrich: {
    touched(sessionId: string): Promise<TouchedEntity[]>
    entity(req: EnrichEntityRequest): Promise<EnrichEntityResult>
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
  app: {
    /** Version + data-folder location (Settings "Your data" card — P0-3). */
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openLogsFolder(): Promise<void>
    /** On-demand snapshot — the same WAL-safe VACUUM INTO as the launch backup (P0-2). */
    backupNow(): Promise<BackupNowResult>
  }
  bugreport: {
    /** Gather the diagnostics block (version/OS/AI-readiness/campaign counts/log tail). */
    diagnostics(campaignId: string | null, view: string): Promise<string>
    /** Auto-send the report (or fall back to the bundle + prefilled email draft). */
    submit(req: BugReportRequest): Promise<BugReportResult>
  }
  update: {
    /** Manually check for an update (Settings button). Progress arrives via `onUpdateStatus`. A no-op
     *  that reports `disabled` in dev/unpackaged builds (P2-1). */
    check(): Promise<void>
    /** Quit and install a downloaded update (the "Restart to update" button). */
    install(): Promise<void>
  }
  log: {
    /** Fire-and-forget: renderer crashes land in the main-process log (P0-3). */
    rendererError(report: RendererErrorReport): void
  }
  usage: {
    /** AI spend totals for the Settings card: this month + lifetime, per feature (P0-4). */
    summary(): Promise<UsageSummary>
  }
  /** Subscribe to the main process asking the renderer to focus quick-add (global hotkey / Ctrl+K). */
  onQuickAddFocus(callback: () => void): () => void
  /** Streaming Recall events (filter by requestId in the renderer). Each returns an unsubscribe fn. */
  onRecallChunk(callback: (chunk: RecallChunk) => void): () => void
  onRecallSources(callback: (ev: RecallSourcesEvent) => void): () => void
  onRecallDone(callback: (done: RecallDone) => void): () => void
  onRecallError(callback: (err: RecallError) => void): () => void
  /** Streaming Recap events (filter by requestId). Each returns an unsubscribe fn. */
  onRecapChunk(callback: (chunk: RecapChunk) => void): () => void
  onRecapDone(callback: (done: RecapDone) => void): () => void
  onRecapError(callback: (err: RecapError) => void): () => void
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): () => void
  /** Subscribe to auto-update lifecycle events (P2-1). Returns an unsubscribe fn. */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
}

/** Channel names — the single source of truth shared by the preload and the main-process handlers. */
export const IPC = {
  campaignList: 'campaign:list',
  campaignGet: 'campaign:get',
  campaignCreate: 'campaign:create',
  campaignUpdate: 'campaign:update',
  campaignDelete: 'campaign:delete',
  campaignExport: 'campaign:export',
  campaignImport: 'campaign:import',
  sessionList: 'session:list',
  sessionGet: 'session:get',
  sessionCreate: 'session:create',
  sessionUpdate: 'session:update',
  sessionDelete: 'session:delete',
  sessionUnclosed: 'session:unclosed',
  entityList: 'entity:list',
  entityGet: 'entity:get',
  entityCreate: 'entity:create',
  entityUpdate: 'entity:update',
  entityDelete: 'entity:delete',
  entityMerge: 'entity:merge',
  entityHistory: 'entity:history',
  entityPickImage: 'entity:pick-image',
  noteList: 'note:list',
  noteListAll: 'note:listAll',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteDelete: 'note:delete',
  eventList: 'event:list',
  eventCreate: 'event:create',
  eventUpdate: 'event:update',
  eventDelete: 'event:delete',
  linkCreate: 'link:create',
  linkUpdate: 'link:update',
  linkSever: 'link:sever',
  linkDelete: 'link:delete',
  linkListForEntity: 'link:listForEntity',
  graphContext: 'graph:context',
  graphHierarchy: 'graph:hierarchy',
  graphCampaign: 'graph:campaign',
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
  suggestCancel: 'suggest:cancel',
  converseQuery: 'converse:query',
  converseCancel: 'converse:cancel',
  continuityQuery: 'continuity:query',
  continuityCancel: 'continuity:cancel',
  deriveProfileQuery: 'derive-profile:query',
  importExtract: 'import:extract',
  importExtractCancel: 'import:extract-cancel',
  importApply: 'import:apply',
  enrichTouched: 'enrich:touched',
  enrichEntity: 'enrich:entity',
  personaGet: 'persona:get',
  personaGenerate: 'persona:generate',
  personaUpdate: 'persona:update',
  onboardingStatus: 'onboarding:status',
  modelDownload: 'onboarding:download-model',
  onboardingReindex: 'onboarding:reindex',
  appInfo: 'app:info',
  appOpenDataFolder: 'app:open-data-folder',
  appOpenLogsFolder: 'app:open-logs-folder',
  appBackupNow: 'app:backup-now',
  bugreportDiagnostics: 'bugreport:diagnostics',
  bugreportSubmit: 'bugreport:submit',
  usageSummary: 'usage:summary',
  updateCheck: 'update:check',
  updateInstall: 'update:install'
} as const

/** One-way channel: main -> renderer, asking the UI to focus the quick-add bar. */
export const QUICK_ADD_FOCUS_CHANNEL = 'ui:quick-add-focus'

/** One-way channel: renderer -> main, forwarding renderer crashes into userData/logs/main.log
 *  (ROADMAP P0-3 — a packaged app has no devtools console, so these were previously lost). */
export const RENDERER_ERROR_CHANNEL = 'log:renderer-error'

/** A renderer-side crash/rejection forwarded to the main-process log. */
export interface RendererErrorReport {
  message: string
  stack?: string
  source: 'error-boundary' | 'window-error' | 'unhandled-rejection'
}

/** App shell info for the Settings "Your data" card (P0-3). */
export interface AppInfo {
  version: string
  dataDir: string
}

export type BackupNowResult = { ok: true; path: string } | { ok: false; error: string }

// ---- Bug reporting (the sidebar "Report a bug" dialog — reports go to the developer by EMAIL) ----

/** Where bug reports go. Shown in the dialog's copy fallback and baked into the mailto draft. */
export const BUG_REPORT_EMAIL = 'CustosService@outlook.com'

/** The deployed intake worker (infra/bugreport-worker → Resend → BUG_REPORT_EMAIL, ADR-058). EMPTY =
 *  auto-send disabled: submit falls back to the bundle + mail-draft flow, so the app is safe to ship
 *  before the worker exists. Paste the `*.workers.dev` URL printed by `npx wrangler deploy` here. */
export const BUG_REPORT_ENDPOINT = 'https://custos-bugreport.custosservice.workers.dev'
/** Shared spam-gate token — MUST equal the worker's `REPORT_TOKEN` secret (see the worker README). It
 *  ships in the app bundle, so it raises the bar against drive-by spam; it is not a true secret. */
export const BUG_REPORT_TOKEN = 'f0b29921746fe8f452087dc11d768e20e80ce7d8bf76ed28'

/** What the renderer submits from the bug-report dialog. */
export interface BugReportRequest {
  /** Who sent it (prefilled from settings.userName); empty = anonymous. */
  name: string
  /** Optional reply address (never required) — wired to the sent email's reply-to (ADR-058). */
  replyTo?: string
  description: string
  /** The silently gathered diagnostics block — always included by design (no in-dialog toggle or review;
   *  the full text is still plainly visible in the bundle's report.txt); null = the gather yielded nothing. */
  diagnostics: string | null
  /** Screenshot data URLs (png/jpeg/webp/gif) saved beside report.txt in the bundle. */
  screenshots: string[]
}

/** `sent: true` = delivered through the intake worker (ADR-058) — nothing written to disk (`dir` is
 *  null; no local copy by design). `sent: false` = the email fallback ran: the bundle was written to
 *  `dir` for drag-in, and `mailOpened: false` means no mail client took the draft (dialog offers
 *  copy-and-send instead). */
export type BugReportResult =
  | { ok: true; sent: boolean; dir: string | null; mailOpened: boolean }
  | { ok: false; error: string }

// ---- One-way streaming channels: main -> renderer (Recall). Payloads are requestId-tagged. ----
export const RECALL_CHUNK_CHANNEL = 'stream:chunk'
export const RECALL_SOURCES_CHANNEL = 'stream:sources'
export const RECALL_DONE_CHANNEL = 'stream:done'
export const RECALL_ERROR_CHANNEL = 'stream:error'
// ---- One-way streaming channels: main -> renderer (Recap). Payloads are requestId-tagged. ----
export const RECAP_CHUNK_CHANNEL = 'recap:chunk'
export const RECAP_DONE_CHANNEL = 'recap:done'
export const RECAP_ERROR_CHANNEL = 'recap:error'
/** One-way: main -> renderer, embedding-model download progress (onboarding). */
export const MODEL_DOWNLOAD_PROGRESS_CHANNEL = 'onboarding:model-progress'

/** One-way: main -> renderer, auto-update lifecycle (P2-1, ADR-042). Drives the Settings update UI. */
export const UPDATE_STATUS_CHANNEL = 'update:status'

/** Auto-update status pushed to the renderer. `checking`/`available`/`downloading`/`downloaded` are the
 *  happy path; `not-available` = up to date; `disabled` = dev/unpackaged (updates apply to the installed
 *  app only); `error` carries a human message (e.g. no releases published yet — benign). */
export interface UpdateStatus {
  state:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'disabled'
    | 'error'
  /** The available/downloaded release version (for `available`/`downloaded`). */
  version?: string
  /** Download percentage 0–100 (for `downloading`). */
  percent?: number
  /** A short human-readable line (for `error`/`disabled`). */
  message?: string
}
