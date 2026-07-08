import {
  ENTITY_TYPES,
  LIFECYCLES,
  type Entity,
  type EntityType,
  type Lifecycle,
  type NoteConfidence
} from '@shared/entity-types'
import type {
  ApplyResult,
  ConfirmedChangeset,
  ConfirmedFieldChange,
  EntityRef,
  ExtractFailureReason,
  ExtractionProposal,
  ExtractRequest,
  ExtractResult,
  FieldChangeOp,
  ProposedEntity,
  ProposedFieldChange,
  ProposedNote,
  ProposedRelationshipChange,
  ProposedStatusChange,
  RawExtraction
} from '@shared/import-types'
import { isRelationAllowed, isRelationKey } from '@shared/relations'
import { profileFor } from '@shared/entity-profiles'
import type { UpdateEntityInput } from '@shared/ipc-types'
import type { DbContext } from './db-context'
import type { VectorStore } from './vector-store.service'
import { FUZZY_THRESHOLD, nameMatchScore } from './vector-store.service'
import { lifecycleHeuristic } from './chronology.service'
import { createEntity, getEntity, listEntities, updateEntity } from './entity.service'
import { createLink, findOpenLink, severLink } from './link.service'
import { createNote } from './note.service'
import { indexEntity, indexNote } from './embedding-index.service'
import { getSettings } from './settings.service'
import { extractChangeset as claudeExtract, isAvailable } from './claude.service'
import { classifyError, isAuthError, isOnline } from './ai-util'
import log from 'electron-log/main'

const ENTITY_TYPE_SET = new Set<string>(ENTITY_TYPES)

/**
 * Phase 1 of import: send the pasted text to Claude for a structured changeset, then VALIDATE + DEDUP it
 * into a reviewable proposal. Nothing is written here. Guards mirror Suggest (key + online; no embedding
 * model needed). Returns a discriminated result so the renderer can show no-key/offline/empty without
 * try/catch.
 */
export async function extract(
  ctx: DbContext,
  req: ExtractRequest,
  signal: AbortSignal
): Promise<ExtractResult> {
  const { campaignId, text } = req
  try {
    if (!text.trim()) return { ok: false, reason: 'empty' }
    if (!isAvailable()) return { ok: false, reason: 'no_key' }
    if (!(await isOnline())) return { ok: false, reason: 'offline' }

    const existing = listEntities(ctx, campaignId)
    const { suggestModel, suggestEffort } = getSettings()
    const raw = await claudeExtract({
      text,
      existing: existing.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        traits: e.traits,
        goals: e.goals,
        flaws: e.flaws,
        attributes: e.attributes
      })),
      model: suggestModel,
      effort: suggestEffort,
      withChanges: req.withChanges,
      signal
    })
    const proposal = validateExtraction(raw, existing)
    if (
      proposal.entities.length === 0 &&
      proposal.notes.length === 0 &&
      proposal.statusChanges.length === 0 &&
      proposal.relationshipChanges.length === 0 &&
      proposal.fieldChanges.length === 0
    ) {
      return { ok: false, reason: 'empty' }
    }
    return { ok: true, proposal }
  } catch (err) {
    // Log the real cause — otherwise every non-network failure (a truncated response, a schema error
    // during a stale-migration dev restart, an unparseable reply) collapses to a generic toast with no
    // trace. See logs/main.log.
    log.error('import.extract failed', err)
    const message = err instanceof Error ? err.message : String(err)
    // Surface the two actionable causes distinctly instead of the catch-all "couldn't read that":
    // a big paste that exhausts the output budget mid-JSON ('truncated' → too_long), and a rejected
    // API key (401 → bad_key). Everything else falls through to the shared classifier.
    const reason: ExtractFailureReason =
      message === 'truncated' ? 'too_long' : isAuthError(err) ? 'bad_key' : classifyError(err)
    return { ok: false, reason, message }
  }
}

/**
 * Clean the model's raw changeset into a reviewable proposal: drop bad-type/empty-name entities;
 * collapse intra-batch duplicate names (rewriting refs); surface up to 3 existing-entity matches per
 * proposal (for "link instead of create"); normalize note refs ("#n" → new index, else an existing id)
 * and drop notes left with no valid reference. `index` stays the model's ORIGINAL position so refs line
 * up across validation and apply.
 */
function validateExtraction(raw: RawExtraction, existing: Entity[]): ExtractionProposal {
  const existingById = new Set(existing.map((e) => e.id))

  // 1) Validate entities, keeping each one's ORIGINAL index (note refs are positional).
  type Valid = {
    index: number
    type: EntityType
    name: string
    description?: string
    status?: string
    attributes?: Record<string, string>
  }
  const valids: Valid[] = []
  ;(raw.entities ?? []).forEach((e, i) => {
    if (!e || typeof e.name !== 'string' || typeof e.type !== 'string') return
    const name = e.name.trim()
    if (!name || !ENTITY_TYPE_SET.has(e.type)) return
    const attributes: Record<string, string> = {}
    if (Array.isArray(e.attributes)) {
      for (const p of e.attributes) {
        if (p && typeof p.key === 'string' && typeof p.value === 'string') {
          const k = p.key.trim()
          const v = p.value.trim()
          if (k && v) attributes[k] = v
        }
      }
    }
    valids.push({
      index: i,
      type: e.type as EntityType,
      name,
      description: strOrUndef(e.description),
      status: strOrUndef(e.status),
      attributes: Object.keys(attributes).length ? attributes : undefined
    })
  })

  // 2) Intra-batch dedup by type+name → remap every original index onto a canonical kept one.
  const canonByKey = new Map<string, number>()
  const remap = new Map<number, number>()
  const kept: Valid[] = []
  for (const v of valids) {
    const key = `${v.type}:${v.name.toLowerCase()}`
    const canon = canonByKey.get(key)
    if (canon !== undefined) {
      remap.set(v.index, canon)
    } else {
      canonByKey.set(key, v.index)
      remap.set(v.index, v.index)
      kept.push(v)
    }
  }
  const keptIndexes = new Set(kept.map((v) => v.index))

  // 3) Proposed entities + their existing-entity matches (same-type first, then score).
  const entities: ProposedEntity[] = kept.map((v) => ({
    index: v.index,
    type: v.type,
    name: v.name,
    description: v.description,
    status: v.status,
    attributes: v.attributes,
    matches: existing
      .map((e) => ({ entityId: e.id, name: e.name, type: e.type, score: nameMatchScore(v.name, e.name) }))
      .filter((m) => m.score >= FUZZY_THRESHOLD)
      .sort((a, b) => (a.type === v.type ? 0 : 1) - (b.type === v.type ? 0 : 1) || b.score - a.score)
      .slice(0, 3)
  }))

  // 4) Resolve a model ref string to an EntityRef (or null when it points at nothing kept/real).
  const resolveRef = (ref: string): EntityRef | null => {
    const s = ref.trim()
    if (s.startsWith('#')) {
      const n = Number(s.slice(1))
      if (!Number.isInteger(n)) return null
      const canon = remap.get(n)
      if (canon === undefined || !keptIndexes.has(canon)) return null
      return { kind: 'new', index: canon }
    }
    return existingById.has(s) ? { kind: 'existing', entityId: s } : null
  }

  // 5) Notes: clean content, resolve + dedup refs, drop any note with no valid reference.
  const notes: ProposedNote[] = []
  for (const n of raw.notes ?? []) {
    if (!n || typeof n.content !== 'string' || !n.content.trim()) continue
    const refs: EntityRef[] = []
    const seen = new Set<string>()
    for (const r of Array.isArray(n.entityRefs) ? n.entityRefs : []) {
      if (typeof r !== 'string') continue
      const resolved = resolveRef(r)
      if (!resolved) continue
      const k = resolved.kind === 'new' ? `n${resolved.index}` : `e${resolved.entityId}`
      if (seen.has(k)) continue
      seen.add(k)
      refs.push(resolved)
    }
    if (refs.length === 0) continue
    const tags = (Array.isArray(n.tags) ? n.tags : [])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim())
    const confidence: NoteConfidence =
      n.confidence === 'rumored' || n.confidence === 'suspected' ? n.confidence : 'confirmed'
    notes.push({ content: n.content.trim(), entityRefs: refs, tags, confidence })
  }

  // ---- Changeset v2 (ADR-018): status + relationship changes (absent unless withChanges) ----

  const refKey = (r: EntityRef): string => (r.kind === 'new' ? `n${r.index}` : `e${r.entityId}`)
  // Type lookup for relation allowedness: proposed entities by canonical index, existing by id.
  const typeOfRef = (r: EntityRef): EntityType | null =>
    r.kind === 'new'
      ? (kept.find((v) => v.index === r.index)?.type ?? null)
      : (existing.find((e) => e.id === r.entityId)?.type ?? null)

  // 6) Status changes: resolve the ref; take a valid lifecycle or derive it from the status text
  //    (same heuristic as capture/backfill — chronology.service); drop entries with neither.
  const statusChanges: ProposedStatusChange[] = []
  const seenStatus = new Set<string>()
  for (const sc of raw.statusChanges ?? []) {
    if (!sc || typeof sc.entityRef !== 'string') continue
    const ref = resolveRef(sc.entityRef)
    if (!ref) continue
    const validLifecycle =
      typeof sc.lifecycle === 'string' && (LIFECYCLES as readonly string[]).includes(sc.lifecycle)
        ? (sc.lifecycle as Lifecycle)
        : null
    const status = strOrUndef(sc.status) ?? null
    if (!validLifecycle && status === null) continue
    const lifecycle = validLifecycle ?? lifecycleHeuristic(status)
    const key = `${refKey(ref)}:${lifecycle}:${status ?? ''}`
    if (seenStatus.has(key)) continue
    seenStatus.add(key)
    statusChanges.push({ entityRef: ref, lifecycle, status })
  }

  // 7) Relationship changes: both refs must resolve and differ; the relation must be a known key and
  //    (when FORMING) allowed between the two types. Severing skips the type check — a legacy edge
  //    should stay severable, and severing a non-existent edge is a no-op at apply time anyway.
  const relationshipChanges: ProposedRelationshipChange[] = []
  const seenRel = new Set<string>()
  for (const rc of raw.relationshipChanges ?? []) {
    if (!rc || typeof rc.fromRef !== 'string' || typeof rc.toRef !== 'string') continue
    if (typeof rc.relation !== 'string' || !isRelationKey(rc.relation)) continue
    if (rc.action !== 'form' && rc.action !== 'sever') continue
    const fromRef = resolveRef(rc.fromRef)
    const toRef = resolveRef(rc.toRef)
    if (!fromRef || !toRef || refKey(fromRef) === refKey(toRef)) continue
    if (rc.action === 'form') {
      const ft = typeOfRef(fromRef)
      const tt = typeOfRef(toRef)
      if (!ft || !tt || !isRelationAllowed(rc.relation, ft, tt)) continue
    }
    const key = `${refKey(fromRef)}>${refKey(toRef)}:${rc.relation}:${rc.action}`
    if (seenRel.has(key)) continue
    seenRel.add(key)
    relationshipChanges.push({ fromRef, toRef, relation: rc.relation, action: rc.action })
  }

  // 8) Field changes: add/cut/alter a promoted list (traits/goals/flaws) or a type attribute on an
  //    EXISTING entity. A #index (proposed) ref is dropped — a new entity carries its fields already.
  //    For a LIST cut/alter, oldValue must match a CURRENT item (no silent no-ops); "" coerces to null.
  const fieldChanges: ProposedFieldChange[] = []
  const seenField = new Set<string>()
  for (const fc of raw.fieldChanges ?? []) {
    if (!fc || typeof fc.entityRef !== 'string') continue
    const ref = resolveRef(fc.entityRef)
    if (!ref || ref.kind !== 'existing') continue
    const ent = existing.find((e) => e.id === ref.entityId)
    if (!ent) continue
    const field = strOrUndef(fc.field)
    if (!field) continue
    const op = fc.op
    if (op !== 'add' && op !== 'cut' && op !== 'alter') continue
    const value = strOrUndef(fc.value) ?? null
    const oldValue = strOrUndef(fc.oldValue) ?? null

    const isPromoted = field === 'traits' || field === 'goals' || field === 'flaws'
    if (isPromoted && !profileFor(ent.type)[field as 'traits' | 'goals' | 'flaws']) continue
    const profField = isPromoted ? null : profileFor(ent.type).fields.find((f) => f.key === field)
    const isList = isPromoted || profField?.kind === 'list'
    const current: string[] = isPromoted
      ? ent[field as 'traits' | 'goals' | 'flaws']
      : isList
        ? attrStringArray(ent.attributes[field])
        : []

    if (op === 'add') {
      if (!value) continue
      if (isList && current.includes(value)) continue // already present
    } else if (op === 'cut') {
      if (isList && !current.includes(oldValue ?? value ?? '')) continue // must name a real item
    } else {
      // alter
      if (!value) continue
      if (isList && !(oldValue && current.includes(oldValue))) continue // must reference a real item
    }

    const key = `${ref.entityId}:${field}:${op}:${value ?? ''}:${oldValue ?? ''}`
    if (seenField.has(key)) continue
    seenField.add(key)
    fieldChanges.push({ entityRef: ref, field, op, value, oldValue })
  }

  return { entities, notes, statusChanges, relationshipChanges, fieldChanges }
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function attrStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Phase 2 of import: apply the user-confirmed changeset in ONE transaction — entities first (building an
 * index→id map), then notes (resolving their refs and attaching the session). Any create throw rolls the
 * whole thing back and rethrows, so a partial apply never persists. Embedding is fire-and-forget and runs
 * AFTER commit (it reads the row back; a rolled-back row wouldn't exist). Illegal/empty items are
 * collected in `skipped` rather than aborting the batch.
 */
export function applyChangeset(
  ctx: DbContext,
  store: VectorStore,
  payload: ConfirmedChangeset
): ApplyResult {
  const result: ApplyResult = {
    createdEntityIds: [],
    linkedEntityIds: [],
    createdNoteIds: [],
    statusChangesApplied: 0,
    relationshipChangesApplied: 0,
    fieldChangesApplied: 0,
    skipped: []
  }
  const idByIndex = new Map<number, string>()

  ctx.drizzle.transaction(() => {
    for (const ce of payload.entities) {
      if (ce.action === 'skip') continue
      if (ce.action === 'link') {
        if (!ce.linkToEntityId) {
          result.skipped.push({ kind: 'entity', reason: `"${ce.name}" had no link target` })
          continue
        }
        idByIndex.set(ce.index, ce.linkToEntityId)
        if (!result.linkedEntityIds.includes(ce.linkToEntityId)) {
          result.linkedEntityIds.push(ce.linkToEntityId)
        }
        continue
      }
      const created = createEntity(ctx, {
        campaignId: payload.campaignId,
        type: ce.type,
        name: ce.name,
        description: ce.description,
        status: ce.status,
        attributes: ce.attributes,
        // Backfill (ADR-018): stamp the baseline at the entity's intro session, falling back to the
        // batch's session. A NULL batch session (undated import / backstory, ADR-030) flows through as an
        // explicit pre-tracking baseline — the entity predates session 1.
        sessionId: ce.sessionId ?? payload.sessionId
      })
      idByIndex.set(ce.index, created.id)
      result.createdEntityIds.push(created.id)
    }

    const resolve = (r: EntityRef): string | null =>
      r.kind === 'existing' ? r.entityId : (idByIndex.get(r.index) ?? null)
    // NULL = undated batch (ADR-030): status changes + link intervals apply as pre-tracking.
    const batchSession = payload.sessionId

    // ---- Changeset v2 (ADR-018): dated changes, stamped at the batch's session ----

    // Status changes ride the chronology capture path: updateEntity appends a session-stamped
    // status_history row. A ref onto a skipped proposal resolves to null → skipped, not aborted.
    for (const sc of payload.statusChanges ?? []) {
      if (!sc.include) continue
      const id = resolve(sc.entityRef)
      if (!id) {
        result.skipped.push({ kind: 'change', reason: 'a status change had no valid target' })
        continue
      }
      updateEntity(ctx, id, { status: sc.status, lifecycle: sc.lifecycle, sessionId: batchSession })
      result.statusChangesApplied++
    }

    // Relationship changes: form opens an interval at the session (idempotent onto a live edge);
    // sever closes the matching open edge (skipped when none exists). Allowedness is RE-checked
    // against the confirmed types — review can retype an entity — so a bad pair skips per-item
    // instead of throwing away the whole batch.
    for (const rc of payload.relationshipChanges ?? []) {
      if (!rc.include) continue
      // Runtime guard (apply trusts the renderer): an unknown key would crash the inverse lookup.
      if (!isRelationKey(rc.relation)) {
        result.skipped.push({ kind: 'change', reason: `unknown relation "${rc.relation}"` })
        continue
      }
      const fromId = resolve(rc.fromRef)
      const toId = resolve(rc.toRef)
      if (!fromId || !toId || fromId === toId) {
        result.skipped.push({ kind: 'change', reason: 'a relationship change had no valid endpoints' })
        continue
      }
      if (rc.action === 'form') {
        const from = getEntity(ctx, fromId)
        const to = getEntity(ctx, toId)
        if (!from || !to || !isRelationAllowed(rc.relation, from.type, to.type)) {
          result.skipped.push({
            kind: 'change',
            reason: `"${rc.relation}" is not allowed between ${from?.type ?? '?'} and ${to?.type ?? '?'}`
          })
          continue
        }
        createLink(ctx, {
          campaignId: payload.campaignId,
          fromEntityId: fromId,
          toEntityId: toId,
          relation: rc.relation,
          sessionId: batchSession
        })
        result.relationshipChangesApplied++
      } else {
        const open = findOpenLink(ctx, fromId, toId, rc.relation)
        if (!open) {
          result.skipped.push({ kind: 'change', reason: 'no live relationship to sever' })
          continue
        }
        // Sever has no pre-tracking representation (an interval needs a real end) — keep the fallback.
        severLink(ctx, open.id, batchSession ?? undefined)
        result.relationshipChangesApplied++
      }
    }

    // Field changes: add/cut/alter a trait/goal/flaw or a type attribute on an EXISTING entity. NOT
    // chronology-versioned (that's status/lifecycle + relationships) → a plain updateEntity, no history row.
    // Re-reads the entity per change so several edits to the same field compound (the txn sees its writes).
    for (const fc of payload.fieldChanges ?? []) {
      if (!fc.include) continue
      const id = resolve(fc.entityRef)
      const ent = id ? getEntity(ctx, id) : null
      if (!id || !ent) {
        result.skipped.push({ kind: 'change', reason: 'a field change had no valid target' })
        continue
      }
      const patch = fieldChangePatch(ent, fc)
      if (!patch) {
        result.skipped.push({ kind: 'change', reason: `could not apply the ${fc.field} change` })
        continue
      }
      updateEntity(ctx, id, patch)
      result.fieldChangesApplied++
    }

    for (const cn of payload.notes) {
      if (!cn.include) continue
      const entityIds: string[] = []
      for (const ref of cn.entityRefs) {
        const id = resolve(ref)
        if (id && !entityIds.includes(id)) entityIds.push(id)
      }
      if (entityIds.length === 0) {
        result.skipped.push({ kind: 'note', reason: 'no valid entity references' })
        continue
      }
      const note = createNote(ctx, {
        campaignId: payload.campaignId,
        entityIds,
        sessionId: payload.sessionId ?? undefined,
        content: cn.content,
        tags: cn.tags,
        confidence: cn.confidence
      })
      result.createdNoteIds.push(note.id)
    }
  })

  // Post-commit: queue embeddings (no-ops until the local model is present).
  for (const id of result.createdEntityIds) indexEntity(ctx, store, id)
  for (const id of result.createdNoteIds) indexNote(ctx, store, id)
  return result
}

/** Apply one add/cut/alter to a string list. Returns null (→ skip) when the op can't proceed. */
function applyListOp(
  arr: string[],
  op: FieldChangeOp,
  value: string | null,
  oldValue: string | null
): string[] | null {
  if (op === 'add') return value && !arr.includes(value) ? [...arr, value] : arr
  if (op === 'cut') {
    const item = oldValue ?? value
    return item ? arr.filter((x) => x !== item) : null
  }
  // alter: swap the exact old item for the new text (both required, old must exist)
  if (!oldValue || !value || !arr.includes(oldValue)) return null
  return arr.map((x) => (x === oldValue ? value : x))
}

/** Compute the updateEntity patch for a confirmed field change (list op on traits/goals/flaws or a
 *  list-kind attribute; set/clear for a scalar attribute). Returns null when the change can't apply. */
function fieldChangePatch(ent: Entity, fc: ConfirmedFieldChange): UpdateEntityInput | null {
  if (fc.field === 'traits' || fc.field === 'goals' || fc.field === 'flaws') {
    const next = applyListOp(ent[fc.field], fc.op, fc.value, fc.oldValue)
    if (!next) return null
    const patch: UpdateEntityInput = {}
    if (fc.field === 'traits') patch.traits = next
    else if (fc.field === 'goals') patch.goals = next
    else patch.flaws = next
    return patch
  }
  // A type-specific attribute: list-kind (per the profile) → list op; otherwise a scalar set/clear.
  const profField = profileFor(ent.type).fields.find((f) => f.key === fc.field)
  const attrs = { ...ent.attributes }
  if (profField?.kind === 'list') {
    const next = applyListOp(attrStringArray(attrs[fc.field]), fc.op, fc.value, fc.oldValue)
    if (!next) return null
    attrs[fc.field] = next
  } else if (fc.op === 'cut') {
    delete attrs[fc.field]
  } else {
    if (!fc.value) return null
    attrs[fc.field] = fc.value
  }
  return { attributes: attrs }
}
