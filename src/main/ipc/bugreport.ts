import { ipcMain } from 'electron'
import { IPC, type BugReportRequest } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import { gatherDiagnostics, submitBugReport } from '../services/bugreport.service'

// Bug reporting: gather-diagnostics + submit (auto-send or bundle → mail draft → reveal folder). The old
// `bugreport:capture` window snap was removed with the launcher's move into Settings (ADR-060) — from
// there it only ever captured the Settings page; screenshots are attached by hand in the dialog.
export function registerBugReportHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.bugreportDiagnostics, (_e, campaignId: string | null, view: string) =>
    gatherDiagnostics(ctx, campaignId, view)
  )

  ipcMain.handle(IPC.bugreportSubmit, (_e, req: BugReportRequest) => submitBugReport(req))
}
