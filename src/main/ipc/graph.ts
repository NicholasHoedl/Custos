import { ipcMain } from 'electron'
import { IPC, type HierarchyKind } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/link.service'

export function registerGraphHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.graphContext, (_e, entityId: string, depth?: number) =>
    svc.getEntityContext(ctx, entityId, depth ?? 1)
  )
  ipcMain.handle(IPC.graphHierarchy, (_e, entityId: string, kind: HierarchyKind) =>
    svc.getHierarchy(ctx, entityId, kind)
  )
  ipcMain.handle(IPC.graphCampaign, (_e, campaignId: string, asOf?: number) =>
    svc.buildCampaignGraph(ctx, campaignId, asOf)
  )
}
