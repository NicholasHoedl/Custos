import { useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Compass,
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
  type SuggestPillar
} from '@shared/suggest-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useSuggest } from '@renderer/hooks/use-suggest'
import { useSessions } from '@renderer/hooks/use-ledger'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { AsOfSelect } from '@renderer/components/AsOfSelect'
import { SceneControls } from '@renderer/components/scene/SceneControls'
import { Banner, PaneHeader, ProgressBar, SetupCard } from '@renderer/components/chrome'

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
  const { sessions } = useSessions(activeCampaignId)
  const [asOf, setAsOf] = useState<number | null>(null)
  const [goal, setGoal] = useState('')

  // Switching mode clears any stale result so the output always matches the selected mode.
  function changeMode(m: SuggestMode) {
    setMode(m)
    suggest.reset()
  }

  if (!activeCampaignId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Sparkles className="size-10 text-muted-foreground/50" />
        <div>
          <p className="font-display text-lg font-medium text-foreground">No campaign selected</p>
          <p className="text-sm text-muted-foreground">
            Choose a campaign in the sidebar to seek counsel.
          </p>
        </div>
      </div>
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
    suggest.ask(situation, mode, asOf ?? undefined, goal)
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-4 p-6">
      <PaneHeader
        title="Counsel"
        size="lg"
        description="In-character ideas for the table — how to react now, or where to take the story next."
        action={
          (situation.trim().length > 0 || goal.trim().length > 0 || suggest.status !== 'idle') && (
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
          )
        }
      />

      {!onb.modelReady ? (
        <SetupCard
          icon={<Download className="size-4" />}
          title={
            setupError ? 'Model download failed' : 'Finish setup: download the local search model'
          }
          body={setupError ?? 'A one-time ~30 MB download lets Suggest find the relevant context.'}
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
          title="Add your API key to get suggestions"
          body="Counsel uses Claude to reason in character — add a key to enable it."
          action={
            <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
              Open Settings
            </Button>
          }
        />
      ) : !hasPc ? (
        <SetupCard
          icon={<Users className="size-4" />}
          title="Select your character"
          body="Counsel reasons as a specific PC. Pick an active character in the sidebar."
          action={null}
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
              <div className="flex items-center gap-2">
                <ModeToggle mode={mode} setMode={changeMode} />
                <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
              </div>
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {thinking ? 'Thinking…' : 'Counsel'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === 'attitudes'
                ? 'Six tagged ways to react to this moment, in your character’s voice.'
                : 'Ways to move the story forward — grounded in your open quests and the party.'}
            </p>
          </div>
        </div>

        {/* RIGHT — the counsel. Cards lay out by the pane's own width (container query), not the viewport. */}
        <div className="@container space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {suggest.status === 'idle' && (
            <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
              {mode === 'attitudes'
                ? 'Six tagged options will appear here, drawn from who your character is and what’s happened.'
                : 'Story directions will appear here — grouped by kind, drawn from your open quests, the party, and where you are.'}
            </p>
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
              <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
                {suggest.result.recommendations.map((r) => (
                  <MomentCard key={r.primaryTag} rec={r} />
                ))}
              </div>
            )}

          {suggest.status === 'done' &&
            suggest.result?.ok &&
            suggest.result.mode === 'directions' && (
              <DirectionsList suggestions={suggest.result.suggestions} />
            )}
        </div>
      </div>
    </div>
  )
}

function ModeToggle({
  mode,
  setMode
}: {
  mode: SuggestMode
  setMode: (m: SuggestMode) => void
}) {
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

const PILLAR_ICON: Record<SuggestPillar, LucideIcon> = {
  combat: Swords,
  social: MessagesSquare,
  exploration: Compass
}

function MomentCard({ rec }: { rec: MomentSuggestion }) {
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
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <PillarIcon className="size-3.5" />
          {PILLAR_LABELS[rec.pillar]}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed text-foreground/90">{rec.action}</p>
      <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5">
        <p className="inscribed mb-0.5 text-[10px]">Check</p>
        <p className="text-xs leading-relaxed text-foreground/80">{rec.mechanic}</p>
      </div>
      {rec.teamwork && (
        <div className="rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5">
          <p className="inscribed mb-0.5 text-[10px]">With the party</p>
          <p className="text-xs leading-relaxed text-foreground/80">{rec.teamwork}</p>
        </div>
      )}
      <p className="mt-auto border-t border-border pt-2 text-xs text-muted-foreground">
        {rec.rationale}
      </p>
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
              <h3 className="font-display text-sm font-medium uppercase tracking-wide text-foreground">
                {CATEGORY_LABELS[cat]}
              </h3>
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

function FailureBanner({ reason }: { reason: SuggestFailureReason }) {
  switch (reason) {
    case 'offline':
      return (
        <Banner icon={<WifiOff className="size-4" />}>
          You&apos;re offline — Counsel needs an internet connection to reason in character.
        </Banner>
      )
    case 'no_key':
      return (
        <Banner icon={<KeyRound className="size-4" />}>
          No API key — add one in Settings to enable Counsel.
        </Banner>
      )
    case 'no_model':
      return (
        <Banner icon={<Download className="size-4" />}>
          The local search model is still downloading.
        </Banner>
      )
    case 'no_pc':
      return (
        <Banner icon={<Users className="size-4" />}>
          Select an active character in the sidebar first.
        </Banner>
      )
    case 'invalid':
      return (
        <Banner icon={<AlertTriangle className="size-4" />}>
          Couldn&apos;t put together a clear set — try rephrasing or adding a little more detail.
        </Banner>
      )
    default:
      return (
        <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
          Something went wrong reaching Claude. Try again.
        </Banner>
      )
  }
}

