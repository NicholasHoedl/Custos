import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

// Popup editor for a promoted string list (traits / goals / flaws / voice examples) — ADR-030 v3.
// Every item is an editable row (with a delete ✕); an add field appends; NOTHING persists until Save
// (Cancel discards). One write per editing session — no per-keystroke saves, no rapid-edit races.
export function ListEditDialog({
  title,
  hint,
  placeholder,
  open,
  onOpenChange,
  value,
  onSave
}: {
  title: string
  hint?: string
  placeholder?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string[]
  onSave: (next: string[]) => Promise<void> | void
}) {
  const [rows, setRows] = useState<string[]>(value)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  // Re-seed from the saved list each time the dialog opens (it may stay mounted between opens).
  useEffect(() => {
    if (open) {
      setRows(value)
      setDraft('')
    }
  }, [open, value])

  function add(): void {
    const t = draft.trim()
    if (!t) return
    setRows((r) => [...r, t])
    setDraft('')
  }

  async function save(): Promise<void> {
    setBusy(true)
    try {
      // Include a typed-but-not-Added draft; trim, drop empties, dedupe (first occurrence wins).
      const seen = new Set<string>()
      const cleaned: string[] = []
      for (const r of [...rows, draft]) {
        const t = r.trim()
        if (t && !seen.has(t)) {
          seen.add(t)
          cleaned.push(t)
        }
      }
      await onSave(cleaned)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {rows.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Nothing here yet — add one below.
            </p>
          )}
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? e.target.value : r)))
                }
                className="h-8 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
              placeholder={placeholder ?? 'Add…'}
              className="h-8 flex-1"
            />
            <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
