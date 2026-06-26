import { ipcMain } from 'electron'
import { IPC, type CreateSessionInput, type UpdateSessionInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/session.service'

export function registerSessionHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.sessionList, (_e, campaignId: string) => svc.listSessions(ctx, campaignId))
  ipcMain.handle(IPC.sessionGet, (_e, id: string) => svc.getSession(ctx, id))
  ipcMain.handle(IPC.sessionCreate, (_e, input: CreateSessionInput) => svc.createSession(ctx, input))
  ipcMain.handle(IPC.sessionUpdate, (_e, id: string, patch: UpdateSessionInput) =>
    svc.updateSession(ctx, id, patch)
  )
  ipcMain.handle(IPC.sessionDelete, (_e, id: string) => svc.deleteSession(ctx, id))
}
