import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookPlus,
  Check,
  ChevronsUpDown,
  Copy,
  KeyRound,
  MessagesSquare,
  RotateCcw,
  Users,
  WifiOff
} from 'lucide-react'
import { ENTITY_TYPE_LABELS, type Entity } from '@shared/entity-types'
import {
  CONVERSE_AIM_LABELS,
  CONVERSE_COST_LABELS,
  CONVERSE_COST_ORDER,
  CONVERSE_TAG_META,
  converseTagLabel,
  type ConverseFailureReason,
  type ConverseQuestion,
  type ConverseTurn
} from '@shared/converse-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useConverse } from '@renderer/hooks/use-converse'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useLensHistory } from '@renderer/hooks/use-lens-history'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { AsOfSelect } from '@renderer/components/AsOfSelect'
import { useLensSave } from '@renderer/components/lens/LensResultBar'
import { LensIdle } from '@renderer/components/lens/LensIdle'
import { LensPromptInfo } from '@renderer/components/lens/LensPromptInfo'
import { CONVERSE_STARTERS } from '@renderer/lib/lens-starters'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { converseProse } from '@renderer/lib/lens-prose'
import { formatRunCost } from '@renderer/lib/format'
import { Banner, EmptyState, PaneBody, PaneHeader, SetupCard } from '@renderer/components/chrome'

// You talk WITH a character (an NPC or a fellow PC), never a place/faction/item.
const CHARACTER_TYPES = ['npc', 'pc'] as const

type Speed = 'quick' | 'deep'

// Converse (the third AI lens): pick a character to talk WITH; Converse proposes a spread of tagged,
// in-character QUESTIONS your active PC could ask to draw them out — funnel-ordered from rapport to
// sensitive. A follow-up loop (ADR-049) continues the conversation: feed back what they said and get
// follow-ups grounded in it. Single-shot per turn, grounded by direct fetch (no model needed). ADR-034.
export function ConverseView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const pendingLens = useUiStore((s) => s.pendingLens)
  const consumePendingLens = useUiStore((s) => s.consumePendingLens)
  const { status: onb } = useOnboarding()
  const converse = useConverse()
  const { entities } = useEntities(activeCampaignId)
  const { sessions } = useSessions(activeCampaignId)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [thread, setThread] = useState('')
  const [speed, setSpeed] = useState<Speed>('quick')
  const [asOf, setAsOf] = useState<number | null>(null)
  // The suggested question the player picked to build a follow-up on (required before following up).
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null)
  const [asked, setAsked] = useState<{ name: string; focus: string }>({ name: '', focus: '' })
  const { entries: recent, remember } = useLensHistory()
  const rememberedRef = useRef(0)

  // Snapshot each completed turn's spread into the cross-session lens history (P1-1). Resets when the
  // thread is cleared (Reset) so a fresh conversation re-remembers correctly.
  useEffect(() => {
    const n = converse.turns.length
    if (n < rememberedRef.current) rememberedRef.current = 0
    while (rememberedRef.current < n) {
      const t = converse.turns[rememberedRef.current]
      remember(
        `Questions for ${asked.name || 'them'}`,
        converseProse(asked.name || 'them', asked.focus || undefined, t.questions)
      )
      rememberedRef.current++
    }
  }, [converse.turns, asked, remember])

  // Seeded from the Web graph (a node → "Prepare questions" for that character). Select the target; the
  // player presses Prepare questions.
  useEffect(() => {
    if (pendingLens?.view === 'converse' && pendingLens.targetId) {
      setTargetId(pendingLens.targetId)
      consumePendingLens()
    }
  }, [pendingLens, consumePendingLens])

  if (!activeCampaignId) {
    return (
      <EmptyState icon={MessagesSquare} title="No campaign selected">
        Choose a campaign in the sidebar to prepare a conversation.
      </EmptyState>
    )
  }

  // Who you can talk WITH: the campaign's NPCs and fellow PCs, never the asking character itself.
  const targets = entities.filter(
    (e) => (e.type === 'npc' || e.type === 'pc') && e.id !== activePcId
  )
  const hasPc = Boolean(activePcId)
  const thinking = converse.status === 'thinking'
  const active = converse.turns.length > 0
  const canSubmit = onb.keyReady && hasPc && !thinking && Boolean(targetId)
  const target = entities.find((e) => e.id === targetId) ?? null

  function submit() {
    if (!canSubmit || !targetId) return
    setAsked({ name: target?.name ?? 'them', focus: thread.trim() })
    setSelectedQuestion(null)
    converse.ask(targetId, thread, { asOfSession: asOf ?? undefined, speed })
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        icon={MessagesSquare}
        title="Converse"
        action={
          <div className="flex items-center gap-1">
            <LensPromptInfo lens="converse" />
            {(Boolean(targetId) || converse.status !== 'idle') && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  converse.reset()
                  setTargetId(null)
                  setThread('')
                  setSelectedQuestion(null)
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        }
      />
      <PaneBody size="reading" className="max-w-4xl">
        {!onb.keyReady ? (
          <SetupCard
            icon={<KeyRound className="size-4" />}
            title="Add your API key to converse"
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
            body="Converse speaks as your main character — set one on the Character page."
            action={
              <Button size="sm" variant="outline" onClick={() => setActiveView('character')}>
                Character page
              </Button>
            }
          />
        ) : null}

        {/* Start a conversation: who, an optional thread, speed + as-of. */}
        <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
          <TargetPicker targets={targets} value={targetId} onChange={setTargetId} />
          <Textarea
            value={thread}
            onChange={(e) => setThread(e.target.value)}
            rows={2}
            placeholder="Optional — a thread to dig into: a person, a topic, a rumor. Leave blank to draw them out generally."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SpeedToggle speed={speed} setSpeed={setSpeed} />
              <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
            </div>
            <Button size="sm" onClick={submit} disabled={!canSubmit}>
              {active ? 'New conversation' : 'Prepare questions'}
            </Button>
          </div>
        </div>

        {/* The conversation thread — oldest first, the follow-up composer at the bottom. */}
        <div className="flex-1 space-y-6 overflow-y-auto">
          {!active && converse.status === 'idle' && (
            <LensIdle starters={CONVERSE_STARTERS} recent={recent} onPick={setThread} />
          )}

          {converse.turns.map((turn, i) => (
            <TurnBlock
              key={i}
              targetName={asked.name || 'them'}
              focus={asked.focus}
              turn={turn}
              onPick={
                i === converse.turns.length - 1 && !thinking ? setSelectedQuestion : undefined
              }
            />
          ))}

          {thinking && (
            <div className="flex flex-col items-center gap-2 pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessagesSquare className="size-4 animate-pulse text-primary" />
                {active
                  ? `Thinking of follow-ups for ${target?.name ?? 'them'}…`
                  : `Weighing what to ask ${target?.name ?? 'them'}…`}
              </div>
              <Button variant="outline" size="sm" onClick={converse.cancel}>
                Stop
              </Button>
            </div>
          )}

          {converse.status === 'error' && (
            <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
              Something went wrong: {converse.error}
            </Banner>
          )}

          {converse.failure && <FailureBanner reason={converse.failure} />}

          {active &&
            !thinking &&
            (selectedQuestion ? (
              <FollowUpBox
                question={selectedQuestion}
                onSend={(answer) => {
                  converse.followUp(selectedQuestion, answer)
                  setSelectedQuestion(null)
                }}
                onChange={() => setSelectedQuestion(null)}
              />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                Pick the question you asked above to follow up.
              </p>
            ))}
        </div>
      </PaneBody>
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
        title="Sonnet — faster questions at the table"
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

/** The "continue the conversation" composer: shows the question you PICKED, you paraphrase their answer,
 *  and the next spread builds on that exchange. */
function FollowUpBox({
  question,
  onSend,
  onChange
}: {
  question: string
  onSend: (answer: string) => void
  onChange: () => void
}) {
  const [answer, setAnswer] = useState('')
  function send() {
    const a = answer.trim()
    if (!a) return
    onSend(a)
    setAnswer('')
  }
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-card/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-foreground/80">
          <span className="inscribed mr-1.5 text-[10px]">You asked</span>
          {`"${question}"`}
        </p>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          change
        </button>
      </div>
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={2}
        autoFocus
        placeholder="What did they say back? Paraphrase it — the follow-ups build on it. e.g. He admits he owes the Zhentarim, but swears he's done with them."
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={send} disabled={!answer.trim()}>
          Follow up
        </Button>
      </div>
    </div>
  )
}

/** One turn in the thread: for a follow-up, the exchange that prompted it (you asked X → they said Y), then
 *  the funnel-ordered spread and per-turn Copy/Inscribe. `onPick` (latest turn only) enables the follow-up. */
function TurnBlock({
  targetName,
  focus,
  turn,
  onPick
}: {
  targetName: string
  focus: string
  turn: ConverseTurn
  onPick?: (question: string) => void
}) {
  const { copy, inscribe } = useLensSave()
  const prose = converseProse(targetName, focus || undefined, turn.questions)
  return (
    <div className="space-y-3">
      {turn.asked && (
        <div className="space-y-1 rounded-md border-l-2 border-primary/40 bg-muted/20 py-1.5 pl-3 pr-2 text-sm leading-relaxed">
          <p className="text-foreground/70">
            <span className="inscribed mr-1.5 text-[10px]">You asked</span>
            {`"${turn.asked.question}"`}
          </p>
          <p className="text-foreground/80">
            <span className="inscribed mr-1.5 text-[10px]">They said</span>
            {turn.asked.answer}
          </p>
        </div>
      )}
      <QuestionSpread questions={turn.questions} onPick={onPick} />
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => copy(prose)}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => inscribe(prose)}
        >
          <BookPlus className="size-3.5" />
          Inscribe
        </Button>
      </div>
      {turn.cost && (
        <p className="text-right font-mono text-[10px] text-muted-foreground">
          {formatRunCost(turn.cost)}
        </p>
      )}
    </div>
  )
}

// A single-select combobox over the campaign's characters (NPCs + fellow PCs), grouped by type.
function TargetPicker({
  targets,
  value,
  onChange
}: {
  targets: Entity[]
  value: string | null
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = targets.find((e) => e.id === value) ?? null
  const groups = CHARACTER_TYPES.map((type) => ({
    type,
    items: targets.filter((e) => e.type === type)
  })).filter((g) => g.items.length > 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={targets.length === 0}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!chosen && 'text-muted-foreground')}>
            {chosen ? chosen.name : 'Choose who to talk with…'}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search characters…" />
          <CommandList>
            <CommandEmpty>No other characters yet.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.type} heading={ENTITY_TYPE_LABELS[g.type]}>
                {g.items.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.id}`}
                    onSelect={() => {
                      onChange(e.id)
                      setOpen(false)
                    }}
                  >
                    <Check className={cn('size-4', value === e.id ? 'opacity-100' : 'opacity-0')} />
                    {e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// The question spread, funnel-ordered by trust cost (rapport-builders first, sensitive probes last),
// stacked in a single wide column (follow-up v2). `onPick` (latest turn only) shows the per-card follow-up.
function QuestionSpread({
  questions,
  onPick
}: {
  questions: ConverseQuestion[]
  onPick?: (question: string) => void
}) {
  const ordered = [...questions].sort(
    (a, b) =>
      CONVERSE_COST_ORDER[CONVERSE_TAG_META[a.tag].cost] -
      CONVERSE_COST_ORDER[CONVERSE_TAG_META[b.tag].cost]
  )
  return (
    <div className="space-y-3">
      {ordered.map((q) => (
        <QuestionCard key={q.tag} q={q} onPick={onPick} />
      ))}
    </div>
  )
}

function QuestionCard({ q, onPick }: { q: ConverseQuestion; onPick?: (question: string) => void }) {
  const meta = CONVERSE_TAG_META[q.tag]
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-primary/15 px-2 py-0.5 font-display text-sm font-medium text-primary">
          {converseTagLabel(q.tag)}
        </span>
        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {CONVERSE_AIM_LABELS[meta.aim]}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {CONVERSE_COST_LABELS[meta.cost]}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed text-foreground/90">{`"${q.question}"`}</p>
      <p className="border-t border-border pt-2 text-xs text-muted-foreground">{q.read}</p>
      {onPick && (
        <button
          type="button"
          onClick={() => onPick(q.question)}
          className="self-start text-xs font-medium text-primary/80 transition-colors hover:text-primary"
        >
          Follow up on this →
        </button>
      )}
    </div>
  )
}

function FailureBanner({ reason }: { reason: ConverseFailureReason }) {
  switch (reason) {
    case 'offline':
      return <Banner icon={<WifiOff className="size-4" />}>{reasonCopy('offline')}</Banner>
    case 'no_key':
      return <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('no_key')}</Banner>
    case 'bad_key':
      return <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('bad_key')}</Banner>
    case 'no_pc':
      return <Banner icon={<Users className="size-4" />}>{reasonCopy('no_pc')}</Banner>
    case 'invalid':
      return (
        <Banner icon={<AlertTriangle className="size-4" />}>
          Couldn&apos;t put together questions — try again, or narrow the thread.
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
