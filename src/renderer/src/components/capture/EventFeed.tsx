import { useEffect, useRef, useState } from 'react'
import { BookCheck, FileInput, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { EventLogEntry } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useEvents, useSessions, useUnclosedSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { formatTime } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { TranscribeDialog } from '@renderer/components/capture/TranscribeDialog'
import { CloseOutDialog } from '@renderer/components/capture/CloseOutDialog'
import { DeleteEventDialog } from '@renderer/components/capture/DeleteEventDialog'
import { SessionControl } from '@renderer/components/sessions/SessionControl'

interface EventFeedProps {
  sessionId: string | null
  /** True while the persisted session is still being restored (T3) — shown instead of the
   *  "start a session" copy so a real zero-sessions campaign reads differently from a loading one. */
  restoring?: boolean
}

// The Journal — the primary at-the-table capture surface. You jot a plain sentence or two of what
// happened; entries save AS-IS to the session log (no per-entry AI, ADR-035 as-built). Extraction is
// the deliberate **Close out session** ritual on the header: one locked wizard runs tier 1 (capture
// extraction over the whole log) then tier 2 (Illuminate) with a bulk-review surface. The header also
// hosts the ACTIVE-session switcher and the Transcribe dialog (ADR-036). Internals still ride the
// event_log table (createEvent); "journal" is the user-facing name (Chronicle). Manual entity/note
// editing lives in Codex.
export function EventFeed({ sessionId, restoring = false }: EventFeedProps) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const { events, refresh } = useEvents(sessionId)
  const { sessions } = useSessions(activeCampaignId)
  const { counts: unclosedCounts } = useUnclosedSessions(activeCampaignId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [transcribeOpen, setTranscribeOpen] = useState(false)
  const [closeOutOpen, setCloseOutOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<EventLogEntry | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // The wizard needs the full Session object (number for copy, id for stamping).
  const activeSession = sessions.find((s) => s.id === sessionId) ?? null
  // Entries added since this session's last close-out (P1-2) — badges the Close-out button.
  const unclosed = sessionId ? (unclosedCounts[sessionId] ?? 0) : 0

  // Start the first/next session right here — Chronicle is the default view, so a campaign with no
  // session must not dead-end on it (ADR-032). Mirrors OnboardingChecklist.startSession.
  async function startSession(): Promise<void> {
    if (!activeCampaignId || starting) return
    setStarting(true)
    try {
      const s = await ledger.session.create({ campaignId: activeCampaignId })
      setActiveSession(s.id)
      useUiStore.getState().bumpSessions()
      toast.success(`Session ${s.number} started`)
    } catch (err) {
      toast.error('Could not start session', { description: String(err) })
    } finally {
      setStarting(false)
    }
  }

  async function submit(): Promise<void> {
    const content = text.trim()
    if (!content || !sessionId || busy) return
    setBusy(true)
    try {
      await ledger.event.create({ sessionId, content })
      setText('')
      refresh()
      useUiStore.getState().bumpSessions() // a new entry makes the session unclosed (P1-2)
    } catch (err) {
      toast.error('Could not save chronicle entry', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function saveEntry(id: string, content: string): Promise<void> {
    try {
      await ledger.event.update(id, { content })
      refresh()
    } catch (err) {
      toast.error('Could not save the edit', { description: String(err) })
    }
  }

  async function deleteEntry(id: string): Promise<void> {
    try {
      await ledger.event.delete(id)
      refresh()
      useUiStore.getState().bumpSessions() // recount unclosed after a removal (P1-2)
    } catch (err) {
      toast.error('Could not delete the entry', { description: String(err) })
    }
  }

  // Oldest first → the latest entry sits at the BOTTOM, so the log reads top-to-bottom like a transcript.
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp)

  // Keep the newest entry in view: pin the feed to the bottom whenever entries change (a fresh add or a
  // session switch) — otherwise a just-added line lands below the fold once the list overflows.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-foreground">Chronicle</h2>
          <p className="text-xs text-muted-foreground">
            {restoring
              ? 'Restoring session…'
              : !sessionId
                ? 'Start a session to begin your chronicle.'
                : 'Jot what happened — plain log lines. Close out the session to record what they imply.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeCampaignId && <SessionControl campaignId={activeCampaignId} className="w-64" />}
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setTranscribeOpen(true)}
          >
            <FileInput className="size-3.5" />
            Transcribe
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!activeSession}
            onClick={() => setCloseOutOpen(true)}
          >
            <BookCheck className="size-3.5" />
            Close out session
            {unclosed > 0 && (
              <span
                className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
                title={`${unclosed} ${unclosed === 1 ? 'entry' : 'entries'} to close out`}
              >
                {unclosed}
              </span>
            )}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {!sessionId && !restoring && activeCampaignId ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="text-sm text-foreground">Start a session to begin your chronicle.</p>
            <Button size="sm" className="mt-2" onClick={() => void startSession()} disabled={starting}>
              {starting ? 'Starting…' : 'Start session'}
            </Button>
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chronicle entries yet.</p>
        ) : (
          ordered.map((ev) => (
            <EntryRow
              key={ev.id}
              event={ev}
              onSave={saveEntry}
              onDelete={() => setConfirmingDelete(ev)}
            />
          ))
        )}
      </div>

      {sessionId && (
        <div className="border-t border-border p-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="What happened? A sentence or two…  (Ctrl+Enter)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Entries save as-is — Close out session to extract them.
            </span>
            <Button size="sm" onClick={() => void submit()} disabled={!text.trim() || busy}>
              Add
            </Button>
          </div>
        </div>
      )}

      <TranscribeDialog open={transcribeOpen} onOpenChange={setTranscribeOpen} />
      {activeSession && (
        <CloseOutDialog session={activeSession} open={closeOutOpen} onOpenChange={setCloseOutOpen} />
      )}
      <DeleteEventDialog
        event={confirmingDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmingDelete(null)
        }}
        onConfirm={(id) => {
          setConfirmingDelete(null)
          void deleteEntry(id)
        }}
      />
    </div>
  )
}

// One chronicle entry: read-only line with hover/focus-revealed edit + delete (P1-4). Clicking edit
// swaps the line for an inline Textarea (Ctrl+Enter saves, Esc cancels — same keys as the composer).
function EntryRow({
  event,
  onSave,
  onDelete
}: {
  event: EventLogEntry
  onSave: (id: string, content: string) => Promise<void>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(event.content)

  function startEdit(): void {
    setDraft(event.content)
    setEditing(true)
  }

  async function commit(): Promise<void> {
    const next = draft.trim()
    if (next && next !== event.content) await onSave(event.id, next)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex gap-3 border-l-2 border-primary/50 pl-3">
        <span className="shrink-0 pt-2 font-mono text-[10px] text-muted-foreground">
          {formatTime(event.timestamp)}
        </span>
        <div className="flex-1 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void commit()} disabled={!draft.trim()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative flex gap-3 border-l-2 border-border pl-3 pr-14">
      <span className="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
        {formatTime(event.timestamp)}
      </span>
      <p className="whitespace-pre-wrap text-sm text-foreground/90">{event.content}</p>
      {/* Revealed on hover OR keyboard focus (P0-1 pattern) — hover-only actions are invisible to tab users. */}
      <div className="absolute right-1 top-0 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={startEdit}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-primary"
          aria-label="Edit entry"
          title="Edit — won’t change notes already extracted"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
          aria-label="Delete entry"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
