import { useEffect, useState } from 'react'
import { CalendarClock, Check, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useEvents, useSessions } from '@renderer/hooks/use-ledger'
import { formatTime } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/chrome'
import { SessionRecap } from '@renderer/components/sessions/SessionRecap'
import { EnrichDialog } from '@renderer/components/sessions/EnrichDialog'
import {
  DeleteSessionDialog,
  EditSessionDialog
} from '@renderer/components/sessions/SessionDialogs'

// Sessions view (ADR-032): a browsable list of the campaign's sessions with their saved summaries, and a
// detail pane hosting the Previously… recap + the session's chronicle entries + the Illuminate pass
// (tier-2 enrichment, ADR-035). Distinct from the Chronicle header's SessionControl, which switches the
// ACTIVE session for capture; here you browse and manage them all.
export function SessionsView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  if (!activeCampaignId) {
    return (
      <EmptyState icon={CalendarClock} title="No campaign selected">
        Choose a campaign in the sidebar to browse its sessions.
      </EmptyState>
    )
  }
  return <SessionsWorkspace campaignId={activeCampaignId} />
}

function SessionsWorkspace({ campaignId }: { campaignId: string }) {
  const { sessions, refresh } = useSessions(campaignId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const ordered = [...sessions].sort((a, b) => b.number - a.number)

  // Default to the newest session, and recover if the selected one is deleted. Keyed off `sessions` +
  // `selectedId` only (not the freshly-sorted `ordered`, which would re-run the effect every render).
  useEffect(() => {
    if (sessions.length > 0 && (!selectedId || !sessions.some((s) => s.id === selectedId))) {
      const newest = sessions.reduce((a, b) => (a.number >= b.number ? a : b))
      setSelectedId(newest.id)
    }
  }, [sessions, selectedId])

  const selected = sessions.find((s) => s.id === selectedId) ?? null

  async function newSession() {
    if (busy) return
    setBusy(true)
    try {
      const s = await ledger.session.create({ campaignId })
      useUiStore.getState().bumpSessions()
      setSelectedId(s.id)
      toast.success(`Session ${s.number} started`)
    } catch (err) {
      toast.error('Could not start session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Master list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border p-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Sessions</h2>
          <Button variant="outline" size="sm" onClick={newSession} disabled={busy}>
            <Plus className="size-3.5" />
            New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {ordered.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No sessions yet — start one.</p>
          ) : (
            ordered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                  s.id === selectedId
                    ? 'bg-primary/15 text-primary'
                    : 'text-foreground hover:bg-muted/60'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">Session {s.number}</span>
                  {s.summary && <Check className="size-3 shrink-0 text-primary" aria-label="Recapped" />}
                </div>
                {(s.title || s.date) && (
                  <div className="truncate text-xs text-muted-foreground">
                    {s.title ?? ''}
                    {s.title && s.date ? ' · ' : ''}
                    {s.date ?? ''}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto max-w-2xl space-y-5 p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  Session {selected.number}
                  {selected.title ? ` — ${selected.title}` : ''}
                </h2>
                {selected.date && <p className="text-sm text-muted-foreground">{selected.date}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setEnrichOpen(true)}>
                  <Sparkles className="size-3.5" />
                  Illuminate
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>
            </div>

            <SessionRecap session={selected} onSaved={refresh} />

            <ChronicleEntries sessionId={selected.id} />

            <EnrichDialog session={selected} open={enrichOpen} onOpenChange={setEnrichOpen} />
            <EditSessionDialog
              session={selected}
              open={editOpen}
              onOpenChange={setEditOpen}
              onSaved={refresh}
            />
            <DeleteSessionDialog
              session={selected}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              onDeleted={() => {
                setSelectedId(null) // the default-select effect re-picks the newest remaining session
                refresh()
              }}
            />
          </div>
        ) : (
          <EmptyState icon={CalendarClock} title="No sessions yet">
            Start a session to begin recording your campaign.
          </EmptyState>
        )}
      </div>
    </div>
  )
}

// The session's raw chronicle entries, read-only (authored/edited in Chronicle).
function ChronicleEntries({ sessionId }: { sessionId: string }) {
  const { events } = useEvents(sessionId)
  const ordered = [...events].sort((a, b) => b.timestamp - a.timestamp)
  return (
    <div className="space-y-2">
      <h3 className="inscribed text-xs">Chronicle</h3>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No chronicle entries for this session.</p>
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
  )
}
