import { useEffect, useState } from 'react'
import { Info, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ENTITY_TYPE_LABELS, type Entity } from '@shared/entity-types'
import { relationsForTypes, type RelationKey } from '@shared/relations'
import { ledger } from '@renderer/lib/ipc'
import { useRelationships } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { EntityBadge } from './EntityBadge'
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

  async function remove(id: string) {
    try {
      await ledger.link.delete(id)
      refresh()
    } catch (err) {
      toast.error('Could not remove link', { description: String(err) })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Relationships</h3>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          <Link2 className="size-3.5" />
          Link to…
        </Button>
      </div>

      {relationships.length === 0 ? (
        <p className="text-xs text-muted-foreground">No relationships yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {relationships.map((rel) => (
            <li key={rel.link.id} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">{rel.label}</span>
              <EntityBadge entity={rel.other} onClick={() => setSelectedEntity(rel.other.id)} />
              {rel.link.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Info className="size-3.5 shrink-0 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{rel.link.description}</TooltipContent>
                </Tooltip>
              )}
              <button
                onClick={() => remove(rel.link.id)}
                className="ml-auto shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                aria-label="Remove link"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
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
    </div>
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setOther(null)
      setRelation('')
      setDescription('')
    }
  }, [open])

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
        description: description.trim() || undefined
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
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
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
                <SelectTrigger>
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
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!other || !relation || busy}>
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
