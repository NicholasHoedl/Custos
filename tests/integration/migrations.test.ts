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

/** A DB migrated up to (but not including) the chronology rework, seeded with varied-status entities. */
function seededPreChronologyDb(foreignKeys: 'ON' | 'OFF'): Database.Database {
  const db = new Database(':memory:')
  db.pragma(`foreign_keys = ${foreignKeys}`)
  applyInTransaction(
    db,
    migrationFiles().filter((f) => f < '0005')
  )
  db.prepare(
    'INSERT INTO campaign (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run('c1', 'Phandelver', null, 1, 1)
  const ent = db.prepare(
    'INSERT INTO entity (id, campaign_id, type, name, description, traits, goals, attributes, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  )
  ent.run('e1', 'c1', 'npc', 'Glasstaff', null, null, null, null, 'Dead', 1, 1) // -> ended
  ent.run('e2', 'c1', 'npc', 'Sildar', null, null, null, null, null, 1, 1) // -> unknown (null status)
  ent.run('e3', 'c1', 'location', 'Tresendar', null, null, null, null, 'Occupied', 1, 1) // -> active
  ent.run('e4', 'c1', 'faction', 'Redbrands', null, null, null, null, '  ', 1, 1) // -> unknown (whitespace)
  ent.run('e5', 'c1', 'pc', 'Aldric', null, null, null, null, null, 1, 1) // -> unknown (pc, for persona)
  db.prepare(
    'INSERT INTO entity_link (id, from_entity_id, to_entity_id, relation, description, campaign_id, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run('l1', 'e1', 'e3', 'located_in', null, 'c1', 1)
  // Children that must survive the migration (must NOT cascade-wipe).
  db.prepare(
    'INSERT INTO entity_embedding (entity_id, model, dim, vector, content_hash, updated_at) VALUES (?,?,?,?,?,?)'
  ).run('e1', 'm', 1, Buffer.from([0, 1, 2, 3]), 'h', 1)
  db.prepare(
    'INSERT INTO pc_persona (entity_id, brief, edited, stale, source_hash, model, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('e5', 'Aldric is brave.', 0, 0, 'h', null, 1, 1)
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

describe('chronology migration (0005 lifecycle backfill + validity intervals)', () => {
  it('with FK off (production toggle): backfills lifecycle + baseline history, preserves children', () => {
    const db = seededPreChronologyDb('OFF')
    applyInTransaction(
      db,
      migrationFiles().filter((f) => f >= '0005')
    )

    const life = (id: string): string =>
      (db.prepare('SELECT lifecycle FROM entity WHERE id = ?').get(id) as { lifecycle: string })
        .lifecycle
    expect(life('e1')).toBe('ended') // status 'Dead'
    expect(life('e2')).toBe('unknown') // status NULL
    expect(life('e3')).toBe('active') // status 'Occupied'
    expect(life('e4')).toBe('unknown') // whitespace-only status
    expect(life('e5')).toBe('unknown') // status NULL

    // Exactly one baseline row per entity, all pre-tracking (since_session_number NULL).
    expect(db.prepare('SELECT count(*) AS c FROM status_history').get()).toEqual({ c: 5 })
    expect(
      db
        .prepare('SELECT count(*) AS c FROM status_history WHERE since_session_number IS NOT NULL')
        .get()
    ).toEqual({ c: 0 })
    // The baseline captured the derived lifecycle + the original free-text status.
    expect(
      db.prepare('SELECT lifecycle, status FROM status_history WHERE entity_id = ?').get('e1')
    ).toEqual({ lifecycle: 'ended', status: 'Dead' })

    // Existing relationships become open, pre-tracking intervals (both numbers NULL).
    expect(
      db
        .prepare(
          'SELECT start_session_number AS s, end_session_number AS e FROM entity_link WHERE id = ?'
        )
        .get('l1')
    ).toEqual({ s: null, e: null })

    // No cascade wipe: the entity embedding + PC persona survive the migration.
    expect(db.prepare('SELECT count(*) AS c FROM entity_embedding').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT count(*) AS c FROM pc_persona').get()).toEqual({ c: 1 })
    db.close()
  })

  it('the partial unique index blocks two OPEN intervals but allows sever -> reform', () => {
    const db = seededPreChronologyDb('OFF')
    applyInTransaction(
      db,
      migrationFiles().filter((f) => f >= '0005')
    )
    const insert = (id: string, start: number | null, end: number | null): void => {
      db.prepare(
        'INSERT INTO entity_link (id, from_entity_id, to_entity_id, relation, description, campaign_id, created_at, start_session_number, end_session_number) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(id, 'e1', 'e3', 'located_in', null, 'c1', 1, start, end)
    }
    // l1 (seeded) is an OPEN located_in edge; a second OPEN duplicate must be rejected.
    expect(() => insert('l2', null, null)).toThrow()
    // Sever l1 (set an end); a fresh OPEN duplicate is then allowed — the reformed relationship.
    db.prepare('UPDATE entity_link SET end_session_number = 2 WHERE id = ?').run('l1')
    expect(() => insert('l3', 3, null)).not.toThrow()
    db.close()
  })
})
