import { useCallback } from 'react'
import { BookPlus, Clock, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { copyToClipboard } from '@renderer/lib/lens-prose'
import type { LensHistoryEntry } from '@renderer/hooks/use-lens-history'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

// Shared Copy / Inscribe / Recent toolbar for the three AI lenses (ROADMAP P1-1). "Inscribe" saves the
// prose to Annals as a campaign-lore note (entityIds: [], ADR-021) stamped at the active session — the
// durable answer to "AI answers are disposable in a memory tool." Copy/Inscribe act on the live result;
// Recent lets you copy/inscribe any of the last few answers this session.

/** Copy + Inscribe bound to the active campaign/session. Shared by the live bar and the Recent rows,
 *  and by the Lore transcript's per-turn actions (overhaul). */
export function useLensSave(): {
  copy: (prose: string) => void
  inscribe: (prose: string) => void
} {
  const campaignId = useAppStore((s) => s.activeCampaignId)
  const sessionId = useAppStore((s) => s.activeSessionId)

  const copy = useCallback((prose: string) => {
    copyToClipboard(prose)
      .then(() => toast.success('Copied'))
      .catch((e) => toast.error('Could not copy', { description: String(e) }))
  }, [])

  const inscribe = useCallback(
    (prose: string) => {
      if (!campaignId) return
      ledger.note
        .create({ campaignId, content: prose, entityIds: [], sessionId: sessionId ?? undefined })
        .then(() => toast.success('Inscribed to Annals'))
        .catch((e) => toast.error('Could not inscribe', { description: String(e) }))
    },
    [campaignId, sessionId]
  )

  return { copy, inscribe }
}

export function LensResultBar({
  prose,
  history
}: {
  /** The live result's prose, or null when there's nothing to act on yet. */
  prose: string | null
  history: LensHistoryEntry[]
}) {
  const { copy, inscribe } = useLensSave()
  if (!prose && history.length === 0) return null

  return (
    <div className="flex items-center justify-end gap-1">
      {prose && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => copy(prose)}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => inscribe(prose)}
          >
            <BookPlus className="size-3.5" />
            Inscribe
          </Button>
        </>
      )}
      {history.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Clock className="size-3.5" />
              Recent
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1">
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {history.map((e) => (
                <li
                  key={e.id}
                  className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={e.label}>
                    {e.label}
                  </span>
                  <button
                    onClick={() => copy(e.prose)}
                    aria-label="Copy"
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    onClick={() => inscribe(e.prose)}
                    aria-label="Inscribe to Annals"
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  >
                    <BookPlus className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
