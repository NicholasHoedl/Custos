import { ipcMain } from 'electron'
import { IPC, type BugReportRequest, type FeatureRequestRequest } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import {
  gatherDiagnostics,
  submitBugReport,
  submitFeatureRequest
} from '../services/bugreport.service'

// Feedback (ADR-057/058/064): gather-diagnostics + submit a bug report OR a feature request (each
// auto-sends via the worker, or falls back to a bundle → mail draft → reveal folder). The old
// `bugreport:capture` window snap was removed with the launcher's move into Settings (ADR-060) — from
// there it only ever captured the Settings page; screenshots are attached by hand in the dialog.
export function registerBugReportHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.bugreportDiagnostics, (_e, campaignId: string | null, view: string) =>
    gatherDiagnostics(ctx, campaignId, view)
  )

  ipcMain.handle(IPC.bugreportSubmit, (_e, req: BugReportRequest) => submitBugReport(req))

  ipcMain.handle(IPC.featureRequestSubmit, (_e, req: FeatureRequestRequest) =>
    submitFeatureRequest(req)
  )
}
