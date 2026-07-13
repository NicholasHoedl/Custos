import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import { addRunCost } from '@shared/usage-types'
import { ledger } from '@renderer/lib/ipc'
import { applySummary, formatRunCost, plural } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useEnrich } from '@renderer/hooks/use-enrich'
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'
import { ChecklistRow, ProgressRow } from '@renderer/components/sessions/enrich-rows'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { Banner, SetupCard } from '@renderer/components/chrome'

type WizardStep = 'chronicle' | 'illuminate' | 'done'
type Tier1Skipped = null | 'no_entries' | 'empty'

// The "Close out session" ritual (ADR-035): both extraction tiers run sequentially against the active
// session inside ONE LOCKED wizard — tier 1 (capture: one extraction over the whole session's chronicle
// log, oldest-first) is reviewed and applied, THEN tier 2 (Illuminate) scans the session's now-written
// notes, sweeps the touched entities, and reviews ties + profile edits. The dialog cannot be dismissed
// by Esc / overlay / X — only Approve/Reject (with a confirm) or, on hard failure, a plain Close exits
// (never trap the user in a broken wizard). Everything here is re-derivable from the DB, so state fully
// resets on close (contrast TranscribeDialog, which retains a paste). Re-running close-out later is safe:
// the ADR-031 dedup rules make a repeat pass near-empty.
export function CloseOutDialog({
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
  const enrich = useEnrich(activeCampaignId, session)
  const [step, setStep] = useState<WizardStep>('chronicle')
  const [tier1Skipped, setTier1Skipped] = useState<Tier1Skipped>(null)
  const [confirmReject, setConfirmReject] = useState<null | 'tier1' | 'tier2'>(null)

  const { extract: impExtract, reset: impReset } = imp
  const { scan: enrichScan, reset: enrichReset } = enrich

  // E1 — open: join the session's chronicle oldest-first and extract; an empty log skips straight to
  // Illuminate (a Transcribe-only or Annals-only session still deserves tier 2). Close: reset everything.
  // Gated on the key: without one the SetupCard renders instead — don't fire a doomed extract.
  useEffect(() => {
    if (!open) {
      impReset()
      enrichReset()
      setStep('chronicle')
      setTier1Skipped(null)
      setConfirmReject(null)
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
      if (!text.trim()) {
        setTier1Skipped('no_entries')
        setStep('illuminate')
      } else {
        impExtract(text)
      }
    })()
    return () => {
      stale = true
    }
  }, [open, onb.keyReady, session.id, impExtract, impReset, enrichReset])

  // E2 — extraction found nothing usable: note it and move on (not a failure).
  useEffect(() => {
    if (open && step === 'chronicle' && imp.status === 'idle' && imp.reason === 'empty') {
      setTier1Skipped('empty')
      setStep('illuminate')
    }
  }, [open, step, imp.status, imp.reason])

  // E3 — tier-1 apply committed: advance. Deliberately NO imp.reset() — the summary needs imp.result.
  useEffect(() => {
    if (open && step === 'chronicle' && imp.status === 'done') setStep('illuminate')
  }, [open, step, imp.status])

  // E4 — entering Illuminate: scan the session's (now freshly written) notes for touched entities.
  // Entities tier 1 JUST created start unchecked (their profiles were derived from this same log
  // seconds ago — enriching them again is near-redundant; ADR-035 cost tuning). Still checkable.
  useEffect(() => {
    if (open && step === 'illuminate' && enrich.phase === 'idle') {
      enrichScan({ defaultUnchecked: imp.result?.createdEntityIds ?? [] })
    }
  }, [open, step, enrich.phase, enrichScan, imp.result])

  // E5 — tier 2 finished (applied, or a clean nothing-new sweep): show the summary.
  useEffect(() => {
    if (open && step === 'illuminate' && enrich.phase === 'done') setStep('done')
  }, [open, step, enrich.phase])

  // Tier-1 failure: a thrown extract/apply ('error') or a non-empty failure reason on idle.
  const tier1Reason =
    imp.status === 'idle' && imp.reason && imp.reason !== 'empty' ? imp.reason : null
  const tier1Failed = imp.status === 'error' || tier1Reason !== null
  const tier1Reviewing = imp.status === 'review' || imp.status === 'applying'
  const running = enrich.phase === 'running'
  // Whether the checklist contains rows tier 1 just created (default-unchecked — explain why).
  const freshIds = new Set(imp.result?.createdEntityIds ?? [])
  const hasFresh = enrich.touched.some((t) => freshIds.has(t.entityId))
  // Both tiers' spend, for the summary (P0-4). addRunCost tolerates either being absent.
  const totalCost = enrich.cost
    ? addRunCost(imp.cost ?? undefined, enrich.cost)
    : (imp.cost ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        usd: 0
      })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-3xl"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Close out Session {session.number}</DialogTitle>
            <DialogDescription>
              {step === 'chronicle'
                ? 'Step 1 of 2 — Chronicle. The Keeper reads this session’s log and proposes the entities, notes, and status changes it implies.'
                : step === 'illuminate'
                  ? 'Step 2 of 2 — Illuminate. Re-reads each entity this session touched and proposes ties and profile details from the notes.'
                  : 'Session closed out — here’s what was recorded.'}
            </DialogDescription>
          </DialogHeader>

          {!onb.keyReady ? (
            <>
              <SetupCard
                title="Add your API key to close out"
                body="Closing out runs the Keeper over your session — add a key in Settings to enable it."
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
              <DialogFooter>
                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : step === 'chronicle' ? (
            tier1Failed ? (
              <>
                <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                  {tier1Reason ? reasonCopy(tier1Reason) : `Something went wrong: ${imp.error}`}
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
            ) : tier1Reviewing ? (
              <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
                <ChangesetReview
                  imp={imp}
                  campaignEntities={campaignEntities}
                  bulk
                  density="compact"
                  applyLabel="Approve & continue"
                  discardLabel="Reject & close"
                  onApply={() => imp.apply(session.id)}
                  onDiscard={() => setConfirmReject('tier1')}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Reading Session {session.number}&apos;s chronicle…
              </div>
            )
          ) : step === 'illuminate' ? (
            <>
              {tier1Skipped && (
                <Banner icon={<Sparkles className="size-4" />}>
                  {tier1Skipped === 'no_entries'
                    ? 'No chronicle entries this session — straight to Illuminate.'
                    : 'Nothing to record from the chronicle — on to Illuminate.'}
                </Banner>
              )}
              {enrich.phase === 'scanning' || enrich.phase === 'idle' ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reading the session&apos;s annals…
                </div>
              ) : enrich.phase === 'checklist' ? (
                enrich.touched.length === 0 ? (
                  <>
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No entities touched this session — nothing to illuminate.
                    </p>
                    <DialogFooter>
                      <Button size="sm" onClick={() => setStep('done')}>
                        Finish
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    {hasFresh && (
                      <p className="text-xs text-muted-foreground">
                        Newly inscribed entities start unchecked — their profiles were just drawn
                        from this log.
                      </p>
                    )}
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
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setStep('done')}>
                        Finish without illuminating
                      </Button>
                      <Button
                        onClick={() => void enrich.run()}
                        disabled={enrich.checked.size === 0}
                      >
                        <Sparkles className="size-3.5" />
                        Illuminate {enrich.checked.size}{' '}
                        {plural(enrich.checked.size, 'entity', 'entities')}
                      </Button>
                    </DialogFooter>
                  </>
                )
              ) : running ? (
                <>
                  <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
                    {enrich.progress.map((p) => (
                      <ProgressRow key={p.entityId} p={p} />
                    ))}
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={enrich.cancel}>
                      Stop after this one
                    </Button>
                  </DialogFooter>
                </>
              ) : enrich.phase === 'review' || enrich.phase === 'applying' ? (
                <>
                  {enrich.globalReason && (
                    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                      {reasonCopy(enrich.globalReason)} Showing what was found before it stopped.
                    </Banner>
                  )}
                  <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
                    <ChangesetReview
                      imp={enrich.review}
                      campaignEntities={campaignEntities}
                      bulk
                      density="compact"
                      applyLabel="Approve & finish"
                      discardLabel="Reject & close"
                      onApply={enrich.apply}
                      onDiscard={() => setConfirmReject('tier2')}
                    />
                  </div>
                </>
              ) : (
                // enrich.phase === 'error' — a hard failure with nothing reviewable.
                <>
                  <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                    {enrich.globalReason
                      ? reasonCopy(enrich.globalReason)
                      : `Something went wrong: ${enrich.error}`}
                  </Banner>
                  {imp.result && (
                    <p className="text-xs text-muted-foreground">
                      The Chronicle changes from step 1 are already recorded and will stay. You can
                      re-run Illuminate from the Sessions page.
                    </p>
                  )}
                  <DialogFooter>
                    <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                      Close
                    </Button>
                  </DialogFooter>
                </>
              )}
            </>
          ) : (
            // step === 'done' — the summary is the only free exit.
            <>
              <div className="space-y-2 rounded-lg border border-border bg-card/60 p-4 text-sm text-foreground">
                <p>
                  <span className="inscribed mr-2 text-xs">Chronicle</span>
                  {imp.result ? applySummary(imp.result) : 'nothing to record.'}
                </p>
                <p>
                  <span className="inscribed mr-2 text-xs">Illuminate</span>
                  {enrich.result
                    ? `${enrich.result.relationshipChangesApplied} ${plural(
                        enrich.result.relationshipChangesApplied,
                        'tie',
                        'ties'
                      )} · ${enrich.result.fieldChangesApplied} profile ${plural(
                        enrich.result.fieldChangesApplied,
                        'edit',
                        'edits'
                      )}`
                    : enrich.phase === 'done'
                      ? 'nothing new — every profile already reflects this session.'
                      : 'skipped.'}
                </p>
                {[...(imp.result?.skipped ?? []), ...(enrich.result?.skipped ?? [])].map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    Skipped a {s.kind}: {s.reason}
                  </p>
                ))}
                {(imp.cost || enrich.cost) && (
                  <p className="pt-1 font-mono text-[10px] text-muted-foreground">
                    This close-out used {formatRunCost(totalCost)}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject confirms — the only non-failure exits besides Approve. */}
      <AlertDialog open={confirmReject !== null} onOpenChange={(o) => !o && setConfirmReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmReject === 'tier1'
                ? 'Discard the Chronicle proposals?'
                : 'Discard the Illuminate proposals?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmReject === 'tier1'
                ? 'Nothing has been applied yet; your chronicle entries stay in the log. You can close out this session again anytime.'
                : 'The Chronicle changes from step 1 are already recorded and will stay. Only the Illuminate proposals are discarded — you can re-run Illuminate from the Sessions page.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmReject(null)
                onOpenChange(false)
              }}
            >
              Reject &amp; exit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
