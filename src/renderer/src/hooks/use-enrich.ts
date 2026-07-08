import { useCallback, useRef, useState } from 'react'
import type { Session } from '@shared/entity-types'
import type { TouchedEntity } from '@shared/enrich-types'
import type {
  ApplyResult,
  ConfirmedFieldChange,
  ConfirmedRelationshipChange,
  EntityRef,
  ExtractFailureReason,
  ProposedRelationshipChange
} from '@shared/import-types'
import { RELATIONS } from '@shared/relations'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
import type { ChangesetReviewModel } from '@renderer/components/capture/ChangesetReview'

export type EnrichPhase =
  | 'idle'
  | 'scanning'
  | 'checklist'
  | 'running'
  | 'review'
  | 'applying'
  | 'done'
  | 'error'

/** One checklist row's live progress through the sequential run. */
export interface EnrichEntityProgress {
  entityId: string
  name: string
  noteCount: number
  state: 'pending' | 'running' | 'done' | 'empty' | 'failed'
  ties: number
  edits: number
  reason?: ExtractFailureReason
}

const refId = (r: EntityRef): string => (r.kind === 'existing' ? r.entityId : `n${r.index}`)

/** Direction-independent identity for a proposed tie over REAL ids (ADR-035 F7): enriching A and B
 *  separately can propose the same edge from both sides — canonicalize via the relation's inverse. */
function canonicalTieKey(rc: ProposedRelationshipChange): string {
  const from = refId(rc.fromRef)
  const to = refId(rc.toRef)
  const fwd = `${from}>${to}:${rc.relation}`
  const rev = `${to}>${from}:${RELATIONS[rc.relation].inverseKey}`
  return `${fwd < rev ? fwd : rev}:${rc.action}`
}

const noop = (): void => {}
const EMPTY: never[] = []

/**
 * Drives one Illuminate run (tier-2 enrichment, ADR-035): scan a session's touched entities → the user
 * checks who to enrich → ONE sequential IPC call per checked entity (progress per row; cancel stops
 * between entities; a global key/offline failure aborts the remainder) → proposals merge (cross-entity
 * tie dedup) into a ChangesetReviewModel → one transactional apply stamped at the enriched session.
 */
export function useEnrich(
  campaignId: string | null,
  session: Session | null
): {
  phase: EnrichPhase
  touched: TouchedEntity[]
  checked: Set<string>
  toggle: (entityId: string) => void
  progress: EnrichEntityProgress[]
  globalReason: ExtractFailureReason | null
  error: string | null
  result: ApplyResult | null
  merged: number
  scan: () => void
  run: () => void
  cancel: () => void
  apply: () => void
  reset: () => void
  review: ChangesetReviewModel
} {
  const [phase, setPhase] = useState<EnrichPhase>('idle')
  const [touched, setTouched] = useState<TouchedEntity[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<EnrichEntityProgress[]>([])
  const [relationshipChanges, setRelationshipChanges] = useState<ConfirmedRelationshipChange[]>([])
  const [fieldChanges, setFieldChanges] = useState<ConfirmedFieldChange[]>([])
  const [globalReason, setGlobalReason] = useState<ExtractFailureReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const cancelRef = useRef(false)

  const scan = useCallback(() => {
    if (!session) return
    setPhase('scanning')
    setError(null)
    ledger.enrich
      .touched(session.id)
      .then((t) => {
        setTouched(t)
        setChecked(new Set(t.map((x) => x.entityId))) // default: everything checked
        setPhase('checklist')
      })
      .catch((e) => {
        setError(String(e))
        setPhase('error')
      })
  }, [session])

  const toggle = useCallback((entityId: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId)
      else next.add(entityId)
      return next
    })
  }, [])

  const run = useCallback(async () => {
    if (!campaignId || !session) return
    const targets = touched.filter((t) => checked.has(t.entityId))
    if (targets.length === 0) return
    cancelRef.current = false
    setPhase('running')
    setGlobalReason(null)
    setProgress(
      targets.map((t) => ({
        entityId: t.entityId,
        name: t.name,
        noteCount: t.noteCount,
        state: 'pending' as const,
        ties: 0,
        edits: 0
      }))
    )
    const rels: ConfirmedRelationshipChange[] = []
    const fields: ConfirmedFieldChange[] = []
    const seenTies = new Set<string>()
    let global: ExtractFailureReason | null = null
    let cancelled = false

    const mark = (id: string, patch: Partial<EnrichEntityProgress>): void =>
      setProgress((ps) => ps.map((p) => (p.entityId === id ? { ...p, ...patch } : p)))

    for (const t of targets) {
      if (cancelRef.current) {
        cancelled = true
        break
      }
      mark(t.entityId, { state: 'running' })
      const res = await ledger.enrich.entity({
        campaignId,
        sessionId: session.id,
        entityId: t.entityId
      })
      if (!res.ok) {
        mark(t.entityId, { state: 'failed', reason: res.reason })
        // A key/network failure would fail every remaining call identically — stop the sweep.
        if (res.reason === 'no_key' || res.reason === 'bad_key' || res.reason === 'offline') {
          global = res.reason
          break
        }
        continue
      }
      // Cross-entity tie dedup (F7): enriching both endpoints can propose the same edge twice.
      const freshTies = res.relationshipChanges.filter((rc) => {
        const key = canonicalTieKey(rc)
        if (seenTies.has(key)) return false
        seenTies.add(key)
        return true
      })
      rels.push(...freshTies.map((c) => ({ ...c, include: true })))
      fields.push(...res.fieldChanges.map((c) => ({ ...c, include: true })))
      mark(t.entityId, {
        state: freshTies.length + res.fieldChanges.length > 0 ? 'done' : 'empty',
        ties: freshTies.length,
        edits: res.fieldChanges.length
      })
    }

    setRelationshipChanges(rels)
    setFieldChanges(fields)
    setGlobalReason(global)
    const merged = rels.length + fields.length
    if (merged > 0) setPhase('review') // (the dialog banners a mid-run global failure)
    else if (global) setPhase('error')
    else if (cancelled) setPhase('checklist')
    else setPhase('done') // clean sweep, nothing new — the dedup payoff
  }, [campaignId, session, touched, checked])

  const cancel = useCallback(() => {
    cancelRef.current = true // takes effect between entities; the in-flight call completes
  }, [])

  const apply = useCallback(() => {
    if (!campaignId || !session) return
    setPhase('applying')
    setError(null)
    ledger.import
      .apply({
        campaignId,
        sessionId: session.id, // ties open their interval at the enriched session (decision #6)
        entities: [],
        notes: [],
        statusChanges: [],
        relationshipChanges,
        fieldChanges
      })
      .then((res) => {
        setResult(res)
        setPhase('done')
        useUiStore.getState().bumpEntities()
      })
      .catch((e) => {
        setError(String(e))
        setPhase('error')
      })
  }, [campaignId, session, relationshipChanges, fieldChanges])

  const reset = useCallback(() => {
    cancelRef.current = true
    setPhase('idle')
    setTouched([])
    setChecked(new Set())
    setProgress([])
    setRelationshipChanges([])
    setFieldChanges([])
    setGlobalReason(null)
    setError(null)
    setResult(null)
  }, [])

  // The reviewer's structural surface: constant-empty entities/notes/status (their sections auto-hide),
  // live relationship/field arrays. Only 'applying' matters for its footer.
  const review: ChangesetReviewModel = {
    status: phase === 'applying' ? 'applying' : 'review',
    proposal: null,
    entities: EMPTY,
    notes: EMPTY,
    statusChanges: EMPTY,
    relationshipChanges,
    fieldChanges,
    setEntities: noop,
    setNotes: noop,
    setStatusChanges: noop,
    setRelationshipChanges,
    setFieldChanges
  }

  return {
    phase,
    touched,
    checked,
    toggle,
    progress,
    globalReason,
    error,
    result,
    merged: relationshipChanges.length + fieldChanges.length,
    scan,
    run,
    cancel,
    apply,
    reset,
    review
  }
}
