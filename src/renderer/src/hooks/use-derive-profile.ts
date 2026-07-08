import { useCallback, useRef, useState } from 'react'
import type { DeriveProfileResult } from '@shared/derive-profile-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type DeriveStatus = 'idle' | 'thinking' | 'done' | 'error'

interface DeriveState {
  status: DeriveStatus
  result: DeriveProfileResult | null
  error: string | null
}

const IDLE: DeriveState = { status: 'idle', result: null, error: null }

/**
 * Drives the single-shot "derive profile from backstory" request (ADR-029), mirroring useConverse. Reads
 * the active campaign from the store; the caller supplies the main character's id. Grounding is a direct
 * fetch of that one entity's backstory, so only an API key is needed (no embedding model).
 */
export function useDeriveProfile(): DeriveState & {
  run: (pcId: string) => void
  reset: () => void
} {
  const [state, setState] = useState<DeriveState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const reqRef = useRef(0)

  const run = useCallback(
    (pcId: string) => {
      if (!activeCampaignId || !pcId) return
      const token = ++reqRef.current
      setState({ status: 'thinking', result: null, error: null })
      ledger.deriveProfile
        .query({ campaignId: activeCampaignId, pcId })
        .then((result) => {
          if (reqRef.current === token) setState({ status: 'done', result, error: null })
        })
        .catch((err) => {
          if (reqRef.current === token)
            setState({ status: 'error', result: null, error: String(err) })
        })
    },
    [activeCampaignId]
  )

  const reset = useCallback(() => {
    reqRef.current++
    setState(IDLE)
  }, [])

  return { ...state, run, reset }
}
