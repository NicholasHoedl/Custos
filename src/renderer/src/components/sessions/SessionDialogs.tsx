import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Session } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

// Session edit/delete dialogs — shared by the sidebar's SessionControl (active-session switcher) and the
// Sessions view (browsable list). Lifted out of Sidebar in the ADR-032 IA restructure so both surfaces
// drive the same forms.

export function EditSessionDialog({
  session,
  open,
  onOpenChange,
  onSaved
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(session.title ?? '')
  const [date, setDate] = useState(session.date ?? '')
  const [summary, setSummary] = useState(session.summary ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(session.title ?? '')
      setDate(session.date ?? '')
      setSummary(session.summary ?? '')
    }
  }, [open, session])

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      await ledger.session.update(session.id, {
        title: title.trim() || null,
        date: date.trim() || null,
        summary: summary.trim() || null
      })
      toast.success(`Session ${session.number} updated`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not update session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit session {session.number}</DialogTitle>
          <DialogDescription>Update this session’s title, date, or summary.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="es-title">Title (optional)</Label>
            <Input
              id="es-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-date">Date (optional)</Label>
            <Input id="es-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-summary">Summary (optional)</Label>
            <Textarea
              id="es-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteSessionDialog({
  session,
  open,
  onOpenChange,
  onDeleted
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    if (busy) return
    setBusy(true)
    try {
      await ledger.session.delete(session.id)
      useUiStore.getState().bumpSessions()
      toast.success(`Session ${session.number} deleted`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error('Could not delete session', { description: String(err) })
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete session {session.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the session and its event-log entries. Notes captured during it are kept, but
            they’ll no longer be linked to a session. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={doDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
