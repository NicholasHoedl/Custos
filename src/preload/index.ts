import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type LedgerApi } from '@shared/ipc-types'

// The single typed surface exposed to the renderer. No Node, no secrets cross this bridge.
const api: LedgerApi = {
  campaign: {
    list: () => ipcRenderer.invoke(IPC.campaignList),
    get: (id) => ipcRenderer.invoke(IPC.campaignGet, id),
    create: (input) => ipcRenderer.invoke(IPC.campaignCreate, input)
  },
  session: {
    list: (campaignId) => ipcRenderer.invoke(IPC.sessionList, campaignId),
    create: (input) => ipcRenderer.invoke(IPC.sessionCreate, input)
  },
  entity: {
    list: (campaignId) => ipcRenderer.invoke(IPC.entityList, campaignId),
    get: (id) => ipcRenderer.invoke(IPC.entityGet, id),
    create: (input) => ipcRenderer.invoke(IPC.entityCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.entityUpdate, id, patch)
  },
  note: {
    list: (entityId) => ipcRenderer.invoke(IPC.noteList, entityId),
    create: (input) => ipcRenderer.invoke(IPC.noteCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.noteUpdate, id, patch)
  },
  event: {
    create: (input) => ipcRenderer.invoke(IPC.eventCreate, input)
  },
  search: {
    text: (query, campaignId) => ipcRenderer.invoke(IPC.searchText, query, campaignId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  apikey: {
    set: (key) => ipcRenderer.invoke(IPC.apikeySet, key),
    validate: () => ipcRenderer.invoke(IPC.apikeyValidate)
  }
}

contextBridge.exposeInMainWorld('ledger', api)
