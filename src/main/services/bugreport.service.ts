import { app, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arch, release } from 'node:os'
import log from 'electron-log/main'
import {
  BUG_REPORT_EMAIL,
  BUG_REPORT_ENDPOINT,
  BUG_REPORT_TOKEN,
  type BugReportRequest,
  type BugReportResult,
  type FeatureRequestRequest
} from '@shared/ipc-types'
import type { DbContext } from './db-context'
import { listEntities } from './entity.service'
import { listAllNotes } from './note.service'
import { listSessions } from './session.service'
import { keyExists } from './key.service'
import { isOnline } from './ai-util'
import { isModelReady } from './embedding.service'
import { isRerankerReady } from './rerank.service'

// Bug reporting (sidebar "Report a bug"). ADR-058: with the intake worker deployed
// (infra/bugreport-worker → Resend), submit POSTs the report and it arrives at BUG_REPORT_EMAIL as an
// email with the screenshots attached — the app's ONE deliberate non-Anthropic egress, user-initiated
// and labeled in the dialog. With no endpoint configured (or on any POST failure/offline), it falls
// back to the original ADR-057 flow: write the bundle, open a prefilled mailto: draft, reveal the
// folder, and the user drags the files in. The bundle is written ONLY on that fallback path (the
// draft needs files to drag) — a delivered report leaves nothing on disk.

/** How much of main.log rides along (from the end). The file rotates at 1 MiB, so this is the recent past. */
const LOG_TAIL_CHARS = 20_000
/** mailto: URLs get unreliable past a few KB — the body is a preview; the full text is in report.txt. */
const MAILTO_BODY_CHARS = 1_200

/** The auto-collected diagnostics block, as plain text the user can read and REDACT before sending
 *  (main.log can contain campaign text inside error traces). The API key is never included — it lives
 *  in encrypted storage, not the log. */
export async function gatherDiagnostics(
  ctx: DbContext,
  campaignId: string | null,
  view: string
): Promise<string> {
  const lines: string[] = [
    `Custos v${app.getVersion()}`,
    `OS: ${process.platform} ${release()} (${arch()})`,
    `When: ${new Date().toISOString()}`,
    `View: ${view}`,
    `API key saved: ${keyExists() ? 'yes' : 'no'}`,
    `Online: ${(await isOnline()) ? 'yes' : 'no'}`,
    `Local search models: embedder ${isModelReady() ? 'ready' : 'not downloaded'} · reranker ${
      isRerankerReady() ? 'ready' : 'not downloaded'
    }`
  ]
  if (campaignId) {
    // Counts only — never content. Scale is the useful signal for perf/repro; names are private.
    try {
      const entities = listEntities(ctx, campaignId).length
      const notes = listAllNotes(ctx, campaignId).length
      const sessions = listSessions(ctx, campaignId).length
      lines.push(`Campaign size: ${entities} entities · ${notes} notes · ${sessions} sessions`)
    } catch {
      lines.push('Campaign size: (unavailable)')
    }
  } else {
    lines.push('Campaign: none selected')
  }
  lines.push('', `--- main.log tail (last ~${Math.round(LOG_TAIL_CHARS / 1000)} KB) ---`, logTail())
  return lines.join('\n')
}

function logTail(): string {
  try {
    const path = join(app.getPath('userData'), 'logs', 'main.log')
    if (!existsSync(path)) return '(no log file yet)'
    const text = readFileSync(path, 'utf-8')
    if (text.length <= LOG_TAIL_CHARS) return text.trimEnd()
    const tail = text.slice(-LOG_TAIL_CHARS)
    // Drop the leading partial line so the tail starts clean.
    return tail.slice(tail.indexOf('\n') + 1).trimEnd()
  } catch (err) {
    return `(could not read main.log: ${String(err)})`
  }
}

/** The full report text written to report.txt (the dialog's copy fallback mirrors it). */
export function formatReportText(req: BugReportRequest): string {
  const shots = req.screenshots.length
  const parts = [
    'Custos bug report',
    `From: ${req.name.trim() || 'anonymous'}`,
    '',
    '--- What went wrong ---',
    req.description.trim(),
    ''
  ]
  if (shots > 0) parts.push(`(${shots} screenshot${shots === 1 ? '' : 's'} saved beside this file.)`, '')
  if (req.diagnostics) parts.push('--- Diagnostics ---', req.diagnostics.trim(), '')
  return parts.join('\n')
}

/** The prefilled draft. Bodies stay short (mailto URLs get flaky past a few KB) — the full report and
 *  the screenshots travel as attachments the user drags in from the revealed bundle folder. */
export function buildMailtoUrl(name: string, description: string): string {
  const from = name.trim()
  const subject = `[Custos] Bug report${from ? ` from ${from}` : ''}`
  let desc = description.trim()
  if (desc.length > MAILTO_BODY_CHARS)
    desc = `${desc.slice(0, MAILTO_BODY_CHARS)}… (cut off — the full text is in the attached report.txt)`
  const body = `${desc}\n\n— Custos saved the full report and any screenshots to a folder it just opened. Drag those files into this email before sending.\n`
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Decode a screenshot data URL; null when malformed (a bad shot is skipped, never sinks the report). */
export function dataUrlToImage(
  dataUrl: string
): { ext: string; base64: string; buffer: Buffer } | null {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1]
  return { ext, base64: m[2], buffer: Buffer.from(m[2], 'base64') }
}

/** The JSON body POSTed to the intake worker (ADR-058) — screenshots travel as
 *  { filename, content(base64) } so the worker can hand them to Resend as attachments verbatim. */
export function buildReportPayload(req: BugReportRequest): Record<string, unknown> {
  const screenshots: { filename: string; content: string }[] = []
  for (const dataUrl of req.screenshots) {
    const img = dataUrlToImage(dataUrl)
    if (img)
      screenshots.push({ filename: `screenshot-${screenshots.length + 1}.${img.ext}`, content: img.base64 })
  }
  return {
    name: req.name,
    replyTo: req.replyTo ?? '',
    description: req.description,
    diagnostics: req.diagnostics ?? '',
    appVersion: app.getVersion(),
    screenshots
  }
}

/** POST a JSON payload to the deployed intake worker with the shared spam-gate token. Throws on ANY
 *  failure (timeout/offline/non-2xx) — every caller falls back to the mail-draft flow, so a dead
 *  endpoint can never lose a submission. Shared by bug reports AND feature requests (ADR-064). */
async function postToWorker(
  payload: Record<string, unknown>,
  endpoint: string,
  token: string
): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000) // a hung request must not hang Submit
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-custos-report': token },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`report endpoint answered ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

// ---- Feature requests (ADR-064) — a different email KIND to the same inbox/worker/token; no
// screenshots or diagnostics, a problem + a proposed feature instead of a bug description. ----

/** The JSON body POSTed for a feature request. `kind:'feature'` makes the worker use the feature subject
 *  + Problem/Proposed-feature layout (an older worker ignores it and would fall back to the bug path). */
export function buildFeaturePayload(req: FeatureRequestRequest): Record<string, unknown> {
  return {
    kind: 'feature',
    name: req.name,
    replyTo: req.replyTo ?? '',
    problem: req.problem,
    proposedFeature: req.proposedFeature,
    appVersion: app.getVersion()
  }
}

/** The request.txt body written on the mailto fallback path. */
export function formatFeatureText(req: FeatureRequestRequest): string {
  return [
    'Custos feature request',
    `From: ${req.name.trim() || 'anonymous'}`,
    '',
    '--- Problem ---',
    req.problem.trim() || '(none given)',
    '',
    '--- Proposed feature ---',
    req.proposedFeature.trim() || '(none given)',
    ''
  ].join('\n')
}

/** The prefilled feature-request draft (fallback only). Feature requests have no attachments, so the
 *  body carries both fields directly — capped, with the overflow in the revealed request.txt. */
export function buildFeatureMailtoUrl(
  name: string,
  problem: string,
  proposedFeature: string
): string {
  const from = name.trim()
  const subject = `[Custos] Feature request${from ? ` from ${from}` : ''}`
  let body = `Problem:\n${problem.trim()}\n\nProposed feature:\n${proposedFeature.trim()}\n`
  if (body.length > MAILTO_BODY_CHARS)
    body = `${body.slice(0, MAILTO_BODY_CHARS)}… (cut off — the full text is in the attached request.txt)\n`
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Submit a feature request — mirrors submitBugReport (POST-first, nothing on disk when delivered;
 *  fallback writes request.txt + opens a mailto draft + reveals the folder). `cfg` exists for tests. */
export async function submitFeatureRequest(
  req: FeatureRequestRequest,
  cfg: { endpoint: string; token: string } = { endpoint: BUG_REPORT_ENDPOINT, token: BUG_REPORT_TOKEN }
): Promise<BugReportResult> {
  try {
    if (cfg.endpoint) {
      try {
        await postToWorker(buildFeaturePayload(req), cfg.endpoint, cfg.token)
        return { ok: true, sent: true, dir: null, mailOpened: false } // delivered — nothing on disk
      } catch (err) {
        log.warn('featurerequest: auto-send failed — falling back to the mail draft', err)
      }
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const dir = join(app.getPath('userData'), 'feature-requests', stamp)
    mkdirSync(dir, { recursive: true })
    const requestPath = join(dir, 'request.txt')
    writeFileSync(requestPath, formatFeatureText(req), 'utf-8')

    let mailOpened = true
    try {
      await shell.openExternal(buildFeatureMailtoUrl(req.name, req.problem, req.proposedFeature))
    } catch (err) {
      mailOpened = false // no mail client — the dialog falls back to "copy the request"
      log.warn('featurerequest: could not open a mail draft', err)
    }
    shell.showItemInFolder(requestPath)
    return { ok: true, sent: false, dir, mailOpened }
  } catch (err) {
    log.error('featurerequest: submit failed', err)
    return { ok: false, error: String(err) }
  }
}

/** Submit a report. With the intake worker deployed (ADR-058) this POSTs it — one click, delivered to
 *  BUG_REPORT_EMAIL with screenshots attached, and NOTHING written to disk. With no endpoint (or when
 *  the POST fails/offline), it falls back to ADR-057's two-step flow — and ONLY there writes the
 *  bundle (report.txt + shots), because the mail draft needs files to drag in. `cfg` exists for tests. */
export async function submitBugReport(
  req: BugReportRequest,
  cfg: { endpoint: string; token: string } = { endpoint: BUG_REPORT_ENDPOINT, token: BUG_REPORT_TOKEN }
): Promise<BugReportResult> {
  try {
    // Auto-send first: a delivered report leaves no local copy (user preference).
    if (cfg.endpoint) {
      try {
        await postToWorker(buildReportPayload(req), cfg.endpoint, cfg.token)
        return { ok: true, sent: true, dir: null, mailOpened: false } // delivered — nothing on disk
      } catch (err) {
        log.warn('bugreport: auto-send failed — falling back to the mail draft', err)
      }
    }

    // Fallback (endpoint unset / POST failed): the draft can't carry attachments, so write the bundle
    // the user drags in.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const dir = join(app.getPath('userData'), 'bug-reports', stamp)
    mkdirSync(dir, { recursive: true })
    const reportPath = join(dir, 'report.txt')
    writeFileSync(reportPath, formatReportText(req), 'utf-8')
    let shot = 0
    for (const dataUrl of req.screenshots) {
      const img = dataUrlToImage(dataUrl)
      if (img) writeFileSync(join(dir, `screenshot-${++shot}.${img.ext}`), img.buffer)
    }

    let mailOpened = true
    try {
      await shell.openExternal(buildMailtoUrl(req.name, req.description))
    } catch (err) {
      mailOpened = false // no mail client — the dialog falls back to "copy the report"
      log.warn('bugreport: could not open a mail draft', err)
    }
    shell.showItemInFolder(reportPath)
    return { ok: true, sent: false, dir, mailOpened }
  } catch (err) {
    log.error('bugreport: submit failed', err)
    return { ok: false, error: String(err) }
  }
}
