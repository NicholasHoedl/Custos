import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import Database from 'better-sqlite3'

// These tests exercise the raw migration SQL the way the production migrator does (drizzle wraps ALL
// pending migrations in ONE transaction — sqlite-core/dialect migrate()), to prove the note → M2M
// rework (0003 backfill + 0004 column-drop rebuild) preserves seeded data. The whole hazard: dropping
// note.entity_id rebuilds the table (DROP + recreate), and DROP TABLE with foreign_keys ON does an
// implicit row-delete that CASCADES into note_embedding + note_entity. The guard is toggling FK off
// AROUND migrate() (src/main/db/index.ts), since PRAGMA foreign_keys is a no-op inside a transaction.

const DRIZZLE = resolve(process.cwd(), 'drizzle')

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

function statements(file: string): string[] {
  return readFileSync(resolve(DRIZZLE, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Apply a set of migration files inside a single transaction — exactly how drizzle's migrator runs. */
function applyInTransaction(db: Database.Database, files: string[]): void {
  db.exec('BEGIN')
  try {
    for (const f of files) for (const stmt of statements(f)) db.exec(stmt)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** A DB migrated up to (but not including) the note rework, with a minimal seeded graph. */
function seededPreReworkDb(foreignKeys: 'ON' | 'OFF'): Database.Database {
  const db = new Database(':memory:')
  db.pragma(`foreign_keys = ${foreignKeys}`)
  applyInTransaction(
    db,
    migrationFiles().filter((f) => f < '0003')
  )
  // Seed a minimal valid graph (parents first, so it holds even under FK on): campaign → entity →
  // note (carrying the legacy single entity_id) → embedding — mirroring the seeded LMoP campaign.
  db.prepare(
    'INSERT INTO campaign (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run('c1', 'Phandelver', null, 1, 1)
  db.prepare(
    'INSERT INTO entity (id, campaign_id, type, name, description, traits, goals, attributes, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run('e1', 'c1', 'npc', 'Glasstaff', null, null, null, null, null, 1, 1)
  db.prepare(
    'INSERT INTO note (id, entity_id, session_id, content, tags, created_at) VALUES (?,?,?,?,?,?)'
  ).run('n1', 'e1', null, 'Glasstaff led the Redbrands.', null, 123)
  db.prepare(
    'INSERT INTO note_embedding (note_id, model, dim, vector, content_hash, updated_at) VALUES (?,?,?,?,?,?)'
  ).run('n1', 'm', 1, Buffer.from([0, 1, 2, 3]), 'h', 1)
  return db
}

describe('note M2M migration (0003 backfill + 0004 column drop)', () => {
  it('with FK off (the production toggle): backfills the join and preserves the embedding', () => {
    const db = seededPreReworkDb('OFF')
    applyInTransaction(
      db,
      migrationFiles().filter((f) => f >= '0003')
    )

    // The legacy association became a join row.
    expect(db.prepare('SELECT note_id, entity_id FROM note_entity').all()).toEqual([
      { note_id: 'n1', entity_id: 'e1' }
    ])
    // The table rebuild did NOT cascade-delete the embedding.
    expect(db.prepare('SELECT count(*) AS c FROM note_embedding').get()).toEqual({ c: 1 })
    // The note survived intact, minus its entity_id column.
    const cols = (db.prepare('PRAGMA table_info(note)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(cols).not.toContain('entity_id')
    expect(db.prepare('SELECT content FROM note WHERE id = ?').get('n1')).toEqual({
      content: 'Glasstaff led the Redbrands.'
    })
    db.close()
  })

  it('with FK on: the rebuild WOULD cascade-wipe children — why migrate() must disable them', () => {
    const db = seededPreReworkDb('ON')
    applyInTransaction(
      db,
      migrationFiles().filter((f) => f >= '0003')
    )

    // The embedded `PRAGMA foreign_keys=OFF` in 0004 is a no-op inside the transaction, so the
    // DROP TABLE cascades and the backfilled join + the embedding are lost. This is the data loss
    // the index.ts toggle prevents; if this assertion ever flips, the guard has been removed.
    expect(db.prepare('SELECT count(*) AS c FROM note_entity').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT count(*) AS c FROM note_embedding').get()).toEqual({ c: 0 })
    db.close()
  })
})
