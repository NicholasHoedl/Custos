import { toast } from 'sonner'
import type { Note } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
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

// Shared confirm for note deletion (ROADMAP P0-1) — previously the ONE destructive action in the app
// that fired on a bare click (both the Annals view and the entity/Character note lists). Owns the IPC
// delete + error toast; callers pass onDeleted to refresh their own lists. Open while `note` is set;
// Radix fires onOpenChange(false) on cancel AND on action, so the caller clears its state there.
export function DeleteNoteDialog({
  note,
  onOpenChange,
  onDeleted
}: {
  note: Note | null
  onOpenChange: (open: boolean) => void
  onDeleted: (id: string) => void
}) {
  async function confirm(): Promise<void> {
    if (!note) return
    try {
      await ledger.note.delete(note.id)
      onDeleted(note.id)
    } catch (err) {
      toast.error('Could not delete note', { description: String(err) })
    }
  }

  const snippet =
    note && note.content.length > 90 ? `${note.content.slice(0, 90).trimEnd()}…` : note?.content

  return (
    <AlertDialog open={note !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete this note?</AlertDialogTitle>
          <AlertDialogDescription>
            “{snippet}” will be permanently deleted. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void confirm()}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
