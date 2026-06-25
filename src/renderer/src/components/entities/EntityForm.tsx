import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType
} from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

interface AttrRow {
  key: string
  value: string
}

interface EntityFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
  entity?: Entity | null
  defaultType?: EntityType
  onSaved: (entity: Entity) => void
}

function toRows(attributes: Record<string, unknown>): AttrRow[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: String(value ?? '') }))
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// The richer "90s budget" entity editor — handles both create and edit. Traits/goals stay promoted
// (Suggest reads them); everything else is generic key/value attribute rows.
export function EntityForm({
  open,
  onOpenChange,
  campaignId,
  entity,
  defaultType = 'npc',
  onSaved
}: EntityFormProps) {
  const editing = Boolean(entity)
  const [name, setName] = useState('')
  const [type, setType] = useState<EntityType>(defaultType)
  const [description, setDescription] = useState('')
  const [traits, setTraits] = useState('')
  const [goals, setGoals] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<AttrRow[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(entity?.name ?? '')
    setType(entity?.type ?? defaultType)
    setDescription(entity?.description ?? '')
    setTraits(entity?.traits.join(', ') ?? '')
    setGoals(entity?.goals.join(', ') ?? '')
    setStatus(entity?.status ?? '')
    setRows(entity ? toRows(entity.attributes) : [])
  }, [open, entity, defaultType])

  function buildAttributes(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (key) out[key] = row.value
    }
    return out
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const saved = entity
        ? await ledger.entity.update(entity.id, {
            name: trimmed,
            description: description.trim() || null,
            traits: splitList(traits),
            goals: splitList(goals),
            attributes: buildAttributes(),
            status: status.trim() || null
          })
        : await ledger.entity.create({
            campaignId,
            type,
            name: trimmed,
            description: description.trim() || undefined,
            traits: splitList(traits),
            goals: splitList(goals),
            attributes: buildAttributes(),
            status: status.trim() || undefined
          })
      toast.success(editing ? 'Saved' : `Added ${ENTITY_TYPE_LABELS[type]}`, { description: trimmed })
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not save', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editing ? 'Edit entity' : 'New entity'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the details for this entity.'
              : 'Create a person, place, faction, quest, item, or character.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ef-name">Name</Label>
              <Input
                id="ef-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as EntityType)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ENTITY_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ef-desc">Description</Label>
            <Textarea
              id="ef-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Who or what is this?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ef-traits">Traits</Label>
              <Input
                id="ef-traits"
                value={traits}
                onChange={(e) => setTraits(e.target.value)}
                placeholder="gruff, loyal"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ef-goals">Goals</Label>
              <Input
                id="ef-goals"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="protect the town"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Separate multiple traits or goals with commas.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="ef-status">Status</Label>
            <Input
              id="ef-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="alive, active, hidden…"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Attributes</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((r) => [...r, { key: '', value: '' }])}
              >
                <Plus className="size-3.5" />
                Add field
              </Button>
            </div>
            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Optional type-specific fields (e.g. race, alignment, value).
              </p>
            )}
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                    }
                    placeholder="field"
                    className="w-1/3"
                  />
                  <Input
                    value={row.value}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))
                      )
                    }
                    placeholder="value"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
