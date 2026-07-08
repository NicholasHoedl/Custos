import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-types'
import type { DeriveProfileRequest } from '@shared/derive-profile-types'
import type { DbContext } from '../services/db-context'
import { deriveProfile } from '../services/derive-profile.service'

// Derive-from-backstory (ADR-029): single-shot request/response like Converse — no streaming, no vector
// store. The renderer reviews + approves the suggestions, then applies them via entity.update +
// persona.update; this handler only produces the (unwritten) proposal.
export function registerDeriveProfileHandlers(ctx: DbContext): void {
  ipcMain.handle(IPC.deriveProfileQuery, (_e, req: DeriveProfileRequest) =>
    deriveProfile(ctx, req, new AbortController().signal)
  )
}
