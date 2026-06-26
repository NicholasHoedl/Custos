import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import { generatePersona, getPersona, updatePersona } from '../services/persona.service'

export function registerPersonaHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.personaGet, (_e, entityId: string) => getPersona(ctx, entityId))
  ipcMain.handle(IPC.personaGenerate, (_e, entityId: string) => generatePersona(ctx, entityId))
  ipcMain.handle(IPC.personaUpdate, (_e, entityId: string, brief: string) =>
    updatePersona(ctx, entityId, brief)
  )
}
