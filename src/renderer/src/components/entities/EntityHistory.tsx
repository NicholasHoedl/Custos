import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { toast } from 'sonner'
import { lifecycleLabel, type EntityType, type StatusHistoryEntry } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
import { Button } from '@renderer/components/ui/button'

// A collapsible "Changed over time" trail for one entity — its status/lifecycle history by session
// (chronology, ADR-017). Lets you verify the deterministic snapshot-on-edit capture, and see how the
// entity's state evolved. Loads lazily on first expand. (No Collapsible primitive exists — a Button
// toggle matches the existing UI conventions.)
export function EntityHistory({ entityId, type }: { entityId: string; type: EntityType }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<StatusHistoryEntry[] | null>(null)

  // The rows cache displays STORED session numbers — drop it whenever entity data changes (an
  // import-apply status change, an ADR-062 insert-before renumber) so it never shows stale stamps.
  const entitiesVersion = useUiStore((s) => s.entitiesVersion)
  useEffect(() => setRows(null), [entitiesVersion, entityId])

  // Lazy load: fetch when expanded with no cached rows — covers both the first expand and a re-fetch
  // after the cache was dropped while the trail was open.
  useEffect(() => {
    if (!open || rows !== null) return
    let cancelled = false
    ledger.entity
      .history(entityId)
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((err) => {
        if (cancelled) return
        setRows([])
        toast.error("Couldn't load history", { description: String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [open, rows, entityId])

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 gap-1.5 text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <History className="size-3.5" />
        Changed over time
      </Button>
      {open &&
        (rows === null ? (
          <p className="pl-2 text-xs text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="pl-2 text-xs text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <ol className="space-y-1 border-l border-border pl-3">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                  {r.sinceSessionNumber === null ? 'Before tracking' : `Session ${r.sinceSessionNumber}`}
                </span>
                <span className="text-foreground/90">
                  {lifecycleLabel(type, r.lifecycle)}
                  {r.status ? ` — ${r.status}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ))}
    </div>
  )
}
