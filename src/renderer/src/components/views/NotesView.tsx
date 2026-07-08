import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, CircleDashed, Pencil, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  NOTE_CONFIDENCES,
  NOTE_CONFIDENCE_LABELS,
  type Entity,
  type Note,
  type NoteConfidence
} from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useAllNotes, useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { formatTimestamp } from '@renderer/lib/format'
import { EmptyState, PaneHeader, PaneShell } from '@renderer/components/chrome'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Badge } from '@renderer/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'

// The single place to write a note and file it under one OR MORE entities (M2M), plus browse/edit/delete
// every note in the campaign. Reached from the sidebar nav and the button under the session-log "Log".
export function NotesView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)

  if (!activeCampaignId) {
    return (
      <EmptyState icon={StickyNote} title="No campaign selected">
        Choose a campaign in the sidebar to keep its annals.
      </EmptyState>
    )
  }
  return <NotesWorkspace campaignId={activeCampaignId} />
}

function NotesWorkspace({ campaignId }: { campaignId: string }) {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const { entities } = useEntities(campaignId)
  const { notes, refresh } = useAllNotes(campaignId)
  const { sessions } = useSessions(campaignId)
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities])
  // The session this note will file under (note.sessionId = the ACTIVE session, whose control now lives
  // on the Chronicle header — ADR-036); surfaced read-only so filing is never silent.
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const [content, setContent] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confidence, setConfidence] = useState<NoteConfidence>('confirmed')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedEntities = selectedIds
    .map((id) => entityById.get(id))
    .filter((e): e is Entity => Boolean(e))

  function toggle(id: string): void {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  function resetComposer(): void {
    setContent('')
    setSelectedIds([])
    setConfidence('confirmed')
    setEditingId(null)
  }

  function startEdit(note: Note): void {
    setEditingId(note.id)
    setContent(note.content)
    setSelectedIds(note.entityIds)
    setConfidence(note.confidence)
  }

  async function save(): Promise<void> {
    const text = content.trim()
    if (!text || busy) return // entity tagging is optional — an untagged note is campaign lore (ADR-021)
    setBusy(true)
    try {
      if (editingId) {
        await ledger.note.update(editingId, { content: text, entityIds: selectedIds, confidence })
        toast.success('Note updated')
      } else {
        await ledger.note.create({
          campaignId,
          content: text,
          entityIds: selectedIds,
          confidence,
          sessionId: activeSessionId ?? undefined
        })
        toast.success('Note saved')
      }
      resetComposer()
      refresh()
    } catch (err) {
      toast.error('Could not save note', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await ledger.note.delete(id)
      if (editingId === id) resetComposer()
      refresh()
    } catch (err) {
      toast.error('Could not delete note', { description: String(err) })
    }
  }

  const canSave = content.trim().length > 0 && !busy

  return (
    <PaneShell size="reading">
      <PaneHeader
        title="Annals"
        size="lg"
        description="Write once, file it under everyone it touches."
      />

      <div className="space-y-3 rounded-lg border border-border bg-card/60 p-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="What happened? Who said what?…  (Ctrl+Enter to save)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              save()
            }
          }}
        />
        <EntityMultiSelect entities={entities} selectedIds={selectedIds} onToggle={toggle} />
        {selectedEntities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedEntities.map((e) => (
              <Badge key={e.id} variant="secondary" className="gap-1 pr-1">
                {e.name}
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  aria-label={`Remove ${e.name}`}
                  className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Confidence</span>
          <Select value={confidence} onValueChange={(v) => setConfidence(v as NoteConfidence)}>
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Note confidence">
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {editingId
              ? 'Editing a note'
              : `${activeSession ? `Filing under Session ${activeSession.number}` : 'Undated'}${
                  selectedIds.length === 0 ? ' · no entities tagged — saves as campaign lore' : ''
                }`}
          </span>
          <div className="flex items-center gap-2">
            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetComposer} disabled={busy}>
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!canSave}>
              {editingId ? 'Save changes' : 'Save note'}
            </Button>
          </div>
        </div>
        {entities.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No entities yet — notes save as campaign lore. Add people, places, and things in the Codex to
            tag them.
          </p>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {notes.length === 0 ? (
          <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
            No annals yet. Write one above and file it under the people, places, and things it touches.
          </p>
        ) : (
          notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              entityById={entityById}
              editing={editingId === n.id}
              onEdit={() => startEdit(n)}
              onDelete={() => remove(n.id)}
            />
          ))
        )}
      </div>
    </PaneShell>
  )
}

function NoteCard({
  note,
  entityById,
  editing,
  onEdit,
  onDelete
}: {
  note: Note
  entityById: Map<string, Entity>
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  function openEntity(id: string): void {
    setSelectedEntity(id)
    setActiveView('capture')
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card/40 p-3 pr-16 transition-colors',
        editing ? 'border-primary/50' : 'border-border'
      )}
    >
      <p className="whitespace-pre-wrap text-sm text-foreground/90">{note.content}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {note.entityIds.map((id) => {
          const e = entityById.get(id)
          return (
            <button
              key={id}
              onClick={() => openEntity(id)}
              className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-primary/15 hover:text-primary"
            >
              {e ? e.name : 'Unknown entity'}
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {note.confidence !== 'confirmed' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-metal">
            <CircleDashed className="size-3" />
            {NOTE_CONFIDENCE_LABELS[note.confidence]}
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatTimestamp(note.createdAt)}
        </span>
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-primary"
          aria-label="Edit note"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
          aria-label="Delete note"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

// Multi-select over every campaign entity, grouped by type. Adapted from the sidebar's NearbyPcsSelector
// (Popover + Command + Badge). Selecting toggles and keeps the popover open for fast multi-tagging.
function EntityMultiSelect({
  entities,
  selectedIds,
  onToggle
}: {
  entities: Entity[]
  selectedIds: string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(selectedIds)
  const groups = ENTITY_TYPES.map((type) => ({
    type,
    items: entities.filter((e) => e.type === type)
  })).filter((g) => g.items.length > 0)

  const label = selectedIds.length === 0 ? 'Tag entities…' : `${selectedIds.length} tagged`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={entities.length === 0}
          className="w-full justify-between font-normal"
        >
          <span className={cn(selectedIds.length === 0 && 'text-muted-foreground')}>{label}</span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search entities…" />
          <CommandList>
            <CommandEmpty>No entities found.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.type} heading={ENTITY_TYPE_LABELS[g.type]}>
                {g.items.map((e) => (
                  <CommandItem key={e.id} value={`${e.name} ${e.id}`} onSelect={() => onToggle(e.id)}>
                    <Check
                      className={cn('size-4', selected.has(e.id) ? 'opacity-100' : 'opacity-0')}
                    />
                    {e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
