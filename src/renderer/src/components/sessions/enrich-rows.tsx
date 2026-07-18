import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { ENTITY_TYPE_LABELS } from '@shared/entity-types'
import type { TouchedEntity } from '@shared/enrich-types'
import type { EnrichEntityProgress } from '@renderer/hooks/use-enrich'
import { plural } from '@renderer/lib/format'

// The Illuminate run's row pieces, shared by the standalone EnrichDialog (Sessions view) and the
// close-out wizard's step 2 (ADR-035).

/** One pre-flight checklist row: check to include this entity in the enrichment sweep. */
export function ChecklistRow({
  touched,
  checked,
  onToggle
}: {
  touched: TouchedEntity
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2">
      <input type="checkbox" className="accent-primary" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{touched.name}</span>
      <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
        {ENTITY_TYPE_LABELS[touched.type]}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {touched.noteCount} {plural(touched.noteCount, 'note', 'notes')}
      </span>
    </label>
  )
}

/** One entity's live progress through the sequential enrichment run. */
export function ProgressRow({ p }: { p: EnrichEntityProgress }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {p.state === 'running' ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : p.state === 'done' ? (
          <Check className="size-4 text-primary" />
        ) : p.state === 'empty' ? (
          <Check className="size-4 text-muted-foreground" />
        ) : p.state === 'failed' ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {p.state === 'done'
          ? `+${p.ties} ${plural(p.ties, 'tie', 'ties')} · ${p.edits} ${plural(p.edits, 'edit', 'edits')}`
          : p.state === 'empty'
            ? 'nothing new'
            : p.state === 'failed'
              ? (p.reason ?? 'failed')
              : p.state === 'running'
                ? 'reading…'
                : ''}
      </span>
    </div>
  )
}
