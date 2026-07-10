import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ApplyResult,
  ConfirmedChangeset,
  ConfirmedEntity,
  ConfirmedFieldChange,
  ConfirmedNote,
  ConfirmedRelationshipChange,
  ConfirmedStatusChange,
  ExtractFailureReason,
  ExtractionMode,
  ExtractionProposal,
  ProposedEntity
} from '@shared/import-types'
import type { AiRunCost } from '@shared/usage-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'

export type ImportStatus = 'idle' | 'extracting' | 'review' | 'applying' | 'done' | 'error'

// A proposal entity becomes an editable "confirmed" draft. Default to linking only when an existing
// entity matches strongly (>=0.9); otherwise create. The original proposal is kept for the match list.
function seedEntity(p: ProposedEntity): ConfirmedEntity {
  const strong = p.matches.find((m) => m.score >= 0.9)
  return {
    index: p.index,
    action: strong ? 'link' : 'create',
    type: p.type,
    name: p.name,
    description: p.description,
    status: p.status,
    attributes: p.attributes,
    linkToEntityId: strong?.entityId
  }
}

/**
 * Two-phase import: extract (Claude) → editable review draft → apply (one transaction).
 * `mode` (ADR-035): 'capture' (default — entities + notes + status; Chronicle/Transcribe) or 'full'
 * (all five arrays incl. ties + field changes; the backstory wizard only). `apply` accepts a session
 * override (an explicit null = undated/pre-tracking) instead of the app's active session.
 */
export function useImport(opts?: { mode?: ExtractionMode; backstorySubjectId?: string }): {
  status: ImportStatus
  proposal: ExtractionProposal | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
  statusChanges: ConfirmedStatusChange[]
  relationshipChanges: ConfirmedRelationshipChange[]
  fieldChanges: ConfirmedFieldChange[]
  reason: ExtractFailureReason | null
  error: string | null
  result: ApplyResult | null
  /** What the extraction call cost (P0-4); null until a run reports usage. */
  cost: AiRunCost | null
  setEntities: Dispatch<SetStateAction<ConfirmedEntity[]>>
  setNotes: Dispatch<SetStateAction<ConfirmedNote[]>>
  setStatusChanges: Dispatch<SetStateAction<ConfirmedStatusChange[]>>
  setRelationshipChanges: Dispatch<SetStateAction<ConfirmedRelationshipChange[]>>
  setFieldChanges: Dispatch<SetStateAction<ConfirmedFieldChange[]>>
  extract: (text: string) => void
  /** Abort an in-flight extraction (Transcribe's Stop, P1-5) and return to idle. */
  cancel: () => void
  apply: (sessionIdOverride?: string | null) => void
  reset: () => void
} {
  const mode = opts?.mode ?? 'capture'
  const backstorySubjectId = opts?.backstorySubjectId
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [proposal, setProposal] = useState<ExtractionProposal | null>(null)
  const [entities, setEntities] = useState<ConfirmedEntity[]>([])
  const [notes, setNotes] = useState<ConfirmedNote[]>([])
  const [statusChanges, setStatusChanges] = useState<ConfirmedStatusChange[]>([])
  const [relationshipChanges, setRelationshipChanges] = useState<ConfirmedRelationshipChange[]>([])
  const [fieldChanges, setFieldChanges] = useState<ConfirmedFieldChange[]>([])
  const [reason, setReason] = useState<ExtractFailureReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [cost, setCost] = useState<AiRunCost | null>(null)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  // The current extraction's requestId — guards its callbacks and lets cancel() abort it (P1-5).
  const requestIdRef = useRef<string | null>(null)

  const extract = useCallback(
    (text: string) => {
      if (!activeCampaignId || !text.trim()) return
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      setStatus('extracting')
      setReason(null)
      setError(null)
      setResult(null)
      setCost(null)
      ledger.import
        .extract({ requestId, campaignId: activeCampaignId, text, mode, backstorySubjectId })
        .then((res) => {
          if (requestIdRef.current !== requestId) return // cancelled or superseded
          if (!res.ok) {
            setStatus('idle')
            setReason(res.reason)
            return
          }
          setProposal(res.proposal)
          setCost(res.cost ?? null)
          setEntities(res.proposal.entities.map(seedEntity))
          setNotes(
            res.proposal.notes.map((n) => ({
              content: n.content,
              entityRefs: n.entityRefs,
              tags: n.tags,
              confidence: n.confidence,
              // A near-duplicate of an existing note (ADR-031) starts UNCHECKED — opt in to keep it.
              include: !n.possibleDuplicate,
              possibleDuplicate: n.possibleDuplicate
            }))
          )
          setStatusChanges(res.proposal.statusChanges.map((c) => ({ ...c, include: true })))
          setRelationshipChanges(
            res.proposal.relationshipChanges.map((c) => ({ ...c, include: true }))
          )
          setFieldChanges(res.proposal.fieldChanges.map((c) => ({ ...c, include: true })))
          setStatus('review')
        })
        .catch((e) => {
          if (requestIdRef.current !== requestId) return // cancelled — ignore the abort rejection
          setStatus('error')
          setError(String(e))
        })
    },
    [activeCampaignId, mode, backstorySubjectId]
  )

  const cancel = useCallback(() => {
    const id = requestIdRef.current
    requestIdRef.current = null
    if (id) ledger.import.cancelExtract(id)
    setStatus('idle')
  }, [])

  const apply = useCallback(
    (sessionIdOverride?: string | null) => {
      if (!activeCampaignId) return
      setStatus('applying')
      setError(null)
      const payload: ConfirmedChangeset = {
        campaignId: activeCampaignId,
        sessionId: sessionIdOverride !== undefined ? sessionIdOverride : activeSessionId,
        entities,
        notes,
        statusChanges,
        relationshipChanges,
        fieldChanges
      }
      ledger.import
        .apply(payload)
        .then((res) => {
          setResult(res)
          setStatus('done')
          const ui = useUiStore.getState()
          ui.bumpEntities() // refresh entity lists across the app
          ui.bumpSessions() // notes stamped at the session clear its unclosed badge (P1-2)
        })
        .catch((e) => {
          setStatus('error')
          setError(String(e))
        })
    },
    [
      activeCampaignId,
      activeSessionId,
      entities,
      notes,
      statusChanges,
      relationshipChanges,
      fieldChanges
    ]
  )

  const reset = useCallback(() => {
    requestIdRef.current = null // drop any in-flight extraction's callbacks
    setStatus('idle')
    setProposal(null)
    setEntities([])
    setNotes([])
    setStatusChanges([])
    setRelationshipChanges([])
    setFieldChanges([])
    setReason(null)
    setError(null)
    setResult(null)
    setCost(null)
  }, [])

  return {
    status,
    proposal,
    entities,
    notes,
    statusChanges,
    relationshipChanges,
    fieldChanges,
    reason,
    error,
    result,
    cost,
    setEntities,
    setNotes,
    setStatusChanges,
    setRelationshipChanges,
    setFieldChanges,
    extract,
    cancel,
    apply,
    reset
  }
}
