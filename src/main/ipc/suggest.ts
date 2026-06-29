import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { SuggestRequest } from '@shared/suggest-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { suggest } from '../services/suggest.service'

export function registerSuggestHandlers(ctx: DbContext, store: VectorStore): void {
  // Request/response (not streaming) — the handler awaits the structured result (ADR-008). A fresh
  // AbortController per call satisfies the service signature; there is no cancel channel yet.
  ipcMain.handle(IPC.suggestQuery, (_e, req: SuggestRequest) =>
    suggest(ctx, store, req, new AbortController().signal)
  )
}
