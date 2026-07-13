import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecallMode, RecallSource, RecallTurn } from '@shared/recall-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type RecallStatus = 'idle' | 'streaming' | 'error'

// Composite key matching recall.service's chunksToSources — used to mark which retrieved sources the
// finished answer actually cited (the done event carries the cited subset; the early event carries all).
function sourceKey(s: RecallSource): string {
  return `${s.entityId ?? 'lore'}:${s.noteId ?? ''}`
}

interface RecallState {
  /** The conversation transcript — completed turns, oldest first (overhaul follow-up loop). */
  turns: RecallTurn[]
  // The in-flight turn:
  status: RecallStatus
  question: string
  answer: string
  sources: RecallSource[]
  error: { message: string; kind: string } | null
}

const IDLE: RecallState = {
  turns: [],
  status: 'idle',
  question: '',
  answer: '',
  sources: [],
  error: null
}

/** Reset only the in-flight turn (keep the transcript). */
function clearInflight(s: RecallState): RecallState {
  return { ...s, status: 'idle', question: '', answer: '', sources: [], error: null }
}

export interface RecallAskOpts {
  mode?: RecallMode
  asOfSession?: number
  speed?: 'quick' | 'deep'
}

export function useRecall(): RecallState & {
  ask: (query: string, opts?: RecallAskOpts) => void
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<RecallState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const reqId = useRef<string | null>(null)
  const buffer = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The completed turns, mirrored in a ref so `ask` (memoized) can send the latest as history without
  // re-subscribing the stream handlers on every turn.
  const turnsRef = useRef<RecallTurn[]>([])

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (buffer.current) {
      const text = buffer.current
      buffer.current = ''
      setState((s) => ({ ...s, answer: s.answer + text }))
    }
  }, [])

  const schedule = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(flush, 50) // ~20fps; smooth without a render per token
  }, [flush])

  useEffect(() => {
    const offChunk = ledger.onRecallChunk((chunk) => {
      if (chunk.requestId !== reqId.current) return
      buffer.current += chunk.text
      schedule()
    })
    // Instant grounding (overhaul): the retrieved sources arrive before the answer finishes streaming.
    const offSources = ledger.onRecallSources((ev) => {
      if (ev.requestId !== reqId.current) return
      setState((s) => ({ ...s, sources: ev.sources }))
    })
    const offDone = ledger.onRecallDone((done) => {
      if (done.requestId !== reqId.current) return
      flush()
      reqId.current = null
      setState((s) => {
        // Mark which retrieved sources the answer cited; keep them all visible as grounding.
        const citedKeys = new Set(done.sources.map(sourceKey))
        const base = s.sources.length ? s.sources : done.sources
        const marked = base.map((src) => ({ ...src, cited: citedKeys.has(sourceKey(src)) }))
        const turn: RecallTurn = {
          question: s.question,
          answer: s.answer,
          sources: marked,
          reason: done.reason,
          cost: done.cost ?? null
        }
        const turns = [...s.turns, turn]
        turnsRef.current = turns
        return clearInflight({ ...s, turns })
      })
    })
    const offError = ledger.onRecallError((err) => {
      if (err.requestId !== reqId.current) return
      flush()
      reqId.current = null
      setState((s) => ({ ...s, status: 'error', error: { message: err.message, kind: err.kind } }))
    })
    return () => {
      offChunk()
      offSources()
      offDone()
      offError()
    }
  }, [flush, schedule])

  const ask = useCallback(
    (query: string, opts?: RecallAskOpts) => {
      const q = query.trim()
      if (!activeCampaignId || !q) return
      const requestId = crypto.randomUUID()
      reqId.current = requestId
      buffer.current = ''
      setState((s) => ({
        ...s,
        status: 'streaming',
        question: q,
        answer: '',
        sources: [],
        error: null
      }))
      ledger.recall
        .query({
          requestId,
          query: q,
          campaignId: activeCampaignId,
          pcId: activePcId,
          mode: opts?.mode ?? 'factual',
          asOfSession: opts?.asOfSession,
          speed: opts?.speed,
          // Follow-up loop: carry the last few turns as context (text only; bounded in the service too).
          history: turnsRef.current
            .slice(-3)
            .map((t) => ({ question: t.question, answer: t.answer }))
        })
        .catch((err) =>
          setState((s) => ({
            ...s,
            status: 'error',
            error: { message: String(err), kind: 'unknown' }
          }))
        )
    },
    [activeCampaignId, activePcId]
  )

  const cancel = useCallback(() => {
    if (reqId.current) ledger.recall.cancel(reqId.current)
    reqId.current = null
    setState((s) => (s.status === 'streaming' ? clearInflight(s) : s))
  }, [])

  // Clear the whole conversation back to idle (and stop any in-flight stream) — the Recall "Reset" button.
  const reset = useCallback(() => {
    if (reqId.current) ledger.recall.cancel(reqId.current)
    reqId.current = null
    buffer.current = ''
    turnsRef.current = []
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setState(IDLE)
  }, [])

  return { ...state, ask, cancel, reset }
}
