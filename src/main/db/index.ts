import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type LedgerDb = BetterSQLite3Database<typeof schema>

let db: LedgerDb | null = null
let rawDb: Database.Database | null = null

function migrationsFolder(): string {
  // Dev: <repo>/drizzle (out/main -> ../../drizzle). Packaged: resources/drizzle (electron-builder extraResources).
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(__dirname, '../../drizzle')
}

/** Opens (once) the local SQLite database, applies pending migrations, and returns the Drizzle handle. */
export function getDb(): LedgerDb {
  if (db) return db
  const file = join(app.getPath('userData'), 'ledger.db')
  rawDb = new Database(file)
  rawDb.pragma('journal_mode = WAL')
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
  } catch {
    // best-effort: if a checkpoint can't complete we still close cleanly below
  }
  rawDb.close()
  rawDb = null
  db = null
}
