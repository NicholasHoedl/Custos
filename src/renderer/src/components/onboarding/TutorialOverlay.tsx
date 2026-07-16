import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { TUTORIAL_STEP_IDS, type TutorialStepId } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'
import { useCampaigns } from '@renderer/hooks/use-ledger'
import { NAV_ITEMS } from '@renderer/lib/nav-items'
import {
  ANTHROPIC_CONSOLE_LABEL,
  ANTHROPIC_CONSOLE_URL,
  API_KEY_STEPS,
  LOOP_STEPS,
  REVIEW_COPY,
  SPOTLIGHT_COPY,
  TOOL_BLURBS,
  TOUR_GROUPS
} from '@renderer/lib/guide-content'
import { Button } from '@renderer/components/ui/button'
import {
  PageOverlay,
  ReviewShell,
  Spotlight,
  useTargetRect
} from '@renderer/components/onboarding/Spotlight'
import { WelcomeCard } from '@renderer/components/onboarding/WelcomeCard'

// The forced first-run tutorial — a PER-PAGE spotlight walkthrough (ADR-059 → ADR-060). One full-screen
// welcome page captures the user's name, then the REAL app takes over across 19 stops: ACTION steps
// force the real UI (the campaign dialog, the session button, Settings' key card) and advance by
// WATCHING state (idempotent — a mid-tour relaunch resumes at the persisted `tutorialStep` and satisfied
// steps fast-forward); INFO steps highlight one control (visible, not operable) with Next; PAGE steps
// show a whole page UNDIMMED with the coach card sitting over the navbar; the REVIEW step closes with a
// front-and-center recap card. Linear, no Back, no skip; AppShell keeps hotkeys disabled throughout.

type Step = 'welcome' | TutorialStepId

interface StepDef {
  id: TutorialStepId
  kind: 'action' | 'info' | 'page' | 'review'
  /** CSS selectors unioned into the cutout (action/info only) — data-tour attrs on real controls. */
  targets?: string[]
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** The view this step lives in (MainPanel keeps views mounted but hidden — hidden rects are 0). */
  view: ViewKey
}

const STEP_DEFS: StepDef[] = [
  { id: 'campaign', kind: 'action', targets: ['[data-tour="new-campaign"]'], side: 'right', view: 'journal' },
  { id: 'character-page', kind: 'page', view: 'character' },
  { id: 'chronicle-page', kind: 'page', view: 'journal' },
  { id: 'session', kind: 'action', targets: ['[data-tour="new-session"]'], side: 'bottom', view: 'journal' },
  { id: 'composer', kind: 'info', targets: ['[data-tour="chronicle-composer"]'], side: 'top', view: 'journal' },
  { id: 'sessions-page', kind: 'page', view: 'sessions' },
  { id: 'extract', kind: 'info', targets: ['[data-tour="tool-extract"]'], side: 'bottom', view: 'sessions' },
  { id: 'illuminate', kind: 'info', targets: ['[data-tour="tool-illuminate"]'], side: 'bottom', view: 'sessions' },
  { id: 'transcribe', kind: 'info', targets: ['[data-tour="tool-transcribe"]'], side: 'bottom', view: 'sessions' },
  { id: 'recap', kind: 'info', targets: ['[data-tour="tool-recap"]'], side: 'bottom', view: 'sessions' },
  { id: 'codex-page', kind: 'page', view: 'capture' },
  { id: 'web-page', kind: 'page', view: 'web' },
  { id: 'lore-page', kind: 'page', view: 'recall' },
  { id: 'counsel-page', kind: 'page', view: 'suggest' },
  { id: 'converse-page', kind: 'page', view: 'converse' },
  { id: 'continuity-page', kind: 'page', view: 'continuity' },
  { id: 'apikey', kind: 'action', targets: ['[data-tour="api-key-card"]'], side: 'bottom', view: 'settings' },
  { id: 'settings-page', kind: 'page', view: 'settings' },
  { id: 'review', kind: 'review', view: 'character' }
]

const nextOf = (id: TutorialStepId): TutorialStepId | null => {
  const i = STEP_DEFS.findIndex((d) => d.id === id)
  return STEP_DEFS[i + 1]?.id ?? null
}

/** Resume guard: absent → fresh install (welcome). Set-but-unknown (hand-edited settings.json, or a
 *  profile from an older step layout) → 'campaign' — a set step proves welcome passed, and the
 *  idempotent action steps fast-forward. */
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
  const rect = useTargetRect(def?.targets ?? null)

  const advance = useCallback((next: TutorialStepId): void => {
    setKeyError(null)
    setStep(next)
    // Fire-and-forget resume pointer — a lost write only costs redoing one step after a crash.
    void ledger.settings.set({ tutorialStep: next }).catch(() => {})
  }, [])

  // Entry side-effect: surface the view the step lives in (every step navigates now — ADR-060).
  useEffect(() => {
    if (def) setActiveView(def.view)
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
    advance('character-page')
  }, [step, campaigns, activeCampaignId, setActiveCampaign, advance])

  useEffect(() => {
    if (step === 'session' && activeSessionId) advance('composer')
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
        if (valid) advance('settings-page')
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

  const header = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-display text-base font-semibold text-foreground">{copy.title}</h2>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Step {STEP_DEFS.indexOf(def) + 1} of {STEP_DEFS.length}
      </span>
    </div>
  )
  const nextRow = (
    <div className="flex justify-end pt-1">
      <Button size="sm" onClick={() => (next ? advance(next) : void finish())}>
        {next ? 'Next' : 'Finish'}
      </Button>
    </div>
  )

  if (def.kind === 'review') {
    return (
      <ReviewShell>
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-semibold text-foreground">{copy.title}</h2>
            <p className="text-sm text-muted-foreground">
              Here&rsquo;s the whole loop, and where everything lives.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="inscribed text-xs">The loop</h3>
            <ul className="space-y-1.5">
              {LOOP_STEPS.map(({ icon: Icon, label, gloss }) => (
                <li key={label} className="flex gap-2.5 text-sm">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-muted-foreground"> — {gloss}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            {(['tour-capture', 'tour-world', 'tour-ask'] as const).map((g) => (
              <div key={g} className="space-y-1">
                <h3 className="inscribed text-xs">{TOUR_GROUPS[g].title}</h3>
                <ul className="space-y-0.5">
                  {TOUR_GROUPS[g].keys.map((k) => {
                    const item = NAV_ITEMS.find((n) => n.key === k)
                    if (!item) return null
                    return (
                      <li key={k} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{item.label}</span> —{' '}
                        {TOOL_BLURBS[k]}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">
            All of this lives in the{' '}
            <span className="font-medium text-foreground">Quickstart guide</span> — the Guide button at
            the bottom-left of the sidebar — whenever you need it.
          </p>

          <p className="text-sm leading-relaxed text-foreground">{REVIEW_COPY.message}</p>

          <div className="flex justify-end">
            <Button onClick={() => void finish()}>Finish</Button>
          </div>
        </div>
      </ReviewShell>
    )
  }

  if (def.kind === 'page') {
    return (
      <PageOverlay
        scrollSelector={def.id === 'settings-page' ? '[data-tour="api-key-card"]' : undefined}
      >
        {header}
        <p className="text-[13px] leading-relaxed text-muted-foreground">{copy.body}</p>
        {nextRow}
      </PageOverlay>
    )
  }

  return (
    <Spotlight rect={rect} interactive={def.kind === 'action'} side={def.side ?? 'right'} wide={def.id === 'apikey'}>
      <div className="space-y-2">
        {header}
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

        {def.kind === 'info' && nextRow}
      </div>
    </Spotlight>
  )
}
