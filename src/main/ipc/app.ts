import { app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import log from 'electron-log/main'
import {
  IPC,
  RENDERER_ERROR_CHANNEL,
  type AppInfo,
  type BackupNowResult,
  type RendererErrorReport
} from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import { backupDatabase } from '../db/backup'
import { usageSummary } from '../services/usage.service'

// App-shell IPC (ROADMAP P0-2/P0-3): version/About info, data-folder affordances, on-demand backup,
// and the renderer-error sink. Previously "Open data folder" existed only in the startup crash dialog
// and renderer crashes logged to a devtools console that doesn't exist when packaged.

const rendererLog = log.scope('renderer')

/** Flood guard: a render-loop crash could emit thousands of identical reports per second. */
const MAX_RENDERER_REPORTS = 200

export function registerAppHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return { version: app.getVersion(), dataDir: app.getPath('userData') }
  })

  ipcMain.handle(IPC.appOpenDataFolder, async () => {
    await shell.openPath(app.getPath('userData'))
  })

  ipcMain.handle(IPC.appOpenLogsFolder, async () => {
    await shell.openPath(join(app.getPath('userData'), 'logs'))
  })

  // On-demand snapshot — identical mechanism to the launch backup (VACUUM INTO through the live
  // connection, WAL-safe at any time; db/backup.ts). Same folder, same 5-newest rotation.
  ipcMain.handle(IPC.appBackupNow, (): BackupNowResult => {
    const dest = backupDatabase(ctx.raw, join(app.getPath('userData'), 'backups'), 5, (m, e) =>
      log.warn(m, e)
    )
    return dest ? { ok: true, path: dest } : { ok: false, error: 'Backup failed — see main.log.' }
  })

  ipcMain.handle(IPC.usageSummary, () => usageSummary())

  // One-way renderer-error sink (fire-and-forget `send`, not invoke — a crashing renderer should
  // never await its own crash report).
  let reported = 0
  ipcMain.on(RENDERER_ERROR_CHANNEL, (_e, report: RendererErrorReport) => {
    if (reported++ >= MAX_RENDERER_REPORTS) return
    rendererLog.error(`[${report.source}] ${report.message}`, report.stack ?? '(no stack)')
  })
}
