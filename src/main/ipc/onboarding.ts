import { ipcMain } from 'electron'
import { IPC, MODEL_DOWNLOAD_PROGRESS_CHANNEL } from '@shared/ipc-types'
import type { OnboardingStatus } from '@shared/recall-types'
import { keyExists } from '../services/key.service'
import { downloadModel, isModelReady, warm } from '../services/embedding.service'
import { downloadReranker, warmReranker } from '../services/rerank.service'
import { getSettings } from '../services/settings.service'
import { listCampaigns } from '../services/campaign.service'
import { deriveTutorialDone } from '../services/onboarding-gate'
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
    // tutorial via the pure `deriveTutorialDone` (ADR-044 → ADR-059): the persisted flag, the e2e skip,
    // or pre-existing data WITHOUT a mid-tour `tutorialStep` (the spotlight tour creates a real campaign
    // at step 1, so a bare campaigns-exist clause would strand a relaunched mid-tour user).
    (): OnboardingStatus => {
      const settings = getSettings()
      return {
        keyReady: keyExists(),
        modelReady: isModelReady() || fakeAiEnabled(),
        tutorialDone: deriveTutorialDone({
          tutorialCompleted: settings.tutorialCompleted === true,
          skipped: tutorialSkipped(),
          campaignCount: listCampaigns(ctx).length,
          tutorialStep: settings.tutorialStep
        }),
        tutorialStep: settings.tutorialStep
      }
    }
  )
  ipcMain.handle(IPC.modelDownload, async () => {
    await downloadModel((p) => send(MODEL_DOWNLOAD_PROGRESS_CHANNEL, p))
    // ADR-052: the cross-encoder reranker is a SECOND, optional model — download it after the embedder,
    // forwarding progress to the same bar. A failure here must NOT block the embedder's readiness (retrieval
    // simply runs un-reranked until it's present), so it is swallowed.
    try {
      await downloadReranker((p) => send(MODEL_DOWNLOAD_PROGRESS_CHANNEL, p))
    } catch {
      /* embedder is ready; reranking stays off until a later successful download */
    }
    warm()
    warmReranker()
    void reindex()
  })
  ipcMain.handle(IPC.onboardingReindex, () => reindex())
}
