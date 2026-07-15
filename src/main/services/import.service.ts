import {
  ENTITY_TYPES,
  type Entity,
  type EntityType,
  type Note,
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
import { RELATIONS, isRelationAllowed, isRelationKey, type RelationKey } from '@shared/relations'
import type { AiRunCost } from '@shared/usage-types'
import { profileFor, type StatusPreset } from '@shared/entity-profiles'
import type { UpdateEntityInput } from '@shared/ipc-types'
import { estimateTokens, MAX_EXTRACT_INPUT_TOKENS } from '@shared/tokens'
import type { DbContext } from './db-context'
import type { VectorStore } from './vector-store.service'
import { FUZZY_THRESHOLD, nameMatchScore } from './vector-store.service'
import { createEntity, getEntity, listEntities, updateEntity } from './entity.service'
import { createLink, findOpenLink, severLink } from './link.service'
import { createNote, listAllNotes } from './note.service'
import { indexEntity, indexNote } from './embedding-index.service'
import { getSettings } from './settings.service'
import { extractChangeset as claudeExtract, isAvailable } from './claude.service'
import { classifyError, isOnline } from './ai-util'
import { fakeAiEnabled, fakeExtraction } from './ai-fake'
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
    // D1: pre-flight size guard — a pathological session would otherwise overflow the model's context (a
    // 400 that classifies to a confusing generic error) or truncate its output. Return a clean `too_long`
    // BEFORE spending the call, so the user gets the existing "too long — split it" guidance.
    if (estimateTokens(text) > MAX_EXTRACT_INPUT_TOKENS) return { ok: false, reason: 'too_long' }

    const existing = listEntities(ctx, campaignId)
    // Extraction runs on ITS OWN model/effort knobs (ADR-035 cost tuning) — decoupled from Counsel's.
    const { extractionModel, extractionEffort } = getSettings()
    let cost: AiRunCost | undefined // per-run cost surfaces in the wizard/Transcribe (P0-4)
    // ADR-030 v3: the backstory flow names its subject so the standing ties anchor to that character.
    const subject = req.backstorySubjectId
      ? existing.find((e) => e.id === req.backstorySubjectId)
      : undefined
    // e2e fake-AI seam (P2-6): return canned extraction so the wizard runs without a real Claude call.
    // The guards above (key + online) already ran; everything downstream (validate + apply) is real.
    const raw = fakeAiEnabled()
      ? fakeExtraction()
      : await claudeExtract({
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
          model: extractionModel,
          effort: extractionEffort,
          onUsage: (c) => (cost = c),
          mode: req.mode ?? 'capture',
          backstorySubject: subject ? { id: subject.id, name: subject.name } : undefined,
          signal
        })
    // ADR-031: existing notes + live edges feed the dedup — an exact re-import drops silently, a
    // near-duplicate note is flagged for review, an already-recorded tie never reaches the review.
    const proposal = validateExtraction(ctx, raw, existing, listAllNotes(ctx, campaignId))
    if (
      proposal.entities.length === 0 &&
      proposal.notes.length === 0 &&
      proposal.statusChanges.length === 0 &&
      proposal.relationshipChanges.length === 0 &&
      proposal.fieldChanges.length === 0
    ) {
      return { ok: false, reason: 'empty' }
    }
    return { ok: true, proposal, cost }
  } catch (err) {
    // Log the real cause — otherwise every non-network failure (a truncated response, a schema error
    // during a stale-migration dev restart, an unparseable reply) collapses to a generic toast with no
    // trace. See logs/main.log.
    log.error('import.extract failed', err)
    const message = err instanceof Error ? err.message : String(err)
    // Surface the two actionable causes distinctly instead of the catch-all "couldn't read that":
    // a big paste that exhausts the output budget mid-JSON ('truncated' → too_long), and a rejected
    // API key (401 → bad_key). Everything else falls through to the shared classifier.
    const reason: ExtractFailureReason = message === 'truncated' ? 'too_long' : classifyError(err) // classifyError yields bad_key for 401s
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
function validateExtraction(
  ctx: DbContext,
  raw: RawExtraction,
  existing: Entity[],
  existingNotes: Note[]
): ExtractionProposal {
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
    // Extraction status is ENUM-ONLY (ADR-054): keep a proposed baseline status only when it snaps to one
    // of the type's presets (canonical casing, "alive" → "Alive"); drop non-preset free text so the AI
    // can't set a status — or, via the heuristic, a "fallen" lifecycle — outside the curated vocabulary.
    const rawStatus = strOrUndef(e.status)
    const statusPreset = presetStatusFor(e.type as EntityType, rawStatus ?? null)
    valids.push({
      index: i,
      type: e.type as EntityType,
      name,
      description: strOrUndef(e.description),
      status: statusPreset ? statusPreset.label : undefined,
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
      .map((e) => ({
        entityId: e.id,
        name: e.name,
        type: e.type,
        score: nameMatchScore(v.name, e.name)
      }))
      .filter((m) => m.score >= FUZZY_THRESHOLD)
      .sort(
        (a, b) => (a.type === v.type ? 0 : 1) - (b.type === v.type ? 0 : 1) || b.score - a.score
      )
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
  //    Dedup (ADR-031): an EXACT normalized match — against the campaign's existing notes or an earlier
  //    note in this batch — is dropped outright (it's already recorded); a NEAR-duplicate of an existing
  //    note (token overlap ≥ NOTE_DUP_THRESHOLD) is kept but flagged, so review defaults it OFF.
  const existingNorms = existingNotes.map((n) => ({
    norm: normalizeNoteText(n.content),
    tokens: noteTokens(n.content)
  }))
  const seenNoteNorms = new Set<string>()
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
    const content = n.content.trim()
    const norm = normalizeNoteText(content)
    if (seenNoteNorms.has(norm)) continue // intra-batch duplicate
    seenNoteNorms.add(norm)
    if (existingNorms.some((ex) => ex.norm === norm)) continue // already recorded verbatim
    const tokens = noteTokens(content)
    const possibleDuplicate = existingNorms.some(
      (ex) => jaccard(tokens, ex.tokens) >= NOTE_DUP_THRESHOLD
    )
    const tags = (Array.isArray(n.tags) ? n.tags : [])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim())
    const confidence: NoteConfidence =
      n.confidence === 'rumored' || n.confidence === 'suspected' ? n.confidence : 'confirmed'
    notes.push({
      content,
      entityRefs: refs,
      tags,
      confidence,
      possibleDuplicate: possibleDuplicate || undefined
    })
  }

  // ---- Changeset v2 (ADR-018/035): status changes (both modes) + tie/field changes ('full' only) ----

  const refKey = (r: EntityRef): string => (r.kind === 'new' ? `n${r.index}` : `e${r.entityId}`)
  // Type lookup for relation allowedness: proposed entities by canonical index, existing by id.
  const typeOfRef = (r: EntityRef): EntityType | null =>
    r.kind === 'new'
      ? (kept.find((v) => v.index === r.index)?.type ?? null)
      : (existing.find((e) => e.id === r.entityId)?.type ?? null)

  // 6) Status changes are ENUM-ONLY (ADR-054): snap the proposed status to the entity type's curated
  //    preset and take BOTH the canonical label AND its EXPLICIT lifecycle from that preset. A status that
  //    isn't a preset is DROPPED — the model never proposes a lifecycle, so it can only make an entity
  //    "fallen"/ended by naming a preset whose lifecycle ends it (no free text, no keyword heuristic).
  const statusChanges: ProposedStatusChange[] = []
  const seenStatus = new Set<string>()
  for (const sc of raw.statusChanges ?? []) {
    if (!sc || typeof sc.entityRef !== 'string') continue
    const ref = resolveRef(sc.entityRef)
    if (!ref) continue
    const preset = presetStatusFor(typeOfRef(ref), strOrUndef(sc.status) ?? null)
    if (!preset) continue // non-preset status → drop
    const status = preset.label
    const lifecycle = preset.lifecycle
    // ADR-031: proposing an existing entity's CURRENT state is a guaranteed no-op (updateEntity only
    // appends history when something changed) — drop it instead of surfacing review noise.
    if (ref.kind === 'existing') {
      const ent = existing.find((e) => e.id === ref.entityId)
      if (ent && ent.lifecycle === lifecycle && (ent.status ?? null) === status) continue
    }
    const key = `${refKey(ref)}:${lifecycle}:${status}`
    if (seenStatus.has(key)) continue
    seenStatus.add(key)
    statusChanges.push({ entityRef: ref, lifecycle, status })
  }

  // 7+8) Relationship + field changes: validated by the shared change validators (factored out for
  //      Illuminate/enrich reuse, ADR-035) over a ctx built from this extraction's closures.
  const changeCtx: ChangeValidationCtx = {
    resolveRef,
    refKey,
    typeOfRef,
    entityByRef: (r) =>
      r.kind === 'existing' ? (existing.find((e) => e.id === r.entityId) ?? null) : null,
    isLiveLink: (fromId, toId, relation) => findOpenLink(ctx, fromId, toId, relation) !== null
  }
  const relationshipChanges = validateRelationshipChanges(raw.relationshipChanges, changeCtx)
  const fieldChanges = validateFieldChanges(raw.fieldChanges, changeCtx)

  return { entities, notes, statusChanges, relationshipChanges, fieldChanges }
}

/**
 * The lookups the change validators need — built by validateExtraction (import: "#index" + real-id refs)
 * and by enrich.service (real-id-only refs). Factored out (ADR-035) so tier 2 reuses the exact ADR-031/033
 * validation rules without the entity/note machinery.
 */
export interface ChangeValidationCtx {
  resolveRef: (ref: string) => EntityRef | null
  refKey: (r: EntityRef) => string
  typeOfRef: (r: EntityRef) => EntityType | null
  /** The CURRENT existing entity behind a ref — null for a proposed-new ref. */
  entityByRef: (r: EntityRef) => Entity | null
  /** Whether an equivalent OPEN edge already exists (wraps findOpenLink, incl. inverse direction). */
  isLiveLink: (fromId: string, toId: string, relation: RelationKey) => boolean
}

/**
 * Relationship changes: both refs must resolve and differ; the relation must be a known key and
 * (when FORMING) allowed between the two types. Severing skips the type check — a legacy edge
 * should stay severable, and severing a non-existent edge is a no-op at apply time anyway.
 * ADR-031: an already-live tie between existing entities is dropped; intra-batch dupes are
 * direction-aware. ADR-033: form ties carry capped description/dispositions + snapped confidence.
 */
export function validateRelationshipChanges(
  raw: RawExtraction['relationshipChanges'],
  v: ChangeValidationCtx
): ProposedRelationshipChange[] {
  const relationshipChanges: ProposedRelationshipChange[] = []
  const seenRel = new Set<string>()
  for (const rc of raw ?? []) {
    if (!rc || typeof rc.fromRef !== 'string' || typeof rc.toRef !== 'string') continue
    if (typeof rc.relation !== 'string' || !isRelationKey(rc.relation)) continue
    if (rc.action !== 'form' && rc.action !== 'sever') continue
    const fromRef = v.resolveRef(rc.fromRef)
    const toRef = v.resolveRef(rc.toRef)
    if (!fromRef || !toRef || v.refKey(fromRef) === v.refKey(toRef)) continue
    if (rc.action === 'form') {
      const ft = v.typeOfRef(fromRef)
      const tt = v.typeOfRef(toRef)
      if (!ft || !tt || !isRelationAllowed(rc.relation, ft, tt)) continue
      // ADR-031: a tie that's ALREADY live between two existing entities is a no-op (createLink is
      // idempotent, incl. the inverse authoring direction) — drop it instead of re-proposing it on
      // every re-run of the same text.
      if (
        fromRef.kind === 'existing' &&
        toRef.kind === 'existing' &&
        v.isLiveLink(fromRef.entityId, toRef.entityId, rc.relation)
      ) {
        continue
      }
    }
    // Intra-batch dedup, DIRECTION-AWARE (ADR-031): "A ally_of B" + "B ally_of A" (symmetric), and
    // "A located_in B" + "B contains A" (directed pair), are the same edge — canonicalize before keying.
    const key = `${canonicalRelKey(v.refKey(fromRef), v.refKey(toRef), rc.relation)}:${rc.action}`
    if (seenRel.has(key)) continue
    seenRel.add(key)
    // Tie enrichment (ADR-033) — only meaningful on a FORM (a new edge carries the metadata; sever closes
    // an existing one). Cap lengths; snap confidence to the note vocabulary (default confirmed).
    const isForm = rc.action === 'form'
    const cap = (s: string | undefined, n: number): string | null =>
      strOrUndef(s)?.slice(0, n) ?? null
    const confidence: NoteConfidence =
      isForm && (rc.confidence === 'rumored' || rc.confidence === 'suspected')
        ? rc.confidence
        : 'confirmed'
    relationshipChanges.push({
      fromRef,
      toRef,
      relation: rc.relation,
      action: rc.action,
      description: isForm ? cap(rc.description, 240) : null,
      fromDisposition: isForm ? cap(rc.fromDisposition, 120) : null,
      toDisposition: isForm ? cap(rc.toDisposition, 120) : null,
      confidence
    })
  }
  return relationshipChanges
}

/**
 * Field changes on an EXISTING entity: a promoted list (traits/goals/flaws), the DESCRIPTION (a real
 * scalar column — ADR-035; previously it silently misrouted into the attributes bag), or a type attribute.
 * A #index (proposed) ref is dropped — a new entity carries its fields already.
 * **ADR-055:** a promoted list is **add/cut only** — `alter` (edit-in-place) is dropped for traits/goals/
 * flaws (they're a stable set, not a progress log; progress → notes/quests). `alter` stays valid for a
 * DESCRIPTION or attribute. For a LIST cut, oldValue must match a CURRENT item; "" coerces to null.
 */
export function validateFieldChanges(
  raw: RawExtraction['fieldChanges'],
  v: ChangeValidationCtx
): ProposedFieldChange[] {
  const fieldChanges: ProposedFieldChange[] = []
  const seenField = new Set<string>()
  for (const fc of raw ?? []) {
    if (!fc || typeof fc.entityRef !== 'string') continue
    const ref = v.resolveRef(fc.entityRef)
    if (!ref || ref.kind !== 'existing') continue
    const ent = v.entityByRef(ref)
    if (!ent) continue
    const field = strOrUndef(fc.field)
    if (!field) continue
    const op = fc.op
    if (op !== 'add' && op !== 'cut' && op !== 'alter') continue
    const value = strOrUndef(fc.value) ?? null
    const oldValue = strOrUndef(fc.oldValue) ?? null

    const isDescription = field === 'description'
    const isPromoted =
      !isDescription && (field === 'traits' || field === 'goals' || field === 'flaws')
    if (isPromoted && !profileFor(ent.type)[field as 'traits' | 'goals' | 'flaws']) continue
    const profField =
      isPromoted || isDescription ? null : profileFor(ent.type).fields.find((f) => f.key === field)
    const isList = isPromoted || profField?.kind === 'list'
    const current: string[] = isPromoted
      ? ent[field as 'traits' | 'goals' | 'flaws']
      : isList
        ? attrStringArray(ent.attributes[field])
        : []

    // Scalar no-ops (ADR-031): setting the value already there, or clearing an empty key, is noise.
    const scalarCurrent = isList
      ? null
      : isDescription
        ? (ent.description ?? '')
        : String(ent.attributes[field] ?? '')
    if (op === 'add') {
      if (!value) continue
      if (isList && current.includes(value)) continue // already present
      if (!isList && scalarCurrent === value) continue // already set to this
    } else if (op === 'cut') {
      if (isList && !current.includes(oldValue ?? value ?? '')) continue // must name a real item
      if (!isList && !scalarCurrent) continue // nothing to clear
    } else {
      // alter
      // ADR-055: a promoted list field (traits/goals/flaws) is ADD/CUT only for AI passes — never
      // edited in place. Those lists are a stable set of discrete items, not a progress log; how a goal
      // advanced (a location learned, a step done) belongs in a note or a quest, not by rewording it.
      // `alter` stays valid for attributes + description (facts/reveals, not progress).
      if (isPromoted) continue
      if (!value) continue
      if (isList && !(oldValue && current.includes(oldValue))) continue // must reference a real item
      if (!isList && scalarCurrent === value) continue // no-op alter
    }

    const key = `${ref.entityId}:${field}:${op}:${value ?? ''}:${oldValue ?? ''}`
    if (seenField.has(key)) continue
    seenField.add(key)
    fieldChanges.push({ entityRef: ref, field, op, value, oldValue })
  }
  return fieldChanges
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function attrStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Case-insensitive match of a status against the type's curated presets (ADR-031 as-built): returns the
 *  canonical preset — label casing + its EXPLICIT lifecycle — the mapping the form's combobox applies. */
function presetStatusFor(type: EntityType | null, raw: string | null): StatusPreset | null {
  if (!type || !raw) return null
  const t = raw.trim().toLowerCase()
  return (profileFor(type).status ?? []).find((p) => p.label.toLowerCase() === t) ?? null
}

// ---- Dedup helpers (ADR-031) ----

/** Two notes whose token overlap reaches this are "the same fact reworded" — flagged, review-off. */
const NOTE_DUP_THRESHOLD = 0.8

/** Case/punctuation/whitespace-insensitive canonical form — the EXACT-duplicate identity. */
function normalizeNoteText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Meaningful words (≥3 chars) as a set — order/casing/punctuation don't matter for similarity. */
function noteTokens(s: string): Set<string> {
  return new Set(
    normalizeNoteText(s)
      .split(' ')
      .filter((t) => t.length >= 3)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/** Direction-independent identity for a relationship edge: "A ally_of B" ≡ "B ally_of A" (symmetric)
 *  and "A located_in B" ≡ "B contains A" (directed pair) — mirrors findOpenLink's equivalence. */
function canonicalRelKey(fromKey: string, toKey: string, relation: RelationKey): string {
  const fwd = `${fromKey}>${toKey}:${relation}`
  const rev = `${toKey}>${fromKey}:${RELATIONS[relation].inverseKey}`
  return fwd < rev ? fwd : rev
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
        // Extraction is ENUM-ONLY (ADR-054): a preset status carries an explicit lifecycle (creature
        // "Defeated" → ended) — adopt it, exactly like the form's combobox does (ADR-021). `ce.status` is
        // already snapped to a preset label or dropped, so with no preset a newly-introduced entity
        // defaults to `active` (never an AI-guessed "ended" from the free-text keyword heuristic).
        lifecycle: presetStatusFor(ce.type, ce.status ?? null)?.lifecycle ?? 'active',
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
        result.skipped.push({
          kind: 'change',
          reason: 'a relationship change had no valid endpoints'
        })
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
          description: rc.description ?? undefined,
          fromDisposition: rc.fromDisposition ?? undefined,
          toDisposition: rc.toDisposition ?? undefined,
          confidence: rc.confidence,
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
 *  list-kind attribute; set/clear for the description or a scalar attribute). Returns null when the
 *  change can't apply. */
function fieldChangePatch(ent: Entity, fc: ConfirmedFieldChange): UpdateEntityInput | null {
  // Description is a REAL scalar column (ADR-035) — write it directly, never the attributes bag.
  if (fc.field === 'description') {
    if (fc.op === 'cut') return { description: null }
    return fc.value ? { description: fc.value } : null
  }
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
