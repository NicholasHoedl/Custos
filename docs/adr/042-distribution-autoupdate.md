# ADR-042: Distribution — auto-update via GitHub Releases, CI release job, proprietary license

## Status

Accepted — **implemented** (ROADMAP P2-1). Adds an auto-update mechanism (electron-updater against public
GitHub Releases), a tag-triggered CI release workflow, a proprietary `LICENSE`, and package metadata
(`engines`/`repository`/`homepage`). **Revises the auto-update deferral in ADR-020** (which stays Accepted
for its backup/logging/recovery scope). No migration. Verified: typecheck + lint + 263 unit + 10 e2e green
(the updater is packaged-only, so it no-ops in dev/e2e); `npm run dist` emits the installer + `latest.yml`.

**Date:** 2026-07-10
**Deciders:** Solo developer

## Context

Ledger already produced a versioned NSIS installer (`npm run dist` → `Ledger Setup X.Y.Z.exe`), but had no
way to **ship updates**, no license file (despite a stale `"MIT"` in `package.json`), and no release
automation. ADR-020 had deliberately deferred auto-update ("out of scope for a local-first single-user
app; the rotating local snapshot is the 80/20"). Now that the app is audit-complete (P0/P1/P2) and ready
to hand to other people, that deferral is worth reversing — a self-updating installer is the difference
between "a build I can send" and "an app people can keep."

## Decision

**Auto-update via electron-updater reading the repo's public GitHub Releases.**
- A `publish: { provider: github, owner, repo }` block in `electron-builder.yml` makes the build emit
  `latest.yml` (the update feed) beside the `.exe` + `.blockmap`.
- A new `services/updater.service.ts` wires `electron-updater`: on launch it
  `checkForUpdatesAndNotify()` (background download + native notify on quit), and its lifecycle events
  (`checking` / `available` / `download-progress` / `downloaded` / `error`) are pushed to the renderer on
  `UPDATE_STATUS_CHANNEL` — mirroring the existing model-download-progress channel. `autoUpdater.logger`
  is the same `electron-log` instance, so updater output lands in `userData/logs/main.log`.
- **Packaged-only.** `if (!app.isPackaged) return` — in dev / e2e (unpackaged) there is no `latest.yml`
  and electron-updater would throw, so it no-ops and the Settings control reports `disabled`. Same guard
  philosophy as the fake-AI seam (ADR-041). Every failure — most often a 404 before the first release is
  published — is logged and surfaced as a benign `error` status; nothing crashes.
- **Settings surface.** The "Your data" section gains a **Check for updates** button (manual
  `update:check`) + a status line, swapping to **Restart to update** (`update:install` →
  `quitAndInstall`) once a build is downloaded.

**A tag-triggered CI release job** (`.github/workflows/release.yml`, separate from the test-only
`ci.yml`): on a `v*` tag push it builds on `windows-latest` and runs `electron-builder --publish always`,
uploading the installer + feed to a **draft** GitHub Release (the maintainer publishes it to go live —
a safety gate). `GH_TOKEN` is the workflow's `GITHUB_TOKEN` (`contents: write`).

**Proprietary license.** `package.json` `license` → `"UNLICENSED"` (`private: true` already set); a new
`LICENSE` reserves all rights (source-available for reference, no reuse/redistribution without written
permission; personal use of official releases allowed). README updated to match.

**Unsigned, cert-ready.** Builds ship unsigned (SmartScreen "unknown publisher" warning). No signing
config is needed — electron-builder auto-signs when `CSC_LINK` + `CSC_KEY_PASSWORD` are present, and the
release workflow already passes those secrets through (empty ⇒ unsigned). Adding a certificate later is a
secrets-only change.

### The proprietary-but-public tension
Token-free auto-update requires the GitHub **Releases** to be **public**. So the shipping shape is a
*public repo + a proprietary license* (source-visible, reuse forbidden) — chosen consciously over a
private repo, which would need a token embedded in the app (insecure) or a self-hosted `generic` feed.

## Consequences

### Positive
- Installed copies update themselves; releases are one `git tag` + one "Publish" click away.
- Zero new runtime risk in dev/test — the updater is packaged-gated and inert everywhere except the
  installed app.
- Signing is a drop-in later (two secrets), not a rebuild of the pipeline.

### Negative / Risks
- **Public releases** expose the source despite the proprietary license (mitigated by the LICENSE terms).
- **Unsigned** installers trip SmartScreen until a cert/reputation exists — documented in README +
  RELEASING.md.
- The updater can't be unit/e2e-tested (packaged-only); coverage is the packaged-gate + a manual install
  check + the local `npm run dist` feed-emission check.
- Owner/repo casing must match the real GitHub repo exactly, and the repo must actually exist before the
  first release resolves (until then the launch check 404s → benign).

## Related Decisions
- **ADR-020** (operational hardening) — revises its deferral of auto-update; its backup/logging/recovery
  decisions stand. ADR-006 (build tooling — electron-builder, "layered on later"). ADR-041 (the
  `!app.isPackaged` guard style + packaged-only seams).

## References
- `electron-builder.yml` (`publish`), `src/main/services/updater.service.ts`, `src/main/ipc/update.ts`
  (+ registration in `handlers.ts`), `src/shared/ipc-types.ts` (`UPDATE_STATUS_CHANNEL` / `UpdateStatus`),
  `src/preload/index.ts`, `src/renderer/src/components/views/SettingsView.tsx`.
- `.github/workflows/release.yml`; `LICENSE`; `RELEASING.md`; `package.json` (`license`/`engines`/
  `repository`/`homepage`).
