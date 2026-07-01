import { useCallback, useRef, useState } from 'react'
import type { SuggestMode, SuggestResult } from '@shared/suggest-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type SuggestStatus = 'idle' | 'thinking' | 'done' | 'error'

interface SuggestState {
  status: SuggestStatus
  result: SuggestResult | null
  error: string | null
}

const IDLE: SuggestState = { status: 'idle', result: null, error: null }

/**
 * Drives a single-shot Suggest request (no streaming). Reads the active campaign + PC from the app
 * store. Attitudes mode requires a situation; directions mode allows an empty one (grounding comes from
 * the campaign's open threads).
 */
export function useSuggest(): SuggestState & {
  ask: (situation: string, mode: SuggestMode, asOfSession?: number) => void
  reset: () => void
} {
  const [state, setState] = useState<SuggestState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const scene = useAppStore((s) => s.scene)
  // Token to drop a stale in-flight result if the user resets or re-asks (e.g. toggles mode) first.
  const reqRef = useRef(0)

  const ask = useCallback(
    (situation: string, mode: SuggestMode, asOfSession?: number) => {
      if (!activeCampaignId || !activePcId) return
      if (mode === 'attitudes' && !situation.trim()) return
      const token = ++reqRef.current
      setState({ status: 'thinking', result: null, error: null })
      ledger.suggest
        .query({
          campaignId: activeCampaignId,
          pcId: activePcId,
          situation: situation.trim(),
          mode,
          scene,
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
    [activeCampaignId, activePcId, scene]
  )

  const reset = useCallback(() => {
    reqRef.current++
    setState(IDLE)
  }, [])

  return { ...state, ask, reset }
}
