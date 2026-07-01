import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ApplyResult,
  ConfirmedChangeset,
  ConfirmedEntity,
  ConfirmedNote,
  ExtractFailureReason,
  ExtractionProposal,
  ProposedEntity
} from '@shared/import-types'
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

/** Two-phase import: extract (Claude) → editable review draft → apply (one transaction). */
export function useImport(): {
  status: ImportStatus
  proposal: ExtractionProposal | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
  reason: ExtractFailureReason | null
  error: string | null
  result: ApplyResult | null
  setEntities: Dispatch<SetStateAction<ConfirmedEntity[]>>
  setNotes: Dispatch<SetStateAction<ConfirmedNote[]>>
  extract: (text: string) => void
  apply: () => void
  reset: () => void
} {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [proposal, setProposal] = useState<ExtractionProposal | null>(null)
  const [entities, setEntities] = useState<ConfirmedEntity[]>([])
  const [notes, setNotes] = useState<ConfirmedNote[]>([])
  const [reason, setReason] = useState<ExtractFailureReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)

  const extract = useCallback(
    (text: string) => {
      if (!activeCampaignId || !text.trim()) return
      setStatus('extracting')
      setReason(null)
      setError(null)
      setResult(null)
      ledger.import
        .extract({ campaignId: activeCampaignId, text })
        .then((res) => {
          if (!res.ok) {
            setStatus('idle')
            setReason(res.reason)
            return
          }
          setProposal(res.proposal)
          setEntities(res.proposal.entities.map(seedEntity))
          setNotes(
            res.proposal.notes.map((n) => ({
              content: n.content,
              entityRefs: n.entityRefs,
              tags: n.tags,
              include: true
            }))
          )
          setStatus('review')
        })
        .catch((e) => {
          setStatus('error')
          setError(String(e))
        })
    },
    [activeCampaignId]
  )

  const apply = useCallback(() => {
    if (!activeCampaignId) return
    setStatus('applying')
    setError(null)
    const payload: ConfirmedChangeset = {
      campaignId: activeCampaignId,
      sessionId: activeSessionId,
      entities,
      notes
    }
    ledger.import
      .apply(payload)
      .then((res) => {
        setResult(res)
        setStatus('done')
        useUiStore.getState().bumpEntities() // refresh entity lists across the app
      })
      .catch((e) => {
        setStatus('error')
        setError(String(e))
      })
  }, [activeCampaignId, activeSessionId, entities, notes])

  const reset = useCallback(() => {
    setStatus('idle')
    setProposal(null)
    setEntities([])
    setNotes([])
    setReason(null)
    setError(null)
    setResult(null)
  }, [])

  return {
    status,
    proposal,
    entities,
    notes,
    reason,
    error,
    result,
    setEntities,
    setNotes,
    extract,
    apply,
    reset
  }
}
