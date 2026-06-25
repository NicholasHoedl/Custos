import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { AppSettings } from '@shared/entity-types'
import { DEFAULT_HOTKEY } from '@shared/constants'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 'md',
  recallModel: 'claude-sonnet-4-6',
  hotkey: DEFAULT_HOTKEY
}

const notImplemented =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`[ledger] IPC "${name}" is not implemented until Phase 1`)
  }

/**
 * Phase 0 placeholder IPC handlers: reads return empty/null, settings return defaults,
 * mutations throw until the service layer lands in Phase 1. Phase 1 will split these into
 * per-domain, service-backed handlers (see ARCHITECTURE §8). The AI channels (recall/suggest/
 * stream) declared in ipc-types are intentionally NOT wired here — they arrive in Phase 2.
 */
export function registerIpcHandlers(): void {
  // campaign
  ipcMain.handle(IPC.campaignList, async () => [])
  ipcMain.handle(IPC.campaignGet, async () => null)
  ipcMain.handle(IPC.campaignCreate, notImplemented('campaign:create'))

  // session
  ipcMain.handle(IPC.sessionList, async () => [])
  ipcMain.handle(IPC.sessionCreate, notImplemented('session:create'))

  // entity
  ipcMain.handle(IPC.entityList, async () => [])
  ipcMain.handle(IPC.entityGet, async () => null)
  ipcMain.handle(IPC.entityCreate, notImplemented('entity:create'))
  ipcMain.handle(IPC.entityUpdate, notImplemented('entity:update'))

  // note
  ipcMain.handle(IPC.noteList, async () => [])
  ipcMain.handle(IPC.noteCreate, notImplemented('note:create'))
  ipcMain.handle(IPC.noteUpdate, notImplemented('note:update'))

  // event
  ipcMain.handle(IPC.eventCreate, notImplemented('event:create'))

  // search
  ipcMain.handle(IPC.searchText, async () => [])

  // settings
  ipcMain.handle(IPC.settingsGet, async () => DEFAULT_SETTINGS)
  ipcMain.handle(IPC.settingsSet, async () => undefined)

  // api key (real secure storage arrives in Phase 2, P2-01)
  ipcMain.handle(IPC.apikeySet, async () => undefined)
  ipcMain.handle(IPC.apikeyValidate, async () => ({ valid: false }))
}
