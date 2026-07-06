import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { backupDatabase } from '../../../src/main/db/backup'

// Real better-sqlite3 against a temp dir — no electron. Windows trap: every handle must be closed
// before rmSync or the unlink fails with EBUSY (handled via the `open` list + afterEach).

const open: Database.Database[] = []
const dirs: string[] = []

function tempDir(): string {
  const d = fs.mkdtempSync(join(os.tmpdir(), 'ledger-backup-'))
  dirs.push(d)
  return d
}
function makeDb(dir: string): Database.Database {
  const db = new Database(join(dir, 'ledger.db'))
  open.push(db)
  db.exec('CREATE TABLE t (v TEXT)')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello')
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('backupDatabase', () => {
  it('writes a consistent, openable snapshot that carries the data', () => {
    const dir = tempDir()
    const db = makeDb(dir)
    const backupsDir = join(dir, 'backups')

    const dest = backupDatabase(db, backupsDir)
    expect(dest).toBeTruthy()
    expect(fs.existsSync(dest!)).toBe(true)

    const snap = new Database(dest!, { readonly: true })
    open.push(snap)
    expect(snap.prepare('SELECT v FROM t').get()).toEqual({ v: 'hello' })
  })

  it('prunes to the `keep` newest (older snapshots removed)', () => {
    const dir = tempDir()
    const db = makeDb(dir)
    const backupsDir = join(dir, 'backups')
    fs.mkdirSync(backupsDir, { recursive: true })
    // Seed six older snapshots (lexicographic timestamps sort chronologically). The real snapshot
    // below stamps at "now" (2026+), so it is the newest of the seven.
    for (const y of ['2001', '2002', '2003', '2004', '2005', '2006']) {
      fs.writeFileSync(join(backupsDir, `ledger-${y}-01-01T00-00-00-000Z.db`), '')
    }

    backupDatabase(db, backupsDir, 5)

    const remaining = fs.readdirSync(backupsDir).sort()
    expect(remaining).toHaveLength(5)
    // The two oldest seeds are gone; a fresh real snapshot is present.
    expect(remaining).not.toContain('ledger-2001-01-01T00-00-00-000Z.db')
    expect(remaining).not.toContain('ledger-2002-01-01T00-00-00-000Z.db')
    expect(remaining.some((f) => /^ledger-20[2-9]\d-/.test(f))).toBe(true)
  })

  it('never throws — a failed snapshot warns and returns null', () => {
    const dir = tempDir()
    const db = makeDb(dir)
    db.close() // a closed handle makes VACUUM INTO throw
    let warned = false
    const dest = backupDatabase(db, join(dir, 'backups'), 5, () => {
      warned = true
    })
    expect(dest).toBeNull()
    expect(warned).toBe(true)
  })
})
