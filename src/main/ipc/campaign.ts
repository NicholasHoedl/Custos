import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import { IPC, type CreateCampaignInput, type UpdateCampaignInput } from '@shared/ipc-types'
import type { CampaignExportResult, CampaignImportResult } from '@shared/export-types'
import type { DbContext } from '../services/db-context'
import * as svc from '../services/campaign.service'
import { buildCampaignExport } from '../services/export.service'
import { importCampaign } from '../services/import-campaign.service'

export function registerCampaignHandlers(ctx: DbContext, reindex: () => Promise<number>): void {
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

  // Import (P0-2): open dialog + file read + one-transaction restore. Errors are returned (not
  // thrown) with user-readable messages from the service; embeddings rebuild in the background
  // (the export omits them by design).
  ipcMain.handle(IPC.campaignImport, async (): Promise<CampaignImportResult> => {
    try {
      const opts = {
        title: 'Import campaign',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile' as const]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }

      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(res.filePaths[0], 'utf8'))
      } catch {
        return { ok: false, error: 'That file is not valid JSON.' }
      }
      const out = importCampaign(ctx, parsed)
      void reindex() // embeddings are omitted from exports — rebuild them in the background
      log.info(`imported campaign ${out.campaignId} ← ${res.filePaths[0]}`)
      return { ok: true, ...out }
    } catch (err) {
      log.error('campaign import failed', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
