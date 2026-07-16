# ADR-057: In-app bug reports — an email hand-off, never an upload

## Status

Accepted — **implemented**. A sidebar launcher (directly under Settings, inside the nav) + a dialog
(`components/BugReportDialog.tsx`) + `bugreport.service` + three IPC channels (`bugreport:diagnostics` /
`bugreport:capture` / `bugreport:submit`); **no migration**. Verified: typecheck + lint + 347 unit (7 new)
+ `tests/e2e/bugreport.spec.ts`. **Superseded in part by ADR-058** — the *transport*: submit now
auto-sends through a Cloudflare-Worker intake once deployed; this ADR's bundle + mail-draft flow remains
as the built-in fallback (endpoint unset, offline, or POST failure).

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

The first *unsupervised* tester cohort is approaching (the supervised-friends phase deferred crash
reporting and in-app feedback — see the deployment plan). Custos is local-first with **no backend**, and
its core promise is that nothing leaves the machine except Anthropic calls. Testers are non-technical
friends. The triage value of a report is mostly in diagnostics the user can't articulate — app version,
OS, AI-readiness (key/online/models), campaign scale, and the `main.log` tail (renderer crashes already
funnel there via `RENDERER_ERROR_CHANNEL`, P0-3). Needed: a low-friction report path that honors the
privacy promise.

## Decision

1. **Destination = email to the developer.** `BUG_REPORT_EMAIL` is a shared const (`@shared/ipc-types`) —
   both the mailto builder (main) and the dialog's copy-fallback (renderer) read it. Email needs no
   account, stays private, and fits a friends cohort. A GitHub-Issues button is deferred until the repo is
   public (cheap later: same `shell.openExternal`, different URL).
2. **The app never sends anything.** Submit writes a bundle — `userData/bug-reports/<stamp>/report.txt` +
   `screenshot-N.*` — opens a prefilled `mailto:` draft, and reveals the bundle via
   `shell.showItemInFolder`; the user drags the files into the email and presses send. Rejected
   alternatives: direct SMTP (credentials embedded in a distributed app), a hosted form service (external
   dependency + silent egress — fights local-first), `.eml`/MAPI compose-with-attachments (mail-client-
   specific and fragile). `mailto:` can't carry attachments and bodies get unreliable past a few KB, so the
   body is a preview (`buildMailtoUrl`, capped ~1.2 KB) and the full text lives in `report.txt`. A failed
   `openExternal` (no mail client) yields `mailOpened: false` → the dialog falls back to copy-report + the
   address; the folder reveal still happens.
3. **Fields (user-specified):** name (prefilled from `settings.userName`), a required description, and a
   screenshots spot — paste (Ctrl+V), drag-drop, file picker (cap 5), **plus an auto window snap** the
   launcher captures via `webContents.capturePage` *before* the dialog opens and covers the bug
   (pre-attached, removable). **Diagnostics are always included and attached silently** — no opt-out
   toggle and no in-dialog review panel (deliberate, twice revised: a report without diagnostics is hard
   to triage, and the panel was friction). Transparency survives at the file level: the block is plain
   text in the revealed bundle's `report.txt`, and nothing sends until the user drags it in and presses
   send. The dialog awaits the in-flight gather at submit, so a fast submit never drops the block;
   campaign size is **counts, never content**; the API key never appears (encrypted store, not the log).
4. **Entry point:** a nav-styled button directly under the Settings item (per request); the dialog follows
   the Transcribe pattern (a dialog, not a new view/ViewKey).

## Consequences

* **+** Zero backend, zero new dependencies; reuses `shell` + the image-over-IPC (base64 data URL)
  patterns; keyless-e2e-testable; pure helpers (`buildMailtoUrl` / `formatReportText` / `dataUrlToImage`)
  unit-tested.
* **+** The privacy posture is explicit and inspectable — every byte the report contains is on screen
  before the user sends it themselves.
* **−** Sending is two-step (drag the files in) — the honest cost of `mailto:`; the done-panel walks the
  user through it.
* **−** Bundles accumulate under `userData/bug-reports` (small, user-visible, no auto-prune yet).

**Deferred:** a crash-triggered "Report this?" toast prefilled from the `RENDERER_ERROR_CHANNEL` sink; a
GitHub-Issues destination; zipping the bundle (a folder of loose files is fine to drag).
