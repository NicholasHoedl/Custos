import { ipcMain } from 'electron'
import type { EntityType } from '@shared/entity-types'
import { IPC, type CreateEntityInput, type UpdateEntityInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/entity.service'

export function registerEntityHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.entityList, (_e, campaignId: string, type?: EntityType) =>
    svc.listEntities(ctx, campaignId, type)
  )
  ipcMain.handle(IPC.entityGet, (_e, id: string) => svc.getEntity(ctx, id))
  ipcMain.handle(IPC.entityCreate, (_e, input: CreateEntityInput) => svc.createEntity(ctx, input))
  ipcMain.handle(IPC.entityUpdate, (_e, id: string, patch: UpdateEntityInput) =>
    svc.updateEntity(ctx, id, patch)
  )
  ipcMain.handle(IPC.entityDelete, (_e, id: string) => svc.deleteEntity(ctx, id))
}
