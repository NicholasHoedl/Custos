import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, FileText, KeyRound, Sparkles, WifiOff } from 'lucide-react'
import type {
  ConfirmedEntity,
  ConfirmedNote,
  EntityRef,
  ExtractFailureReason,
  MatchCandidate
} from '@shared/import-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { EntityRow, NoteRow } from '@renderer/components/capture/import-rows'

// Paste raw text → Claude proposes entities + notes → review/edit/confirm each → apply in one txn.
// Lives as a Capture pane (like Notes/Recap).
export function ImportView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const imp = useImport()
  const [text, setText] = useState('')

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

  const patchEntity = (index: number, patch: Partial<ConfirmedEntity>): void =>
    imp.setEntities((es) => es.map((e) => (e.index === index ? { ...e, ...patch } : e)))
  const patchNote = (i: number, patch: Partial<ConfirmedNote>): void =>
    imp.setNotes((ns) => ns.map((n, j) => (j === i ? { ...n, ...patch } : n)))

  if (!onb.keyReady) {
    return (
      <Wrap>
        <Header />
        <SetupCard
          title="Add your API key to import"
          body="Import uses Claude to read your text — add a key to enable it."
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
            Imported <strong>{r.createdEntityIds.length}</strong>{' '}
            {plural(r.createdEntityIds.length, 'new entity', 'new entities')}
            {r.linkedEntityIds.length > 0 && <> · linked {r.linkedEntityIds.length}</>} ·{' '}
            <strong>{r.createdNoteIds.length}</strong>{' '}
            {plural(r.createdNoteIds.length, 'note', 'notes')}.
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
        <Button
          size="sm"
          onClick={() => {
            imp.reset()
            setText('')
          }}
        >
          Import more
        </Button>
      </Wrap>
    )
  }

  if (imp.status === 'review' || imp.status === 'applying') {
    const creating = imp.entities.filter((e) => e.action === 'create').length
    const linking = imp.entities.filter((e) => e.action === 'link').length
    const noting = imp.notes.filter((n) => n.include).length
    const applying = imp.status === 'applying'
    return (
      <Wrap>
        <Header />
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {imp.entities.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Entities
              </h3>
              {imp.entities.map((e) => (
                <EntityRow
                  key={e.index}
                  entity={e}
                  matches={matchesByIndex.get(e.index) ?? []}
                  existingName={existingName}
                  onPatch={(p) => patchEntity(e.index, p)}
                />
              ))}
            </section>
          )}
          {imp.notes.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notes
              </h3>
              {imp.notes.map((n, i) => (
                <NoteRow key={i} note={n} refName={refName} onPatch={(p) => patchNote(i, p)} />
              ))}
            </section>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {creating} new · {linking} linked · {noting} {plural(noting, 'note', 'notes')}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={imp.reset} disabled={applying}>
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => imp.apply()}
              disabled={applying || (creating === 0 && linking === 0 && noting === 0)}
            >
              {applying ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </div>
      </Wrap>
    )
  }

  const extracting = imp.status === 'extracting'
  return (
    <Wrap>
      <Header />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder="Paste session notes, a chat log, or a backstory… Claude proposes entities and notes to add."
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {text.length.toLocaleString()} characters
          {text.length > 20000 ? ' — long pastes cost more and may be truncated' : ''}
        </span>
        <Button size="sm" onClick={() => imp.extract(text)} disabled={extracting || !text.trim()}>
          <FileText className="size-3.5" />
          {extracting ? 'Reading…' : 'Extract'}
        </Button>
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

function Header() {
  return (
    <header>
      <h1 className="font-display text-2xl font-semibold text-foreground">Import</h1>
      <p className="text-sm text-muted-foreground">
        Paste raw text; review the entities and notes Claude proposes before adding them.
      </p>
    </header>
  )
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-6">{children}</div>
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
      <Banner icon={<Sparkles className="size-4" />}>
        Nothing to import from that — paste text with people, places, quests, or events.
      </Banner>
    )
  if (reason === 'no_key')
    return <Banner icon={<KeyRound className="size-4" />}>No API key — add one in Settings.</Banner>
  if (reason === 'offline')
    return (
      <Banner icon={<WifiOff className="size-4" />}>
        You’re offline — Import needs an internet connection.
      </Banner>
    )
  return (
    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
      Couldn’t read that — try again or rephrase.
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
