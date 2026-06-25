import { ipcMain } from 'electron'
import { IPC, type CreateEventInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/event.service'

export function registerEventHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.eventList, (_e, sessionId: string) => svc.listEvents(ctx, sessionId))
  ipcMain.handle(IPC.eventCreate, (_e, input: CreateEventInput) => svc.createEvent(ctx, input))
}
