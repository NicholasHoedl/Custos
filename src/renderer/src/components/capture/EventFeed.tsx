import { useState } from 'react'
import { BookCheck, FileInput } from 'lucide-react'
import { toast } from 'sonner'
import { ledger } from '@renderer/lib/ipc'
import { useEvents, useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { formatTime } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { TranscribeDialog } from '@renderer/components/capture/TranscribeDialog'
import { CloseOutDialog } from '@renderer/components/capture/CloseOutDialog'
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
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [transcribeOpen, setTranscribeOpen] = useState(false)
  const [closeOutOpen, setCloseOutOpen] = useState(false)

  // The wizard needs the full Session object (number for copy, id for stamping).
  const activeSession = sessions.find((s) => s.id === sessionId) ?? null

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
    } catch (err) {
      toast.error('Could not save chronicle entry', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const ordered = [...events].sort((a, b) => b.timestamp - a.timestamp)

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
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
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
            <div key={ev.id} className="flex gap-3 border-l-2 border-border pl-3">
              <span className="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
                {formatTime(ev.timestamp)}
              </span>
              <p className="whitespace-pre-wrap text-sm text-foreground/90">{ev.content}</p>
            </div>
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
    </div>
  )
}
