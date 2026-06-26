import { BrowserWindow } from 'electron'
import { getDb, getRawDb } from '../db'
import type { DbContext } from '../services/db-context'
import { BruteForceVectorStore } from '../services/vector-store.service'
import { backfill } from '../services/embedding-index.service'
import { registerCampaignHandlers } from './campaign'
import { registerSessionHandlers } from './session'
import { registerEntityHandlers } from './entity'
import { registerNoteHandlers } from './note'
import { registerEventHandlers } from './event'
import { registerLinkHandlers } from './link'
import { registerGraphHandlers } from './graph'
import { registerSearchHandlers } from './search'
import { registerSettingsHandlers } from './settings'
import { registerOnboardingHandlers } from './onboarding'
import { registerRecallHandlers } from './recall'
import { registerPersonaHandlers } from './persona'

/** Send a one-way event to the renderer (streaming: recall chunks, model-download progress). */
export type Send = (channel: string, payload: unknown) => void

/**
 * Registers all IPC handlers, backed by the service layer. The DB is opened once and shared as a
 * DbContext (Drizzle for CRUD + the raw better-sqlite3 handle for recursive-CTE graph queries — ADR-011).
 * `getWindow` is read lazily so streaming handlers always target the current window.
 */
export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const ctx: DbContext = { drizzle: getDb(), raw: getRawDb() }
  const send: Send = (channel, payload) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const store = new BruteForceVectorStore(ctx)
  const reindex = (): Promise<number> => backfill(ctx, store)

  registerCampaignHandlers(ctx)
  registerSessionHandlers(ctx)
  registerEntityHandlers(ctx, store)
  registerNoteHandlers(ctx, store)
  registerEventHandlers(ctx)
  registerLinkHandlers(ctx)
  registerGraphHandlers(ctx)
  registerSearchHandlers(ctx)
  registerSettingsHandlers()
  registerOnboardingHandlers(send, reindex)
  registerRecallHandlers(ctx, store, send)
  registerPersonaHandlers(ctx)

  void reindex() // embed anything unindexed (no-ops until the model is downloaded)
}
