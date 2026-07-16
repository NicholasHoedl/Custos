import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ContinuityFinding,
  ContinuityFixAction,
  ContinuityResult
} from '@shared/continuity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'

export type ContinuityStatus = 'idle' | 'thinking' | 'done' | 'error'

interface ContinuityState {
  status: ContinuityStatus
  result: ContinuityResult | null
  error: string | null
}

const IDLE: ContinuityState = { status: 'idle', result: null, error: null }

/**
 * Drives the single-shot Continuity audit (ADR-056): the deterministic checks always return; the AI pass
 * is additive and reports its own status inside the result. Reads the active campaign from the app store;
 * `cancel` aborts the in-flight AI call (the bumped token makes the aborted promise read as "stopped").
 */
export function useContinuity(): ContinuityState & {
  run: (opts?: { speed?: 'quick' | 'deep' }) => void
  applyFix: (action: ContinuityFixAction, finding: ContinuityFinding) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<ContinuityState>(IDLE)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const reqRef = useRef(0)
  const requestIdRef = useRef<string | null>(null)

  const run = useCallback(
    (opts?: { speed?: 'quick' | 'deep' }) => {
      if (!activeCampaignId) return
      const token = ++reqRef.current
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      setState({ status: 'thinking', result: null, error: null })
      ledger.continuity
        .query({ requestId, campaignId: activeCampaignId, speed: opts?.speed })
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

  const cancel = useCallback(() => {
    reqRef.current++
    if (requestIdRef.current) ledger.continuity.cancel(requestIdRef.current)
    requestIdRef.current = null
    setState(IDLE)
  }, [])

  const reset = useCallback(() => cancel(), [cancel])

  // Apply a deterministic finding's one-click fix via the existing entity/link IPC. Prune the finding
  // OPTIMISTICALLY (before the await) so its card — and any sibling Fix button (a faction conflict shows two:
  // sever ally / sever enemy) — can't be re-clicked mid-flight and sever the wrong tie; restore it if the
  // write fails. No re-run, so the AI pass isn't re-fired/re-billed.
  const applyFix = useCallback(async (action: ContinuityFixAction, finding: ContinuityFinding) => {
    setState((s) =>
      s.result
        ? { ...s, result: { ...s.result, findings: s.result.findings.filter((f) => f !== finding) } }
        : s
    )
    try {
      if (action.kind === 'set-lifecycle') {
        await ledger.entity.update(action.entityId, { lifecycle: action.lifecycle })
      } else {
        await ledger.link.sever(action.linkId)
      }
    } catch (err) {
      setState((s) =>
        s.result && !s.result.findings.includes(finding)
          ? { ...s, result: { ...s.result, findings: [...s.result.findings, finding] } }
          : s
      )
      toast.error('Could not apply the fix', { description: String(err) })
      return
    }
    useUiStore.getState().bumpEntities()
    toast.success('Fixed')
  }, [])

  return { ...state, run, applyFix, cancel, reset }
}
