import { ipcMain } from 'electron'
import { IPC, type CreateNoteInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/note.service'

export function registerNoteHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.noteList, (_e, entityId: string) => svc.listNotes(ctx, entityId))
  ipcMain.handle(IPC.noteCreate, (_e, input: CreateNoteInput) => svc.createNote(ctx, input))
  ipcMain.handle(IPC.noteUpdate, (_e, id: string, patch: { content?: string }) =>
    svc.updateNote(ctx, id, patch)
  )
  ipcMain.handle(IPC.noteDelete, (_e, id: string) => svc.deleteNote(ctx, id))
}
