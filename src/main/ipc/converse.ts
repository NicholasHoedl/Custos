import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { ConverseRequest } from '@shared/converse-types'
import type { DbContext } from '../services/db-context'
import { converse } from '../services/converse.service'

// Converse (in-character questions): single-shot request/response like Suggest — no streaming, and no
// vector store (grounding is direct-fetch of the target + the asking PC).
export function registerConverseHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.converseQuery, (_e, req: ConverseRequest) =>
    converse(ctx, req, new AbortController().signal)
  )
}
