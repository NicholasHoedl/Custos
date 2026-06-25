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
  rawDb.pragma('foreign_keys = ON')
  db = drizzle(rawDb, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
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
