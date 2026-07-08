import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { EnrichEntityRequest } from '@shared/enrich-types'
import type { DbContext } from '../services/db-context'
import { enrichEntity, listTouchedEntities } from '../services/enrich.service'

export function registerEnrichHandlers(ctx: DbContext): void {
  // The pre-flight checklist: which entities a session's notes touched (sync DB read).
  ipcMain.handle(IPC.enrichTouched, (_e, sessionId: string) => listTouchedEntities(ctx, sessionId))
  // One focused model call per entity — the renderer sequences these and merges the proposals. A
  // throwaway controller, mirroring import.extract: an in-flight call isn't separately cancellable
  // (the renderer cancels BETWEEN entities). Failures return a discriminated result, never throw.
  ipcMain.handle(IPC.enrichEntity, (_e, req: EnrichEntityRequest) =>
    enrichEntity(ctx, req, new AbortController().signal)
  )
}
