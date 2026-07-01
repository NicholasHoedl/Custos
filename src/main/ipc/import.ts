import { ipcMain } from 'electron'
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
  ipcMain.handle(IPC.importApply, (_e, payload: ConfirmedChangeset) =>
    applyChangeset(ctx, store, payload)
  )
}
