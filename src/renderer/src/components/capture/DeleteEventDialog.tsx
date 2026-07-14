import type { EventLogEntry } from '@shared/entity-types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

// Confirm for deleting a chronicle entry (ROADMAP P1-4) — mirrors notes/DeleteNoteDialog (P0-1) so
// every destructive action in the app confirms the same way. The IPC delete + refresh live in the
// caller (EventFeed owns the events list + the sessions bump); this only gates the click.
export function DeleteEventDialog({
  event,
  onOpenChange,
  onConfirm
}: {
  event: EventLogEntry | null
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string) => void
}) {
  const snippet =
    event && event.content.length > 90 ? `${event.content.slice(0, 90).trimEnd()}…` : event?.content

  return (
    <AlertDialog open={event !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            “{snippet}” will be removed from the log. This can’t be undone. Notes already extracted from
            it are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => event && onConfirm(event.id)}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
