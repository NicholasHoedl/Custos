import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { IPC } from '@shared/ipc-types'
import type { ConfirmedChangeset, ExtractRequest } from '@shared/import-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { applyChangeset, extract } from '../services/import.service'
import { registerCancelable } from './cancelable'

export function registerImportHandlers(ctx: DbContext, store: VectorStore): void {
  // Extract (the expensive Claude pass) is cancellable by requestId — import:extract-cancel aborts it
  // (P1-5, Transcribe's Stop). Apply (the DB transaction below) is not cancellable.
  registerCancelable<ExtractRequest>(IPC.importExtract, IPC.importExtractCancel, (req, signal) =>
    extract(ctx, req, signal)
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
