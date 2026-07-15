// "Illuminate" (code name enrich, ADR-035) — the manual tier-2 enrichment pass. One focused model call
// per entity, grounded in its FULL note history + current profile + live ties, proposing ONLY
// relationship + field changes (real-id refs). The renderer sequences one IPC call per checked entity,
// merges the proposals into a single ChangesetReview, and applies through the existing import engine
// (empty entities/notes/status arrays) stamped at the enriched session.

import type { TouchedEntity, EnrichEntityRequest, EnrichEntityResult } from '@shared/enrich-types'
import type { ExtractFailureReason } from '@shared/import-types'
import type { AiRunCost } from '@shared/usage-types'
import type { RelationshipView } from '@shared/graph-types'
import { profileKeys } from '@shared/entity-profiles'
import type { DbContext } from './db-context'
import { getEntity, listEntities } from './entity.service'
import { getCampaign } from './campaign.service'
import { listNotesForEntity, listNotesForSession } from './note.service'
import { findOpenLink, listForEntity } from './link.service'
import {
  validateFieldChanges,
  validateRelationshipChanges,
  type ChangeValidationCtx
} from './import.service'
import { getSettings } from './settings.service'
import { confidenceTag, enrichChangeset, isAvailable } from './claude.service'
import { classifyError, isOnline } from './ai-util'
import { fakeAiEnabled, fakeEnrichment } from './ai-fake'
import log from 'electron-log/main'

/** Grounding cap: the newest N notes feed the prompt (rendered oldest-first); older ones are counted. */
const ENRICH_NOTE_CAP = 30

/** Roster cap (ADR-035 cost tuning): only plausible tie ENDPOINTS reach the prompt — entities named in
 *  the subject's notes plus current tie endpoints. A tie to an entity never mentioned would be
 *  ungrounded by definition, so the full-campaign roster (100 UUID-bearing lines) was mostly noise. */
const ENRICH_ROSTER_CAP = 25

/**
 * The entities a session's notes touched, with per-entity note counts — the pre-flight checklist.
 * Derived from notes ONLY: chronicle events never carry an entityId in practice, and extraction turns
 * every journal line into entity-tagged notes anyway (ADR-035 F3).
 */
export function listTouchedEntities(ctx: DbContext, sessionId: string): TouchedEntity[] {
  const counts = new Map<string, number>()
  for (const n of listNotesForSession(ctx, sessionId)) {
    for (const id of n.entityIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const out: TouchedEntity[] = []
  for (const [entityId, noteCount] of counts) {
    const e = getEntity(ctx, entityId)
    if (e) out.push({ entityId, name: e.name, type: e.type, noteCount })
  }
  return out.sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name))
}

/**
 * The subject's live ties as id-bearing lines — the same fields as formatRelationships (label,
 * confidence, description, per-direction disposition — ADR-033) PLUS the far endpoint's REAL id, so a
 * sever proposal can reference it (names alone would be ambiguous and unresolvable). No cap: an
 * entity's live ties are exactly the never-re-propose set the model must see; the validator backstops.
 */
function tieLinesWithIds(subjectName: string, views: RelationshipView[]): string | null {
  const lines = views.map((v) => {
    const conf = confidenceTag(v.link.confidence)
    const desc = v.link.description ? ` (${v.link.description})` : ''
    const near = v.direction === 'out' ? v.link.fromDisposition : v.link.toDisposition
    const far = v.direction === 'out' ? v.link.toDisposition : v.link.fromDisposition
    const feelings = [near && `${subjectName} feels ${near}`, far && `${v.other.name} feels ${far}`]
      .filter(Boolean)
      .join('; ')
    const feel = feelings ? ` — ${feelings}` : ''
    return `- ${v.other.id} · ${subjectName} ${v.label} ${v.other.name}${conf}${desc}${feel}`
  })
  return lines.length ? lines.join('\n') : null
}

function fail(reason: ExtractFailureReason, message?: string): EnrichEntityResult {
  return { ok: false, reason, message }
}

/**
 * The slim prompt roster (ADR-035 cost tuning): `pinnedIds` first (always kept — the main character, so a
 * PC↔NPC tie can form even when the PC is only the implicit narrator of "we spoke to X" notes), then current
 * tie endpoints (a sever must reference them), then entities NAMED anywhere in `notesForMention`,
 * alphabetical, capped. **B1:** the caller passes the entity's FULL note history here (not just the capped
 * prompt window), so a tie to an entity named only in an older note stays proposable. Pure + unit-tested.
 */
export function selectEnrichRoster<E extends { id: string; name: string }>(
  others: E[],
  notesForMention: { content: string }[],
  tieEndpointIds: Set<string>,
  cap: number = ENRICH_ROSTER_CAP,
  pinnedIds: Set<string> = new Set()
): E[] {
  const haystack = notesForMention.map((n) => n.content.toLowerCase()).join('\n')
  const rank = (e: E): number => (pinnedIds.has(e.id) ? 0 : tieEndpointIds.has(e.id) ? 1 : 2)
  return others
    .filter(
      (e) => pinnedIds.has(e.id) || tieEndpointIds.has(e.id) || haystack.includes(e.name.toLowerCase())
    )
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, cap)
}

/**
 * Enrich ONE entity: gather (full live notes capped to the newest 30, current profile, live ties,
 * roster) → one structured model call → validate through the SHARED change validators (ADR-031/033
 * rules) with a REAL-ID-ONLY resolver ("#index" resolves to nothing) → tier-2 post-filters: every field
 * change targets the subject and a whitelisted field (description/traits/goals/flaws + the type's
 * attribute keys — an automated sweep must not invent attribute keys, ADR-035 F2); every tie includes
 * the subject. An EMPTY result is `ok: true` — "nothing new" is the expected steady-state of a sweep.
 */
export async function enrichEntity(
  ctx: DbContext,
  req: EnrichEntityRequest,
  signal: AbortSignal
): Promise<EnrichEntityResult> {
  try {
    if (!isAvailable()) return fail('no_key')
    if (!(await isOnline())) return fail('offline')
    const subject = getEntity(ctx, req.entityId)
    if (!subject || subject.campaignId !== req.campaignId) return fail('invalid')

    // Grounding — the LIVE view (no as-of): enrichment reconciles the profile with everything known now.
    const allNotes = listNotesForEntity(ctx, req.entityId) // newest first
    const capped = allNotes.slice(0, ENRICH_NOTE_CAP).reverse() // prompt reads oldest → newest
    const omitted = Math.max(0, allNotes.length - ENRICH_NOTE_CAP)
    const views = listForEntity(ctx, req.entityId) // live ties
    const tieLines = tieLinesWithIds(subject.name, views)
    const others = listEntities(ctx, req.campaignId).filter((e) => e.id !== subject.id)
    // The campaign's main character is the implicit narrator of PC-perspective chronicle ("we spoke to X"),
    // so it's rarely NAMED in an NPC's notes — pin it into the roster (unless it IS the subject) so a PC↔NPC
    // tie can still form. Paired with the POV framing passed to the enrich prompt (mainCharacter, below).
    const mcId = getCampaign(ctx, req.campaignId)?.mainCharacterId ?? null
    const mainCharacter = mcId && mcId !== subject.id ? others.find((e) => e.id === mcId) : undefined
    // Slim prompt roster: pinned MC + tie endpoints + note-mentioned entities, capped — scanning ALL notes
    // (B1), so a tie to an entity named only in an older note stays proposable. Validator stays permissive.
    const tieEndpointIds = new Set(views.map((v) => v.other.id))
    const roster = selectEnrichRoster(
      others,
      allNotes,
      tieEndpointIds,
      ENRICH_ROSTER_CAP,
      mainCharacter ? new Set([mainCharacter.id]) : new Set<string>()
    )

    // Illuminate has its OWN model/effort (ADR-051 — decoupled from extraction; defaults to Haiku·medium):
    // structured, validated, review-gated, and the cost driver since it runs one call per entity.
    const { illuminateModel, illuminateEffort } = getSettings()
    let cost: AiRunCost | undefined // per-entity cost — the renderer sums the sweep (P0-4)
    // e2e fake-AI seam (P2-6): canned enrichment anchored to the REAL subject id (in scope here — which is
    // why the seam lives at the call site, not inside claude.service). Guards above already ran.
    const raw = fakeAiEnabled()
      ? fakeEnrichment(subject.id)
      : await enrichChangeset({
          subject: {
            id: subject.id,
            name: subject.name,
            type: subject.type,
            description: subject.description,
            status: subject.status,
            lifecycle: subject.lifecycle,
            traits: subject.traits,
            goals: subject.goals,
            flaws: subject.flaws,
            attributes: subject.attributes
          },
          notes: capped.map((n) => ({ content: n.content, confidence: n.confidence })),
          tieLines,
          existing: roster.map((e) => ({ id: e.id, name: e.name, type: e.type })),
          mainCharacter: mainCharacter ? { id: mainCharacter.id, name: mainCharacter.name } : undefined,
          omittedNotes: omitted,
          model: illuminateModel,
          effort: illuminateEffort,
          onUsage: (c) => (cost = c),
          signal
        })

    // Shared validation (ADR-031 live-tie/no-op drops + ADR-033 enrichment caps) over a REAL-ID-ONLY
    // resolver — a "#index" or unknown id resolves to null and the item drops.
    const byId = new Map(others.map((e) => [e.id, e]))
    byId.set(subject.id, subject)
    const v: ChangeValidationCtx = {
      resolveRef: (ref) => {
        const s = ref.trim()
        return byId.has(s) ? { kind: 'existing', entityId: s } : null
      },
      refKey: (r) => (r.kind === 'new' ? `n${r.index}` : `e${r.entityId}`),
      typeOfRef: (r) => (r.kind === 'existing' ? (byId.get(r.entityId)?.type ?? null) : null),
      entityByRef: (r) => (r.kind === 'existing' ? (byId.get(r.entityId) ?? null) : null),
      isLiveLink: (fromId, toId, relation) => findOpenLink(ctx, fromId, toId, relation) !== null
    }
    const relationshipChanges = validateRelationshipChanges(raw.relationshipChanges, v).filter(
      (rc) =>
        (rc.fromRef.kind === 'existing' && rc.fromRef.entityId === subject.id) ||
        (rc.toRef.kind === 'existing' && rc.toRef.entityId === subject.id)
    )
    // Illuminate MAY NOT change `description`: the per-session sweep churned the stable prose summary with
    // transient details. Description stays set by hand + the backstory tool only — `validateFieldChanges`
    // still permits it for the full/backstory path; this enrich-only whitelist is what excludes it here.
    const allowedFields = new Set<string>(['traits', 'goals', 'flaws', ...profileKeys(subject.type)])
    const fieldChanges = validateFieldChanges(raw.fieldChanges, v).filter(
      (fc) =>
        fc.entityRef.kind === 'existing' &&
        fc.entityRef.entityId === subject.id &&
        allowedFields.has(fc.field)
    )
    return { ok: true, relationshipChanges, fieldChanges, cost }
  } catch (err) {
    log.error('enrich.entity failed', err)
    const message = err instanceof Error ? err.message : String(err)
    const reason: ExtractFailureReason =
      message === 'truncated' ? 'too_long' : classifyError(err)
    return fail(reason, message)
  }
}
