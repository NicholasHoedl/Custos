import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/search.service'

export function registerSearchHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.searchText, (_e, query: string, campaignId: string) =>
    svc.searchText(ctx, query, campaignId)
  )
}
