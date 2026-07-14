import { IPC } from '@shared/ipc-types'
import type { ConverseRequest } from '@shared/converse-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { converse } from '../services/converse.service'
import { registerCancelable } from './cancelable'

// Converse (in-character questions): single-shot request/response like Suggest — no streaming. Grounding is
// direct-fetch of the target + the asking PC; the store is passed for an OPTIONAL focus-scoped retrieval that
// stays model-graceful (dense only when the model is ready, fuzzy always). converse:cancel aborts the
// in-flight call by requestId (P1-5).
export function registerConverseHandlers(ctx: DbContext, store: VectorStore): void {
  registerCancelable<ConverseRequest>(IPC.converseQuery, IPC.converseCancel, (req, signal) =>
    converse(ctx, store, req, signal)
  )
}
