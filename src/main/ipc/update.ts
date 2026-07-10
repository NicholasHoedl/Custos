import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { Send } from './handlers'
import { checkForUpdates, initAutoUpdater, quitAndInstall } from '../services/updater.service'

// Auto-update IPC (P2-1, ADR-042). Wires the updater once (launch check + status events → `send`) and
// exposes the manual check / install actions to the Settings UI. `send` is the shared main→renderer
// closure from registerIpcHandlers, so update status rides the same channel plumbing as everything else.
export function registerUpdateHandlers(send: Send): void {
  initAutoUpdater(send)
  ipcMain.handle(IPC.updateCheck, () => checkForUpdates(send))
  ipcMain.handle(IPC.updateInstall, () => quitAndInstall())
}
