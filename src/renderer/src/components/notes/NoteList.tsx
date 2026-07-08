import { useState } from 'react'
import { CircleDashed, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { NOTE_CONFIDENCE_LABELS, type Note } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { formatTimestamp } from '@renderer/lib/format'
import { NoteEditDialog } from './NoteEditDialog'

// Read + edit + delete list of an entity's annals, shared by EntityDetail and the Character dashboard
// (ADR-032) — both were delete-only, so fixing a note's typo meant hunting it down in the Annals view.
export function NoteList({
  notes,
  onChanged,
  emptyText = 'No annals recorded.'
}: {
  notes: Note[]
  onChanged: () => void
  emptyText?: string
}) {
  const [editing, setEditing] = useState<Note | null>(null)

  async function remove(id: string): Promise<void> {
    try {
      await ledger.note.delete(id)
      onChanged()
    } catch (err) {
      toast.error('Could not delete note', { description: String(err) })
    }
  }

  if (notes.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }

  return (
    <>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className="group relative rounded-md border border-border bg-card/40 p-3 pr-16"
          >
            <p className="whitespace-pre-wrap text-sm text-foreground/90">{n.content}</p>
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span>{formatTimestamp(n.createdAt)}</span>
              {n.confidence !== 'confirmed' && (
                <span className="inline-flex items-center gap-1 text-metal">
                  <CircleDashed className="size-3" />
                  {NOTE_CONFIDENCE_LABELS[n.confidence]}
                </span>
              )}
            </div>
            <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => setEditing(n)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Edit note"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => void remove(n.id)}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label="Delete note"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <NoteEditDialog
          note={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          onSaved={onChanged}
        />
      )}
    </>
  )
}
