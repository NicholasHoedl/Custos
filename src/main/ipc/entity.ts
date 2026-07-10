import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import type { EntityType } from '@shared/entity-types'
import { IPC, type CreateEntityInput, type UpdateEntityInput } from '@shared/ipc-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import { indexEntity } from '../services/embedding-index.service'
import { markStaleIfChanged } from '../services/persona.service'
import { getEntityHistory } from '../services/chronology.service'
import { mergeEntities } from '../services/merge.service'
import * as svc from '../services/entity.service'

export function registerEntityHandlers(ctx: DbContext, store: VectorStore): void {
  ipcMain.handle(IPC.entityList, (_e, campaignId: string, type?: EntityType) =>
    svc.listEntities(ctx, campaignId, type)
  )
  ipcMain.handle(IPC.entityGet, (_e, id: string) => svc.getEntity(ctx, id))
  ipcMain.handle(IPC.entityCreate, (_e, input: CreateEntityInput) => {
    const entity = svc.createEntity(ctx, input)
    indexEntity(ctx, store, entity.id) // fire-and-forget
    return entity
  })
  ipcMain.handle(IPC.entityUpdate, (_e, id: string, patch: UpdateEntityInput) => {
    const entity = svc.updateEntity(ctx, id, patch)
    indexEntity(ctx, store, entity.id)
    if (entity.type === 'pc') markStaleIfChanged(ctx, entity.id) // brief may be out of date
    return entity
  })
  ipcMain.handle(IPC.entityDelete, (_e, id: string) => svc.deleteEntity(ctx, id))
  ipcMain.handle(IPC.entityHistory, (_e, id: string) => getEntityHistory(ctx, id))

  // Portrait picker (P2-2): a native file dialog → downscale to a 512px-wide JPEG thumbnail →
  // base64 data URL stored in entity.image. Thumbnailing bounds the DB/export size; no files, no
  // custom protocol. Returns null on cancel or an unreadable image.
  ipcMain.handle(IPC.entityPickImage, async (): Promise<string | null> => {
    const opts = {
      title: 'Choose a portrait',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile' as const]
    }
    const win = BrowserWindow.getFocusedWindow()
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    const img = nativeImage.createFromPath(res.filePaths[0])
    if (img.isEmpty()) return null
    const scaled = img.getSize().width > 512 ? img.resize({ width: 512 }) : img
    return `data:image/jpeg;base64,${scaled.toJPEG(72).toString('base64')}`
  })
  // Merge (P1-6, re-point only): the loser's notes/ties/chronology move to the survivor, then it's
  // deleted. Re-embed the survivor to be safe (a no-op via the hash guard — its text is unchanged).
  ipcMain.handle(IPC.entityMerge, (_e, survivorId: string, loserId: string) => {
    const survivor = mergeEntities(ctx, { survivorId, loserId })
    indexEntity(ctx, store, survivorId) // hash-guarded no-op; keeps the seam honest if that ever changes
    return survivor
  })
}
