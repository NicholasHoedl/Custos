import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  NOTE_CONFIDENCES,
  NOTE_CONFIDENCE_LABELS,
  type Note,
  type NoteConfidence
} from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Label } from '@renderer/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

// Edit a note's text + confidence anywhere it's listed (ADR-032) — the entity/dashboard annals were
// delete-only, forcing a trip to the Annals view to fix a typo. Entity links aren't editable here (that's
// the manual note composer's job); this is the in-place text/confidence fix.
export function NoteEditDialog({
  note,
  open,
  onOpenChange,
  onSaved
}: {
  note: Note
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [content, setContent] = useState(note.content)
  const [confidence, setConfidence] = useState<NoteConfidence>(note.confidence)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setContent(note.content)
      setConfidence(note.confidence)
    }
  }, [open, note])

  async function submit() {
    if (!content.trim() || busy) return
    setBusy(true)
    try {
      await ledger.note.update(note.id, { content: content.trim(), confidence })
      toast.success('Note updated')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not update note', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit note</DialogTitle>
          <DialogDescription>Fix the text or adjust how certain it is.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} autoFocus />
          <div className="space-y-1.5">
            <Label>Confidence</Label>
            <Select value={confidence} onValueChange={(v) => setConfidence(v as NoteConfidence)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_CONFIDENCES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {NOTE_CONFIDENCE_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!content.trim() || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
