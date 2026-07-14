// Empty state for the capture views (Chronicle, Codex) when no campaign is active — e.g. after the last
// campaign is deleted. New users never see it: the forced first-run tutorial (ADR-044) creates a campaign
// before the app is usable. It points at the always-visible Sidebar "New campaign" button — the single
// home of the create flow (`layout/Sidebar.tsx` CreateCampaignDialog).
export function NoCampaign() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-2 text-center">
        <h2 className="font-display text-lg font-semibold text-foreground">No campaign yet</h2>
        <p className="text-sm text-muted-foreground">
          Begin a new chronicle with the{' '}
          <span className="font-medium text-foreground">New campaign</span> button in the sidebar.
        </p>
      </div>
    </div>
  )
}
