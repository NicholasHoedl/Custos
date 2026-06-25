import { getDb, getRawDb } from '../db'
import type { DbContext } from '../services/db-context'
import { registerCampaignHandlers } from './campaign'
import { registerSessionHandlers } from './session'
import { registerEntityHandlers } from './entity'
import { registerNoteHandlers } from './note'
import { registerEventHandlers } from './event'
import { registerLinkHandlers } from './link'
import { registerGraphHandlers } from './graph'
import { registerSearchHandlers } from './search'
import { registerSettingsHandlers } from './settings'

/**
 * Registers all IPC handlers, backed by the service layer. The DB is opened once and shared as a
 * DbContext (Drizzle for CRUD + the raw better-sqlite3 handle for recursive-CTE graph queries — ADR-011).
 * The AI channels (recall/suggest/stream) declared in ipc-types are intentionally NOT wired — Phase 2.
 */
export function registerIpcHandlers(): void {
  const ctx: DbContext = { drizzle: getDb(), raw: getRawDb() }
  registerCampaignHandlers(ctx)
  registerSessionHandlers(ctx)
  registerEntityHandlers(ctx)
  registerNoteHandlers(ctx)
  registerEventHandlers(ctx)
  registerLinkHandlers(ctx)
  registerGraphHandlers(ctx)
  registerSearchHandlers(ctx)
  registerSettingsHandlers()
}
