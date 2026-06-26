import { contextBridge, ipcRenderer } from 'electron'
import { IPC, QUICK_ADD_FOCUS_CHANNEL, type LedgerApi } from '@shared/ipc-types'

// The single typed surface exposed to the renderer. No Node, no secrets cross this bridge.
const api: LedgerApi = {
  campaign: {
    list: () => ipcRenderer.invoke(IPC.campaignList),
    get: (id) => ipcRenderer.invoke(IPC.campaignGet, id),
    create: (input) => ipcRenderer.invoke(IPC.campaignCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.campaignUpdate, id, patch)
  },
  session: {
    list: (campaignId) => ipcRenderer.invoke(IPC.sessionList, campaignId),
    get: (id) => ipcRenderer.invoke(IPC.sessionGet, id),
    create: (input) => ipcRenderer.invoke(IPC.sessionCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.sessionUpdate, id, patch)
  },
  entity: {
    list: (campaignId, type) => ipcRenderer.invoke(IPC.entityList, campaignId, type),
    get: (id) => ipcRenderer.invoke(IPC.entityGet, id),
    create: (input) => ipcRenderer.invoke(IPC.entityCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.entityUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.entityDelete, id)
  },
  note: {
    list: (entityId) => ipcRenderer.invoke(IPC.noteList, entityId),
    create: (input) => ipcRenderer.invoke(IPC.noteCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.noteUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.noteDelete, id)
  },
  event: {
    list: (sessionId) => ipcRenderer.invoke(IPC.eventList, sessionId),
    create: (input) => ipcRenderer.invoke(IPC.eventCreate, input)
  },
  link: {
    create: (input) => ipcRenderer.invoke(IPC.linkCreate, input),
    delete: (id) => ipcRenderer.invoke(IPC.linkDelete, id),
    listForEntity: (entityId) => ipcRenderer.invoke(IPC.linkListForEntity, entityId)
  },
  graph: {
    context: (entityId, depth) => ipcRenderer.invoke(IPC.graphContext, entityId, depth),
    hierarchy: (entityId, kind) => ipcRenderer.invoke(IPC.graphHierarchy, entityId, kind)
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
  },
  onQuickAddFocus: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(QUICK_ADD_FOCUS_CHANNEL, listener)
    return () => ipcRenderer.removeListener(QUICK_ADD_FOCUS_CHANNEL, listener)
  }
}

contextBridge.exposeInMainWorld('ledger', api)
