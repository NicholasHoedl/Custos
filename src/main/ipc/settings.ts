import { ipcMain } from 'electron'
import type { AppSettings } from '@shared/entity-types'
import { IPC } from '@shared/ipc-types'
import * as settingsSvc from '../services/settings.service'
import * as keySvc from '../services/key.service'
import { validateKey } from '../services/claude.service'

// Settings + API key. The key is encrypted via safeStorage and never returned to the renderer;
// `validate` performs a network auth check and returns only `{ valid }`.
export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => settingsSvc.getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    settingsSvc.setSettings(patch)
  })
  ipcMain.handle(IPC.apikeySet, (_e, key: string) => keySvc.setKey(key))
  ipcMain.handle(IPC.apikeyExists, () => keySvc.keyExists())
  ipcMain.handle(IPC.apikeyValidate, () => validateKey())
  ipcMain.handle(IPC.apikeyClear, () => keySvc.clearKey())
}
