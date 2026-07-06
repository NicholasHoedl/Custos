import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType,
  type Lifecycle
} from '@shared/entity-types'
import { profileFor, profileKeys, type ProfileField } from '@shared/entity-profiles'
import { lifecycleHeuristic } from '@shared/lifecycle'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
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
import { TagInput } from './TagInput'
import { StatusCombobox } from './StatusCombobox'

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

function toRows(attributes: Record<string, unknown>, known: Set<string>): AttrRow[] {
  return Object.entries(attributes)
    .filter(([k]) => !known.has(k))
    .map(([key, value]) => ({ key, value: String(value ?? '') }))
}

// The entity editor (create + edit). The visible fields are driven by the type's profile
// (@shared/entity-profiles): promoted traits/goals/status plus type-specific fields stored in the
// `attributes` JSON bag, with a collapsible escape hatch for ad-hoc / legacy attributes.
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
  const [traits, setTraits] = useState<string[]>([])
  const [goals, setGoals] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [lifecycle, setLifecycle] = useState<Lifecycle>('active')
  const [attributes, setAttributes] = useState<Record<string, unknown>>({})
  const [extraRows, setExtraRows] = useState<AttrRow[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const e = entity
    const t = e?.type ?? defaultType
    setName(e?.name ?? '')
    setType(t)
    setDescription(e?.description ?? '')
    setTraits(e?.traits ?? [])
    setGoals(e?.goals ?? [])
    setStatus(e?.status ?? '')
    setLifecycle(e?.lifecycle ?? 'active')
    const attrs = e?.attributes ?? {}
    setAttributes(attrs)
    const extras = toRows(attrs, profileKeys(t))
    setExtraRows(extras)
    setMoreOpen(extras.length > 0)
  }, [open, entity, defaultType])

  const prof = profileFor(type)
  const setAttr = (key: string, val: unknown): void =>
    setAttributes((a) => ({ ...a, [key]: val }))

  // Create-only: switching type re-derives which attribute keys are "extra" and clears a status that
  // isn't valid for the new type. traits/goals are kept in state (gated at submit) so they survive
  // a round-trip through an incompatible type.
  function onTypeChange(next: EntityType): void {
    setType(next)
    setExtraRows(toRows(attributes, profileKeys(next)))
    // Keep the status only if it's a preset of the new type, adopting that preset's lifecycle; otherwise
    // clear it — a status-less entity reads as `unknown` until one is set.
    const match = profileFor(next).status?.find((o) => o.label === status)
    if (match) setLifecycle(match.lifecycle)
    else {
      setStatus('')
      setLifecycle('unknown')
    }
  }

  // updateEntity replaces `attributes` wholesale, so the payload must re-emit every key worth keeping:
  // the profile fields (non-empty) plus any ad-hoc rows whose key isn't owned by the profile.
  function buildAttributes(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const f of prof.fields) {
      const v = attributes[f.key]
      if (f.kind === 'list') {
        // Normally an array; preserve a wrong-shaped legacy value (e.g. a string under a key that is
        // now a list field) rather than silently dropping it on this wholesale-replace save.
        if (Array.isArray(v)) {
          if (v.length > 0) out[f.key] = v
        } else if (v != null && v !== '') {
          out[f.key] = v
        }
      } else if (f.kind === 'number') {
        if (v !== '' && v != null) {
          const n = Number(v)
          out[f.key] = Number.isNaN(n) ? v : n // keep a non-numeric legacy value rather than drop it
        }
      } else {
        const s = typeof v === 'string' ? v.trim() : v
        if (s) out[f.key] = s
      }
    }
    const known = profileKeys(type)
    for (const row of extraRows) {
      const k = row.key.trim()
      if (k && !known.has(k)) out[k] = row.value
    }
    return out
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const attrs = buildAttributes()
      const payloadTraits = prof.traits ? traits : []
      const payloadGoals = prof.goals ? goals : []
      const saved = entity
        ? await ledger.entity.update(entity.id, {
            name: trimmed,
            description: description.trim() || null,
            traits: payloadTraits,
            goals: payloadGoals,
            attributes: attrs,
            status: status.trim() || null,
            lifecycle
          })
        : await ledger.entity.create({
            campaignId,
            type,
            name: trimmed,
            description: description.trim() || undefined,
            traits: payloadTraits,
            goals: payloadGoals,
            attributes: attrs,
            status: status.trim() || undefined,
            lifecycle
          })
      useUiStore.getState().bumpEntities() // refresh every entity list (e.g. scene selectors) now
      toast.success(editing ? 'Saved' : `Added ${ENTITY_TYPE_LABELS[type]}`, { description: trimmed })
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not save', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  function renderField(field: ProfileField) {
    const fid = `ef-attr-${field.key}`
    const raw = attributes[field.key]
    if (field.kind === 'list') {
      return (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={fid}>{field.label}</Label>
          <TagInput
            id={fid}
            value={Array.isArray(raw) ? (raw as string[]) : []}
            onChange={(v) => setAttr(field.key, v)}
            placeholder={field.placeholder}
          />
        </div>
      )
    }
    if (field.kind === 'textarea') {
      return (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={fid}>{field.label}</Label>
          <Textarea
            id={fid}
            value={typeof raw === 'string' ? raw : ''}
            onChange={(e) => setAttr(field.key, e.target.value)}
            rows={3}
            placeholder={field.placeholder}
          />
        </div>
      )
    }
    if (field.kind === 'number') {
      return (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={fid}>{field.label}</Label>
          <Input
            id={fid}
            type="number"
            inputMode="numeric"
            value={raw == null ? '' : String(raw)}
            onChange={(e) => setAttr(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      )
    }
    if (field.kind === 'select') {
      const current = typeof raw === 'string' ? raw : ''
      const opts = field.options ?? []
      const hasLegacy = Boolean(current) && !opts.includes(current)
      return (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={fid}>{field.label}</Label>
          <div className="flex items-center gap-2">
            <Select value={current} onValueChange={(v) => setAttr(field.key, v)}>
              <SelectTrigger id={fid} className="flex-1">
                <SelectValue placeholder={`Choose ${field.label.toLowerCase()}…`} />
              </SelectTrigger>
              <SelectContent>
                {hasLegacy && <SelectItem value={current}>{current}</SelectItem>}
                {opts.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAttr(field.key, '')}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )
    }
    return (
      <div key={field.key} className="space-y-1.5">
        <Label htmlFor={fid}>{field.label}</Label>
        <Input
          id={fid}
          value={typeof raw === 'string' ? raw : ''}
          onChange={(e) => setAttr(field.key, e.target.value)}
          placeholder={field.placeholder}
        />
      </div>
    )
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
              <Label htmlFor="ef-type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => onTypeChange(v as EntityType)}
                disabled={editing}
              >
                <SelectTrigger id="ef-type">
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

          {prof.traits && (
            <div className="space-y-1.5">
              <Label htmlFor="ef-traits">Traits</Label>
              <TagInput
                id="ef-traits"
                value={traits}
                onChange={setTraits}
                placeholder="Add a trait — e.g. gruff"
              />
            </div>
          )}

          {prof.goals && (
            <div className="space-y-1.5">
              <Label htmlFor="ef-goals">Goals</Label>
              <TagInput
                id="ef-goals"
                value={goals}
                onChange={setGoals}
                placeholder="Add a goal — e.g. protect the town"
              />
            </div>
          )}

          {prof.status && (
            <div className="space-y-1.5">
              <Label htmlFor="ef-status">Status</Label>
              <StatusCombobox
                id="ef-status"
                value={status}
                onChange={(v, lc) => {
                  setStatus(v)
                  setLifecycle(lc ?? lifecycleHeuristic(v.trim() || null))
                }}
                options={prof.status}
              />
              {(lifecycle === 'ended' || lifecycle === 'presumed_ended') && (
                <label className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={lifecycle === 'presumed_ended'}
                    onChange={(e) => setLifecycle(e.target.checked ? 'presumed_ended' : 'ended')}
                  />
                  Presumed / unconfirmed — believed over, but the party hasn’t confirmed it.
                </label>
              )}
              <p className="text-[11px] text-muted-foreground">
                Where this stands now — the AI trusts it for “now vs. then.”
              </p>
            </div>
          )}

          {prof.fields.map(renderField)}

          <div className="space-y-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => setMoreOpen((o) => !o)}
            >
              {moreOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              More fields{extraRows.length > 0 ? ` (${extraRows.length})` : ''}
            </Button>
            {moreOpen && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Custom attributes outside the {ENTITY_TYPE_LABELS[type]} profile.
                </p>
                {extraRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        setExtraRows((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))
                        )
                      }
                      placeholder="field"
                      className="w-1/3"
                    />
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        setExtraRows((rs) =>
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
                      onClick={() => setExtraRows((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExtraRows((r) => [...r, { key: '', value: '' }])}
                >
                  <Plus className="size-3.5" />
                  Add field
                </Button>
              </div>
            )}
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
