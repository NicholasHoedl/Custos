import { ipcMain } from 'electron'
import { IPC, type CreateLinkInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/link.service'

export function registerLinkHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.linkCreate, (_e, input: CreateLinkInput) => svc.createLink(ctx, input))
  ipcMain.handle(IPC.linkDelete, (_e, id: string) => svc.deleteLink(ctx, id))
  ipcMain.handle(IPC.linkListForEntity, (_e, entityId: string) => svc.listForEntity(ctx, entityId))
}
