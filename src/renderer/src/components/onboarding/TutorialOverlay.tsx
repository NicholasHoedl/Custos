import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { TUTORIAL_STEP_IDS, type TutorialStepId } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'
import { useCampaigns } from '@renderer/hooks/use-ledger'
import { NAV_ITEMS, type NavItem } from '@renderer/lib/nav-items'
import {
  ANTHROPIC_CONSOLE_LABEL,
  ANTHROPIC_CONSOLE_URL,
  API_KEY_STEPS,
  SPOTLIGHT_COPY,
  TOOL_BLURBS,
  TOUR_GROUPS
} from '@renderer/lib/guide-content'
import { Button } from '@renderer/components/ui/button'
import { Spotlight, useTargetRect } from '@renderer/components/onboarding/Spotlight'
import { WelcomeCard } from '@renderer/components/onboarding/WelcomeCard'

// The forced first-run tutorial, redesigned as a SPOTLIGHT TOUR (ADR-059 — supersedes the ADR-044/045
// wizard's presentation; the gate, the validated-key requirement, non-skippability, and the e2e skip
// seam all stand). One full-screen welcome page captures the user's name, then the REAL app takes over:
// a scrim greys and click-blocks everything except one highlighted control per step, with an anchored
// coach mark. ACTION steps force the real UI (the campaign dialog, the session button, Settings' key
// card) and advance by WATCHING state — which makes them idempotent: a mid-tour relaunch resumes at the
// persisted `tutorialStep`, and already-satisfied steps fast-forward on entry. INFO steps advance via
// Next. Linear, no Back; AppShell keeps hotkeys disabled while the tour is active.

type Step = 'welcome' | TutorialStepId

interface StepDef {
  id: TutorialStepId
  kind: 'action' | 'info'
  /** CSS selectors unioned into the cutout — data-tour attributes on the real controls. */
  targets: string[]
  side: 'top' | 'right' | 'bottom' | 'left'
  /** View the target lives in (MainPanel keeps views mounted but hidden — a hidden rect is 0). */
  view?: ViewKey
}

/** The group cutout = the nav heading + every nav item the group teaches (from TOUR_GROUPS, so the
 *  tour and the Quickstart guide can't drift — including Continuity in the ask group). */
const groupTargets = (g: 'tour-capture' | 'tour-world' | 'tour-ask'): string[] => [
  `[data-tour="nav-group-${g.replace('tour-', '')}"]`,
  ...TOUR_GROUPS[g].keys.map((k) => `[data-tour="nav-${k}"]`)
]

const STEP_DEFS: StepDef[] = [
  { id: 'campaign', kind: 'action', targets: ['[data-tour="new-campaign"]'], side: 'right', view: 'journal' },
  { id: 'character', kind: 'info', targets: ['[data-tour="nav-character"]'], side: 'right' },
  { id: 'session', kind: 'action', targets: ['[data-tour="new-session"]'], side: 'bottom', view: 'journal' },
  { id: 'apikey', kind: 'action', targets: ['[data-tour="api-key-card"]'], side: 'bottom', view: 'settings' },
  { id: 'tour-capture', kind: 'info', targets: groupTargets('tour-capture'), side: 'right' },
  { id: 'tour-world', kind: 'info', targets: groupTargets('tour-world'), side: 'right' },
  { id: 'tour-ask', kind: 'info', targets: groupTargets('tour-ask'), side: 'right' },
  { id: 'bug', kind: 'info', targets: ['[data-tour="report-bug"]'], side: 'right' },
  { id: 'guide', kind: 'info', targets: ['[data-tour="guide"]'], side: 'right' }
]

const nextOf = (id: TutorialStepId): TutorialStepId | null => {
  const i = STEP_DEFS.findIndex((d) => d.id === id)
  return STEP_DEFS[i + 1]?.id ?? null
}

/** Resume guard: absent → fresh install (welcome). Set-but-unknown (hand-edited settings.json) →
 *  'campaign' — a set step proves welcome passed, and the idempotent action steps fast-forward. */
function validateResume(initial: string | undefined): Step {
  if (!initial) return 'welcome'
  return (TUTORIAL_STEP_IDS as readonly string[]).includes(initial)
    ? (initial as TutorialStepId)
    : 'campaign'
}

export function TutorialOverlay({
  onDone,
  initialStep
}: {
  onDone: () => void
  initialStep?: TutorialStepId
}) {
  const [step, setStep] = useState<Step>(() => validateResume(initialStep))
  const setActiveView = useUiStore((s) => s.setActiveView)
  const keySavedNonce = useUiStore((s) => s.keySavedNonce)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveCampaign = useAppStore((s) => s.setActiveCampaign)
  const { campaigns } = useCampaigns()
  const [keyError, setKeyError] = useState<string | null>(null)
  const lastCheckedNonce = useRef(-1) // -1 = the apikey step hasn't run its entry probe yet
  const validatingRef = useRef(false)

  const def = step === 'welcome' ? null : (STEP_DEFS.find((d) => d.id === step) ?? null)
  const rect = useTargetRect(def ? def.targets : null)

  const advance = useCallback((next: TutorialStepId): void => {
    setKeyError(null)
    setStep(next)
    // Fire-and-forget resume pointer — a lost write only costs redoing one step after a crash.
    void ledger.settings.set({ tutorialStep: next }).catch(() => {})
  }, [])

  // Entry side-effect: surface the view the step's target lives in.
  useEffect(() => {
    if (def?.view) setActiveView(def.view)
  }, [def, setActiveView])

  // Resume guard: past the campaign step with campaigns but no selection (wiped localStorage) → select
  // the first, or the session step's target (SessionControl needs an active campaign) never mounts.
  useEffect(() => {
    if (step === 'welcome' || step === 'campaign') return
    if (campaigns.length > 0 && !activeCampaignId) setActiveCampaign(campaigns[0].id)
  }, [step, campaigns, activeCampaignId, setActiveCampaign])

  // ACTION detectors — state-based, so they fire for a fresh action AND fast-forward on resume.
  useEffect(() => {
    if (step !== 'campaign' || campaigns.length === 0) return
    if (!activeCampaignId) setActiveCampaign(campaigns[0].id)
    advance('character')
  }, [step, campaigns, activeCampaignId, setActiveCampaign, advance])

  useEffect(() => {
    if (step === 'session' && activeSessionId) advance('apikey')
  }, [step, activeSessionId, advance])

  // Key detector: validate once per save (SettingsView bumps keySavedNonce after each save+validate
  // cycle) plus once on entry when a key already exists (resume). An invalid key STAYS stored (today's
  // behavior) — the coach mark shows the error and waits for another save.
  useEffect(() => {
    if (step !== 'apikey') return
    let cancelled = false
    async function check(entryProbe: boolean): Promise<void> {
      if (validatingRef.current) return
      validatingRef.current = true
      try {
        if (entryProbe) {
          const exists = await ledger.apikey.exists()
          if (!exists || cancelled) return
        }
        const { valid } = await ledger.apikey.validate()
        if (cancelled) return
        if (valid) advance('tour-capture')
        else setKeyError('That key was rejected — check it in the form above and save again.')
      } catch (e) {
        if (!cancelled) setKeyError(`Couldn't verify the key: ${String(e)}`)
      } finally {
        validatingRef.current = false
      }
    }
    if (keySavedNonce > Math.max(lastCheckedNonce.current, 0)) {
      lastCheckedNonce.current = keySavedNonce
      void check(false)
    } else if (lastCheckedNonce.current === -1) {
      lastCheckedNonce.current = keySavedNonce
      void check(true)
    }
    return () => {
      cancelled = true
    }
  }, [step, keySavedNonce, advance])

  async function finish(): Promise<void> {
    try {
      // Spread-with-undefined overwrites the key; JSON.stringify then drops it from settings.json.
      await ledger.settings.set({ tutorialCompleted: true, tutorialStep: undefined })
    } catch (e) {
      toast.error('Could not finish the tutorial', { description: String(e) })
      return
    }
    setActiveView('journal')
    onDone()
  }

  if (step === 'welcome') {
    return (
      <WelcomeCard
        onSubmit={async (name) => {
          try {
            // Awaited (unlike step advances): the name must survive an immediate quit.
            await ledger.settings.set({ userName: name, tutorialStep: 'campaign' })
          } catch (e) {
            toast.error('Could not save your name', { description: String(e) })
            return
          }
          setStep('campaign')
        }}
      />
    )
  }

  if (!def) return null
  const copy = SPOTLIGHT_COPY[def.id]
  const next = nextOf(def.id)

  return (
    <Spotlight rect={rect} interactive={def.kind === 'action'} side={def.side} wide={def.id === 'apikey'}>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-foreground">{copy.title}</h2>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Step {STEP_DEFS.indexOf(def) + 1} of {STEP_DEFS.length}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{copy.body}</p>

        {def.id === 'apikey' && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">No key yet? Here&rsquo;s how:</p>
            <ol className="list-decimal space-y-1 rounded-md border border-border bg-background/50 py-2 pl-6 pr-2 text-xs text-muted-foreground">
              {API_KEY_STEPS.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <a
              href={ANTHROPIC_CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              Open {ANTHROPIC_CONSOLE_LABEL} <ExternalLink className="size-3" />
            </a>
            {keyError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {keyError}
              </p>
            )}
          </div>
        )}

        {(def.id === 'tour-capture' || def.id === 'tour-world' || def.id === 'tour-ask') && (
          <ToolList group={def.id} />
        )}

        {def.kind === 'info' && (
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => (next ? advance(next) : void finish())}>
              {next ? 'Next' : 'Finish'}
            </Button>
          </div>
        )}
      </div>
    </Spotlight>
  )
}

/** The compact tool list inside a group step's coach mark (the old wizard's ToolTour, shrunk). */
function ToolList({ group }: { group: 'tour-capture' | 'tour-world' | 'tour-ask' }) {
  const items = TOUR_GROUPS[group].keys
    .map((k) => NAV_ITEMS.find((n) => n.key === k))
    .filter((n): n is NavItem => Boolean(n))
  return (
    <ul className="space-y-2">
      {items.map(({ key, label, icon: Icon }) => (
        <li key={key} className="flex gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
            <Icon className="size-3.5 text-primary" />
          </div>
          <div>
            <div className="text-xs font-medium text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground">{TOOL_BLURBS[key]}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
