import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Session } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import {
  DeleteSessionDialog,
  EditSessionDialog
} from '@renderer/components/sessions/SessionDialogs'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

function sessionLabel(s: Session): string {
  const suffix = s.title ? ` · ${s.title}` : s.date ? ` · ${s.date}` : ''
  return `Session ${s.number}${suffix}`
}

/**
 * The ACTIVE-session switcher (select + edit/delete + new) — extracted from the Sidebar (ADR-036) and
 * mounted in the Chronicle header, the capture surface the active session actually governs. It also owns
 * the auto-select-latest invariant; since MainPanel keeps every view mounted (hidden, not unmounted),
 * that effect keeps running app-wide whenever a campaign is active — exactly the Sidebar-era guarantee.
 */
export function SessionControl({
  campaignId,
  className
}: {
  campaignId: string
  className?: string
}) {
  const { sessions, refresh } = useSessions(campaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // A just-created session id isn't in the (stale) list until the bump's refetch lands — activating it
  // immediately made the auto-select effect below see an "invalid" id and revert to the OLD latest, so
  // "+" created Session N+1 but silently left Session N active (and entries kept landing there). Park
  // the intent here; the effect activates it once the id is actually listed.
  const pendingActivate = useRef<string | null>(null)

  // Auto-select the most recent session whenever the active one isn't a valid session in this campaign
  // — covers first load (none active) and recovery after the active session is deleted.
  useEffect(() => {
    if (pendingActivate.current) {
      if (sessions.some((s) => s.id === pendingActivate.current)) {
        setActiveSession(pendingActivate.current)
        pendingActivate.current = null
      }
      return // hold the latest-pick while a just-created id is in flight
    }
    if (sessions.length > 0 && !sessions.some((s) => s.id === activeSessionId)) {
      const latest = sessions.reduce((a, b) => (a.number >= b.number ? a : b))
      setActiveSession(latest.id)
    }
  }, [sessions, activeSessionId, setActiveSession])

  async function newSession() {
    if (busy) return
    setBusy(true)
    try {
      const session = await ledger.session.create({ campaignId })
      pendingActivate.current = session.id
      useUiStore.getState().bumpSessions()
      toast.success(`Session ${session.number} started`)
    } catch (err) {
      toast.error('Could not start session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Select
        value={activeSessionId ?? ''}
        onValueChange={setActiveSession}
        disabled={sessions.length === 0}
      >
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder="No sessions" />
        </SelectTrigger>
        <SelectContent>
          {[...sessions]
            .sort((a, b) => b.number - a.number)
            .map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {sessionLabel(s)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {activeSession && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Session actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="outline"
        size="icon"
        onClick={newSession}
        disabled={busy}
        aria-label="New session"
        data-tour="new-session"
      >
        <Plus className="size-4" />
      </Button>
      {activeSession && (
        <>
          <EditSessionDialog
            session={activeSession}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={refresh}
          />
          <DeleteSessionDialog
            session={activeSession}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => {
              setActiveSession(null) // the auto-select effect re-picks the latest remaining session
              refresh()
            }}
          />
        </>
      )}
    </div>
  )
}
