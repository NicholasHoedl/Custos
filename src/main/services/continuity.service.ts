// Continuity (ADR-056): the read-only campaign AUDIT. Two sources, unified into one findings report:
//  1. always-on DETERMINISTIC checks (pure @shared/continuity-checks) over the live campaign state — no
//     key, no network, instant, precise;
//  2. an ADDITIVE whole-campaign AI pass for the semantic contradictions the checks can't see (a note
//     implying an ended entity still acts, two notes disagreeing, a rumor a later note resolved).
// The deterministic findings ALWAYS return; the AI part reports its own status (skipped/failed/ok), so the
// tool is useful with no key. Informational only — never applies a fix. Single-shot + cancelable.

import { addRunCost, type AiRunCost } from '@shared/usage-types'
import {
  CONTINUITY_SEVERITY_ORDER,
  CONTINUITY_CATEGORIES,
  type ContinuityAiStatus,
  type ContinuityCategory,
  type ContinuityFinding,
  type ContinuityRequest,
  type ContinuityResult,
  type RawContinuityFinding
} from '@shared/continuity-types'
import {
  runDeterministicChecks,
  type CheckEntity,
  type CheckLink
} from '@shared/continuity-checks'
import { estimateTokens, MAX_EXTRACT_INPUT_TOKENS } from '@shared/tokens'
import { RELATIONS, isRelationKey } from '@shared/relations'
import type { NoteConfidence } from '@shared/entity-types'
import type { DbContext } from './db-context'
import { listEntities } from './entity.service'
import { listLinksForCampaign } from './link.service'
import { listAllNotes } from './note.service'
import { listSessions } from './session.service'
import { getSettings } from './settings.service'
import { continuity as claudeContinuity, confidenceTag, isAvailable } from './claude.service'
import { classifyError, isOnline } from './ai-util'
import { fakeAiEnabled, fakeContinuity } from './ai-fake'

// Leave headroom under the hard extraction ceiling for the system prompt + the model's output.
const CONTINUITY_INPUT_BUDGET = Math.floor(MAX_EXTRACT_INPUT_TOKENS * 0.7)
const MAX_TIE_LINES = 80

/** Render the campaign's LIVE ties as one line each (label · confidence · description · dispositions),
 *  capped — the model reads these to spot a flip/contradiction. */
function renderTieLines(
  links: { fromEntityId: string; toEntityId: string; relation: string; endSessionNumber: number | null; description: string | null; fromDisposition: string | null; toDisposition: string | null; confidence: NoteConfidence }[],
  nameById: Map<string, string>
): string | null {
  const lines: string[] = []
  for (const l of links) {
    if (l.endSessionNumber !== null) continue // live only
    const from = nameById.get(l.fromEntityId)
    const to = nameById.get(l.toEntityId)
    if (!from || !to) continue // dangling
    const label = isRelationKey(l.relation) ? RELATIONS[l.relation].forward : l.relation
    const desc = l.description ? ` (${l.description})` : ''
    const feelings = [
      l.fromDisposition && `${from} feels ${l.fromDisposition}`,
      l.toDisposition && `${to} feels ${l.toDisposition}`
    ]
      .filter(Boolean)
      .join('; ')
    const feel = feelings ? ` — ${feelings}` : ''
    lines.push(`- ${from} ${label} ${to}${confidenceTag(l.confidence)}${desc}${feel}`)
    if (lines.length >= MAX_TIE_LINES) break
  }
  return lines.length ? lines.join('\n') : null
}

/** Map the model's raw findings onto validated ContinuityFindings: known category/severity, real ids only. */
function mapAiFindings(raw: RawContinuityFinding[], idSet: Set<string>): ContinuityFinding[] {
  const cats = new Set<string>(CONTINUITY_CATEGORIES)
  const out: ContinuityFinding[] = []
  for (const f of raw) {
    const summary = (f?.summary ?? '').trim()
    if (!summary) continue
    const category = (cats.has(f.category) ? f.category : 'contradiction') as ContinuityCategory
    const severity =
      f.severity === 'high' || f.severity === 'low' ? f.severity : ('medium' as const)
    const entityIds = (Array.isArray(f.entityRefs) ? f.entityRefs : []).filter((id) => idSet.has(id))
    const fix = (f.suggestedFix ?? '').trim()
    out.push({
      category,
      severity,
      source: 'ai',
      summary,
      detail: (f.detail ?? '').trim(),
      entityIds,
      ...(fix ? { suggestedFix: fix } : {})
    })
  }
  return out
}

/**
 * Run the audit: gather the campaign, run the deterministic checks, then (if a key is present + online)
 * run the additive AI pass over a token-bounded whole-campaign gather. Merge + sort by severity. Never
 * throws for a missing key — the AI status carries that; the deterministic findings always return.
 */
export async function runContinuity(
  ctx: DbContext,
  req: ContinuityRequest,
  signal: AbortSignal
): Promise<ContinuityResult> {
  const { campaignId } = req
  const entities = listEntities(ctx, campaignId)
  const links = listLinksForCampaign(ctx, campaignId)
  const notes = listAllNotes(ctx, campaignId) // newest first (note.service)
  const nameById = new Map(entities.map((e) => [e.id, e.name]))
  const sessionNumberById = new Map(listSessions(ctx, campaignId).map((s) => [s.id, s.number]))

  // ---- Deterministic checks (over the LIVE picture) ----
  const checkEntities: CheckEntity[] = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    status: e.status,
    lifecycle: e.lifecycle
  }))
  const checkLinks: CheckLink[] = links.map((l) => ({
    id: l.id,
    fromEntityId: l.fromEntityId,
    toEntityId: l.toEntityId,
    relation: l.relation,
    live: l.endSessionNumber === null
  }))
  const deterministic = runDeterministicChecks({
    entities: checkEntities,
    links: checkLinks
  })

  // ---- Additive AI pass ----
  let ai: ContinuityAiStatus = { status: 'skipped', reason: 'no_key' }
  let cost: AiRunCost | undefined
  let aiFindings: ContinuityFinding[] = []

  if (entities.length === 0) {
    ai = { status: 'skipped', reason: 'empty' }
  } else if (!isAvailable()) {
    ai = { status: 'skipped', reason: 'no_key' }
  } else if (!(await isOnline())) {
    ai = { status: 'skipped', reason: 'offline' }
  } else {
    try {
      const tieLines = renderTieLines(links, nameById)
      // Slice notes newest-first to a token budget (base = entities + ties); the deterministic checks still
      // cover any older notes the AI doesn't see.
      const gatherEntities = entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        status: e.status,
        lifecycle: e.lifecycle
      }))
      const baseTokens =
        estimateTokens(gatherEntities.map((e) => `${e.id} ${e.name} ${e.status ?? ''}`).join('\n')) +
        estimateTokens(tieLines ?? '')
      const keptNotes: {
        sessionNumber: number | null
        entityNames: string[]
        content: string
        confidence: NoteConfidence
      }[] = []
      let noteChars = 0
      for (const n of notes) {
        noteChars += n.content.length + 48 // + prefix overhead (session/tags)
        if (baseTokens + Math.ceil(noteChars / 4) > CONTINUITY_INPUT_BUDGET) break
        keptNotes.push({
          sessionNumber: n.sessionId != null ? (sessionNumberById.get(n.sessionId) ?? null) : null,
          entityNames: n.entityIds.map((id) => nameById.get(id) ?? '?').filter((x) => x !== '?'),
          content: n.content,
          confidence: n.confidence
        })
      }

      const settings = getSettings()
      const quick = req.speed === 'quick'
      const model = quick ? 'claude-sonnet-4-6' : settings.suggestModel
      const effort: 'medium' | 'high' = quick ? 'medium' : settings.suggestEffort

      const raw = fakeAiEnabled()
        ? fakeContinuity()
        : await claudeContinuity({
            entities: gatherEntities,
            tieLines,
            notes: keptNotes,
            omittedNotes: notes.length - keptNotes.length,
            alreadyFlagged: deterministic.map((f) => f.summary),
            model,
            effort,
            onUsage: (c) => (cost = addRunCost(cost, c)),
            signal
          })
      aiFindings = mapAiFindings(raw, new Set(entities.map((e) => e.id)))
      ai = { status: 'ok' }
    } catch (err) {
      if (signal.aborted) {
        ai = { status: 'skipped', reason: 'no_key' } // treat a user Stop as "not run" (deterministic stands)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        const c = classifyError(err)
        const reason =
          message === 'truncated'
            ? 'too_long'
            : c === 'bad_key'
              ? 'bad_key'
              : c === 'offline' || c === 'api'
                ? 'api' // a network drop AFTER the pre-flight guard reads better as api than unknown
                : 'unknown'
        ai = { status: 'failed', reason, message }
      }
    }
  }

  const findings = [...deterministic, ...aiFindings].sort(
    (a, b) => CONTINUITY_SEVERITY_ORDER[a.severity] - CONTINUITY_SEVERITY_ORDER[b.severity]
  )
  return { findings, ai, cost }
}
