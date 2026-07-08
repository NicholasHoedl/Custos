import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  MODEL_DOWNLOAD_PROGRESS_CHANNEL,
  QUICK_ADD_FOCUS_CHANNEL,
  RECALL_CHUNK_CHANNEL,
  RECALL_DONE_CHANNEL,
  RECALL_ERROR_CHANNEL,
  RECAP_CHUNK_CHANNEL,
  RECAP_DONE_CHANNEL,
  RECAP_ERROR_CHANNEL,
  type LedgerApi
} from '@shared/ipc-types'

// Subscribe to a one-way main->renderer channel; returns an unsubscribe fn. The IpcRendererEvent is
// dropped so renderer callbacks only ever see the typed payload (no sender/ports leak).
function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: unknown, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The single typed surface exposed to the renderer. No Node, no secrets cross this bridge.
const api: LedgerApi = {
  campaign: {
    list: () => ipcRenderer.invoke(IPC.campaignList),
    get: (id) => ipcRenderer.invoke(IPC.campaignGet, id),
    create: (input) => ipcRenderer.invoke(IPC.campaignCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.campaignUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.campaignDelete, id),
    export: (campaignId) => ipcRenderer.invoke(IPC.campaignExport, campaignId)
  },
  session: {
    list: (campaignId) => ipcRenderer.invoke(IPC.sessionList, campaignId),
    get: (id) => ipcRenderer.invoke(IPC.sessionGet, id),
    create: (input) => ipcRenderer.invoke(IPC.sessionCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.sessionUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.sessionDelete, id)
  },
  entity: {
    list: (campaignId, type) => ipcRenderer.invoke(IPC.entityList, campaignId, type),
    get: (id) => ipcRenderer.invoke(IPC.entityGet, id),
    create: (input) => ipcRenderer.invoke(IPC.entityCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.entityUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.entityDelete, id),
    history: (entityId) => ipcRenderer.invoke(IPC.entityHistory, entityId)
  },
  note: {
    list: (entityId) => ipcRenderer.invoke(IPC.noteList, entityId),
    listAll: (campaignId) => ipcRenderer.invoke(IPC.noteListAll, campaignId),
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
    sever: (id, sessionId) => ipcRenderer.invoke(IPC.linkSever, id, sessionId),
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
    exists: () => ipcRenderer.invoke(IPC.apikeyExists),
    validate: () => ipcRenderer.invoke(IPC.apikeyValidate),
    clear: () => ipcRenderer.invoke(IPC.apikeyClear)
  },
  recall: {
    query: (input) => ipcRenderer.invoke(IPC.recallQuery, input),
    cancel: (requestId) => ipcRenderer.invoke(IPC.recallCancel, requestId)
  },
  recap: {
    generate: (input) => ipcRenderer.invoke(IPC.recapGenerate, input),
    cancel: (requestId) => ipcRenderer.invoke(IPC.recapCancel, requestId)
  },
  suggest: {
    query: (input) => ipcRenderer.invoke(IPC.suggestQuery, input)
  },
  converse: {
    query: (input) => ipcRenderer.invoke(IPC.converseQuery, input)
  },
  deriveProfile: {
    query: (input) => ipcRenderer.invoke(IPC.deriveProfileQuery, input)
  },
  import: {
    extract: (input) => ipcRenderer.invoke(IPC.importExtract, input),
    apply: (payload) => ipcRenderer.invoke(IPC.importApply, payload)
  },
  persona: {
    get: (entityId) => ipcRenderer.invoke(IPC.personaGet, entityId),
    generate: (entityId) => ipcRenderer.invoke(IPC.personaGenerate, entityId),
    update: (entityId, brief) => ipcRenderer.invoke(IPC.personaUpdate, entityId, brief)
  },
  onboarding: {
    status: () => ipcRenderer.invoke(IPC.onboardingStatus),
    downloadModel: () => ipcRenderer.invoke(IPC.modelDownload),
    reindex: () => ipcRenderer.invoke(IPC.onboardingReindex)
  },
  onQuickAddFocus: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(QUICK_ADD_FOCUS_CHANNEL, listener)
    return () => ipcRenderer.removeListener(QUICK_ADD_FOCUS_CHANNEL, listener)
  },
  onRecallChunk: (callback) => subscribe(RECALL_CHUNK_CHANNEL, callback),
  onRecallDone: (callback) => subscribe(RECALL_DONE_CHANNEL, callback),
  onRecallError: (callback) => subscribe(RECALL_ERROR_CHANNEL, callback),
  onRecapChunk: (callback) => subscribe(RECAP_CHUNK_CHANNEL, callback),
  onRecapDone: (callback) => subscribe(RECAP_DONE_CHANNEL, callback),
  onRecapError: (callback) => subscribe(RECAP_ERROR_CHANNEL, callback),
  onModelDownloadProgress: (callback) => subscribe(MODEL_DOWNLOAD_PROGRESS_CHANNEL, callback)
}

contextBridge.exposeInMainWorld('ledger', api)
