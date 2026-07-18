import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { EventLogEntry } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useEvents } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { formatTime } from '@renderer/lib/format'
import { PaneHeader } from '@renderer/components/chrome'
import { Button } from '@renderer/components/ui/button'
import { MentionTextarea } from '@renderer/components/entities/MentionTextarea'
import { ChronicleInfo } from '@renderer/components/capture/ChronicleInfo'
import { DeleteEventDialog } from '@renderer/components/capture/DeleteEventDialog'
import { SessionControl } from '@renderer/components/sessions/SessionControl'

interface EventFeedProps {
  sessionId: string | null
  /** True while the persisted session is still being restored (T3) — shown instead of the
   *  "start a session" copy so a real zero-sessions campaign reads differently from a loading one. */
  restoring?: boolean
}

// The Journal — the primary at-the-table capture surface. You jot a plain sentence or two of what
// happened; entries save AS-IS to the session log (no per-entry AI, ADR-035 as-built). Turning a
// session's log into entities/notes (Extract), enriching them (Illuminate), and importing outside notes
// (Transcribe) all live on the Sessions page now (ADR-051); the Chronicle header holds ONLY the
// active-session switcher. Internals still ride the event_log table (createEvent); "journal" is the
// user-facing name (Chronicle). Manual entity/note editing lives in Codex.
export function EventFeed({ sessionId, restoring = false }: EventFeedProps) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const { events, refresh } = useEvents(sessionId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<EventLogEntry | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // E2: composer draft persistence — keyed per session so switching swaps drafts, and a reload/crash keeps
  // an unsent entry. Load happens on session change; persistence rides the user's edits (below), never the
  // programmatic loads, so one session's text can't leak into another.
  const draftKey = sessionId ? `ledger.chronicleDraft:${sessionId}` : null
  useEffect(() => {
    setText(draftKey ? (localStorage.getItem(draftKey) ?? '') : '')
  }, [draftKey])

  function onComposerChange(v: string): void {
    setText(v)
    if (!draftKey) return
    if (v) localStorage.setItem(draftKey, v)
    else localStorage.removeItem(draftKey)
  }

  // Start the first/next session right here — Chronicle is the default view, so a campaign with no
  // session must not dead-end on it (ADR-032).
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
    // E1: pin the session at submit time — the entry lands in the session it was WRITTEN in even if the
    // active session switches mid-create (the closure already captures `sessionId`; this makes it explicit
    // and refactor-proof). No "you switched" toast: it would false-fire on a render-lag mismatch and its
    // bottom-right position covers the composer's own Add button.
    const target = sessionId
    if (!content || !target || busy) return
    setBusy(true)
    try {
      await ledger.event.create({ sessionId: target, content })
      setText('')
      if (draftKey) localStorage.removeItem(draftKey) // E2: clear the saved draft on a successful add
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
      useUiStore.getState().bumpSessions() // C1: an edit re-flags the session (updatedAt bumped) so the
      // "N to extract" badge refreshes — an edited-after-extract entry should nudge a re-extract.
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
      <PaneHeader
        icon={NotebookPen}
        title="Chronicle"
        action={
          <div className="flex items-center gap-1">
            <ChronicleInfo />
            {activeCampaignId && (
              <SessionControl campaignId={activeCampaignId} className="w-64" />
            )}
          </div>
        }
      />

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {!sessionId && !restoring && activeCampaignId ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="text-sm text-foreground">Start a session to begin your chronicle.</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => void startSession()}
              disabled={starting}
            >
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
        <div data-tour="chronicle-composer" className="border-t border-border p-3">
          <MentionTextarea
            value={text}
            onValueChange={onComposerChange}
            rows={2}
            placeholder="What happened? A sentence or two…  (Ctrl+Enter)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={!text.trim() || busy}>
              Add
            </Button>
          </div>
        </div>
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
        <span className="shrink-0 pt-2 font-mono text-[0.625rem] text-muted-foreground">
          {formatTime(event.timestamp)}
        </span>
        <div className="flex-1 space-y-1.5">
          <MentionTextarea
            value={draft}
            onValueChange={setDraft}
            rows={2}
            autoFocus
            className="font-reading"
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
      <span className="shrink-0 pt-0.5 font-mono text-[0.625rem] text-muted-foreground">
        {formatTime(event.timestamp)}
      </span>
      <p className="font-reading whitespace-pre-wrap text-sm text-foreground/90">{event.content}</p>
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
