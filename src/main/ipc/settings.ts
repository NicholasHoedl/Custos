import { ipcMain } from 'electron'
import type { AppSettings } from '@shared/entity-types'
import { IPC } from '@shared/ipc-types'
import { DEFAULT_HOTKEY } from '@shared/constants'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 'md',
  recallModel: 'claude-sonnet-4-6',
  hotkey: DEFAULT_HOTKEY
}

// Settings + API key get real, secure-storage backing in Phase 2 (P2-01). Placeholders for now.
export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => DEFAULT_SETTINGS)
  ipcMain.handle(IPC.settingsSet, () => undefined)
  ipcMain.handle(IPC.apikeySet, () => undefined)
  ipcMain.handle(IPC.apikeyValidate, () => ({ valid: false }))
}
