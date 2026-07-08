import { useCallback, useRef, useState } from 'react'
import type { ConverseResult } from '@shared/converse-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type ConverseStatus = 'idle' | 'thinking' | 'done' | 'error'

interface ConverseState {
  status: ConverseStatus
  result: ConverseResult | null
  error: string | null
}

const IDLE: ConverseState = { status: 'idle', result: null, error: null }

/**
 * Drives a single-shot Converse request (no streaming, mirrors useSuggest). Reads the active campaign +
 * asking PC from the app store; the caller supplies the target character and an optional thread to dig
 * into. Grounding is direct-fetch, so no embedding model is needed (only an API key).
 */
export function useConverse(): ConverseState & {
  ask: (targetId: string, thread: string, asOfSession?: number) => void
  reset: () => void
} {
  const [state, setState] = useState<ConverseState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  // Token to drop a stale in-flight result if the user resets or re-asks first.
  const reqRef = useRef(0)

  const ask = useCallback(
    (targetId: string, thread: string, asOfSession?: number) => {
      if (!activeCampaignId || !activePcId || !targetId) return
      const token = ++reqRef.current
      setState({ status: 'thinking', result: null, error: null })
      ledger.converse
        .query({
          campaignId: activeCampaignId,
          pcId: activePcId,
          targetId,
          focus: thread.trim() || undefined,
          asOfSession
        })
        .then((result) => {
          if (reqRef.current === token) setState({ status: 'done', result, error: null })
        })
        .catch((err) => {
          if (reqRef.current === token)
            setState({ status: 'error', result: null, error: String(err) })
        })
    },
    [activeCampaignId, activePcId]
  )

  const reset = useCallback(() => {
    reqRef.current++
    setState(IDLE)
  }, [])

  return { ...state, ask, reset }
}
