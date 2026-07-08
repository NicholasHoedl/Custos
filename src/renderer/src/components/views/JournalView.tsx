import { useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { OnboardingChecklist } from '@renderer/components/OnboardingChecklist'
import { EventFeed } from '@renderer/components/capture/EventFeed'

// The Journal is the primary at-the-table view: a running log of plain entries (no per-entry AI —
// extraction is the header's "Close out session" wizard, ADR-035 as-built; see EventFeed/CloseOutDialog).
// Promoted to a top-level, default view so capture-by-writing is the main path; manual entity editing
// lives in Codex. EventFeed is the sole host of the journal (Chronicle) now.
export function JournalView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  // Distinguish "still restoring the persisted session" from "campaign has no sessions" (T3).
  const { loading: sessionsLoading } = useSessions(activeCampaignId)
  const restoringSession = sessionsLoading && activeSessionId === null

  if (!activeCampaignId) {
    // No campaign yet: the welcome IS the empty state (it carries the create-campaign step).
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <OnboardingChecklist />
        </div>
      </div>
    )
  }

  // Key by campaign so per-campaign UI state (open dialogs, composer text) never survives a campaign
  // switch. Mirrors how CaptureView keys its panels.
  return <EventFeed key={activeCampaignId} sessionId={activeSessionId} restoring={restoringSession} />
}
