import { BrowserWindow, ipcMain } from 'electron'
import { IPC, type BugReportRequest } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import { gatherDiagnostics, submitBugReport } from '../services/bugreport.service'

/** Max width for the auto-snap that seeds the dialog — keeps the data URL crossing the bridge modest. */
const CAPTURE_MAX_WIDTH = 1400

// Bug reporting: gather-diagnostics + window snap + submit (write bundle → mail draft → reveal folder).
export function registerBugReportHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.bugreportDiagnostics, (_e, campaignId: string | null, view: string) =>
    gatherDiagnostics(ctx, campaignId, view)
  )

  // Snap the sender's window — called BEFORE the dialog opens, so the bug is still visible in the shot.
  ipcMain.handle(IPC.bugreportCapture, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return null
    try {
      const img = await win.webContents.capturePage()
      if (img.isEmpty()) return null
      const scaled =
        img.getSize().width > CAPTURE_MAX_WIDTH ? img.resize({ width: CAPTURE_MAX_WIDTH }) : img
      return `data:image/png;base64,${scaled.toPNG().toString('base64')}`
    } catch {
      return null // best-effort — the user can still attach screenshots by hand
    }
  })

  ipcMain.handle(IPC.bugreportSubmit, (_e, req: BugReportRequest) => submitBugReport(req))
}
