import type {
  Campaign,
  Entity,
  EntityLink,
  EventLogEntry,
  Note,
  Session,
  StatusHistoryEntry
} from './entity-types'
import type { PersonaBrief } from './recall-types'

// A portable, self-contained snapshot of ONE campaign's whole graph (export-only, ADR pending). It's a
// second backup channel and the "campaign portability" out-path. Embeddings are intentionally OMITTED —
// they regenerate from content on load (embedding-index backfill), keeping the file small and
// model-version-independent. A round-trip IMPORT is a separate, larger project (id remapping + FK order
// + session-number/chronology-interval integrity); this defines only the export shape.

export const CAMPAIGN_EXPORT_VERSION = 1

export interface CampaignExport {
  version: number
  exportedAt: number
  campaign: Campaign
  sessions: Session[]
  entities: Entity[]
  /** Append-only chronology trail (all entities); baseline + dated changes. */
  statusHistory: StatusHistoryEntry[]
  /** Each note carries its `entityIds` — the note↔entity M2M is captured there, no separate join array. */
  notes: Note[]
  /** All edges, live and severed (validity intervals preserved). */
  entityLinks: EntityLink[]
  eventLog: EventLogEntry[]
  /** In-character briefs for PC entities (content + flags; source hash omitted, recomputed on import). */
  personae: PersonaBrief[]
}

/** Result of the main-process export handler (after the save dialog). */
export type CampaignExportResult =
  | { ok: true; path: string; counts: { entities: number; notes: number; links: number } }
  | { ok: false; canceled: true }
  | { ok: false; error: string }
