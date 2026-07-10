import { ipcMain } from 'electron'

// Shared plumbing for a request/response IPC call whose in-flight work can be aborted (ROADMAP P1-5).
// Mirrors recall.ts's controller map, but for the single-shot lenses (Counsel, Converse, Transcribe)
// that await a structured result rather than streaming. Each query stashes an AbortController keyed by
// req.requestId; the companion cancel channel aborts it (the Anthropic SDK cancels the HTTP request,
// so a "Thinking…" spin can actually be stopped). The renderer hook ignores the aborted promise via
// its own staleness token, so cancelling reads as "back to idle", not an error.
export function registerCancelable<Req extends { requestId?: string }>(
  queryChannel: string,
  cancelChannel: string,
  run: (req: Req, signal: AbortSignal) => Promise<unknown>
): void {
  const controllers = new Map<string, AbortController>()

  ipcMain.handle(queryChannel, async (_e, req: Req) => {
    const controller = new AbortController()
    const id = req.requestId // the renderer always sends one; guarded so a direct/legacy call still runs
    if (id) controllers.set(id, controller)
    try {
      return await run(req, controller.signal)
    } finally {
      if (id) controllers.delete(id)
    }
  })

  ipcMain.handle(cancelChannel, (_e, requestId: string) => {
    controllers.get(requestId)?.abort()
    controllers.delete(requestId)
  })
}
