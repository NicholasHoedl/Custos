import { IPC } from '@shared/ipc-types'
import type { ContinuityRequest } from '@shared/continuity-types'
import type { DbContext } from '../services/db-context'
import { runContinuity } from '../services/continuity.service'
import { registerCancelable } from './cancelable'

// Continuity (read-only campaign audit, ADR-056): single-shot request/response. The deterministic checks
// always run; the AI pass is additive and reports its own status. continuity:cancel aborts the in-flight
// AI call by requestId.
export function registerContinuityHandlers(ctx: DbContext): void {
  registerCancelable<ContinuityRequest>(IPC.continuityQuery, IPC.continuityCancel, (req, signal) =>
    runContinuity(ctx, req, signal)
  )
}
