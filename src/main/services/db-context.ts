import type Database from 'better-sqlite3'
import type { LedgerDb } from '../db'

/** Services receive the DB so they stay testable on an in-memory database. */
export interface DbContext {
  drizzle: LedgerDb
  raw: Database.Database
}
