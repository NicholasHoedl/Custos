import { useState, type ReactNode } from 'react'
import { Check, Circle, Download, KeyRound, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { useSessions } from '@renderer/hooks/use-ledger'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { ProgressBar } from '@renderer/components/chrome'

// Capture-first welcome (O1): guides Create campaign -> Start session (the only steps needed to
// capture), then OFFERS the API key + search model as optional "enables Recall & Suggest" steps.
// Never blocks capture. Steps tie off by their live signals; dismissible once a campaign exists.

const DISMISS_KEY = 'ledger.onboardingDismissed'

export function OnboardingChecklist() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveCampaign = useAppStore((s) => s.setActiveCampaign)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb, progress, downloading, download } = useOnboarding()
  const { sessions } = useSessions(activeCampaignId)
  const [name, setName] = useState('')
  const [mcName, setMcName] = useState('')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  const hasCampaign = activeCampaignId !== null
  const hasSession = sessions.length > 0
  const done = hasCampaign && hasSession && onb.keyReady && onb.modelReady
  // All done, or dismissed once there's a campaign to fall back to. Before a campaign exists the
  // welcome stays (dismissing into an empty app helps no one — the Sidebar can also create one).
  if (done || (dismissed && hasCampaign)) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  async function createCampaign() {
    const n = name.trim()
    const mc = mcName.trim()
    // Every campaign is created WITH its mandatory main character (ADR-029).
    if (!n || !mc || busy) return
    setBusy(true)
    try {
      const c = await ledger.campaign.create({ name: n, mainCharacterName: mc })
      setActiveCampaign(c.id) // the Sidebar's MainCharacterBadge reseeds the lens from the new MC
      useUiStore.getState().bumpCampaigns()
      setName('')
      setMcName('')
      toast.success('Campaign created', { description: n })
    } catch (err) {
      toast.error('Could not create campaign', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function startSession() {
    if (!activeCampaignId || busy) return
    setBusy(true)
    try {
      const s = await ledger.session.create({ campaignId: activeCampaignId })
      setActiveSession(s.id)
      useUiStore.getState().bumpSessions()
      toast.success(`Session ${s.number} started`)
    } catch (err) {
      toast.error('Could not start session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const downloadingModel = downloading || progress?.status === 'downloading'

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="font-display text-lg font-semibold text-foreground">Welcome to Ledger</h2>
        </div>
        {hasCampaign && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss welcome"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        A couple of steps to get going. Capture works right away — the AI steps are optional.
      </p>

      <ol className="mt-3 space-y-2.5">
        <Step done={hasCampaign} label="Create a campaign">
          {!hasCampaign && (
            <div className="space-y-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Campaign name…"
                autoFocus
                className="h-8"
              />
              <Input
                value={mcName}
                onChange={(e) => setMcName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    createCampaign()
                  }
                }}
                placeholder="Main character's name…"
                className="h-8"
              />
              <Button
                size="sm"
                onClick={createCampaign}
                disabled={!name.trim() || !mcName.trim() || busy}
              >
                Create
              </Button>
            </div>
          )}
        </Step>

        <Step done={hasSession} label="Start your first session">
          {hasCampaign && !hasSession && (
            <Button size="sm" onClick={startSession} disabled={busy}>
              Start session 1
            </Button>
          )}
          {!hasCampaign && (
            <span className="text-xs text-muted-foreground">Create a campaign first.</span>
          )}
        </Step>

        <Step done={onb.keyReady} label="Add an API key" hint="enables Recall & Suggest">
          {!onb.keyReady && (
            <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
              <KeyRound className="size-3.5" />
              Open Settings
            </Button>
          )}
        </Step>

        <Step done={onb.modelReady} label="Download the search model" hint="~30 MB, powers semantic search">
          {!onb.modelReady &&
            (downloadingModel ? (
              <ProgressBar progress={progress} />
            ) : (
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="size-3.5" />
                Download
              </Button>
            ))}
        </Step>
      </ol>
    </div>
  )
}

function Step({
  done,
  label,
  hint,
  children
}: {
  done: boolean
  label: string
  /** Present ⇒ the step is optional; the hint says what it unlocks. */
  hint?: string
  children?: ReactNode
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cn('mt-0.5 shrink-0', done ? 'text-primary' : 'text-muted-foreground/40')}>
        {done ? <Check className="size-4" /> : <Circle className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span
            className={cn(
              'text-sm font-medium',
              done ? 'text-muted-foreground line-through' : 'text-foreground'
            )}
          >
            {label}
          </span>
          {hint && (
            <>
              <span className="rounded bg-muted/60 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                optional
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </>
          )}
        </div>
        {!done && children}
      </div>
    </li>
  )
}
