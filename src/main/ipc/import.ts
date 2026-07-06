import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { IPC } from '@shared/ipc-types'
import type { ConfirmedChangeset, ExtractRequest } from '@shared/import-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { applyChangeset, extract } from '../services/import.service'

export function registerImportHandlers(ctx: DbContext, store: VectorStore): void {
  // Two single-shot calls: extract (the expensive Claude pass) and apply (the DB transaction). A throwaway
  // controller — a long extraction isn't separately cancellable in v1 (acceptable).
  ipcMain.handle(IPC.importExtract, (_e, req: ExtractRequest) =>
    extract(ctx, req, new AbortController().signal)
  )
  // apply throws on a failed transaction (the renderer toasts it) — log the real cause first so a
  // schema/write failure leaves a trace in logs/main.log rather than only a generic toast.
  ipcMain.handle(IPC.importApply, async (_e, payload: ConfirmedChangeset) => {
    try {
      return await applyChangeset(ctx, store, payload)
    } catch (err) {
      log.error('import.apply failed', err)
      throw err
    }
  })
}
