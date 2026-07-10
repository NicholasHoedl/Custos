import { useState } from 'react'
import { Plus, Search, Skull, Star, StickyNote } from 'lucide-react'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType
} from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { Input } from '@renderer/components/ui/input'
import { Portrait } from './Portrait'

export type EntityFilter = EntityType | 'all'
/** Which non-entity pane the capture detail area shows when no entity is selected. Previously… and
 *  Transcribe were promoted to top-level nav (ADR-032); Codex keeps only Inscribe + Annals. */
export type CapturePanel = 'add' | 'notes'

const FILTERS: EntityFilter[] = ['all', ...ENTITY_TYPES]

interface EntityBrowserProps {
  entities: Entity[]
  selectedId: string | null
  filter: EntityFilter
  onFilterChange: (filter: EntityFilter) => void
  onSelect: (id: string) => void
  /** The active non-entity pane (drives the header highlight when nothing is selected). */
  panel: CapturePanel
  /** Clear the selection and show the Add-entity form pane. */
  onShowAddEntity: () => void
  /** Clear the selection and show the notes pane in the detail pane. */
  onShowNotes: () => void
  /** The campaign's main character id — its row gets a ★ and redirects to the Character page (ADR-030). */
  mainCharacterId?: string | null
}

// Master list of all entities in the campaign, filtered client-side by type (chips, with live counts)
// and by a free-text name/description filter so an entity can be found without leaving the panel.
// Selecting opens the entity in the detail panel.
export function EntityBrowser({
  entities,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
  panel,
  onShowAddEntity,
  onShowNotes,
  mainCharacterId
}: EntityBrowserProps) {
  const [query, setQuery] = useState('')

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
      <div className="space-y-1 border-b border-border p-2">
        <button
          onClick={onShowAddEntity}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            !selectedId && panel === 'add'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <Plus className="size-4" />
          Inscribe
        </button>
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
          Annals
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
            {entities.length === 0 ? 'Nothing inscribed yet — use Inscribe above.' : 'No matches.'}
          </p>
        ) : (
          visible.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              selected={entity.id === selectedId}
              isMain={entity.id === mainCharacterId}
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
  isMain,
  onClick
}: {
  entity: Entity
  selected: boolean
  isMain: boolean
  onClick: () => void
}) {
  const fallen = entity.lifecycle === 'ended'
  const presumed = entity.lifecycle === 'presumed_ended'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-transparent hover:border-border hover:bg-muted/50'
      )}
    >
      <Portrait image={entity.image} name={entity.name} lifecycle={entity.lifecycle} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex w-full items-center gap-2">
        <span
          className={cn(
            'truncate text-sm font-medium',
            fallen ? 'text-foreground/60 line-through decoration-blood/70' : 'text-foreground'
          )}
        >
          {entity.name}
        </span>
        {isMain && (
          <Star className="size-3 shrink-0 fill-primary text-primary" aria-label="Main character" />
        )}
        {fallen && <Skull className="size-3 shrink-0 text-blood" aria-label="Fallen" />}
        {presumed && <Skull className="size-3 shrink-0 text-blood/50" aria-label="Presumed lost" />}
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {ENTITY_TYPE_LABELS[entity.type]}
        </span>
      </div>
      {entity.description && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{entity.description}</span>
      )}
      </div>
    </button>
  )
}
