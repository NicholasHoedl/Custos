import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { applySummary, formatRunCost } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
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
import { estimateTokens, EXTRACT_ADVISORY_TOKENS } from '@shared/tokens'

// Extract (ADR-051) — the standalone tier-1 pass, formerly step 1 of the "Close out" wizard. Reads ONE
// session's chronicle log oldest-first, runs one capture-mode extraction, and reviews the proposed
// entities / notes / status changes — applied stamped at this session. A plain, closeable dialog (not the
// old locked wizard); Illuminate is the separate next step. Re-running is dedup-safe (ADR-031), and state
// fully resets on close (everything is re-derivable from the DB).
export function ExtractDialog({
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
  const imp = useImport({ mode: 'capture' })
  const [noEntries, setNoEntries] = useState(false)
  const [estTokens, setEstTokens] = useState(0) // D1: joined-chronicle size, for the long-session advisory
  const { extract: impExtract, reset: impReset } = imp

  // On open: join the session's chronicle oldest-first and extract. An empty log has nothing to extract.
  // Gated on the key (the SetupCard renders instead). Close → reset everything.
  useEffect(() => {
    if (!open) {
      impReset()
      setNoEntries(false)
      setEstTokens(0)
      return
    }
    if (!onb.keyReady) return
    let stale = false
    void (async () => {
      const events = await ledger.event.list(session.id)
      if (stale) return
      const text = [...events]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((e) => e.content)
        .join('\n')
      setEstTokens(estimateTokens(text))
      if (!text.trim()) setNoEntries(true)
      else impExtract(text)
    })()
    return () => {
      stale = true
    }
  }, [open, onb.keyReady, session.id, impExtract, impReset])

  const applying = imp.status === 'applying'
  // A non-empty failure reason on idle, or a thrown error. ('empty' is a clean nothing-to-record, below.)
  const failReason =
    imp.status === 'idle' && imp.reason && imp.reason !== 'empty' ? imp.reason : null
  const failed = imp.status === 'error' || failReason !== null
  const nothingToRecord = noEntries || (imp.status === 'idle' && imp.reason === 'empty')

  return (
    <Dialog open={open} onOpenChange={(o) => !applying && onOpenChange(o)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Extract Session {session.number}</DialogTitle>
          <DialogDescription>
            The Keeper reads this session&apos;s chronicle and proposes the entities, notes, and status
            changes it implies — applied to this session for your review.
          </DialogDescription>
        </DialogHeader>

        {estTokens > EXTRACT_ADVISORY_TOKENS && (
          <Banner icon={<AlertTriangle className="size-4" />}>
            This is a long session (~{estTokens.toLocaleString()} tokens). If the extraction comes back
            truncated, split it — extract the earliest entries, then re-open to catch the rest.
          </Banner>
        )}

        {!onb.keyReady ? (
          <SetupCard
            title="Add your API key to extract"
            body="Extracting reads a session's chronicle and proposes what to record — add a key in Settings to enable it."
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
        ) : failed ? (
          <>
            <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
              {failReason ? reasonCopy(failReason) : `Something went wrong: ${imp.error}`}
            </Banner>
            <p className="text-xs text-muted-foreground">
              Nothing was recorded; your chronicle entries are safe in the log.
            </p>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : nothingToRecord ? (
          <>
            <p className="py-6 text-center text-sm text-muted-foreground">
              {noEntries
                ? 'No chronicle entries in this session yet — jot some in the Chronicle first.'
                : 'Nothing new to record from this session’s chronicle.'}
            </p>
            <DialogFooter>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : imp.status === 'review' || imp.status === 'applying' ? (
          <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
            <ChangesetReview
              imp={imp}
              campaignEntities={campaignEntities}
              bulk
              density="compact"
              applyLabel={`Apply to Session ${session.number}`}
              onApply={() => imp.apply(session.id)}
              onDiscard={() => onOpenChange(false)}
            />
          </div>
        ) : imp.status === 'done' ? (
          <>
            <div className="space-y-2 rounded-lg border border-border bg-card/60 p-4 text-sm text-foreground">
              <p>{imp.result ? applySummary(imp.result) : 'Nothing to record.'}</p>
              <p className="text-xs text-muted-foreground">
                Next: run <span className="text-foreground">Illuminate</span> to fill in ties &amp;
                profile details.
              </p>
              {imp.result && imp.result.skipped.length > 0 && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {imp.result.skipped.map((s, i) => (
                    <li key={i}>
                      Skipped a {s.kind}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {imp.cost && (
                <p className="pt-1 font-mono text-[0.625rem] text-muted-foreground">
                  This extract used {formatRunCost(imp.cost)}
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
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading Session {session.number}&apos;s chronicle…
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
