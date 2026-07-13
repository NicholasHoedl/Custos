import { useEffect } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import { formatRunCost, plural } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useEnrich } from '@renderer/hooks/use-enrich'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { ChecklistRow, ProgressRow } from '@renderer/components/sessions/enrich-rows'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { Banner, SetupCard } from '@renderer/components/chrome'

// Illuminate (code name enrich, ADR-035) — the manual tier-2 pass over one session: pick which of its
// touched entities to enrich, one focused Keeper call each (grounded in that entity's FULL note history),
// then review the proposed ties + profile edits and apply them stamped at this session. Re-running is
// safe: the ADR-031 dedup rules drop everything already recorded, so a second pass comes back near-empty.
export function EnrichDialog({
  session,
  open,
  onOpenChange
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const enrich = useEnrich(activeCampaignId, session)
  const { scan, reset } = enrich

  // Fresh scan on open; a run's state is discarded on close (unlike Transcribe, everything here is
  // re-derivable from the DB — re-scanning is cheap and re-running is dedup-safe).
  useEffect(() => {
    if (open) scan()
    else reset()
  }, [open, scan, reset])

  const checkedCount = enrich.checked.size
  const running = enrich.phase === 'running'

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Illuminate Session {session.number}</DialogTitle>
          <DialogDescription>
            {enrich.phase === 'review'
              ? 'Review the ties and profile edits the Keeper found — applied to this session.'
              : 'Re-reads each entity this session touched and proposes ties and profile details from the notes.'}
          </DialogDescription>
        </DialogHeader>

        {!onb.keyReady ? (
          <SetupCard
            title="Add your API key to illuminate"
            body="The Keeper reads each entity's history and proposes what its profile is missing — add a key in Settings."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  setActiveView('settings')
                }}
              >
                Open Settings
              </Button>
            }
          />
        ) : enrich.phase === 'scanning' || enrich.phase === 'idle' ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the session&apos;s annals…
          </div>
        ) : enrich.phase === 'checklist' ? (
          <>
            {enrich.touched.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No entities touched in this session&apos;s annals — chronicle something first.
              </p>
            ) : (
              <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
                {enrich.touched.map((t) => (
                  <ChecklistRow
                    key={t.entityId}
                    touched={t}
                    checked={enrich.checked.has(t.entityId)}
                    onToggle={() => enrich.toggle(t.entityId)}
                  />
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void enrich.run()} disabled={checkedCount === 0}>
                <Sparkles className="size-3.5" />
                Illuminate {checkedCount} {plural(checkedCount, 'entity', 'entities')}
              </Button>
            </DialogFooter>
          </>
        ) : running || enrich.phase === 'review' || enrich.phase === 'applying' ? (
          <>
            {running && (
              <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
                {enrich.progress.map((p) => (
                  <ProgressRow key={p.entityId} p={p} />
                ))}
              </div>
            )}
            {!running && enrich.globalReason && (
              <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                {reasonCopy(enrich.globalReason)} Showing what was found before it stopped.
              </Banner>
            )}
            {!running && (
              <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
                <ChangesetReview
                  imp={enrich.review}
                  campaignEntities={campaignEntities}
                  onApply={enrich.apply}
                  onDiscard={() => onOpenChange(false)}
                  applyLabel={`Apply to Session ${session.number}`}
                />
              </div>
            )}
            {running && (
              <DialogFooter>
                <Button variant="ghost" onClick={enrich.cancel}>
                  Stop after this one
                </Button>
              </DialogFooter>
            )}
          </>
        ) : enrich.phase === 'done' ? (
          <>
            <div className="rounded-lg border border-border bg-card/60 p-4">
              {enrich.result ? (
                <p className="text-sm text-foreground">
                  Recorded <strong>{enrich.result.relationshipChangesApplied}</strong>{' '}
                  {plural(enrich.result.relationshipChangesApplied, 'tie', 'ties')} ·{' '}
                  <strong>{enrich.result.fieldChangesApplied}</strong> profile{' '}
                  {plural(enrich.result.fieldChangesApplied, 'edit', 'edits')} for Session{' '}
                  {session.number}.
                </p>
              ) : (
                <p className="text-sm text-foreground">
                  Nothing new — every profile already reflects this session&apos;s annals.
                </p>
              )}
              {enrich.result && enrich.result.skipped.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {enrich.result.skipped.map((s, i) => (
                    <li key={i}>
                      Skipped a {s.kind}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {enrich.cost && (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  This sweep used {formatRunCost(enrich.cost)}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
              {enrich.globalReason
                ? reasonCopy(enrich.globalReason)
                : `Something went wrong: ${enrich.error}`}
            </Banner>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
