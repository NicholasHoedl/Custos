import { ipcMain } from 'electron'
import { IPC, type CreateCampaignInput, type UpdateCampaignInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/campaign.service'

export function registerCampaignHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.campaignList, () => svc.listCampaigns(ctx))
  ipcMain.handle(IPC.campaignGet, (_e, id: string) => svc.getCampaign(ctx, id))
  ipcMain.handle(IPC.campaignCreate, (_e, input: CreateCampaignInput) => svc.createCampaign(ctx, input))
  ipcMain.handle(IPC.campaignUpdate, (_e, id: string, patch: UpdateCampaignInput) =>
    svc.updateCampaign(ctx, id, patch)
  )
  ipcMain.handle(IPC.campaignDelete, (_e, id: string) => svc.deleteCampaign(ctx, id))
}
