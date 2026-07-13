import { ENTITY_TYPE_LABELS, type EntityType } from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { ENTITY_TYPE_COLOR, ENTITY_TYPE_ICON } from '@renderer/lib/entity-visuals'

interface EntityBadgeProps {
  entity: { id: string; name: string; type: EntityType }
  onClick?: () => void
  className?: string
}

// A compact, clickable reference to an entity. Each entity type carries its own muted color + icon
// (see lib/entity-visuals).
export function EntityBadge({ entity, onClick, className }: EntityBadgeProps) {
  const Icon = ENTITY_TYPE_ICON[entity.type]
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${ENTITY_TYPE_LABELS[entity.type]}: ${entity.name}`}
      style={{ color: ENTITY_TYPE_COLOR[entity.type], borderColor: ENTITY_TYPE_COLOR[entity.type] }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
        !onClick && 'cursor-default',
        className
      )}
    >
      <Icon className="size-3" />
      <span className="max-w-[14rem] truncate">{entity.name}</span>
    </button>
  )
}
