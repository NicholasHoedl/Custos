import { IPC } from '@shared/ipc-types'
import type { ConverseRequest } from '@shared/converse-types'
import type { DbContext } from '../services/db-context'
import { converse } from '../services/converse.service'
import { registerCancelable } from './cancelable'

// Converse (in-character questions): single-shot request/response like Suggest — no streaming, and no
// vector store (grounding is direct-fetch of the target + the asking PC). converse:cancel aborts the
// in-flight call by requestId (P1-5).
export function registerConverseHandlers(ctx: DbContext): void {
  registerCancelable<ConverseRequest>(IPC.converseQuery, IPC.converseCancel, (req, signal) =>
    converse(ctx, req, signal)
  )
}
