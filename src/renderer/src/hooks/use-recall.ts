import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecallMode, RecallReason, RecallSource } from '@shared/recall-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type RecallStatus = 'idle' | 'streaming' | 'done' | 'error'

interface RecallState {
  status: RecallStatus
  answer: string
  sources: RecallSource[]
  reason: RecallReason | null
  error: { message: string; kind: string } | null
}

const IDLE: RecallState = { status: 'idle', answer: '', sources: [], reason: null, error: null }

export function useRecall(): RecallState & {
  ask: (query: string, mode: RecallMode) => void
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<RecallState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const reqId = useRef<string | null>(null)
  const buffer = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    const offDone = ledger.onRecallDone((done) => {
      if (done.requestId !== reqId.current) return
      flush()
      setState((s) => ({ ...s, status: 'done', sources: done.sources, reason: done.reason }))
    })
    const offError = ledger.onRecallError((err) => {
      if (err.requestId !== reqId.current) return
      flush()
      setState((s) => ({ ...s, status: 'error', error: { message: err.message, kind: err.kind } }))
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [flush, schedule])

  const ask = useCallback(
    (query: string, mode: RecallMode) => {
      if (!activeCampaignId || !query.trim()) return
      const requestId = crypto.randomUUID()
      reqId.current = requestId
      buffer.current = ''
      setState({ status: 'streaming', answer: '', sources: [], reason: null, error: null })
      ledger.recall
        .query({ requestId, query: query.trim(), campaignId: activeCampaignId, pcId: activePcId, mode })
        .catch((err) =>
          setState((s) => ({ ...s, status: 'error', error: { message: String(err), kind: 'unknown' } }))
        )
    },
    [activeCampaignId, activePcId]
  )

  const cancel = useCallback(() => {
    if (reqId.current) ledger.recall.cancel(reqId.current)
    reqId.current = null
    setState((s) => (s.status === 'streaming' ? { ...s, status: 'idle' } : s))
  }, [])

  // Clear everything back to idle (and stop any in-flight stream) — backs the Recall "Reset" button.
  const reset = useCallback(() => {
    if (reqId.current) ledger.recall.cancel(reqId.current)
    reqId.current = null
    buffer.current = ''
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setState(IDLE)
  }, [])

  return { ...state, ask, cancel, reset }
}
