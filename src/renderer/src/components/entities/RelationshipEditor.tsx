import { useEffect, useRef, useState } from 'react'
import { Link2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPE_LABELS,
  NOTE_CONFIDENCES,
  NOTE_CONFIDENCE_LABELS,
  type Entity,
  type NoteConfidence
} from '@shared/entity-types'
import type { RelationshipView } from '@shared/graph-types'
import { relationsForTypes, type RelationKey } from '@shared/relations'
import { ledger } from '@renderer/lib/ipc'
import { useRelationships } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { EntityBadge } from './EntityBadge'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

interface RelationshipEditorProps {
  entity: Entity
  allEntities: Entity[]
}

// First-class relationship linking (P1-06). Edges are authored from this entity (`from`) to a target
// (`to`); the registry decides which relations are valid and supplies the directional label on read.
export function RelationshipEditor({ entity, allEntities }: RelationshipEditorProps) {
  const { relationships, refresh } = useRelationships(entity.id)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRel, setEditingRel] = useState<RelationshipView | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Keyboard: press "L" (while an entity is open and you're not typing) to open the link picker.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (dialogOpen || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'l') return
      // Only the VISIBLE editor responds (ADR-032): MainPanel keeps every view mounted (toggling
      // `hidden`), so this window listener would otherwise fire on an off-screen pane — opening the
      // wrong entity's dialog, or stacking two when a Codex entity is also selected. offsetParent is
      // null when the element (or an ancestor) is display:none.
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      setDialogOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogOpen])

  async function sever(id: string) {
    try {
      await ledger.link.sever(id) // soft close — kept in the timeline as ended (chronology)
      refresh()
    } catch (err) {
      toast.error('Could not unlink', { description: String(err) })
    }
  }

  async function hardDelete(id: string) {
    try {
      await ledger.link.delete(id) // escape hatch for a mis-entry — removed with no history
      refresh()
    } catch (err) {
      toast.error('Could not delete', { description: String(err) })
    }
  }

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="inscribed text-xs">Ties</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          title="Link to another entity (press L)"
        >
          <Link2 className="size-3.5" />
          Link to…
        </Button>
      </div>

      {relationships.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ties yet.</p>
      ) : (
        <ul className="space-y-1">
          {relationships.map((rel) => {
            // Orient the per-direction disposition for THIS entity (ADR-033): near = how it feels about
            // the other; far = how the other feels back.
            const near = rel.direction === 'out' ? rel.link.fromDisposition : rel.link.toDisposition
            const far = rel.direction === 'out' ? rel.link.toDisposition : rel.link.fromDisposition
            const feelings = [
              near && `${entity.name} feels ${near}`,
              far && `${rel.other.name} feels ${far}`
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={rel.link.id} className="rounded-md px-1 py-1 hover:bg-muted/40">
                <div className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">{rel.label}</span>
                  <EntityBadge entity={rel.other} onClick={() => setSelectedEntity(rel.other.id)} />
                  {rel.link.confidence !== 'confirmed' && (
                    <span className="shrink-0 rounded bg-metal/15 px-1.5 py-0.5 text-[0.625rem] text-metal">
                      {NOTE_CONFIDENCE_LABELS[rel.link.confidence]}
                    </span>
                  )}
                  <div className="ml-auto flex shrink-0 items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setEditingRel(rel)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Edit tie"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Edit the “why / context” note</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => sever(rel.link.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Unlink (keeps history)"
                    >
                      <X className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Unlink — kept in the timeline as ended</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => hardDelete(rel.link.id)}
                      className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Delete permanently"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete permanently — for a mistake (no history)</TooltipContent>
                </Tooltip>
                  </div>
                </div>
                {(rel.link.description || feelings) && (
                  <div className="mt-0.5 space-y-0.5 pl-1 text-xs text-muted-foreground">
                    {rel.link.description && <p className="italic">{rel.link.description}</p>}
                    {feelings && <p>{feelings}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <LinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entity={entity}
        candidates={allEntities.filter((e) => e.id !== entity.id)}
        onCreated={() => {
          setDialogOpen(false)
          refresh()
        }}
      />

      {editingRel && (
        <TieEditDialog
          rel={editingRel}
          subjectName={entity.name}
          open
          onOpenChange={(o) => {
            if (!o) setEditingRel(null)
          }}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

// Edit a tie's context: description + per-direction disposition + confidence (ADR-033). The relation +
// endpoints are immutable — changing those is a sever + a new link.
function TieEditDialog({
  rel,
  subjectName,
  open,
  onOpenChange,
  onSaved
}: {
  rel: RelationshipView
  subjectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const link = rel.link
  const isOut = rel.direction === 'out'
  const fromName = isOut ? subjectName : rel.other.name
  const toName = isOut ? rel.other.name : subjectName

  const [description, setDescription] = useState(link.description ?? '')
  const [fromDisposition, setFromDisposition] = useState(link.fromDisposition ?? '')
  const [toDisposition, setToDisposition] = useState(link.toDisposition ?? '')
  const [confidence, setConfidence] = useState<NoteConfidence>(link.confidence)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDescription(link.description ?? '')
      setFromDisposition(link.fromDisposition ?? '')
      setToDisposition(link.toDisposition ?? '')
      setConfidence(link.confidence)
    }
  }, [open, link])

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      await ledger.link.update(link.id, {
        description: description.trim() || null,
        fromDisposition: fromDisposition.trim() || null,
        toDisposition: toDisposition.trim() || null,
        confidence
      })
      toast.success('Tie updated')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not update tie', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit tie</DialogTitle>
          <DialogDescription>The why, how each side feels, and how sure you are.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Why / context</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Met in the mines; owes them a debt."
            />
          </div>
          <div className="space-y-1.5">
            <Label>How {fromName} feels about {toName}</Label>
            <Input
              value={fromDisposition}
              onChange={(e) => setFromDisposition(e.target.value)}
              placeholder="e.g. loyal but carries guilt"
            />
          </div>
          <div className="space-y-1.5">
            <Label>How {toName} feels about {fromName}</Label>
            <Input
              value={toDisposition}
              onChange={(e) => setToDisposition(e.target.value)}
              placeholder="e.g. protective, mentor-fond"
            />
          </div>
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
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface LinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entity: Entity
  candidates: Entity[]
  onCreated: () => void
}

function LinkDialog({ open, onOpenChange, entity, candidates, onCreated }: LinkDialogProps) {
  const [other, setOther] = useState<Entity | null>(null)
  const [relation, setRelation] = useState<RelationKey | ''>('')
  const [description, setDescription] = useState('')
  const [fromDisposition, setFromDisposition] = useState('')
  const [toDisposition, setToDisposition] = useState('')
  const [confidence, setConfidence] = useState<NoteConfidence>('confirmed')
  const [busy, setBusy] = useState(false)
  const relationTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      setOther(null)
      setRelation('')
      setDescription('')
      setFromDisposition('')
      setToDisposition('')
      setConfidence('confirmed')
    }
  }, [open])

  // Once a target is picked (keyboard: type → arrow → Enter in the Command), move focus to the
  // relationship select so the whole flow stays keyboard-native without reaching for the mouse.
  useEffect(() => {
    if (other) relationTriggerRef.current?.focus()
  }, [other])

  const allowed = other ? relationsForTypes(entity.type, other.type) : []

  function pick(target: Entity) {
    setOther(target)
    setRelation(relationsForTypes(entity.type, target.type)[0]?.key ?? '')
  }

  async function submit() {
    if (!other || !relation || busy) return
    setBusy(true)
    try {
      await ledger.link.create({
        campaignId: entity.campaignId,
        fromEntityId: entity.id,
        toEntityId: other.id,
        relation,
        description: description.trim() || undefined,
        fromDisposition: fromDisposition.trim() || undefined,
        toDisposition: toDisposition.trim() || undefined,
        confidence
      })
      toast.success('Linked', { description: `${entity.name} → ${other.name}` })
      onCreated()
    } catch (err) {
      toast.error('Could not link', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Link {entity.name}</DialogTitle>
          <DialogDescription>Connect this entity to another in the campaign.</DialogDescription>
        </DialogHeader>

        {!other ? (
          <Command className="rounded-md border border-border">
            <CommandInput placeholder="Search entities…" />
            <CommandList>
              <CommandEmpty>No entities found.</CommandEmpty>
              <CommandGroup>
                {candidates.map((c) => (
                  <CommandItem key={c.id} value={`${c.name} ${c.type}`} onSelect={() => pick(c)}>
                    <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
                      {ENTITY_TYPE_LABELS[c.type]}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Target:</span>
              <EntityBadge entity={other} />
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOther(null)}>
                Change
              </Button>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Relationship</span>
              <Select value={relation} onValueChange={(v) => setRelation(v as RelationKey)}>
                <SelectTrigger ref={relationTriggerRef}>
                  <SelectValue placeholder="Choose a relationship…" />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {entity.name} {r.forward} {other.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Why / context (optional)</span>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. since the heist in Neverwinter"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-1.5">
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {entity.name} feels…
                </span>
                <Input
                  value={fromDisposition}
                  onChange={(e) => setFromDisposition(e.target.value)}
                  placeholder="loyal, wary…"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {other.name} feels…
                </span>
                <Input
                  value={toDisposition}
                  onChange={(e) => setToDisposition(e.target.value)}
                  placeholder="protective, hostile…"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Confidence</span>
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
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!other || !relation || busy}>
            {busy ? 'Adding…' : 'Add link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
