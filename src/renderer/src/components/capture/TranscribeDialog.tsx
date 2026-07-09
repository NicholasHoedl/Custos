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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { Banner, SetupCard } from '@renderer/components/chrome'

// The target-session choice: 'active' stamps at the app's current session (the default); a session id
// stamps at that specific session; SESSION_NONE leaves notes undated. This is what lets you import notes
// taken elsewhere — or handed over by another player — and tie them to the session they actually belong to.
const SESSION_NONE = '__none__'

// Transcribe — paste raw text → the Keeper proposes entities + notes + status changes (tier-1 'capture'
// extraction, ADR-035; ties/field edits come from a later Illuminate pass) → review/edit/confirm → apply
// in one transaction, stamped at a chosen session. Hosted in a dialog off the Chronicle header (ADR-036;
// formerly the top-level ImportView). State deliberately SURVIVES close/reopen — a paste isn't
// re-derivable, so an accidental Esc mid-review must not discard it; only Discard/apply/"Transcribe
// more" reset.
export function TranscribeDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const { sessions } = useSessions(activeCampaignId)
  const imp = useImport({ mode: 'capture' })
  const [text, setText] = useState('')
  const [sessionChoice, setSessionChoice] = useState<string>('active')

  const reviewing = imp.status === 'review' || imp.status === 'applying'
  const extracting = imp.status === 'extracting'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Transcribe</DialogTitle>
          <DialogDescription>
            Paste notes from anywhere — the Keeper proposes the entities, notes, and status changes to
            record, tied to a session you choose.
          </DialogDescription>
        </DialogHeader>

        {!onb.keyReady ? (
          <SetupCard
            title="Add your API key to transcribe"
            body="The Keeper reads your text and proposes what to record — add a key in Settings to enable it."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  setActiveView('settings')
                }}
              >
                Open Settings
              </Button>
            }
          />
        ) : imp.status === 'done' && imp.result ? (
          <DoneSummary
            result={imp.result}
            onMore={() => {
              imp.reset()
              setText('')
            }}
          />
        ) : reviewing ? (
          <>
            {sessions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>These notes &amp; changes belong to</span>
                <SessionPicker sessions={sessions} value={sessionChoice} onChange={setSessionChoice} />
              </div>
            )}
            <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
              <ChangesetReview
                imp={imp}
                campaignEntities={campaignEntities}
                onApply={() =>
                  imp.apply(
                    // 'active' → let apply() use the app's current session; else the chosen one (or undated).
                    sessionChoice === 'active'
                      ? undefined
                      : sessionChoice === SESSION_NONE
                        ? null
                        : sessionChoice
                  )
                }
                onDiscard={imp.reset}
              />
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Paste session notes, a chat log, or another player's write-up… the Keeper proposes the entities, notes, and status changes to record."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {text.length.toLocaleString()} characters
                {text.length > 20000 ? ' — long pastes cost more and may be truncated' : ''}
              </span>
              <Button size="sm" onClick={() => imp.extract(text)} disabled={extracting || !text.trim()}>
                <FileText className="size-3.5" />
                {extracting ? 'Reading…' : 'Transcribe'}
              </Button>
            </div>
            {imp.status === 'error' && (
              <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                Something went wrong: {imp.error}
              </Banner>
            )}
            {imp.reason && <ReasonBanner reason={imp.reason} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DoneSummary({
  result,
  onMore
}: {
  result: NonNullable<ReturnType<typeof useImport>['result']>
  onMore: () => void
}) {
  const changes =
    result.statusChangesApplied + result.relationshipChangesApplied + result.fieldChangesApplied
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card/60 p-4">
        <p className="text-sm text-foreground">
          Transcribed <strong>{result.createdEntityIds.length}</strong>{' '}
          {plural(result.createdEntityIds.length, 'new entity', 'new entities')}
          {result.linkedEntityIds.length > 0 && <> · linked {result.linkedEntityIds.length}</>}
          {changes > 0 && (
            <>
              {' '}
              · <strong>{changes}</strong> {plural(changes, 'change', 'changes')}
            </>
          )}{' '}
          · <strong>{result.createdNoteIds.length}</strong>{' '}
          {plural(result.createdNoteIds.length, 'note', 'notes')}.
        </p>
        {result.skipped.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {result.skipped.map((s, i) => (
              <li key={i}>
                Skipped a {s.kind}: {s.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button size="sm" onClick={onMore}>
        Transcribe more
      </Button>
    </div>
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
        <SelectItem value={SESSION_NONE}>undated (pre-campaign)</SelectItem>
      </SelectContent>
    </Select>
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
    return <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('no_key')}</Banner>
  if (reason === 'bad_key')
    return (
      <Banner icon={<KeyRound className="size-4" />} tone="destructive">
        {reasonCopy('bad_key')}
      </Banner>
    )
  if (reason === 'offline')
    return <Banner icon={<WifiOff className="size-4" />}>{reasonCopy('offline')}</Banner>
  if (reason === 'too_long')
    return (
      <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
        {reasonCopy('too_long')}
      </Banner>
    )
  return (
    <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
      Couldn’t read that — try again or rephrase.
    </Banner>
  )
}
