import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { RecapRequest } from '@shared/recap-types'
import type { DbContext } from '../services/db-context'
import type { Send } from './handlers'
import { generateRecap } from '../services/recap.service'

export function registerRecapHandlers(ctx: DbContext, send: Send): void {
  // One AbortController per in-flight recap so recap:cancel can stop the stream.
  const controllers = new Map<string, AbortController>()

  ipcMain.handle(IPC.recapGenerate, (_e, req: RecapRequest) => {
    const controller = new AbortController()
    controllers.set(req.requestId, controller)
    // Stream in the background; the renderer subscribes to recap:* events. Return the ack now.
    void generateRecap(ctx, send, req, controller.signal).finally(() =>
      controllers.delete(req.requestId)
    )
    return { requestId: req.requestId }
  })

  ipcMain.handle(IPC.recapCancel, (_e, requestId: string) => {
    controllers.get(requestId)?.abort()
    controllers.delete(requestId)
  })
}
