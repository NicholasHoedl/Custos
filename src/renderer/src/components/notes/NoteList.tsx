import { useState } from 'react'
import { CircleDashed, Pencil, Trash2 } from 'lucide-react'
import { NOTE_CONFIDENCE_LABELS, type Note } from '@shared/entity-types'
import { formatTimestamp } from '@renderer/lib/format'
import { NoteEditDialog } from './NoteEditDialog'
import { DeleteNoteDialog } from './DeleteNoteDialog'

// Read + edit + delete list of an entity's notes, shared by EntityDetail and the Character dashboard
// (ADR-032) — both were delete-only, so fixing a note's typo meant hunting it down in the Notes view.
// Deletion confirms via the shared DeleteNoteDialog (P0-1).
export function NoteList({
  notes,
  onChanged,
  emptyText = 'No notes recorded.'
}: {
  notes: Note[]
  onChanged: () => void
  emptyText?: string
}) {
  const [editing, setEditing] = useState<Note | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<Note | null>(null)

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
            <p className="font-reading whitespace-pre-wrap text-sm text-foreground/90">{n.content}</p>
            <div className="mt-1 flex items-center gap-2 font-mono text-[0.625rem] text-muted-foreground">
              <span>{formatTimestamp(n.createdAt)}</span>
              {n.confidence !== 'confirmed' && (
                <span className="inline-flex items-center gap-1 text-metal">
                  <CircleDashed className="size-3" />
                  {NOTE_CONFIDENCE_LABELS[n.confidence]}
                </span>
              )}
            </div>
            {/* Revealed on hover OR keyboard focus (P0-1) — hover-only actions are invisible to tab users. */}
            <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                onClick={() => setEditing(n)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Edit note"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => setConfirmingDelete(n)}
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
      <DeleteNoteDialog
        note={confirmingDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmingDelete(null)
        }}
        onDeleted={() => onChanged()}
      />
    </>
  )
}
