import { useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { NoCampaign } from '@renderer/components/NoCampaign'
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

  if (!activeCampaignId) return <NoCampaign />

  // Key EventFeed by campaign so per-campaign UI state (open dialogs, composer text) never survives a
  // campaign switch.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <EventFeed key={activeCampaignId} sessionId={activeSessionId} restoring={restoringSession} />
      </div>
    </div>
  )
}
