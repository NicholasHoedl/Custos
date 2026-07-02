import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, KeyRound, Sparkles, WifiOff } from 'lucide-react'
import type { EntityRef, ExtractFailureReason, MatchCandidate } from '@shared/import-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { ledger } from '@renderer/lib/ipc'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  EntityRow,
  NoteRow,
  RelationshipChangeRow,
  StatusChangeRow
} from '@renderer/components/capture/import-rows'

type Phase = 'roster' | 'beats'

// The backfill interview (ADR-018): adopt Ledger mid-campaign by first establishing the ROSTER (the
// cast + its earliest-known state, applied as session-stamped baselines), then walking the sessions
// for KEY BEATS (notes + dated status/relationship changes). Each batch is one extract → review →
// atomic apply, stamped at its session — so the backfilled past feeds as-of reconstruction.
export function BackfillView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { sessions, refresh: refreshSessions } = useSessions(activeCampaignId)
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const imp = useImport({ withChanges: true })

  const [phase, setPhase] = useState<Phase>('roster')
  const [text, setText] = useState('')
  const [targetCount, setTargetCount] = useState('')
  const [creatingSessions, setCreatingSessions] = useState(false)
  const [beatsSessionId, setBeatsSessionId] = useState<string | null>(null)

  const ordered = useMemo(() => [...sessions].sort((a, b) => a.number - b.number), [sessions])
  const sessionOne = ordered[0] ?? null
  const beatsSession = ordered.find((s) => s.id === beatsSessionId) ?? null
  // Roster baselines default to session 1; beats stamp at the session under review.
  const batchSessionId = phase === 'roster' ? (sessionOne?.id ?? null) : beatsSessionId

  const rosterNames = useMemo(
    () => campaignEntities.slice(0, 12).map((e) => e.name),
    [campaignEntities]
  )

  const matchesByIndex = useMemo(() => {
    const m = new Map<number, MatchCandidate[]>()
    imp.proposal?.entities.forEach((pe) => m.set(pe.index, pe.matches))
    return m
  }, [imp.proposal])

  const existingName = (id: string): string =>
    campaignEntities.find((e) => e.id === id)?.name ?? 'an entity'
  const refName = (r: EntityRef): string =>
    r.kind === 'existing'
      ? existingName(r.entityId)
      : (imp.entities.find((e) => e.index === r.index)?.name ?? 'new entity')

  async function createSessionsUpTo() {
    const target = Number(targetCount)
    if (!activeCampaignId || !Number.isInteger(target) || target <= sessions.length) return
    setCreatingSessions(true)
    try {
      for (let i = sessions.length; i < target; i++) {
        await ledger.session.create({ campaignId: activeCampaignId })
      }
      refreshSessions()
    } finally {
      setCreatingSessions(false)
    }
  }

  function changePhase(p: Phase) {
    setPhase(p)
    setText('')
    imp.reset()
    if (p === 'beats' && !beatsSessionId && ordered.length) setBeatsSessionId(ordered[0].id)
  }

  if (!onb.keyReady) {
    return (
      <Wrap>
        <Header />
        <SetupCard
          title="Add your API key to backfill"
          body="The interview uses Claude to structure your answers — add a key to enable it."
          action={
            <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
              Open Settings
            </Button>
          }
        />
      </Wrap>
    )
  }

  if (imp.status === 'done' && imp.result) {
    const r = imp.result
    return (
      <Wrap>
        <Header />
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <p className="text-sm text-foreground">
            Applied <strong>{r.createdEntityIds.length}</strong>{' '}
            {plural(r.createdEntityIds.length, 'new entity', 'new entities')}
            {r.linkedEntityIds.length > 0 && <> · linked {r.linkedEntityIds.length}</>} ·{' '}
            <strong>{r.statusChangesApplied}</strong> status{' '}
            {plural(r.statusChangesApplied, 'change', 'changes')} ·{' '}
            <strong>{r.relationshipChangesApplied}</strong> relationship{' '}
            {plural(r.relationshipChangesApplied, 'change', 'changes')} ·{' '}
            <strong>{r.createdNoteIds.length}</strong> {plural(r.createdNoteIds.length, 'note', 'notes')}
            {phase === 'beats' && beatsSession ? <> — stamped at Session {beatsSession.number}</> : null}.
          </p>
          {r.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {r.skipped.map((s, i) => (
                <li key={i}>
                  Skipped a {s.kind}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              imp.reset()
              setText('')
            }}
          >
            Continue this phase
          </Button>
          {phase === 'roster' && (
            <Button size="sm" variant="outline" onClick={() => changePhase('beats')}>
              Move to session beats →
            </Button>
          )}
        </div>
      </Wrap>
    )
  }

  if (imp.status === 'review' || imp.status === 'applying') {
    const creating = imp.entities.filter((e) => e.action === 'create').length
    const linking = imp.entities.filter((e) => e.action === 'link').length
    const noting = imp.notes.filter((n) => n.include).length
    const changing =
      imp.statusChanges.filter((c) => c.include).length +
      imp.relationshipChanges.filter((c) => c.include).length
    const applying = imp.status === 'applying'
    return (
      <Wrap>
        <Header />
        <p className="text-xs text-muted-foreground">
          {phase === 'roster'
            ? 'Reviewing the roster — baselines describe how things FIRST were; deaths and turns belong in session beats.'
            : `Reviewing Session ${beatsSession?.number ?? '?'} — everything below is stamped at that session.`}
        </p>
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {imp.entities.length > 0 && (
            <Section label="Entities">
              {imp.entities.map((e) => (
                <EntityRow
                  key={e.index}
                  entity={e}
                  matches={matchesByIndex.get(e.index) ?? []}
                  existingName={existingName}
                  sessions={phase === 'roster' ? ordered : undefined}
                  onPatch={(p) =>
                    imp.setEntities((es) => es.map((x) => (x.index === e.index ? { ...x, ...p } : x)))
                  }
                />
              ))}
            </Section>
          )}
          {imp.statusChanges.length > 0 && (
            <Section label="Status changes">
              {imp.statusChanges.map((c, i) => (
                <StatusChangeRow
                  key={i}
                  change={c}
                  refName={refName}
                  onToggle={() =>
                    imp.setStatusChanges((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                    )
                  }
                />
              ))}
            </Section>
          )}
          {imp.relationshipChanges.length > 0 && (
            <Section label="Relationship changes">
              {imp.relationshipChanges.map((c, i) => (
                <RelationshipChangeRow
                  key={i}
                  change={c}
                  refName={refName}
                  onToggle={() =>
                    imp.setRelationshipChanges((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                    )
                  }
                />
              ))}
            </Section>
          )}
          {imp.notes.length > 0 && (
            <Section label="Notes">
              {imp.notes.map((n, i) => (
                <NoteRow
                  key={i}
                  note={n}
                  refName={refName}
                  onPatch={(p) =>
                    imp.setNotes((ns) => ns.map((x, j) => (j === i ? { ...x, ...p } : x)))
                  }
                />
              ))}
            </Section>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {creating} new · {linking} linked · {changing} {plural(changing, 'change', 'changes')} ·{' '}
            {noting} {plural(noting, 'note', 'notes')}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={imp.reset} disabled={applying}>
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => imp.apply(batchSessionId)}
              disabled={applying || (creating === 0 && linking === 0 && noting === 0 && changing === 0)}
            >
              {applying ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </div>
      </Wrap>
    )
  }

  const extracting = imp.status === 'extracting'
  const canExtract =
    Boolean(text.trim()) && !extracting && (phase === 'roster' ? Boolean(sessionOne) : Boolean(beatsSessionId))
  return (
    <Wrap>
      <Header />

      {/* Step 0 — the timeline: beats need sessions to attach to. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          Sessions so far: <span className="font-medium text-foreground">{sessions.length}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
            type="number"
            inputMode="numeric"
            placeholder="e.g. 10"
            className="h-7 w-20 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={createSessionsUpTo}
            disabled={creatingSessions || Number(targetCount) <= sessions.length}
          >
            {creatingSessions ? 'Creating…' : 'Create sessions'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PhaseToggle phase={phase} setPhase={changePhase} />
        {phase === 'beats' && (
          <Select value={beatsSessionId ?? ''} onValueChange={(v) => setBeatsSessionId(v || null)}>
            <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
              <SelectValue placeholder="Pick a session…" />
            </SelectTrigger>
            <SelectContent>
              {ordered.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  Session {s.number}
                  {s.title ? ` — ${s.title}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {phase === 'roster' ? (
            <>
              Who are the main people, places, factions, and quests of this campaign? A sentence each —
              how they <em>first</em> were, not how they ended up. Note anyone who only appeared partway
              in (you can set their first session in review). Paste a cast list if you have one.
            </>
          ) : (
            <>
              Session {beatsSession?.number ?? '…'}: {rosterNames.length > 0 && (
                <>of {rosterNames.join(', ')}{campaignEntities.length > 12 ? '…' : ''} — </>
              )}
              who appeared? Any deaths, betrayals, alliances formed or broken, quests opened or
              completed? What happened?
            </>
          )}
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            phase === 'roster'
              ? 'e.g. Gundren Rockseeker — dwarf patron who hired the party. Glasstaff — masked Redbrand leader in Phandalin…'
              : 'e.g. We stormed Tresendar Manor. Glasstaff turned out to be Iarno and we killed him; the Redbrands scattered…'
          }
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {text.length.toLocaleString()} characters
            {text.length > 20000 ? ' — long answers cost more and may be truncated' : ''}
          </span>
          <Button size="sm" onClick={() => imp.extract(text)} disabled={!canExtract}>
            <Sparkles className="size-3.5" />
            {extracting ? 'Reading…' : 'Extract'}
          </Button>
        </div>
        {phase === 'roster' && !sessionOne && (
          <p className="text-xs text-muted-foreground">
            Create your sessions above first — roster baselines anchor to Session 1.
          </p>
        )}
      </div>

      {imp.status === 'error' && (
        <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
          Something went wrong: {imp.error}
        </Banner>
      )}
      {imp.reason && <ReasonBanner reason={imp.reason} />}
    </Wrap>
  )
}

function PhaseToggle({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setPhase('roster')}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          phase === 'roster' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        1 · Roster
      </button>
      <button
        type="button"
        onClick={() => setPhase('beats')}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          phase === 'beats' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        2 · Session beats
      </button>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}

function Header() {
  return (
    <header>
      <h1 className="font-display text-2xl font-semibold text-foreground">Backfill</h1>
      <p className="text-sm text-muted-foreground">
        Catch Ledger up on a campaign already in progress — the roster first, then each session&apos;s
        key beats, stamped onto the timeline.
      </p>
    </header>
  )
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">{children}</div>
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function SetupCard({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-primary">
        <KeyRound className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function ReasonBanner({ reason }: { reason: ExtractFailureReason }) {
  if (reason === 'empty')
    return (
      <Banner icon={<CalendarClock className="size-4" />}>
        Nothing to add from that — try describing people, places, quests, or what changed.
      </Banner>
    )
  if (reason === 'no_key')
    return <Banner icon={<KeyRound className="size-4" />}>No API key — add one in Settings.</Banner>
  if (reason === 'offline')
    return (
      <Banner icon={<WifiOff className="size-4" />}>
        You&apos;re offline — the backfill interview needs an internet connection.
      </Banner>
    )
  return (
    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
      Couldn&apos;t read that — try again or rephrase.
    </Banner>
  )
}

function Banner({
  icon,
  children,
  tone = 'muted'
}: {
  icon: ReactNode
  children: ReactNode
  tone?: 'muted' | 'destructive'
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/10 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      <span className={tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}
