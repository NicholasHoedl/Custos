import { app } from 'electron'
import fs from 'node:fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import log from 'electron-log/main'
import * as schema from './schema'
import { backupDatabase } from './backup'

const dlog = log.scope('db')

export type LedgerDb = BetterSQLite3Database<typeof schema>

let db: LedgerDb | null = null
let rawDb: Database.Database | null = null

function migrationsFolder(): string {
  // Dev: <repo>/drizzle (out/main -> ../../drizzle). Packaged: resources/drizzle (electron-builder extraResources).
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}

/**
 * One-time rebrand carry-over (Ledger → Custos). The app was renamed, which moves its data folder from
 * `%APPDATA%\Ledger` to `%APPDATA%\Custos` and the DB from `ledger.db` to `custos.db`. If this is a fresh
 * Custos folder but a legacy Ledger folder with a `ledger.db` exists, copy the legacy contents over —
 * renaming `ledger.db*` → `custos.db*` — so an existing user keeps their campaign, API key, downloaded
 * model, settings, and backups. Non-destructive: never overwrites anything already in the new folder, and
 * leaves the old folder untouched as a fallback. Runs only when there is no `custos.db` yet.
 */
function migrateLegacyLedgerData(): void {
  const userData = app.getPath('userData') // e.g. %APPDATA%\Custos
  if (fs.existsSync(join(userData, 'custos.db'))) return // already have Custos data
  const legacyDir = join(app.getPath('appData'), 'Ledger')
  if (!fs.existsSync(join(legacyDir, 'ledger.db'))) return // fresh install — nothing to carry over
  try {
    fs.mkdirSync(userData, { recursive: true })
    for (const entry of fs.readdirSync(legacyDir)) {
      const renamed = entry.startsWith('ledger.db')
        ? entry.replace('ledger.db', 'custos.db')
        : entry
      const dest = join(userData, renamed)
      if (fs.existsSync(dest)) continue // never clobber anything already in the new folder
      fs.cpSync(join(legacyDir, entry), dest, { recursive: true })
    }
    dlog.info('rebrand: carried existing Ledger data over to Custos')
  } catch (e) {
    dlog.warn('rebrand: Ledger → Custos data carry-over failed', e)
  }
}

/** Opens (once) the local SQLite database, applies pending migrations, and returns the Drizzle handle. */
export function getDb(): LedgerDb {
  if (db) return db
  migrateLegacyLedgerData() // carry a pre-rename %APPDATA%\Ledger install over to \Custos, once
  const file = join(app.getPath('userData'), 'custos.db')
  const existedBeforeOpen = fs.existsSync(file) // BEFORE open — opening creates the file
  rawDb = new Database(file)
  rawDb.pragma('journal_mode = WAL')
  // Rotating pre-migration snapshot (T1 data safety): every launch of an existing DB banks a
  // consistent restore point BEFORE migrations touch it. Never blocks startup.
  if (existedBeforeOpen) {
    const dest = backupDatabase(rawDb, join(app.getPath('userData'), 'backups'), 5, (m, e) =>
      dlog.warn(m, e)
    )
    if (dest) dlog.info(`backup written: ${dest}`)
  }
  db = drizzle(rawDb, { schema })
  // Run migrations with FK enforcement OFF, then restore it for all runtime queries. SQLite drops a
  // column by rebuilding the table (CREATE new / copy / DROP old / RENAME); with foreign_keys ON, the
  // DROP's implicit row-delete cascades into child tables (note_embedding, note_entity) and silently
  // wipes them. PRAGMA foreign_keys is a no-op inside a transaction, and the migrator wraps all
  // migrations in one, so it must be toggled here — outside that transaction (ADR-004 seed safety).
  rawDb.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder: migrationsFolder() })
  } finally {
    rawDb.pragma('foreign_keys = ON') // always restore enforcement, even if a migration throws
  }
  return db
}

/**
 * The underlying better-sqlite3 handle — used by the graph service for recursive-CTE traversal and
 * by search (Drizzle's query builder does not model `WITH RECURSIVE`). CRUD goes through Drizzle. (ADR-011)
 */
export function getRawDb(): Database.Database {
  if (!rawDb) getDb()
  return rawDb as Database.Database
}

/** Startup smoke check: proves the DB is migrated and queryable. Returns the campaign count. */
export function dbHealthCheck(): number {
  return getDb().select().from(schema.campaign).all().length
}

/**
 * Checkpoint the write-ahead log into the main DB file and close the handle. Called on app quit so we
 * never leave an uncheckpointed WAL behind — a stale WAL from an unclean shutdown can silently revert
 * committed writes the next time the file is opened (ADR-004; this is the root cause of the seed-loss
 * we hit during Phase 2 dogfooding).
 */
export function closeDb(): void {
  if (!rawDb) return
  try {
    rawDb.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) {
    // Still close below — but this is the exact failure class that once reverted committed data
    // (stale WAL), so it must leave a trail (T1 data safety).
    dlog.error('WAL checkpoint failed on quit — a stale WAL may remain', err)
  }
  rawDb.close()
  rawDb = null
  db = null
}
