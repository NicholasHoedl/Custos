import { useEffect, useRef, useState } from 'react'
import { BookText, FileInput, Plus, Search, StickyNote } from 'lucide-react'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType
} from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/store/ui-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { EntityForm } from '@renderer/components/entities/EntityForm'

export type EntityFilter = EntityType | 'all'
/** Which non-entity pane the capture detail area shows when no entity is selected. */
export type CapturePanel = 'notes' | 'recap' | 'import'

const FILTERS: EntityFilter[] = ['all', ...ENTITY_TYPES]

interface EntityBrowserProps {
  entities: Entity[]
  campaignId: string
  selectedId: string | null
  filter: EntityFilter
  onFilterChange: (filter: EntityFilter) => void
  onSelect: (id: string) => void
  /** Called after the "Add entity" form creates one, so the parent can select it. */
  onCreated: (entity: Entity) => void
  /** The active non-entity pane (drives the header highlight when nothing is selected). */
  panel: CapturePanel
  /** Clear the selection and show the notes pane in the detail pane. */
  onShowNotes: () => void
  /** Clear the selection and show the recap pane in the detail pane. */
  onShowRecap: () => void
  /** Clear the selection and show the import pane in the detail pane. */
  onShowImport: () => void
}

// Master list of all entities in the campaign, filtered client-side by type (chips, with live counts)
// and by a free-text name/description filter so an entity can be found without leaving the panel.
// Selecting opens the entity in the detail panel.
export function EntityBrowser({
  entities,
  campaignId,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
  onCreated,
  panel,
  onShowNotes,
  onShowRecap,
  onShowImport
}: EntityBrowserProps) {
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  // The global quick-add hotkey / Ctrl+K (ADR-010) now opens the full Add-entity form. Skip the initial
  // mount so it only fires on an actual bump, not on first render.
  const quickAddNonce = useUiStore((s) => s.quickAddNonce)
  const firstNonce = useRef(true)
  useEffect(() => {
    if (firstNonce.current) {
      firstNonce.current = false
      return
    }
    setAddOpen(true)
  }, [quickAddNonce])

  const byType = filter === 'all' ? entities : entities.filter((e) => e.type === filter)
  const q = query.trim().toLowerCase()
  const visible = q
    ? byType.filter(
        (e) =>
          e.name.toLowerCase().includes(q) || (e.description?.toLowerCase().includes(q) ?? false)
      )
    : byType

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <Button className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add entity
        </Button>
      </div>
      <EntityForm
        open={addOpen}
        onOpenChange={setAddOpen}
        campaignId={campaignId}
        onSaved={onCreated}
      />
      <div className="space-y-1 border-b border-border p-2">
        <button
          onClick={onShowNotes}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            !selectedId && panel === 'notes'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <StickyNote className="size-4" />
          Notes
        </button>
        <button
          onClick={onShowRecap}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            !selectedId && panel === 'recap'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <BookText className="size-4" />
          Recap
        </button>
        <button
          onClick={onShowImport}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            !selectedId && panel === 'import'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <FileInput className="size-4" />
          Import
        </button>
      </div>
      <div className="border-b border-border">
        <div className="flex flex-wrap gap-1 p-2 pb-1.5">
          {FILTERS.map((f) => {
            const count =
              f === 'all' ? entities.length : entities.filter((e) => e.type === f).length
            if (f !== 'all' && count === 0 && filter !== f) return null
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => onFilterChange(f)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {f === 'all' ? 'All' : ENTITY_TYPE_LABELS[f]}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Filter this list…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {entities.length === 0 ? 'Nothing here yet. Use quick-add above.' : 'No matches.'}
          </p>
        ) : (
          visible.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              selected={entity.id === selectedId}
              onClick={() => onSelect(entity.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function EntityCard({
  entity,
  selected,
  onClick
}: {
  entity: Entity
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-transparent hover:border-border hover:bg-muted/50'
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{entity.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {ENTITY_TYPE_LABELS[entity.type]}
        </span>
      </div>
      {entity.description && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{entity.description}</span>
      )}
    </button>
  )
}
