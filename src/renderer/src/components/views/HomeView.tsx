import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowRight,
  BookCheck,
  CalendarPlus,
  CheckCircle2,
  Home,
  Search,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import type { EntityType, Entity } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import {
  activeQuests,
  archiveSpotlight,
  latestSession,
  needsFirstSession,
  recentlyTouched,
  relativeDays,
  typeCounts,
  unresolvedRumors
} from '@renderer/lib/dashboard'
import { ENTITY_TYPE_COLOR, ENTITY_TYPE_ICON } from '@renderer/lib/entity-visuals'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore, type LensHistoryKey } from '@renderer/store/ui-store'
import {
  useAllNotes,
  useCampaigns,
  useCampaignGraph,
  useEntities,
  useSessions,
  useUnclosedSessions
} from '@renderer/hooks/use-ledger'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { NoCampaign } from '@renderer/components/NoCampaign'
import { Portrait } from '@renderer/components/entities/Portrait'
import { SessionRecap } from '@renderer/components/sessions/SessionRecap'
import { MiniWeb } from '@renderer/components/home/MiniWeb'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { PaneBody, PaneHeader, SetupCard } from '@renderer/components/chrome'

// Home — the campaign's front door (ADR-061) and the app's default landing view. Answers "where am I,
// and what should I do next?": identity hero, the latest session's recap, a needs-attention strip
// (unclosed extracts / setup / the FREE deterministic record-health probe), open threads, stats, a
// static web teaser, a dormant-thread spotlight, and an ask box that pre-seeds Lore. Widget math lives
// in the pure lib/dashboard.ts; this file is layout + wiring.

const LENS_LABEL: Record<LensHistoryKey, string> = {
  recall: 'Lore',
  suggest: 'Counsel',
  converse: 'Converse',
  continuity: 'Continuity'
}

function typeLabel(t: EntityType, count: number): string {
  const plural = count === 1 ? '' : 's'
  if (t === 'npc') return `NPC${plural}`
  if (t === 'pc') return `PC${plural}`
  return t.charAt(0).toUpperCase() + t.slice(1) + plural
}

/** The record-health probe: deterministic Continuity checks only (free, keyless — ADR-061). */
function useRecordHealth(campaignId: string | null): number | null {
  const [count, setCount] = useState<number | null>(null)
  const entitiesVersion = useUiStore((s) => s.entitiesVersion)
  useEffect(() => {
    if (!campaignId) {
      setCount(null)
      return
    }
    let alive = true
    ledger.continuity
      .query({ campaignId, checksOnly: true })
      .then((res) => {
        if (alive) setCount(res.findings.length)
      })
      .catch(() => {
        if (alive) setCount(null) // silent — the health tile simply doesn't render
      })
    return () => {
      alive = false
    }
  }, [campaignId, entitiesVersion])
  return count
}

/** Whether the main character has a generated persona (ADR-063) — the "fill in your character" needs-
 *  attention item clears once it does. `null` while loading or on error (item stays hidden until known).
 *  Refetches on entitiesVersion, which persona generate/derive bump. */
function useMcPersonaReady(mcId: string | null): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null)
  const entitiesVersion = useUiStore((s) => s.entitiesVersion)
  useEffect(() => {
    if (!mcId) {
      setReady(null)
      return
    }
    let alive = true
    ledger.persona
      .get(mcId)
      .then((p) => {
        if (alive) setReady(p !== null)
      })
      .catch(() => {
        if (alive) setReady(null) // silent — treat unknown as "don't nag"
      })
    return () => {
      alive = false
    }
  }, [mcId, entitiesVersion])
  return ready
}

export function HomeView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const openLens = useUiStore((s) => s.openLens)
  const lensHistory = useUiStore((s) => s.lensHistory)

  const { campaigns } = useCampaigns()
  const { sessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions(activeCampaignId)
  const { entities } = useEntities(activeCampaignId)
  const { notes, refresh: refreshNotes } = useAllNotes(activeCampaignId)
  // useAllNotes has no version subscription of its own — keep the note-driven widgets (rumors,
  // spotlight, counts) fresh on the common mutation paths (Extract apply, note writes).
  const entitiesVersion = useUiStore((s) => s.entitiesVersion)
  const sessionsVersion = useUiStore((s) => s.sessionsVersion)
  useEffect(() => refreshNotes(), [entitiesVersion, sessionsVersion, refreshNotes])
  const { counts: unclosed } = useUnclosedSessions(activeCampaignId)
  const { graph } = useCampaignGraph(activeCampaignId)
  const { status: onb } = useOnboarding()
  const health = useRecordHealth(activeCampaignId)

  const [ask, setAsk] = useState('')

  const campaign = campaigns.find((c) => c.id === activeCampaignId) ?? null
  const mc = campaign?.mainCharacterId
    ? (entities.find((e) => e.id === campaign.mainCharacterId) ?? null)
    : null
  const latest = latestSession(sessions)

  // Before session 1 (ADR-063): nudge the two setup tasks a new campaign needs. Character clears once
  // the MC's persona is generated; start-session once any session exists (guarded on the initial load).
  const personaReady = useMcPersonaReady(mc?.id ?? null)
  const characterNeeded = mc !== null && personaReady === false
  const firstSessionNeeded = !sessionsLoading && needsFirstSession(sessions)

  const quests = useMemo(() => activeQuests(entities), [entities])
  const rumors = useMemo(() => unresolvedRumors(notes), [notes])
  const stats = useMemo(() => typeCounts(entities), [entities])
  const touched = useMemo(() => recentlyTouched(entities), [entities])
  const spotlight = useMemo(
    () => archiveSpotlight(entities, notes, Math.floor(Date.now() / 86_400_000)),
    [entities, notes]
  )
  const recentAsks = useMemo(
    () =>
      (Object.keys(LENS_LABEL) as LensHistoryKey[])
        .flatMap((k) => lensHistory[k].map((e) => ({ ...e, lens: k })))
        .sort((a, b) => b.at - a.at)
        .slice(0, 5),
    [lensHistory]
  )

  const unclosedRows = useMemo(
    () =>
      Object.entries(unclosed)
        .map(([sessionId, count]) => ({ session: sessions.find((s) => s.id === sessionId), count }))
        .filter((r) => r.session !== undefined)
        .sort((a, b) => (b.session?.number ?? 0) - (a.session?.number ?? 0)),
    [unclosed, sessions]
  )

  function openEntity(e: Entity): void {
    if (campaign?.mainCharacterId === e.id) {
      setActiveView('character')
    } else {
      setSelectedEntity(e.id)
      setActiveView('capture')
    }
  }

  function submitAsk(): void {
    const q = ask.trim()
    if (!q) return
    openLens({ view: 'recall', query: q })
    setAsk('')
  }

  if (!activeCampaignId)
    return (
      <div className="flex h-full flex-col">
        <PaneHeader icon={Home} title="Home" />
        <NoCampaign />
      </div>
    )

  const lastPlayedTs = latest
    ? latest.date && !Number.isNaN(Date.parse(latest.date))
      ? Date.parse(latest.date)
      : latest.createdAt
    : null
  const needsAttention =
    unclosedRows.length > 0 ||
    !onb.keyReady ||
    !onb.modelReady ||
    characterNeeded ||
    firstSessionNeeded ||
    (health ?? 0) > 0

  return (
    <div className="flex h-full flex-col">
      <PaneHeader icon={Home} title="Home" />
      <PaneBody size="reading" className="max-w-5xl">
        {/* Hero — the campaign's identity. */}
        <div className="flex items-center gap-4">
          {mc && <Portrait image={mc.image} name={mc.name} size="lg" />}
          <div className="min-w-0">
            <h2 className="truncate font-display text-3xl font-semibold text-foreground">
              {campaign?.name ?? 'Your campaign'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mc ? (
                <>
                  Playing as <span className="font-medium text-foreground">{mc.name}</span>
                </>
              ) : (
                'No main character set'
              )}
              {latest && <> · Session {latest.number}</>}
              {lastPlayedTs != null && <> · last played {relativeDays(lastPlayedTs, Date.now())}</>}
            </p>
          </div>
        </div>

        {/* Needs attention — renders only when something actually does. */}
        {needsAttention && (
          <Card title="Needs attention">
            <div className="space-y-2">
              {!onb.keyReady && (
                <SetupCard
                  title="Add your Anthropic API key"
                  body="The Keeper needs it to think — Lore, Counsel, Converse, recaps."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
                      Settings
                    </Button>
                  }
                />
              )}
              {!onb.modelReady && (
                <SetupCard
                  title="Download the local search model"
                  body="Free, on-device search over your notes — Lore and Counsel use it."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
                      Settings
                    </Button>
                  }
                />
              )}
              {characterNeeded && (
                <SetupCard
                  icon={<UserRound className="size-4" />}
                  title="Fill in your character"
                  body="Give the Keeper your backstory and voice so it can speak as you — Lore, Counsel, and Converse use it."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('character')}>
                      Set up
                    </Button>
                  }
                />
              )}
              {firstSessionNeeded && (
                <SetupCard
                  icon={<CalendarPlus className="size-4" />}
                  title="Start your first session"
                  body="When the game begins, open the Chronicle and start Session 1."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('journal')}>
                      Start session
                    </Button>
                  }
                />
              )}
              {unclosedRows.map(({ session, count }) => (
                <AttentionRow
                  key={session?.id}
                  icon={<BookCheck className="size-4 text-primary" />}
                  text={
                    <>
                      Session {session?.number} has{' '}
                      <span className="font-medium text-foreground">
                        {count} {count === 1 ? 'entry' : 'entries'}
                      </span>{' '}
                      not yet extracted.
                    </>
                  }
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('sessions')}>
                      Extract
                    </Button>
                  }
                />
              ))}
              {(health ?? 0) > 0 && (
                <AttentionRow
                  icon={<ShieldCheck className="size-4 text-destructive" />}
                  text={
                    <>
                      Record health:{' '}
                      <span className="font-medium text-foreground">
                        {health} {health === 1 ? 'inconsistency' : 'inconsistencies'}
                      </span>{' '}
                      in the automatic checks.
                    </>
                  }
                  action={
                    <Button size="sm" variant="outline" onClick={() => setActiveView('continuity')}>
                      Open Continuity
                    </Button>
                  }
                />
              )}
              {health === 0 && unclosedRows.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-primary" />
                  The record itself is consistent.
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Previously on… — SessionRecap renders its OWN "Previously…" heading + Regenerate row, so
              the card only adds an eyebrow for the fallback states (no session / no key). */}
          <Card title={latest && onb.keyReady ? undefined : 'Previously…'} className="md:col-span-1">
            {latest ? (
              onb.keyReady ? (
                <SessionRecap session={latest} onSaved={refreshSessions} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {latest.summary ??
                    'Add an API key in Settings and the Keeper will recap each session for you.'}
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                No sessions yet — start one on the Chronicle page when the game begins.
              </p>
            )}
          </Card>

          {/* Open threads */}
          <Card title="Open threads">
            {quests.length === 0 && rumors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No open quests or rumors yet — Extract finds them as you play.
              </p>
            ) : (
              <div className="space-y-1">
                {quests.map((q) => {
                  const Icon = ENTITY_TYPE_ICON.quest
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => openEntity(q)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                    >
                      <Icon className="size-3.5 shrink-0" style={{ color: ENTITY_TYPE_COLOR.quest }} />
                      <span className="truncate">{q.name}</span>
                    </button>
                  )
                })}
                {rumors.map((r) => (
                  <div key={r.id} className="rounded-md px-2 py-1 text-xs text-muted-foreground">
                    <span className="mr-1.5 rounded bg-muted/60 px-1 py-0.5 text-[10px] uppercase tracking-wide">
                      {r.confidence === 'rumored' ? 'rumor' : 'suspected'}
                    </span>
                    <span className="line-clamp-2">{r.content}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* The web, in miniature */}
          <Card title="The web">
            <MiniWeb
              graph={graph}
              mainCharacterId={campaign?.mainCharacterId ?? null}
              onOpen={() => setActiveView('web')}
            />
          </Card>

          {/* Memory at a glance + recently touched */}
          <Card title="The memory">
            {entities.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Empty so far — chronicle a session and Extract will begin filling it.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {stats.map(({ type, count }) => {
                    const Icon = ENTITY_TYPE_ICON[type]
                    return (
                      <span
                        key={type}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        <Icon className="size-3" style={{ color: ENTITY_TYPE_COLOR[type] }} />
                        {count} {typeLabel(type, count)}
                      </span>
                    )
                  })}
                  <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                    {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                  </span>
                  <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                    {graph.edges.length} {graph.edges.length === 1 ? 'tie' : 'ties'}
                  </span>
                </div>
                {touched.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="inscribed text-[10px]">Recently touched</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {touched.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => openEntity(e)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50"
                        >
                          <Portrait image={e.image} name={e.name} lifecycle={e.lifecycle} size="sm" className="size-4 rounded-sm text-[7px]" />
                          <span className="max-w-32 truncate">{e.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* From the archives… */}
        {spotlight && (
          <Card title="From the archives…">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Archive className="mt-0.5 size-4 shrink-0 text-metal" />
                {spotlight.kind === 'dormant' ? (
                  <span>
                    It has been a while since{' '}
                    <span className="font-medium text-foreground">{spotlight.entity.name}</span> came
                    up — last noted {relativeDays(spotlight.lastNoteAt, Date.now())}. Whatever became
                    of that?
                  </span>
                ) : (
                  <span>
                    An old {spotlight.note.confidence === 'rumored' ? 'rumor' : 'suspicion'} still
                    lingers: <span className="italic">“{spotlight.note.content}”</span>
                  </span>
                )}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => {
                  if (spotlight.kind === 'dormant') {
                    openEntity(spotlight.entity)
                  } else {
                    const target = entities.find((e) => spotlight.note.entityIds.includes(e.id))
                    if (target) openEntity(target)
                    else setActiveView('capture')
                  }
                }}
              >
                Revisit <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </Card>
        )}

        {/* Ask the Keeper */}
        <Card title="Ask the Keeper">
          <div className="flex gap-2">
            <Input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="What do we know about…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitAsk()
                }
              }}
            />
            <Button onClick={submitAsk} disabled={!ask.trim()}>
              <Search className="size-3.5" />
              Ask Lore
            </Button>
          </div>
          {recentAsks.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {recentAsks.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveView(r.lens)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[10px] uppercase tracking-wide">
                    {LENS_LABEL[r.lens]}
                  </span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </PaneBody>
    </div>
  )
}

function Card({
  title,
  className,
  children
}: {
  /** Omitted when the card's content brings its own heading (the embedded SessionRecap). */
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-2 rounded-lg border border-border bg-card/60 p-4', className)}>
      {title && <h3 className="inscribed text-xs">{title}</h3>}
      {children}
    </section>
  )
}

function AttentionRow({
  icon,
  text,
  action
}: {
  icon: ReactNode
  text: ReactNode
  action: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span className="min-w-0">{text}</span>
      </p>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
