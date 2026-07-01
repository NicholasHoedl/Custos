import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecapReason } from '@shared/recap-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'

export type RecapStatus = 'idle' | 'streaming' | 'done' | 'error'

interface RecapState {
  status: RecapStatus
  recap: string
  reason: RecapReason | null
  error: { message: string; kind: string } | null
}

const IDLE: RecapState = { status: 'idle', recap: '', reason: null, error: null }

/** Streamed session recap — mirrors use-recall's token-buffer pattern (50ms flush, requestId match). */
export function useRecap(): RecapState & {
  generate: (sessionId: string) => void
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<RecapState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
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
      setState((s) => ({ ...s, recap: s.recap + text }))
    }
  }, [])

  const schedule = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(flush, 50) // ~20fps; smooth without a render per token
  }, [flush])

  useEffect(() => {
    const offChunk = ledger.onRecapChunk((chunk) => {
      if (chunk.requestId !== reqId.current) return
      buffer.current += chunk.text
      schedule()
    })
    const offDone = ledger.onRecapDone((done) => {
      if (done.requestId !== reqId.current) return
      flush()
      setState((s) => ({ ...s, status: 'done', reason: done.reason }))
    })
    const offError = ledger.onRecapError((err) => {
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

  const generate = useCallback(
    (sessionId: string) => {
      if (!activeCampaignId || !sessionId) return
      const requestId = crypto.randomUUID()
      reqId.current = requestId
      buffer.current = ''
      setState({ status: 'streaming', recap: '', reason: null, error: null })
      ledger.recap
        .generate({ requestId, campaignId: activeCampaignId, sessionId })
        .catch((err) =>
          setState((s) => ({
            ...s,
            status: 'error',
            error: { message: String(err), kind: 'unknown' }
          }))
        )
    },
    [activeCampaignId]
  )

  const cancel = useCallback(() => {
    if (reqId.current) ledger.recap.cancel(reqId.current)
    reqId.current = null
    setState((s) => (s.status === 'streaming' ? { ...s, status: 'idle' } : s))
  }, [])

  const reset = useCallback(() => {
    if (reqId.current) ledger.recap.cancel(reqId.current)
    reqId.current = null
    buffer.current = ''
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setState(IDLE)
  }, [])

  return { ...state, generate, cancel, reset }
}
