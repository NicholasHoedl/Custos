import { useMemo, useState } from 'react'
import { AlertTriangle, FileText, KeyRound, Sparkles, WifiOff } from 'lucide-react'
import type {
  ConfirmedEntity,
  ConfirmedNote,
  EntityRef,
  ExtractFailureReason,
  MatchCandidate
} from '@shared/import-types'
import { plural } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { EntityRow, NoteRow } from '@renderer/components/capture/import-rows'
import { Banner, PaneHeader, PaneShell, SetupCard } from '@renderer/components/chrome'

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
      <PaneShell size="form">
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
      </PaneShell>
    )
  }

  if (imp.status === 'done' && imp.result) {
    const r = imp.result
    return (
      <PaneShell size="form">
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
      </PaneShell>
    )
  }

  if (imp.status === 'review' || imp.status === 'applying') {
    const creating = imp.entities.filter((e) => e.action === 'create').length
    const linking = imp.entities.filter((e) => e.action === 'link').length
    const noting = imp.notes.filter((n) => n.include).length
    const applying = imp.status === 'applying'
    return (
      <PaneShell size="form">
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
      </PaneShell>
    )
  }

  const extracting = imp.status === 'extracting'
  return (
    <PaneShell size="form">
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
    </PaneShell>
  )
}

function Header() {
  return (
    <PaneHeader
      title="Import"
      description="Paste raw text; review the entities and notes Claude proposes before adding them."
    />
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
  if (reason === 'bad_key')
    return (
      <Banner icon={<KeyRound className="size-4" />} tone="destructive">
        Your API key was rejected — update it in Settings.
      </Banner>
    )
  if (reason === 'offline')
    return (
      <Banner icon={<WifiOff className="size-4" />}>
        You’re offline — Import needs an internet connection.
      </Banner>
    )
  if (reason === 'too_long')
    return (
      <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
        That’s a lot of text at once — import it in smaller chunks (a section or two at a time).
      </Banner>
    )
  return (
    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
      Couldn’t read that — try again or rephrase.
    </Banner>
  )
}
