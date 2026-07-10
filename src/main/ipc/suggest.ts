import { IPC } from '@shared/ipc-types'
import type { SuggestRequest } from '@shared/suggest-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { suggest } from '../services/suggest.service'
import { registerCancelable } from './cancelable'

export function registerSuggestHandlers(ctx: DbContext, store: VectorStore): void {
  // Request/response (not streaming) — the handler awaits the structured result (ADR-008); suggest:cancel
  // aborts the in-flight Claude call by requestId (P1-5).
  registerCancelable<SuggestRequest>(IPC.suggestQuery, IPC.suggestCancel, (req, signal) =>
    suggest(ctx, store, req, signal)
  )
}
