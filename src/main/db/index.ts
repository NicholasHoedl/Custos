import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type LedgerDb = BetterSQLite3Database<typeof schema>

let db: LedgerDb | null = null

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
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  return db
}

/** Startup smoke check: proves the DB is migrated and queryable. Returns the campaign count. */
export function dbHealthCheck(): number {
  return getDb().select().from(schema.campaign).all().length
}
