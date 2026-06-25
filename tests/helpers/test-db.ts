import { resolve } from 'path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../../src/main/db/schema'
import type { DbContext } from '../../src/main/services/db-context'

/** A fresh in-memory database with all migrations applied — services run against the real schema. */
export function makeTestDb(): DbContext {
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  const drz = drizzle(raw, { schema })
  migrate(drz, { migrationsFolder: resolve(process.cwd(), 'drizzle') })
  return { drizzle: drz, raw }
}
