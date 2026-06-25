import { useState } from 'react'
import { toast } from 'sonner'
import { ledger } from '@renderer/lib/ipc'
import { useEvents } from '@renderer/hooks/use-ledger'
import { formatTime } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'

interface EventFeedProps {
  sessionId: string | null
}

// The chronological session feed — quotes and beats logged as they happen (P1-08). Shown in the
// detail pane when no entity is selected, so the session timeline is always one glance away.
export function EventFeed({ sessionId }: EventFeedProps) {
  const { events, refresh } = useEvents(sessionId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function log() {
    const content = text.trim()
    if (!content || !sessionId || busy) return
    setBusy(true)
    try {
      await ledger.event.create({ sessionId, content })
      setText('')
      refresh()
    } catch (err) {
      toast.error('Could not log event', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const ordered = [...events].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <h2 className="font-display text-xl font-semibold text-foreground">Session log</h2>
        <p className="text-xs text-muted-foreground">
          {sessionId ? 'Quotes and beats as they happen.' : 'Start a session to log events.'}
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events logged yet.</p>
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
            placeholder="Log a quote or beat…  (Ctrl+Enter)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                log()
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={log} disabled={!text.trim() || busy}>
              Log
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
