import { ipcMain } from 'electron'
import { IPC, MODEL_DOWNLOAD_PROGRESS_CHANNEL } from '@shared/ipc-types'
import type { OnboardingStatus } from '@shared/recall-types'
import { keyExists } from '../services/key.service'
import { downloadModel, isModelReady, warm } from '../services/embedding.service'
import { getSettings } from '../services/settings.service'
import { listCampaigns } from '../services/campaign.service'
import { fakeAiEnabled, tutorialSkipped } from '../services/ai-fake'
import type { DbContext } from '../services/db-context'

type Send = (channel: string, payload: unknown) => void

// Onboarding: report whether the AI prerequisites (API key + embedding model) are ready, and drive the
// one-time model download with streamed progress. After a successful download, trigger a backfill so
// existing notes/entities get embedded.
export function registerOnboardingHandlers(
  ctx: DbContext,
  send: Send,
  reindex: () => Promise<number>
): void {
  ipcMain.handle(
    IPC.onboardingStatus,
    // e2e fake-AI seam (ADR-043): report the model ready so Counsel/Recall's submit buttons enable —
    // the services keep the model-free fuzzy retrieval, so no real model is needed. `isModelReady()`
    // itself stays honest, so embedding indexing still no-ops. `tutorialDone` gates the forced first-run
    // wizard (ADR-044): the persisted flag, the e2e skip, OR any pre-existing data — a user who already
    // has a campaign predates the tutorial (or already finished it) and must not be forced through it.
    (): OnboardingStatus => ({
      keyReady: keyExists(),
      modelReady: isModelReady() || fakeAiEnabled(),
      tutorialDone:
        getSettings().tutorialCompleted === true ||
        tutorialSkipped() ||
        listCampaigns(ctx).length > 0
    })
  )
  ipcMain.handle(IPC.modelDownload, async () => {
    await downloadModel((p) => send(MODEL_DOWNLOAD_PROGRESS_CHANNEL, p))
    warm()
    void reindex()
  })
  ipcMain.handle(IPC.onboardingReindex, () => reindex())
}
