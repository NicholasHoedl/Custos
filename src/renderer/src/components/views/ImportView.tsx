import { useState } from 'react'
import { AlertTriangle, FileText, KeyRound, Sparkles, WifiOff } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import type { ExtractFailureReason } from '@shared/import-types'
import { plural } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'
import { Banner, PaneHeader, PaneShell, SetupCard } from '@renderer/components/chrome'

// The target-session choice: 'active' stamps at the app's current session (the default); a session id
// stamps at that specific session; SESSION_NONE leaves notes undated. This is what lets you import notes
// taken elsewhere — or handed over by another player — and tie them (and any status/relationship
// changes) to the session they actually belong to.
const SESSION_NONE = '__none__'

// Paste raw text → Claude proposes entities + notes + status/relationship changes → review/edit/confirm
// each → apply in one transaction, stamped at a chosen session. A Capture pane (like Notes/Recap). The
// extract/review/apply engine is shared with the Journal (ADR-014/018/022); `withChanges` turns on the
// status/relationship proposals (this pane absorbed the old Backfill's capability).
export function ImportView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const { sessions } = useSessions(activeCampaignId)
  const imp = useImport({ withChanges: true })
  const [text, setText] = useState('')
  const [sessionChoice, setSessionChoice] = useState<string>('active')

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
    const changes = r.statusChangesApplied + r.relationshipChangesApplied
    return (
      <PaneShell size="form">
        <Header />
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <p className="text-sm text-foreground">
            Imported <strong>{r.createdEntityIds.length}</strong>{' '}
            {plural(r.createdEntityIds.length, 'new entity', 'new entities')}
            {r.linkedEntityIds.length > 0 && <> · linked {r.linkedEntityIds.length}</>}
            {changes > 0 && (
              <>
                {' '}
                · <strong>{changes}</strong> {plural(changes, 'change', 'changes')}
              </>
            )}{' '}
            · <strong>{r.createdNoteIds.length}</strong>{' '}
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
    // 'active' → let apply() use the app's current session; else stamp at the chosen session (or undated).
    const applySession =
      sessionChoice === 'active' ? undefined : sessionChoice === SESSION_NONE ? null : sessionChoice
    return (
      <PaneShell size="form">
        <Header />
        {sessions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>These notes &amp; changes belong to</span>
            <SessionPicker sessions={sessions} value={sessionChoice} onChange={setSessionChoice} />
          </div>
        )}
        <ChangesetReview
          imp={imp}
          campaignEntities={campaignEntities}
          onApply={() => imp.apply(applySession)}
          onDiscard={imp.reset}
        />
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
        placeholder="Paste session notes, a chat log, or another player's write-up… Claude proposes the entities, notes, and status/relationship changes to add."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
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

// Ties this import to a session: the current one (default), a specific past session, or none (undated).
function SessionPicker({
  sessions,
  value,
  onChange
}: {
  sessions: Session[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto gap-1.5 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">the current session</SelectItem>
        {[...sessions]
          .sort((a, b) => b.number - a.number)
          .map((s) => (
            <SelectItem key={s.id} value={s.id}>
              Session {s.number}
              {s.title ? ` — ${s.title}` : ''}
            </SelectItem>
          ))}
        <SelectItem value={SESSION_NONE}>no session (undated)</SelectItem>
      </SelectContent>
    </Select>
  )
}

function Header() {
  return (
    <PaneHeader
      title="Import"
      description="Paste notes from anywhere — Claude proposes the entities, notes, and status/relationship changes to add, tied to a session you choose."
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
