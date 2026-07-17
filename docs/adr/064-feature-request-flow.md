# ADR-064: A "Feedback" section — Report a bug + Request a feature (a second email kind)

## Status

Accepted — **implemented**. The Settings "Report a bug" section becomes **"Feedback"** with two options;
a new `FeatureRequestDialog` + `submitFeatureRequest` send a distinct email kind through the SAME worker/
token/inbox. The worker branches on a `kind` field and must be redeployed. No migration.

**Date:** 2026-07-17
**Deciders:** Solo developer

## Context

Testers can report bugs (ADR-057/058: a dialog POSTs to a Cloudflare Worker → Resend → the dev inbox,
with a mailto+bundle fallback). They also want to send **feature requests** — a problem they're hitting
plus a proposed change — as a separate, clearly-labeled kind of email to the same inbox.

## Decision

1. **Rename the section to "Feedback"** and host BOTH options under it: the existing "Report a bug…"
   button and a new **"Request a feature…"** button (each opens its own dialog).
2. **`FeatureRequestDialog`** = `BugReportDialog` minus screenshots and diagnostics, plus two textareas
   (**problem** + **proposed feature**). It reuses the whole delivery story: name (prefilled from
   `settings.userName`), optional reply email (auto-send only), the `AUTO_SEND` gating, the busy/done
   state machine, the sent + mailto-fallback panels, and the copy-to-clipboard fallback. Submit is gated
   on both content fields.
3. **A second email kind on the same pipe.** The worker/token/inbox/sender are reused; the POST body
   carries `kind: 'feature'` + `problem` + `proposedFeature` (no screenshots/diagnostics). The **worker
   branches on `kind`**: feature requests get subject `[Custos] Feature request` and a Problem/
   Proposed-feature body with no attachments; anything else stays the bug path (backward-compatible — an
   absent `kind` is a bug report). `submitFeatureRequest` mirrors `submitBugReport` (POST-first, nothing
   on disk when delivered; fallback writes `feature-requests/<stamp>/request.txt` + opens a mailto draft).
   The private POST mechanics were factored into a shared `postToWorker(payload, endpoint, token)`.
4. **No diagnostics or screenshots for feature requests** — they're a forward-looking ask, not a defect
   report; the fields the user listed (name, optional email, problem, proposed feature) are the whole form.

## Consequences

* **+** One "Feedback" home for both bug reports and feature requests; the two arrive as clearly distinct
  emails (`[Custos] Bug report` vs `[Custos] Feature request`), no new secret/account/worker.
* **+** Fully backward-compatible at the worker: existing bug reports are unchanged (no `kind`).
* **− Requires a worker redeploy** (`npx wrangler deploy`) to ship the feature kind. An OLD deployed
  worker ignores `kind`/`problem`/`proposedFeature` and still requires `description`, so it would 400 a
  feature request. **Land the worker + app together**; the redeploy is the go-live gate. (Unit/e2e tests
  never hit the live worker, so they're safe either way.)
* Both content fields are required by the dialog; the worker is looser (either one) for resilience.
* Extends ADR-058's public-token arrangement (same token in the bundle) — deliberately not a true secret.
