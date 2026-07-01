import { ENTITY_TYPES, type Entity, type EntityType } from '@shared/entity-types'
import type {
  ApplyResult,
  ConfirmedChangeset,
  EntityRef,
  ExtractionProposal,
  ExtractRequest,
  ExtractResult,
  ProposedEntity,
  ProposedNote,
  RawExtraction
} from '@shared/import-types'
import type { DbContext } from './db-context'
import type { VectorStore } from './vector-store.service'
import { FUZZY_THRESHOLD, nameMatchScore } from './vector-store.service'
import { createEntity, listEntities } from './entity.service'
import { createNote } from './note.service'
import { indexEntity, indexNote } from './embedding-index.service'
import { getSettings } from './settings.service'
import { extractChangeset as claudeExtract, isAvailable } from './claude.service'
import { classifyError, isOnline } from './ai-util'

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
      existing: existing.map((e) => ({ id: e.id, name: e.name, type: e.type })),
      model: suggestModel,
      effort: suggestEffort,
      signal
    })
    const proposal = validateExtraction(raw, existing)
    if (proposal.entities.length === 0 && proposal.notes.length === 0) {
      return { ok: false, reason: 'empty' }
    }
    return { ok: true, proposal }
  } catch (err) {
    return {
      ok: false,
      reason: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    }
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
    notes.push({ content: n.content.trim(), entityRefs: refs, tags })
  }

  return { entities, notes }
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
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
        attributes: ce.attributes
      })
      idByIndex.set(ce.index, created.id)
      result.createdEntityIds.push(created.id)
    }

    const resolve = (r: EntityRef): string | null =>
      r.kind === 'existing' ? r.entityId : (idByIndex.get(r.index) ?? null)

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
        entityIds,
        sessionId: payload.sessionId ?? undefined,
        content: cn.content,
        tags: cn.tags
      })
      result.createdNoteIds.push(note.id)
    }
  })

  // Post-commit: queue embeddings (no-ops until the local model is present).
  for (const id of result.createdEntityIds) indexEntity(ctx, store, id)
  for (const id of result.createdNoteIds) indexNote(ctx, store, id)
  return result
}
