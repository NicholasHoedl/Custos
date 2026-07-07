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
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type Entity } from '@shared/entity-types'
import type {
  ConverseBriefing,
  ConverseFailureReason,
  ConverseQuestion
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
import { Banner, PaneHeader, PaneShell, SetupCard } from '@renderer/components/chrome'

// Converse (the third AI lens): pick a TARGET character; Converse briefs you on what's known/suspected
// about them and their connections, then proposes in-character questions your active PC could ask to
// draw them out. Single-shot, grounded by direct fetch — mirrors Counsel's shell (no model needed).
export function ConverseView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const converse = useConverse()
  const { entities } = useEntities(activeCampaignId)
  const { sessions } = useSessions(activeCampaignId)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [focus, setFocus] = useState('')
  const [asOf, setAsOf] = useState<number | null>(null)

  if (!activeCampaignId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <MessagesSquare className="size-10 text-muted-foreground/50" />
        <div>
          <p className="font-display text-lg font-medium text-foreground">No saga selected</p>
          <p className="text-sm text-muted-foreground">
            Choose a saga in the sidebar to prepare a conversation.
          </p>
        </div>
      </div>
    )
  }

  const hasPc = Boolean(activePcId)
  const thinking = converse.status === 'thinking'
  const canSubmit = onb.keyReady && hasPc && !thinking && Boolean(targetId)
  const target = entities.find((e) => e.id === targetId) ?? null

  function submit() {
    if (!canSubmit || !targetId) return
    converse.ask(targetId, focus, asOf ?? undefined)
  }

  return (
    <PaneShell size="reading">
      <PaneHeader
        title="Converse"
        size="lg"
        description="Prepare to draw a character out — what's known and suspected about them, then questions to ask in character."
        action={
          (Boolean(targetId) || converse.status !== 'idle') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                converse.reset()
                setTargetId(null)
                setFocus('')
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
          body="Converse uses Claude to reason in character — add a key to enable it."
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
          body="Converse speaks as a specific PC. Pick an active character in the sidebar."
          action={null}
        />
      ) : null}

      <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
        <TargetPicker entities={entities} value={targetId} onChange={setTargetId} />
        <Textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={2}
          placeholder="Optional — a thread to steer toward, e.g. their ties to the Redbrands, or why they were at the mine."
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
            {thinking ? 'Thinking…' : 'Converse'}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {converse.status === 'idle' && (
          <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
            Pick who your character wants to draw out. You&apos;ll get a briefing on them, then questions
            to ask — in your character&apos;s voice.
          </p>
        )}

        {thinking && (
          <div className="flex items-center justify-center gap-2 pt-8 text-sm text-muted-foreground">
            <MessagesSquare className="size-4 animate-pulse text-primary" />
            Weighing what you know about {target?.name ?? 'them'}…
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
          <ConverseAnswer
            briefing={converse.result.briefing}
            questions={converse.result.questions}
            targetName={target?.name ?? 'them'}
          />
        )}
      </div>
    </PaneShell>
  )
}

// A single-select combobox over ALL campaign entities, grouped by type (adapts SceneControls' picker).
function TargetPicker({
  entities,
  value,
  onChange
}: {
  entities: Entity[]
  value: string | null
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = entities.find((e) => e.id === value) ?? null
  const groups = ENTITY_TYPES.map((type) => ({
    type,
    items: entities.filter((e) => e.type === type)
  })).filter((g) => g.items.length > 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={entities.length === 0}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!chosen && 'text-muted-foreground')}>
            {chosen ? chosen.name : 'Choose who to draw out…'}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search characters, places, things…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
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

function ConverseAnswer({
  briefing,
  questions,
  targetName
}: {
  briefing: ConverseBriefing
  questions: ConverseQuestion[]
  targetName: string
}) {
  const groups = [
    { label: 'Known', items: briefing.known },
    { label: 'Open & suspected', items: briefing.openSuspected },
    { label: 'Connections', items: briefing.connections }
  ].filter((g) => g.items.length > 0)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {groups.map((g) => (
          <section key={g.label} className="space-y-1.5">
            <h3 className="inscribed text-xs">{g.label}</h3>
            <ul className="space-y-1.5">
              {g.items.map((it, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-foreground/90"
                >
                  {it}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {briefing.known.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Little is confirmed about {targetName} — the questions below go after what&apos;s unknown.
          </p>
        )}
      </div>

      {questions.length > 0 && (
        <div className="space-y-2">
          <h3 className="inscribed text-xs">Questions to ask</h3>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/60 p-4">
                {q.targetsThread && <p className="inscribed mb-1.5 text-[11px]">{q.targetsThread}</p>}
                <p className="text-[15px] leading-relaxed text-foreground/90">{q.question}</p>
                {q.why && (
                  <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    {q.why}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FailureBanner({ reason }: { reason: ConverseFailureReason }) {
  switch (reason) {
    case 'offline':
      return (
        <Banner icon={<WifiOff className="size-4" />}>
          You&apos;re offline — Converse needs an internet connection to reason in character.
        </Banner>
      )
    case 'no_key':
      return (
        <Banner icon={<KeyRound className="size-4" />}>
          No API key — add one in Settings to enable Converse.
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
          Couldn&apos;t put together a clear briefing — try again, or narrow the focus.
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
