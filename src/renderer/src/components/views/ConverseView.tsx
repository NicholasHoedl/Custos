import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
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
  type ConverseQuestion
} from '@shared/converse-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useConverse } from '@renderer/hooks/use-converse'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
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
import { reasonCopy } from '@renderer/lib/ai-copy'
import { formatRunCost } from '@renderer/lib/format'
import { Banner, EmptyState, PaneHeader, PaneShell, SetupCard } from '@renderer/components/chrome'

// You talk WITH a character (an NPC or a fellow PC), never a place/faction/item.
const CHARACTER_TYPES = ['npc', 'pc'] as const

// Converse (the third AI lens): pick a character to talk WITH; Converse proposes a spread of tagged,
// in-character QUESTIONS your active PC could ask to draw them out — funnel-ordered from rapport to
// sensitive. Single-shot, grounded by direct fetch — mirrors Counsel's shell (no model needed). ADR-034.
export function ConverseView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const converse = useConverse()
  const { entities } = useEntities(activeCampaignId)
  const { sessions } = useSessions(activeCampaignId)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [thread, setThread] = useState('')
  const [asOf, setAsOf] = useState<number | null>(null)

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
  const canSubmit = onb.keyReady && hasPc && !thinking && Boolean(targetId)
  const target = entities.find((e) => e.id === targetId) ?? null

  function submit() {
    if (!canSubmit || !targetId) return
    converse.ask(targetId, thread, asOf ?? undefined)
  }

  return (
    <PaneShell size="reading">
      <PaneHeader
        title="Converse"
        size="lg"
        description="Prepare to draw a character out — a spread of questions to ask them, in your character’s voice."
        action={
          (Boolean(targetId) || converse.status !== 'idle') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                converse.reset()
                setTargetId(null)
                setThread('')
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )
        }
      />

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
          <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {thinking ? 'Thinking…' : 'Prepare questions'}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {converse.status === 'idle' && (
          <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
            Pick who your character wants to talk with. The Keeper readies a spread of questions to ask
            — in your character&apos;s voice, from safe openers to pointed probes.
          </p>
        )}

        {thinking && (
          <div className="flex items-center justify-center gap-2 pt-8 text-sm text-muted-foreground">
            <MessagesSquare className="size-4 animate-pulse text-primary" />
            Weighing what to ask {target?.name ?? 'them'}…
          </div>
        )}

        {converse.status === 'error' && (
          <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
            Something went wrong: {converse.error}
          </Banner>
        )}

        {converse.status === 'done' && converse.result && !converse.result.ok && (
          <FailureBanner reason={converse.result.reason} />
        )}

        {converse.status === 'done' && converse.result?.ok && (
          <QuestionSpread questions={converse.result.questions} />
        )}

        {converse.status === 'done' && converse.result?.ok && converse.result.cost && (
          <p className="text-right font-mono text-[10px] text-muted-foreground">
            {formatRunCost(converse.result.cost)}
          </p>
        )}
      </div>
    </PaneShell>
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

// The question spread, funnel-ordered by trust cost (rapport-builders first, sensitive probes last).
function QuestionSpread({ questions }: { questions: ConverseQuestion[] }) {
  const ordered = [...questions].sort(
    (a, b) =>
      CONVERSE_COST_ORDER[CONVERSE_TAG_META[a.tag].cost] -
      CONVERSE_COST_ORDER[CONVERSE_TAG_META[b.tag].cost]
  )
  return (
    <div className="@container">
      <div className="grid gap-3 @lg:grid-cols-2">
        {ordered.map((q) => (
          <QuestionCard key={q.tag} q={q} />
        ))}
      </div>
    </div>
  )
}

function QuestionCard({ q }: { q: ConverseQuestion }) {
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
      <p className="text-[15px] leading-relaxed text-foreground/90">{q.question}</p>
      <p className="mt-auto border-t border-border pt-2 text-xs text-muted-foreground">{q.read}</p>
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
