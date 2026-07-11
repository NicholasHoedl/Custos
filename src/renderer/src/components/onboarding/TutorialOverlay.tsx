import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Session } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useSettings } from '@renderer/hooks/use-settings'
import { NAV_ITEMS, type NavItem } from '@renderer/lib/nav-items'
import { CloseOutDialog } from '@renderer/components/capture/CloseOutDialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import { Banner } from '@renderer/components/chrome'

// The forced first-run tutorial (ADR-044) — a non-skippable, guided modal wizard mounted in AppShell.
// It creates a real campaign + main character + session, teaches the capture→close-out loop by running a
// REAL close-out, and tours every tool. There is no close/Esc/skip; only Back and the step's primary
// action advance. On finish it persists `tutorialCompleted`, retires the legacy onboarding cards, and
// lands the user on the Chronicle with a campaign, character, and Session 1 ready to write into.

const STEPS = [
  'welcome',
  'campaign',
  'character',
  'session',
  'chronicle',
  'apikey',
  'closeout',
  'tour-capture',
  'tour-world',
  'tour-ask',
  'done'
] as const
type Step = (typeof STEPS)[number]

/** One-line "what it's for" per nav view, keyed by NAV_ITEMS.key — used by the tool tour. */
const TOOL_BLURBS: Record<string, string> = {
  journal:
    "Jot what happens as you play — one plain line at a time. You'll spend most of your time here.",
  sessions:
    'Each game night is a session. Review it, get a "previously on…" recap, and run Illuminate to enrich your world from its notes.',
  character:
    "Your main character's home — their profile, backstory, persona, and voice (the voice the Keeper speaks in).",
  capture:
    'Your world library: every person, place, faction, quest, and item. Browse, edit, and inscribe new entries.',
  web: "A living map of how everyone and everything connects — a force-directed graph of your campaign's relationships.",
  recall:
    'Ask a question in plain language; get a cited answer drawn from your own notes. (Needs the search model — download it in Settings.)',
  suggest:
    'Stuck in the moment? Get in-character ideas for what your character might do — tagged and grounded in the scene.',
  converse:
    'About to talk to someone? Get a spread of in-character questions to draw them out, from safe openers to pointed probes.'
}

const TOUR_GROUPS: Record<'tour-capture' | 'tour-world' | 'tour-ask', { title: string; keys: string[] }> =
  {
    'tour-capture': { title: 'Capture the story', keys: ['journal', 'sessions'] },
    'tour-world': { title: 'Your world', keys: ['character', 'capture', 'web'] },
    'tour-ask': { title: 'Ask the Keeper', keys: ['recall', 'suggest', 'converse'] }
  }

export function TutorialOverlay({ onDone }: { onDone: () => void }) {
  const setActiveCampaign = useAppStore((s) => s.setActiveCampaign)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const bumpCampaigns = useUiStore((s) => s.bumpCampaigns)
  const bumpSessions = useUiStore((s) => s.bumpSessions)
  const { update } = useSettings()

  const [stepIndex, setStepIndex] = useState(0)
  const step: Step = STEPS[stepIndex]

  const [name, setName] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [mcName, setMcName] = useState('')
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [entries, setEntries] = useState<string[]>([])
  const [entryDraft, setEntryDraft] = useState('')

  const [keyDraft, setKeyDraft] = useState('')
  const [validating, setValidating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const [closeOutOpen, setCloseOutOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Auto-create the first session once the campaign exists and we reach the session step.
  useEffect(() => {
    if (step !== 'session' || !campaignId || session) return
    setBusy(true)
    ledger.session
      .create({ campaignId })
      .then((s) => {
        setSession(s)
        setActiveSession(s.id)
        bumpSessions()
      })
      .catch((e) => toast.error('Could not start a session', { description: String(e) }))
      .finally(() => setBusy(false))
  }, [step, campaignId, session, setActiveSession, bumpSessions])

  const advance = (): void => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const back = (): void => setStepIndex((i) => Math.max(i - 1, 0))

  async function createCampaign(): Promise<void> {
    if (campaignId) return advance() // idempotent: created already (e.g. Back then Next)
    setBusy(true)
    try {
      const c = await ledger.campaign.create({
        name: campaignName.trim(),
        mainCharacterName: mcName.trim()
      })
      setCampaignId(c.id)
      setActiveCampaign(c.id) // Mc lens auto-locks via the sidebar MainCharacterBadge
      bumpCampaigns()
      advance()
    } catch (e) {
      toast.error('Could not create the campaign', { description: String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function addEntry(): Promise<void> {
    const content = entryDraft.trim()
    if (!content || !session) return
    setBusy(true)
    try {
      await ledger.event.create({ sessionId: session.id, content })
      setEntries((e) => [...e, content])
      setEntryDraft('')
      bumpSessions()
    } catch (e) {
      toast.error('Could not add the entry', { description: String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function verifyKey(): Promise<void> {
    const key = keyDraft.trim()
    if (!key) return
    setValidating(true)
    setKeyError(null)
    try {
      await ledger.apikey.set(key)
      const { valid } = await ledger.apikey.validate()
      if (valid) advance()
      else setKeyError('That key was rejected. Check it and try again.')
    } catch (e) {
      setKeyError(`Couldn't verify the key: ${String(e)}`)
    } finally {
      setValidating(false)
    }
  }

  async function finish(): Promise<void> {
    await update({ userName: name.trim(), tutorialCompleted: true })
    // The forced tutorial supersedes the legacy optional cards — retire them so they don't re-nag.
    localStorage.setItem('ledger.onboardingDismissed', '1')
    localStorage.setItem('ledger.loopExplainerDismissed', '1')
    setActiveView('journal')
    onDone()
  }

  // ---- per-step gating for the generic Next button ----
  const canProceed = (): boolean => {
    switch (step) {
      case 'welcome':
        return name.trim().length > 0
      case 'campaign':
        return campaignName.trim().length > 0
      case 'character':
        return mcName.trim().length > 0
      case 'session':
        return session !== null
      case 'chronicle':
        return entries.length > 0
      default:
        return true
    }
  }

  const stepNumber = stepIndex + 1
  const totalSteps = STEPS.length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="First-run tutorial"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/98 p-6"
    >
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-6 py-4">
          <BookOpen className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold text-foreground">
            Welcome to Ledger
          </span>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Step {stepNumber} of {totalSteps}
          </span>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <StepBody
            step={step}
            name={name}
            setName={setName}
            campaignName={campaignName}
            setCampaignName={setCampaignName}
            mcName={mcName}
            setMcName={setMcName}
            entries={entries}
            entryDraft={entryDraft}
            setEntryDraft={setEntryDraft}
            addEntry={addEntry}
            keyDraft={keyDraft}
            setKeyDraft={setKeyDraft}
            keyError={keyError}
            busy={busy}
            session={session}
            onOpenCloseOut={() => setCloseOutOpen(true)}
          />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          {stepIndex > 0 && step !== 'done' ? (
            <Button variant="ghost" size="sm" onClick={back} disabled={busy || validating}>
              Back
            </Button>
          ) : (
            <span />
          )}

          {step === 'apikey' ? (
            <Button onClick={() => void verifyKey()} disabled={!keyDraft.trim() || validating}>
              {validating && <Loader2 className="size-4 animate-spin" />}
              Verify &amp; continue
            </Button>
          ) : step === 'closeout' ? (
            <span className="text-xs text-muted-foreground">
              Open the close-out to continue — it advances when you finish.
            </span>
          ) : step === 'done' ? (
            <Button onClick={() => void finish()}>Start writing</Button>
          ) : step === 'character' ? (
            <Button onClick={() => void createCampaign()} disabled={!canProceed() || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create campaign
            </Button>
          ) : (
            <Button onClick={advance} disabled={!canProceed() || busy}>
              Next
            </Button>
          )}
        </footer>
      </div>

      {/* The REAL close-out wizard, opened from step 7. Radix portals it above this z-40 overlay. On close
          (done or its own graceful exit) we advance — never trapping the user. */}
      {step === 'closeout' && session && (
        <CloseOutDialog
          session={session}
          open={closeOutOpen}
          onOpenChange={(o) => {
            setCloseOutOpen(o)
            if (!o) advance()
          }}
        />
      )}
    </div>
  )
}

function StepBody(props: {
  step: Step
  name: string
  setName: (v: string) => void
  campaignName: string
  setCampaignName: (v: string) => void
  mcName: string
  setMcName: (v: string) => void
  entries: string[]
  entryDraft: string
  setEntryDraft: (v: string) => void
  addEntry: () => void
  keyDraft: string
  setKeyDraft: (v: string) => void
  keyError: string | null
  busy: boolean
  session: Session | null
  onOpenCloseOut: () => void
}): React.ReactElement {
  const { step } = props
  switch (step) {
    case 'welcome':
      return (
        <Field
          title="First — what should the Keeper call you?"
          hint="The Keeper is your AI chronicler. This is just so it can greet you by name."
        >
          <Label htmlFor="tut-name">Your name</Label>
          <Input
            id="tut-name"
            autoFocus
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="e.g. Alex"
          />
        </Field>
      )
    case 'campaign':
      return (
        <Field
          title="Every game lives in a campaign."
          hint="One ongoing story and its cast. You can make more later."
        >
          <Label htmlFor="tut-campaign">Campaign name</Label>
          <Input
            id="tut-campaign"
            autoFocus
            value={props.campaignName}
            onChange={(e) => props.setCampaignName(e.target.value)}
            placeholder="e.g. The Lost Mine of Phandelver"
          />
        </Field>
      )
    case 'character':
      return (
        <Field
          title="You play one hero — your main character."
          hint="They're the voice the Keeper speaks in, and the centre of your campaign. Who are they?"
        >
          <Label htmlFor="tut-mc">Main character's name</Label>
          <Input
            id="tut-mc"
            autoFocus
            value={props.mcName}
            onChange={(e) => props.setMcName(e.target.value)}
            placeholder="e.g. Vargas Stormcloak"
          />
        </Field>
      )
    case 'session':
      return (
        <Field
          title="A session is one night at the table."
          hint="We've started your first — everything you record lands in it until you close it out."
        >
          <p className="text-sm text-foreground">
            {props.session ? (
              <>
                <span className="font-medium text-primary">Session {props.session.number}</span>{' '}
                started. Ready when you are.
              </>
            ) : (
              'Starting your first session…'
            )}
          </p>
        </Field>
      )
    case 'chronicle':
      return (
        <Field
          title="As you play, jot what happens — one line at a time."
          hint="This is the Chronicle. Plain notes; the Keeper turns them into structured memory later. Add at least one to continue."
        >
          <Textarea
            rows={2}
            value={props.entryDraft}
            onChange={(e) => props.setEntryDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') props.addEntry()
            }}
            placeholder="e.g. The party met Aldric in the tavern and struck a deal."
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={props.addEntry} disabled={!props.entryDraft.trim() || props.busy}>
              Add
            </Button>
          </div>
          {props.entries.length > 0 && (
            <ul className="space-y-1 rounded-md border border-border bg-background/50 p-2">
              {props.entries.map((e, i) => (
                <li key={i} className="text-sm text-foreground/90">
                  • {e}
                </li>
              ))}
            </ul>
          )}
        </Field>
      )
    case 'apikey':
      return (
        <Field
          title="Ledger's memory is powered by Claude."
          hint="Paste your Anthropic API key. It's stored encrypted on this device and only ever used to call Anthropic. This step is required to continue."
        >
          <Label htmlFor="tut-key">Anthropic API key</Label>
          <Input
            id="tut-key"
            type="password"
            autoFocus
            value={props.keyDraft}
            onChange={(e) => props.setKeyDraft(e.target.value)}
            placeholder="sk-ant-…"
          />
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            Get a key at console.anthropic.com <ExternalLink className="size-3" />
          </a>
          {props.keyError && (
            <Banner tone="destructive" icon={<AlertTriangle className="size-4" />}>
              {props.keyError}
            </Banner>
          )}
        </Field>
      )
    case 'closeout':
      return (
        <Field
          title="Now turn your log into memory: close out the session."
          hint="The Keeper reads your whole chronicle and proposes the entities, notes, and status changes to record — then Illuminate fills in relationships. You review everything before it's saved."
        >
          <Button onClick={props.onOpenCloseOut}>Close out session</Button>
        </Field>
      )
    case 'tour-capture':
    case 'tour-world':
    case 'tour-ask':
      return <ToolTour group={step} />
    case 'done':
      return (
        <Field
          title={`You're all set${props.name.trim() ? `, ${props.name.trim()}` : ''}.`}
          hint={`Your campaign "${props.campaignName}" is ready with ${props.mcName} and Session ${props.session?.number ?? 1}. Jump into the Chronicle and start writing — the loop you just learned is the whole rhythm of the tool.`}
        >
          <p className="text-sm text-muted-foreground">
            The AI lenses (Lore, Counsel, Converse) and the search model can be tuned any time in
            Settings.
          </p>
        </Field>
      )
  }
}

function ToolTour({ group }: { group: 'tour-capture' | 'tour-world' | 'tour-ask' }): React.ReactElement {
  const { title, keys } = TOUR_GROUPS[group]
  const items = keys
    .map((k) => NAV_ITEMS.find((n) => n.key === k))
    .filter((n): n is NavItem => Boolean(n))
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">Here's what lives in the sidebar.</p>
      </div>
      <ul className="space-y-3">
        {items.map(({ key, label, icon: Icon }) => (
          <li key={key} className="flex gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
              <Icon className="size-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-sm text-muted-foreground">{TOOL_BLURBS[key]}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  title,
  hint,
  children
}: {
  title: string
  hint: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
