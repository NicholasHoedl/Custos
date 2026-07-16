# ADR-058: Bug-report auto-send — a Cloudflare-Worker intake in front of Resend

## Status

Accepted — **implemented** (supersedes the *transport* decision of ADR-057; everything else there —
fields, silent diagnostics, the bundle, the entry point — stands). App side + worker source are built
and inert until deployed: `BUG_REPORT_ENDPOINT` (`@shared/ipc-types`) is EMPTY, so submit uses the
ADR-057 fallback flow unchanged. Verified: typecheck + lint + unit (incl. auto-send + fallback with a
stubbed fetch) + `bugreport.spec` e2e.

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

ADR-057 chose a deliberately send-nothing design: bundle + prefilled `mailto:` + drag-the-files. In
practice the two-step hand-off is real friction for non-technical testers, and the user wants one-click
"Send report" delivered to CustosService@outlook.com. True auto-send requires *something* to
authenticate to a mail server — and a distributed Electron app can safely hold no sending credential
(an asar unpacks trivially; Microsoft is retiring basic-auth SMTP on personal accounts; user-supplied
SMTP would demand testers' own credentials). So sending must move off the client.

## Decision

1. **A minimal hosted intake**: `infra/bugreport-worker/` — a single-file Cloudflare Worker (free tier,
   `*.workers.dev`, no domain) that validates the POST and forwards it to the **Resend** API as an
   email with the screenshots attached. The Resend account is created WITH CustosService@outlook.com,
   so the free built-in sender (`onboarding@resend.dev` → deliverable only to the account owner) needs
   no custom domain. `RESEND_API_KEY` lives only as a Worker secret — never in the app.
2. **A shared spam-gate token** (`BUG_REPORT_TOKEN` const = the worker's `REPORT_TOKEN` secret), sent
   as `x-custos-report`. It ships in the app bundle, so it is a bar-raiser against drive-by spam, not a
   true secret — accepted at friends-cohort scale. The worker also caps sizes (5 shots / ~12 MB base64,
   bounded text fields) and answers 401/400/405 for anything else.
3. **Fallback-first plumbing** (revised same-day: no local copy on success — user request): when
   `BUG_REPORT_ENDPOINT` is non-empty, `submitBugReport` POSTs `buildReportPayload` (JSON; screenshots
   as `{filename, content(base64)}`; optional `replyTo`; 15 s abort) FIRST — a delivered report writes
   NOTHING to disk (`dir: null`). ANY failure (offline, timeout, non-2xx) — or no endpoint — falls back
   to the ADR-057 mail-draft flow, which ALONE writes the bundle (the draft needs files to drag in), so
   a dead endpoint can never lose a report. `BugReportResult.sent` tells the dialog which path ran.
4. **Renderer gates on the same const** (`AUTO_SEND`): button label ("Send report" vs "Open email
   draft"), the honest description copy ("Pressing Send delivers this report…"), an optional "Your
   email (only if you'd like a reply)" field (→ Resend `reply_to`; testers never NEED an email), and a
   clean "Report sent — thank you" done-panel. An undeployed build renders exactly the old dialog —
   the existing e2e keeps passing unmodified.

## Consequences

* **+** One-click reports with attachments; no tester accounts or credentials; the developer's key
  stays server-side; total cost $0 at this scale (Workers 100k req/day, Resend ~100 emails/day).
* **−** This is the app's **first deliberate non-Anthropic egress** — user-initiated, explicitly
  labeled in the dialog, and carrying the same diagnostics the tester could already read in
  `report.txt`. The "app never sends anything" line of ADR-057 is retired; the local-first promise is
  restated as "nothing leaves except Anthropic calls and the bug report you press Send on."
* **−** One piece of hosted infrastructure to keep alive (worker + Resend account); deploy runbook in
  `infra/bugreport-worker/README.md`. If it dies, the app degrades gracefully to the mail-draft flow.

**Deferred:** delivery receipts/queueing (a failed send falls back rather than retrying later);
worker-side rate limiting beyond the token (add a Cloudflare rate rule if spam ever appears).
