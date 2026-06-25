import { ENTITY_TYPE_LABELS, type EntityType } from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'

interface EntityBadgeProps {
  entity: { id: string; name: string; type: EntityType }
  onClick?: () => void
  className?: string
}

// A compact, clickable reference to an entity. The cyan accent is reserved for player characters;
// everything else stays in the cool/muted register (design guardrail).
export function EntityBadge({ entity, onClick, className }: EntityBadgeProps) {
  const isPc = entity.type === 'pc'
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${ENTITY_TYPE_LABELS[entity.type]}: ${entity.name}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
        isPc
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted/40 text-foreground hover:border-primary/50 hover:text-primary',
        !onClick && 'cursor-default',
        className
      )}
    >
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {entity.type === 'pc' ? 'PC' : ENTITY_TYPE_LABELS[entity.type].slice(0, 3)}
      </span>
      <span className="max-w-[14rem] truncate">{entity.name}</span>
    </button>
  )
}
