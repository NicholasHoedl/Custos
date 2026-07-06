import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import { IPC, type CreateCampaignInput, type UpdateCampaignInput } from '@shared/ipc-types'
import type { CampaignExportResult } from '@shared/export-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/campaign.service'
import { buildCampaignExport } from '../services/export.service'

export function registerCampaignHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.campaignList, () => svc.listCampaigns(ctx))
  ipcMain.handle(IPC.campaignGet, (_e, id: string) => svc.getCampaign(ctx, id))
  ipcMain.handle(IPC.campaignCreate, (_e, input: CreateCampaignInput) => svc.createCampaign(ctx, input))
  ipcMain.handle(IPC.campaignUpdate, (_e, id: string, patch: UpdateCampaignInput) =>
    svc.updateCampaign(ctx, id, patch)
  )
  ipcMain.handle(IPC.campaignDelete, (_e, id: string) => svc.deleteCampaign(ctx, id))

  // Export: assemble the JSON snapshot, then a save dialog + file write. Errors are returned (not
  // thrown) so the renderer shows a toast instead of an unhandled rejection.
  ipcMain.handle(IPC.campaignExport, async (_e, campaignId: string): Promise<CampaignExportResult> => {
    try {
      const data = buildCampaignExport(ctx, campaignId)
      const safe = data.campaign.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'campaign'
      const stamp = new Date(data.exportedAt).toISOString().slice(0, 10) // YYYY-MM-DD
      const opts = {
        title: 'Export campaign',
        defaultPath: `${safe}-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8')
      log.info(`exported campaign ${campaignId} → ${res.filePath}`)
      return {
        ok: true,
        path: res.filePath,
        counts: {
          entities: data.entities.length,
          notes: data.notes.length,
          links: data.entityLinks.length
        }
      }
    } catch (err) {
      log.error('campaign export failed', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
