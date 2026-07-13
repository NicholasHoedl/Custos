import { useCallback, useRef, useState } from 'react'
import type { MomentSuggestion, SuggestMode, SuggestResult } from '@shared/suggest-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type SuggestStatus = 'idle' | 'thinking' | 'done' | 'error'

/** Everything past the situation + mode: as-of clamp, goal bias, speed tier, and the refine re-roll. */
export interface AskOptions {
  asOfSession?: number
  goal?: string
  speed?: 'quick' | 'deep'
  /** Refine (attitudes only): a nudge + the spread being reshaped — re-rolls a fresh six. */
  refinement?: string
  previous?: MomentSuggestion[]
}

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
  ask: (situation: string, mode: SuggestMode, opts?: AskOptions) => void
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<SuggestState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const scene = useAppStore((s) => s.scene)
  // Token to drop a stale in-flight result if the user cancels, resets, or re-asks first.
  const reqRef = useRef(0)
  // The current call's requestId — lets cancel() abort the main-process call (P1-5).
  const requestIdRef = useRef<string | null>(null)

  const ask = useCallback(
    (situation: string, mode: SuggestMode, opts?: AskOptions) => {
      if (!activeCampaignId || !activePcId) return
      if (mode === 'attitudes' && !situation.trim()) return
      const token = ++reqRef.current
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      setState({ status: 'thinking', result: null, error: null })
      ledger.suggest
        .query({
          requestId,
          campaignId: activeCampaignId,
          pcId: activePcId,
          situation: situation.trim(),
          goal: opts?.goal?.trim() || undefined,
          mode,
          scene,
          asOfSession: opts?.asOfSession,
          speed: opts?.speed,
          refinement: opts?.refinement,
          previous: opts?.previous
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

  // Abort the in-flight call (frees the model spend) and drop back to idle — the bumped token means the
  // aborted promise's rejection is ignored, so this reads as "stopped", not an error.
  const cancel = useCallback(() => {
    reqRef.current++
    if (requestIdRef.current) ledger.suggest.cancel(requestIdRef.current)
    requestIdRef.current = null
    setState(IDLE)
  }, [])

  const reset = useCallback(() => {
    cancel()
  }, [cancel])

  return { ...state, ask, cancel, reset }
}
