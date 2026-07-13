import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Compass,
  Dices,
  Download,
  Flag,
  Heart,
  KeyRound,
  MapPin,
  MessagesSquare,
  Package,
  RotateCcw,
  ScrollText,
  Sparkles,
  Swords,
  User,
  Users,
  WifiOff,
  type LucideIcon
} from 'lucide-react'
import {
  CATEGORY_LABELS,
  PILLAR_LABELS,
  SUGGEST_CATEGORIES,
  tagLabel,
  type MomentSuggestion,
  type StorySuggestion,
  type SuggestCategory,
  type SuggestFailureReason,
  type SuggestMode,
  type SuggestPillar,
  type SuggestResult
} from '@shared/suggest-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useSuggest } from '@renderer/hooks/use-suggest'
import { useSessions } from '@renderer/hooks/use-ledger'
import { useLensHistory } from '@renderer/hooks/use-lens-history'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { AsOfSelect } from '@renderer/components/AsOfSelect'
import { SceneControls } from '@renderer/components/scene/SceneControls'
import { LensResultBar } from '@renderer/components/lens/LensResultBar'
import { LensIdle } from '@renderer/components/lens/LensIdle'
import { SUGGEST_STARTERS } from '@renderer/lib/lens-starters'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { directionsProse, momentsProse } from '@renderer/lib/lens-prose'
import { formatRunCost } from '@renderer/lib/format'
import {
  Banner,
  EmptyState,
  InfoPopover,
  PaneHeader,
  ProgressBar,
  SetupCard
} from '@renderer/components/chrome'

type Speed = 'quick' | 'deep'

/** Preset nudges for the per-moment re-roll — each re-asks the same moment reshaped toward it. */
const REFINE_NUDGES = ['Bolder', 'More cautious', 'De-escalate', 'Fresh angle'] as const

const CATEGORY_ICONS: Record<SuggestCategory, LucideIcon> = {
  quest: ScrollText,
  npc: User,
  location: MapPin,
  party: Users,
  personal: Heart,
  story: BookOpen,
  faction: Flag,
  item: Package
}

export function SuggestView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb, progress, downloading, error: setupError, download } = useOnboarding()
  const suggest = useSuggest()
  const [situation, setSituation] = useState('')
  const [mode, setMode] = useState<SuggestMode>('attitudes')
  const [speed, setSpeed] = useState<Speed>('quick')
  const { sessions } = useSessions(activeCampaignId)
  const [asOf, setAsOf] = useState<number | null>(null)
  const [goal, setGoal] = useState('')
  const [asked, setAsked] = useState('')
  const { entries: recent, remember } = useLensHistory()
  const rememberedRef = useRef<SuggestResult | null>(null)

  // Prose for the current result (Copy/Inscribe), and a snapshot into history once it's done (P1-1).
  const prose =
    suggest.status === 'done' && suggest.result?.ok
      ? suggest.result.mode === 'attitudes'
        ? momentsProse(asked, suggest.result.recommendations)
        : directionsProse(asked, suggest.result.suggestions)
      : null
  useEffect(() => {
    const r = suggest.result
    if (suggest.status === 'done' && r?.ok && r !== rememberedRef.current) {
      rememberedRef.current = r
      const label = asked || (r.mode === 'attitudes' ? 'In the moment' : 'What’s next')
      remember(
        label,
        r.mode === 'attitudes'
          ? momentsProse(asked, r.recommendations)
          : directionsProse(asked, r.suggestions)
      )
    }
  }, [suggest.status, suggest.result, asked, remember])

  // Switching mode clears any stale result so the output always matches the selected mode.
  function changeMode(m: SuggestMode) {
    setMode(m)
    suggest.reset()
  }

  if (!activeCampaignId) {
    return (
      <EmptyState icon={Sparkles} title="No campaign selected">
        Choose a campaign in the sidebar to seek counsel.
      </EmptyState>
    )
  }

  const hasPc = Boolean(activePcId)
  const thinking = suggest.status === 'thinking'
  const needsSituation = mode === 'attitudes'
  const canSubmit =
    onb.modelReady &&
    onb.keyReady &&
    hasPc &&
    !thinking &&
    (!needsSituation || Boolean(situation.trim()))

  function submit() {
    if (!canSubmit) return
    setAsked(situation.trim())
    suggest.ask(situation, mode, { asOfSession: asOf ?? undefined, goal, speed })
  }

  // Re-roll the spread reshaped toward a nudge (attitudes only) — reuses the same moment, scene, and
  // speed, passing the current six as `previous` so the model returns genuinely different options.
  function refine(nudge: string) {
    const r = suggest.result
    if (thinking || !asked || !(r?.ok && r.mode === 'attitudes')) return
    suggest.ask(asked, 'attitudes', {
      asOfSession: asOf ?? undefined,
      goal,
      speed,
      refinement: nudge,
      previous: r.recommendations
    })
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        icon={Sparkles}
        title="Counsel"
        action={
          <div className="flex items-center gap-1">
            <CounselInfo />
            {(situation.trim().length > 0 ||
              goal.trim().length > 0 ||
              suggest.status !== 'idle') && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  suggest.reset()
                  setSituation('')
                  setGoal('')
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        }
      />
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 p-6">
        {!onb.modelReady ? (
          <SetupCard
            icon={<Download className="size-4" />}
            title={
              setupError ? 'Model download failed' : 'Finish setup: download the local search model'
            }
            body={
              setupError ?? 'A one-time ~30 MB download lets Counsel find the relevant context.'
            }
            action={
              progress?.status === 'downloading' || downloading ? (
                <ProgressBar progress={progress} />
              ) : (
                <Button size="sm" onClick={download}>
                  {setupError ? 'Retry' : 'Download model'}
                </Button>
              )
            }
          />
        ) : !onb.keyReady ? (
          <SetupCard
            icon={<KeyRound className="size-4" />}
            title="Add your API key to get counsel"
            body="The Keeper reasons in your character’s voice — add a key in Settings to enable it."
            action={
              <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
                Open Settings
              </Button>
            }
          />
        ) : !hasPc ? (
          <SetupCard
            icon={<Users className="size-4" />}
            title="Set your main character"
            body="Counsel speaks as your main character — set one on the Character page."
            action={
              <Button size="sm" variant="outline" onClick={() => setActiveView('character')}>
                Character page
              </Button>
            }
          />
        ) : null}

        {/* Controls on the left, the counsel on the right. Collapses to a single column below lg. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:flex-row lg:gap-6 lg:overflow-visible">
          {/* LEFT — the scene you're in and the moment you're asking about. */}
          <div className="flex shrink-0 flex-col gap-4 lg:w-[360px] lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {/* The scene (where the party is, who's present, the mode) — pinned into Suggest's grounding. */}
            <SceneControls campaignId={activeCampaignId} />

            <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
              {mode === 'attitudes' && (
                <Input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Optional goal — what are you trying to achieve? e.g. learn where Glasstaff is"
                  className="text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                />
              )}
              <Textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={3}
                placeholder={
                  mode === 'attitudes'
                    ? "e.g. The mayor just admitted he's been paying off the Redbrands. The party turns to you."
                    : 'Optional — where do things stand? e.g. We just got back to Phandalin after clearing the hideout.'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ModeToggle mode={mode} setMode={changeMode} />
                  <SpeedToggle speed={speed} setSpeed={setSpeed} />
                  <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
                </div>
                {thinking ? (
                  <Button variant="outline" size="sm" onClick={suggest.cancel}>
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" onClick={submit} disabled={!canSubmit}>
                    Seek counsel
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — the counsel. Cards lay out by the pane's own width (container query), not the viewport. */}
          <div className="@container space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {(prose || recent.length > 0) && <LensResultBar prose={prose} history={recent} />}

            {suggest.status === 'idle' && (
              <LensIdle starters={SUGGEST_STARTERS} recent={recent} onPick={setSituation} />
            )}

            {thinking && (
              <div className="flex items-center justify-center gap-2 pt-8 text-sm text-muted-foreground">
                <Sparkles className="size-4 animate-pulse text-primary" />
                {mode === 'attitudes'
                  ? 'Weighing how your character would react…'
                  : 'Looking for where your character would take things…'}
              </div>
            )}

            {suggest.status === 'error' && (
              <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                Something went wrong: {suggest.error}
              </Banner>
            )}

            {suggest.status === 'done' && suggest.result && !suggest.result.ok && (
              <FailureBanner reason={suggest.result.reason} />
            )}

            {suggest.status === 'done' &&
              suggest.result?.ok &&
              suggest.result.mode === 'attitudes' && (
                <div className="space-y-4">
                  <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
                    {suggest.result.recommendations.map((r) => (
                      <MomentCard key={r.primaryTag} rec={r} />
                    ))}
                  </div>
                  {/* Re-roll the same moment, nudged — replaces the spread rather than stacking a transcript. */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    <span className="inscribed text-[10px]">Refine</span>
                    {REFINE_NUDGES.map((n) => (
                      <Button
                        key={n}
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full text-xs font-normal"
                        onClick={() => refine(n)}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

            {suggest.status === 'done' &&
              suggest.result?.ok &&
              suggest.result.mode === 'directions' && (
                <DirectionsList suggestions={suggest.result.suggestions} />
              )}

            {suggest.status === 'done' && suggest.result?.ok && suggest.result.cost && (
              <p className="text-right font-mono text-[10px] text-muted-foreground">
                {formatRunCost(suggest.result.cost)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeToggle({ mode, setMode }: { mode: SuggestMode; setMode: (m: SuggestMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode('attitudes')}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          mode === 'attitudes'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        In the moment
      </button>
      <button
        type="button"
        onClick={() => setMode('directions')}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          mode === 'directions'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        What&apos;s next
      </button>
    </div>
  )
}

/** Quick (Sonnet — table-fast) vs Deep (the Settings "Counsel model" — fuller reasoning). Per-query. */
function SpeedToggle({ speed, setSpeed }: { speed: Speed; setSpeed: (s: Speed) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setSpeed('quick')}
        title="Sonnet — faster options at the table"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'quick'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Quick
      </button>
      <button
        type="button"
        onClick={() => setSpeed('deep')}
        title="Your Settings model — fuller reasoning"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'deep'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Deep
      </button>
    </div>
  )
}

const PILLAR_ICON: Record<SuggestPillar, LucideIcon> = {
  combat: Swords,
  social: MessagesSquare,
  exploration: Compass
}

// Compact by default so six cards scan fast under table pressure: the front carries the tag(s), the
// concrete action, and a prominent 5e-mechanic badge; pillar/teamwork/rationale tuck behind a per-card
// expand (the house Button+Chevron idiom — no Collapsible primitive exists).
function MomentCard({ rec }: { rec: MomentSuggestion }) {
  const [expanded, setExpanded] = useState(false)
  const PillarIcon = PILLAR_ICON[rec.pillar]
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-primary/15 px-2 py-0.5 font-display text-sm font-medium text-primary">
          {tagLabel(rec.primaryTag)}
        </span>
        {rec.secondaryTags.map((t) => (
          <span
            key={t}
            className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {tagLabel(t)}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide details' : 'Show details'}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      <p className="text-[15px] leading-relaxed text-foreground/90">{rec.action}</p>
      <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary/90">
        <Dices className="size-3.5 shrink-0" />
        <span className="leading-snug">{rec.mechanic}</span>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <PillarIcon className="size-3.5" />
            {PILLAR_LABELS[rec.pillar]}
          </div>
          {rec.teamwork && (
            <div className="rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5">
              <p className="inscribed mb-0.5 text-[10px]">With the party</p>
              <p className="text-xs leading-relaxed text-foreground/80">{rec.teamwork}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{rec.rationale}</p>
        </div>
      )}
    </div>
  )
}

function DirectionsList({ suggestions }: { suggestions: StorySuggestion[] }) {
  // Group by category, in the canonical category order; only render categories with suggestions.
  const groups = SUGGEST_CATEGORIES.map((cat) => ({
    cat,
    items: suggestions.filter((s) => s.category === cat)
  })).filter((g) => g.items.length > 0)

  return (
    <div className="space-y-5">
      {groups.map(({ cat, items }) => {
        const Icon = CATEGORY_ICONS[cat]
        return (
          <section key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              <h3 className="inscribed text-xs">{CATEGORY_LABELS[cat]}</h3>
            </div>
            <ul className="space-y-2">
              {items.map((s, i) => (
                <li key={i} className="rounded-lg border border-border bg-card/60 p-3">
                  <p className="text-[15px] leading-relaxed text-foreground/90">{s.suggestion}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function CounselInfo() {
  return (
    <InfoPopover label="About Counsel">
      <p className="text-sm font-medium text-foreground">What Counsel does</p>
      <p className="text-muted-foreground">
        Reads your main character and the campaign and offers ideas in their voice — six tagged ways
        to react to a moment, or story directions grounded in your open quests and the party. It
        reasons as your character; it doesn&apos;t roll dice or decide outcomes.
      </p>
      <p className="text-sm font-medium text-foreground">Get the best results</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        <li>Set the scene — where you are and who&apos;s present sharpens the read.</li>
        <li>Describe a concrete moment, not a vague situation.</li>
        <li>Name a goal to bias the options toward it.</li>
        <li>Use “as of” to ask without spoiling what your character doesn&apos;t know yet.</li>
      </ul>
    </InfoPopover>
  )
}

function FailureBanner({ reason }: { reason: SuggestFailureReason }) {
  switch (reason) {
    case 'offline':
      return <Banner icon={<WifiOff className="size-4" />}>{reasonCopy('offline')}</Banner>
    case 'no_key':
      return <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('no_key')}</Banner>
    case 'bad_key':
      return <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('bad_key')}</Banner>
    case 'no_model':
      return <Banner icon={<Download className="size-4" />}>{reasonCopy('no_model')}</Banner>
    case 'no_pc':
      return <Banner icon={<Users className="size-4" />}>{reasonCopy('no_pc')}</Banner>
    case 'invalid':
      return (
        <Banner icon={<AlertTriangle className="size-4" />}>
          Couldn&apos;t put together a clear set — try rephrasing or adding a little more detail.
        </Banner>
      )
    default:
      return (
        <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
          {reasonCopy('api')}
        </Banner>
      )
  }
}
