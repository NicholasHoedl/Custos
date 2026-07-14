// Domain shapes shared across the main and renderer processes.
// These are the parsed/typed forms; the DB row forms (JSON-as-text) live in src/main/db/schema.ts.

// 'event' = WORLD-SCALE history (a city destroyed, a king assassinated — ADR-019), NOT a session
// beat; the party's own beats live in the event_log table.
// 'creature' = a monster/beast/hazard (a dragon, undead, a plant-swarm) — has tactics/weakness, not a
// social persona; distinct from 'npc' (a person). PC-only features (persona, in-character modes) skip it.
export type EntityType =
  | 'npc'
  | 'location'
  | 'faction'
  | 'quest'
  | 'item'
  | 'pc'
  | 'event'
  | 'creature'

export const ENTITY_TYPES: readonly EntityType[] = [
  'npc',
  'location',
  'faction',
  'quest',
  'item',
  'pc',
  'event',
  'creature'
]

/** Human labels for entity types (UI). */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  npc: 'NPC',
  location: 'Location',
  faction: 'Faction',
  quest: 'Quest',
  item: 'Item',
  pc: 'Player Character',
  event: 'Event',
  creature: 'Creature'
}

/** Chronology (ADR-017): the coarse lifecycle the AI trusts for past-vs-present reasoning.
 *  `presumed_ended` = believed gone/dead but UNCONFIRMED — the AI hedges instead of asserting it. */
export type Lifecycle = 'active' | 'ended' | 'presumed_ended' | 'unknown'

export const LIFECYCLES: readonly Lifecycle[] = ['active', 'ended', 'presumed_ended', 'unknown']

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  active: 'Active',
  ended: 'Fallen',
  presumed_ended: 'Presumed lost',
  unknown: 'Unknown'
}

/** Epistemic weight of a note (ADR-021): `confirmed` = observed/known; `rumored` = heard secondhand;
 *  `suspected` = the party's own hypothesis. The AI is told this so it hedges rather than asserting. */
export type NoteConfidence = 'confirmed' | 'rumored' | 'suspected'

export const NOTE_CONFIDENCES: readonly NoteConfidence[] = ['confirmed', 'rumored', 'suspected']

export const NOTE_CONFIDENCE_LABELS: Record<NoteConfidence, string> = {
  confirmed: 'Known',
  rumored: 'Hearsay',
  suspected: 'Whispered'
}

export interface Campaign {
  id: string
  name: string
  description: string | null
  mainCharacterId: string | null // the campaign's main character (a pc entity); default Recall/Suggest lens
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
  image: string | null // optional portrait — a base64 data URL (JPEG thumbnail); NOT embedded (P2-2)
  traits: string[] // promoted (Suggest reads these)
  goals: string[] // promoted
  flaws: string[] // promoted (ADR-026): a vice/fear/weakness — the richest roleplay hook
  voiceExamples: string[] // promoted (ADR-029): main-character-only sample lines; grounds Counsel/Converse voice
  attributes: Record<string, unknown> // open bag of type-specific fields
  status: string | null
  lifecycle: Lifecycle // chronology: coarse state the AI trusts; free-text `status` stays for nuance
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  campaignId: string // the note's home campaign (ADR-021) — a note may tag 0..N entities
  entityIds: string[] // the entities this note is associated with (M2M); MAY be empty (campaign lore)
  sessionId: string | null
  content: string
  tags: string[]
  confidence: NoteConfidence // epistemic weight the AI is told (ADR-021)
  createdAt: number
}

export interface EntityLink {
  id: string
  fromEntityId: string
  toEntityId: string
  relation: string // forward RelationKey (see @shared/relations)
  description: string | null // the "why/when" of the edge — the RAG-context lever
  // Tie enrichment (ADR-033): how each endpoint FEELS about the other (short free-text, per direction so
  // asymmetric feelings live on one edge); confidence mirrors note confidence so the AI can hedge.
  fromDisposition: string | null // how `from` feels about `to`
  toDisposition: string | null // how `to` feels about `from`
  confidence: NoteConfidence // 'confirmed' | 'rumored' | 'suspected' (ADR-021 vocabulary)
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

// The app is dark-only and has no font-size control; the former `theme`/`fontSize` settings were
// declared but never read, so they were removed (ROADMAP R-1/R-2). Dark lives unconditionally in
// globals.css; the Toaster hardcodes theme="dark".

export interface AppSettings {
  recallModel: 'claude-sonnet-4-6' | 'claude-opus-4-8'
  suggestModel: 'claude-sonnet-4-6' | 'claude-opus-4-8'
  suggestEffort: 'medium' | 'high'
  /** Extraction knobs (ADR-035 cost tuning): Transcribe + the session Extract tool + backstory derive.
   *  Structured work behind a validation net + review gate — a cheaper model at medium effort loses
   *  little; Counsel/Converse keep their own settings. */
  extractionModel: 'claude-sonnet-4-6' | 'claude-opus-4-8' | 'claude-haiku-4-5'
  extractionEffort: 'medium' | 'high'
  /** Illuminate (enrichment) knobs — DECOUPLED from extraction (ADR-051). Illuminate fires one call per
   *  touched entity, so it's the cost driver; it's review-gated, so it defaults to the cheapest tier. */
  illuminateModel: 'claude-sonnet-4-6' | 'claude-opus-4-8' | 'claude-haiku-4-5'
  illuminateEffort: 'medium' | 'high'
  hotkey: string
  /** First-run tutorial (ADR-044): the player's name (used for the Keeper's greeting) and whether the
   *  forced onboarding wizard has been completed. Both optional so old settings.json files stay valid. */
  userName?: string
  tutorialCompleted?: boolean
}
