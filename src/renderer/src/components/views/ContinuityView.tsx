import { useEffect, useRef } from 'react'
import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  WifiOff,
  Wrench
} from 'lucide-react'
import {
  CONTINUITY_CATEGORY_LABELS,
  type ContinuityFinding,
  type ContinuityFixAction,
  type ContinuityResult,
  type ContinuitySeverity
} from '@shared/continuity-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useContinuity } from '@renderer/hooks/use-continuity'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useLensHistory } from '@renderer/hooks/use-lens-history'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { LensResultBar } from '@renderer/components/lens/LensResultBar'
import { LensPromptInfo } from '@renderer/components/lens/LensPromptInfo'
import { continuityProse } from '@renderer/lib/lens-prose'
import { formatRunCost } from '@renderer/lib/format'
import { Banner, EmptyState, PaneBody, PaneHeader } from '@renderer/components/chrome'

type Speed = 'quick' | 'deep'

const SEVERITY_STYLE: Record<ContinuitySeverity, string> = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground'
}
const SEVERITY_LABEL: Record<ContinuitySeverity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

export function ContinuityView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const audit = useContinuity()
  const [speed, setSpeed] = useState<Speed>('deep')
  const { entities } = useEntities(activeCampaignId)
  const nameById = new Map(entities.map((e) => [e.id, e.name]))
  const { entries: recent, remember } = useLensHistory('continuity')
  const snapshottedRef = useRef(false)

  const result = audit.status === 'done' ? audit.result : null
  const prose = result ? continuityProse(result.findings) : null

  // Snapshot the report into history ONCE per run (survives nav, P1-1). Reset when a new run starts, so a
  // later optimistic prune (applyFix removing a fixed finding) doesn't re-snapshot the shrinking report.
  useEffect(() => {
    if (audit.status === 'thinking') snapshottedRef.current = false
    if (audit.status === 'done' && result && !snapshottedRef.current) {
      snapshottedRef.current = true
      const n = result.findings.length
      remember(`${n} finding${n === 1 ? '' : 's'}`, continuityProse(result.findings))
    }
  }, [audit.status, result, remember])

  function openEntity(id: string) {
    setSelectedEntity(id)
    setActiveView('capture')
  }

  if (!activeCampaignId) {
    return (
      <EmptyState icon={ShieldCheck} title="No campaign selected">
        Choose a campaign in the sidebar to audit its continuity.
      </EmptyState>
    )
  }

  const thinking = audit.status === 'thinking'

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        icon={ShieldCheck}
        title="Continuity"
        action={
          <div className="flex items-center gap-1">
            <LensPromptInfo lens="continuity" />
            {audit.status !== 'idle' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={audit.reset}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        }
      />
      <PaneBody size="reading" className="max-w-4xl">
        {/* The run control. The automatic checks need no key/network — only the AI contradiction pass does. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Scan the campaign for inconsistencies</p>
            <p className="text-xs text-muted-foreground">
              Automatic checks run instantly; an AI pass looks for contradictions in the notes.
              {!onb.keyReady && ' Add an API key in Settings for the AI pass.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SpeedToggle speed={speed} setSpeed={setSpeed} />
            {thinking ? (
              <Button variant="outline" size="sm" onClick={audit.cancel}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => audit.run({ speed })}>
                <ScanSearch className="size-3.5" />
                {audit.status === 'done' ? 'Re-run' : 'Run check'}
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {(prose || recent.length > 0) && <LensResultBar prose={prose} history={recent} />}

          {audit.status === 'idle' && (
            <EmptyState icon={ShieldCheck} title="Ready when you are">
              Run a check to see any places where the record disagrees with itself — a fallen NPC still
              acting, two notes that conflict, a status that doesn’t match its lifecycle.
            </EmptyState>
          )}

          {thinking && (
            <div className="flex items-center justify-center gap-2 pt-8 text-sm text-muted-foreground">
              <Sparkles className="size-4 animate-pulse text-primary" />
              Scanning the record for inconsistencies…
            </div>
          )}

          {audit.status === 'error' && (
            <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
              Something went wrong: {audit.error}
            </Banner>
          )}

          {result && (
            <>
              <AiStatusBanner ai={result.ai} />
              {result.findings.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No inconsistencies found">
                  The record looks consistent. Re-run after your next session to keep it clean.
                </EmptyState>
              ) : (
                <div className="space-y-3">
                  {result.findings.map((f) => (
                    <FindingCard
                      // Stable identity (findings have no id) so an optimistic prune doesn't shift a sibling's
                      // key — safe even if the card later gains internal state.
                      key={`${f.source}:${f.category}:${f.entityIds.join(',')}:${f.summary}`}
                      finding={f}
                      nameById={nameById}
                      onOpen={openEntity}
                      onFix={audit.applyFix}
                    />
                  ))}
                </div>
              )}
              {result.cost && (
                <p className="text-right font-mono text-[0.625rem] text-muted-foreground">
                  {formatRunCost(result.cost)}
                </p>
              )}
            </>
          )}
        </div>
      </PaneBody>
    </div>
  )
}

function AiStatusBanner({ ai }: { ai: ContinuityResult['ai'] }) {
  if (ai.status === 'ok') return null
  if (ai.status === 'skipped') {
    if (ai.reason === 'empty' || ai.reason === 'checks_only') return null
    const copy =
      ai.reason === 'no_key'
        ? 'The AI contradiction pass didn’t run — add an API key in Settings. The automatic checks below still ran.'
        : 'The AI contradiction pass didn’t run (you appear to be offline). The automatic checks below still ran.'
    const Icon = ai.reason === 'no_key' ? KeyRound : WifiOff
    return <Banner icon={<Icon className="size-4" />}>{copy}</Banner>
  }
  // failed
  return (
    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
      The AI contradiction pass failed ({ai.reason}). The automatic checks below still ran.
    </Banner>
  )
}

function FindingCard({
  finding,
  nameById,
  onOpen,
  onFix
}: {
  finding: ContinuityFinding
  nameById: Map<string, string>
  onOpen: (id: string) => void
  onFix: (action: ContinuityFixAction, finding: ContinuityFinding) => void
}) {
  const named = finding.entityIds
    .map((id) => ({ id, name: nameById.get(id) }))
    .filter((e): e is { id: string; name: string } => Boolean(e.name))
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wide',
            SEVERITY_STYLE[finding.severity]
          )}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
          {CONTINUITY_CATEGORY_LABELS[finding.category]}
        </span>
        <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground/70">
          {finding.source === 'ai' ? 'AI' : 'Auto'}
        </span>
      </div>
      <h3 className="font-display text-[0.9375rem] font-medium leading-snug text-foreground">
        {finding.summary}
      </h3>
      {finding.detail && (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{finding.detail}</p>
      )}
      {finding.suggestedFix && (
        <p className="text-[0.75rem] italic leading-relaxed text-muted-foreground/80">
          Suggested fix: {finding.suggestedFix}
        </p>
      )}
      {finding.fix && finding.fix.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {finding.fix.actions.map((a, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => onFix(a.action, finding)}
            >
              <Wrench className="size-3" />
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {named.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {named.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onOpen(e.id)}
              className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-xs text-foreground hover:border-primary/50 hover:text-primary"
            >
              {e.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Quick (Sonnet — faster) vs Deep (the Settings model — fuller reasoning) for the AI pass. */
function SpeedToggle({ speed, setSpeed }: { speed: Speed; setSpeed: (s: Speed) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setSpeed('quick')}
        title="Sonnet — a faster scan"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'quick' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Quick
      </button>
      <button
        type="button"
        onClick={() => setSpeed('deep')}
        title="Your Settings model — a thorough scan"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'deep' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Deep
      </button>
    </div>
  )
}
