import fs from 'node:fs'
import { join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'

// Rotating on-launch database backups (quality-review T1). The campaign DB is irreplaceable and a
// stale-WAL incident has already reverted data once — every launch snapshots the pre-migration state
// so any corruption/bad-migration event has a same-day restore point.

/**
 * Take a consistent snapshot of the OPEN database into `backupsDir`, pruning to the `keep` newest.
 * Uses `VACUUM INTO` — WAL-safe (reads through the live connection, so it captures exactly what the
 * app sees) and compacted. The destination is a bound parameter, so Windows paths containing
 * apostrophes (user names) need no escaping. NEVER throws: a failed backup warns and returns null —
 * a snapshot must never block startup.
 */
export function backupDatabase(
  raw: BetterSqlite3.Database,
  backupsDir: string,
  keep = 5,
  warn: (message: string, err: unknown) => void = (m, e) => console.warn(m, e)
): string | null {
  try {
    fs.mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-') // ':' is illegal in Windows filenames
    const dest = join(backupsDir, `ledger-${stamp}.db`)
    raw.prepare('VACUUM INTO ?').run(dest)
    prune(backupsDir, keep)
    return dest
  } catch (err) {
    warn('database backup failed (continuing startup)', err)
    return null
  }
}

/** Delete all but the `keep` newest snapshots. ISO stamps sort lexicographically = chronologically. */
function prune(backupsDir: string, keep: number): void {
  const stale = fs
    .readdirSync(backupsDir)
    .filter((f) => /^ledger-.*\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep)
  for (const f of stale) fs.unlinkSync(join(backupsDir, f))
}
