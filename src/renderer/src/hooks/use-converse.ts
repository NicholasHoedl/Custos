import { useCallback, useRef, useState } from 'react'
import type { ConverseFailureReason, ConverseTurn } from '@shared/converse-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type ConverseStatus = 'idle' | 'thinking' | 'done' | 'error'

interface ConverseState {
  /** The conversation thread — the opening spread then any follow-up turns, oldest first (ADR-049). */
  turns: ConverseTurn[]
  status: ConverseStatus
  /** An ok:false reason from the last call (no key / offline / invalid …), rendered as a banner. */
  failure: ConverseFailureReason | null
  error: string | null
}

const IDLE: ConverseState = { turns: [], status: 'idle', failure: null, error: null }

export interface ConverseAskOpts {
  asOfSession?: number
  speed?: 'quick' | 'deep'
}

/**
 * Drives the Converse lens as a light conversation THREAD (ADR-049): `ask` starts a fresh conversation (the
 * opening question spread); `followUp` feeds back what the target said and appends a spread of follow-up
 * questions grounded in it. Single-shot per turn (mirrors useSuggest), not streaming. Reads the active
 * campaign + asking PC from the store; grounding is direct-fetch, so no embedding model is needed.
 */
export function useConverse(): ConverseState & {
  ask: (targetId: string, thread: string, opts?: ConverseAskOpts) => void
  followUp: (answer: string) => void
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<ConverseState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  // Token to drop a stale in-flight result if the user cancels, resets, or re-asks first.
  const reqRef = useRef(0)
  const requestIdRef = useRef<string | null>(null)
  // The active conversation's params (so followUp reuses the same target/thread/as-of/speed) + the
  // target's answers fed so far (each follow-up grounds on them).
  const convoRef = useRef<({ targetId: string; thread: string } & ConverseAskOpts) | null>(null)
  const answersRef = useRef<string[]>([])

  // One request → append a turn on success. `answer` is what the target said that prompted this spread
  // (null for the opening spread); `history` is the answers that ground it (empty for the opening spread).
  const send = useCallback(
    (
      targetId: string,
      thread: string,
      opts: ConverseAskOpts,
      history: string[],
      answer: string | null
    ) => {
      if (!activeCampaignId || !activePcId || !targetId) return
      const token = ++reqRef.current
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      setState((s) => ({ ...s, status: 'thinking', error: null }))
      ledger.converse
        .query({
          requestId,
          campaignId: activeCampaignId,
          pcId: activePcId,
          targetId,
          focus: thread.trim() || undefined,
          asOfSession: opts.asOfSession,
          speed: opts.speed,
          history: history.length ? history : undefined
        })
        .then((result) => {
          if (reqRef.current !== token) return
          if (result.ok) {
            answersRef.current = history
            setState((s) => ({
              ...s,
              status: 'done',
              failure: null,
              turns: [...s.turns, { answer, questions: result.questions, cost: result.cost }]
            }))
          } else {
            setState((s) => ({ ...s, status: 'done', failure: result.reason }))
          }
        })
        .catch((err) => {
          if (reqRef.current === token)
            setState((s) => ({ ...s, status: 'error', error: String(err) }))
        })
    },
    [activeCampaignId, activePcId]
  )

  // Start a fresh conversation: reset the thread + answers, then fetch the opening spread.
  const ask = useCallback(
    (targetId: string, thread: string, opts?: ConverseAskOpts) => {
      if (!targetId) return
      const o = opts ?? {}
      convoRef.current = { targetId, thread, ...o }
      answersRef.current = []
      setState((s) => ({ ...s, turns: [], failure: null, error: null }))
      send(targetId, thread, o, [], null)
    },
    [send]
  )

  // Feed what the target just said → a spread of follow-up questions grounded in the answers so far.
  const followUp = useCallback(
    (answer: string) => {
      const convo = convoRef.current
      const a = answer.trim()
      if (!convo || !a) return
      send(
        convo.targetId,
        convo.thread,
        { asOfSession: convo.asOfSession, speed: convo.speed },
        [...answersRef.current, a],
        a
      )
    },
    [send]
  )

  // Abort the in-flight call but KEEP the thread (drop back to the last spread, or idle if none).
  const cancel = useCallback(() => {
    reqRef.current++
    if (requestIdRef.current) ledger.converse.cancel(requestIdRef.current)
    requestIdRef.current = null
    setState((s) => ({ ...s, status: s.turns.length ? 'done' : 'idle' }))
  }, [])

  // Clear the whole conversation back to idle (and stop any in-flight call) — the Converse "Reset" button.
  const reset = useCallback(() => {
    reqRef.current++
    if (requestIdRef.current) ledger.converse.cancel(requestIdRef.current)
    requestIdRef.current = null
    convoRef.current = null
    answersRef.current = []
    setState(IDLE)
  }, [])

  return { ...state, ask, followUp, cancel, reset }
}
