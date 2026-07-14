# ADR-020: Operational hardening — backups, logging, and startup recovery

## Status

Accepted

**Date:** 2026-07-02
**Deciders:** Solo developer

## Context

A quality review (2026-07-02) found the engineering core strong but the *operational* shell weak.
The campaign database is a single irreplaceable SQLite file, and a stale-WAL incident had already
reverted committed data once during dogfooding (ADR-004). Yet the app had: **no backups**; a
**silently-swallowed** WAL-checkpoint failure on quit (the exact prior failure class); a **brick
with no message** if a migration ever threw at startup (the crash happened before any window
existed); **no persistent log** (diagnostics went to a DevTools console lost on restart); **no React
error boundary** (a renderer render-crash blanked the window mid-session); and **ten unhandled
renderer IPC fetches** that failed to empty lists silently. None of these were feature gaps — they
were the difference between "an excellent codebase" and "software you can rely on at the table for
years."

## Decision Drivers

* Make the irreplaceable data *un-loseable* — a same-day restore point for any corruption or bad
  migration, with zero risk to normal launches.
* Leave a **forensic trail** when something misbehaves on the user's machine.
* Fail **loudly and recoverably**, never silently — at startup, in the main process, and in the
  renderer.
* Reuse what exists; add no runtime dependency that isn't pulling real weight.

## Decision

Ship an operational-safety layer, main-process-first:

1. **Rotating pre-migration backups.** On every launch of an *existing* DB, `src/main/db/backup.ts`
   takes a consistent snapshot via `VACUUM INTO` (WAL-safe; a bound parameter, so Windows paths with
   apostrophes need no escaping) into `userData/backups/ledger-<stamp>.db`, pruned to the 5 newest.
   It runs **before** migrations touch the file and **never throws** — a failed backup logs a warning
   and continues. The fresh-install case is skipped (checked before the DB is opened, since opening
   creates the file).
2. **Persistent logging.** `electron-log` writes `userData/logs/main.log` (1 MiB rotation). Main
   process only — no `log.initialize()` (that bridges into the sandboxed renderer, which we don't
   want); the renderer surfaces its own errors via toasts. `log.errorHandler.startCatching` captures
   uncaught main exceptions/rejections. The five scattered `console.*` sites are migrated to scoped
   loggers. The previously-silent WAL-checkpoint failure now logs an error.
3. **Startup recovery dialog.** `getDb()` + the health check are wrapped in try/catch; a failure logs
   the error and shows a native `dialog.showMessageBoxSync` ("Custos cannot start" → *Open data
   folder* / *Quit*) that points at the backups and the log, then quits cleanly (firing the
   WAL-checkpoint close). No window, IPC, or hotkey starts on the failure path.
4. **Renderer resilience.** A hand-rolled `ErrorBoundary` (React still needs a class for
   `componentDidCatch`) wraps the app with a design-language fallback + reload. A `.catch`-audit
   closed all ten unhandled IPC fetches behind one **id-deduped** error toast (a dead backend shows a
   single toast, not one per hook); genuinely best-effort paths (debounced search, a supplementary
   hierarchy tree, a delete-dialog count) are marked as intentional degradations.
5. **Session durability.** `activeSessionId` now persists **per campaign** and restores
   synchronously on launch/campaign-switch, so a note is never filed against a not-yet-known session;
   capture surfaces show a brief "restoring" state to distinguish it from a zero-session campaign.

## Considered Options (data safety)

- **better-sqlite3 `db.backup()`** — async (a `setImmediate` transfer loop); awkward and racy inside
  the synchronous `getDb()`. Rejected.
- **`fs.copyFileSync` of the db + `-wal`/`-shm` before opening** — not guaranteed consistent between
  checkpoints. Rejected.
- **`VACUUM INTO` (chosen)** — synchronous, reads through the live connection (captures exactly what
  the app sees, WAL and all), and produces a compacted single-file copy.
- **Full auto-update / cloud backup (electron-updater, remote sync)** — deferred; out of scope for a
  local-first single-user app. The rotating local snapshot is the 80/20.

## Consequences

### Positive
- Every launch banks a restore point; a corrupt DB or bad migration is recoverable same-day, and the
  startup dialog tells the user exactly where to look.
- Real diagnostics survive restarts; the silent failure classes (checkpoint, IPC fetch, main
  exceptions) now leave a trail or a toast.
- A renderer crash is recoverable in place instead of blanking the window.

### Negative / Risks
- One extra `VACUUM INTO` per launch (fast at this scale; grows with DB size — revisit if it ever
  becomes perceptible).
- Backups accumulate ~5× the DB size on disk (bounded by the rotation).
- The recovery dialog covers open/migrate failure; a mid-session corruption still relies on the WAL
  discipline and the backups, not live detection.

## Packaging note (why `--config.npmRebuild=false`)

`npm run dist` packages with `electron-builder --config.npmRebuild=false`. `better-sqlite3` is
already compiled for the Electron ABI by the `postinstall` (`electron-builder install-app-deps`), so
the package-time rebuild is redundant — and it also tries to rebuild **sharp**, an *unused*
transitive dependency of `@xenova/transformers` (Custos embeds text only, never images), whose
`libvips` DLLs intermittently fail to unlink on Windows. Skipping the rebuild packages the
already-correct binaries and never touches sharp. A future slim-down could also exclude
`node_modules/sharp/**` from the bundle, pending a check that transformers' optional sharp-require
degrades gracefully.

## Related Decisions

- ADR-004 — the datastore + the WAL/seed-loss history this hardens against.
- ADR-006 — electron-vite / electron-builder; this adds the icon + `dist` script + CI on top.
- ADR-008 — the streaming IPC protocol (already error-classified); this closes the *non-streaming*
  fetch gaps.

## References

- `src/main/db/backup.ts`, `src/main/db/index.ts`, `src/main/index.ts`
- `src/renderer/src/components/ErrorBoundary.tsx`, `src/renderer/src/hooks/use-ledger.ts`
- `src/renderer/src/store/app-store.ts` (per-campaign session persistence)
- `.github/workflows/ci.yml`, `electron-builder.yml`, `build/icon.png`
- `../../SPEC.md` §10 (Delivered beyond the MVP)
