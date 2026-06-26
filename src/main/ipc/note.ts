import { ipcMain } from 'electron'
import { IPC, type CreateNoteInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { indexNote } from '../services/embedding-index.service'
import * as svc from '../services/note.service'

export function registerNoteHandlers(ctx: DbContext, store: VectorStore): void {
  ipcMain.handle(IPC.noteList, (_e, entityId: string) => svc.listNotes(ctx, entityId))
  ipcMain.handle(IPC.noteCreate, (_e, input: CreateNoteInput) => {
    const note = svc.createNote(ctx, input)
    indexNote(ctx, store, note.id) // fire-and-forget; keeps capture off the embedding path
    return note
  })
  ipcMain.handle(IPC.noteUpdate, (_e, id: string, patch: { content?: string }) => {
    const note = svc.updateNote(ctx, id, patch)
    indexNote(ctx, store, note.id)
    return note
  })
  ipcMain.handle(IPC.noteDelete, (_e, id: string) => svc.deleteNote(ctx, id))
}
