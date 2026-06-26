import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { RecallRequest } from '@shared/recall-types'
import type { DbContext } from '../services/db-context'
import type { VectorStore } from '../services/vector-store.service'
import type { Send } from './handlers'
import { ask } from '../services/recall.service'

export function registerRecallHandlers(ctx: DbContext, store: VectorStore, send: Send): void {
  // One AbortController per in-flight request so recall:cancel can stop the stream.
  const controllers = new Map<string, AbortController>()

  ipcMain.handle(IPC.recallQuery, (_e, req: RecallRequest) => {
    const controller = new AbortController()
    controllers.set(req.requestId, controller)
    // Stream in the background; the renderer subscribes to stream:* events. Return the ack now.
    void ask(ctx, store, send, req, controller.signal).finally(() =>
      controllers.delete(req.requestId)
    )
    return { requestId: req.requestId }
  })

  ipcMain.handle(IPC.recallCancel, (_e, requestId: string) => {
    controllers.get(requestId)?.abort()
    controllers.delete(requestId)
  })
}
