import { ipcMain } from 'electron'
import { IPC, MODEL_DOWNLOAD_PROGRESS_CHANNEL } from '@shared/ipc-types'
import type { OnboardingStatus } from '@shared/recall-types'
import { keyExists } from '../services/key.service'
import { downloadModel, isModelReady, warm } from '../services/embedding.service'

type Send = (channel: string, payload: unknown) => void

// Onboarding: report whether the AI prerequisites (API key + embedding model) are ready, and drive the
// one-time model download with streamed progress. After a successful download, trigger a backfill so
// existing notes/entities get embedded.
export function registerOnboardingHandlers(send: Send, reindex: () => Promise<number>): void {
  ipcMain.handle(
    IPC.onboardingStatus,
    (): OnboardingStatus => ({ keyReady: keyExists(), modelReady: isModelReady() })
  )
  ipcMain.handle(IPC.modelDownload, async () => {
    await downloadModel((p) => send(MODEL_DOWNLOAD_PROGRESS_CHANNEL, p))
    warm()
    void reindex()
  })
  ipcMain.handle(IPC.onboardingReindex, () => reindex())
}
