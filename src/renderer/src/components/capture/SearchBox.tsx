import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { EntitySearchResult } from '@shared/ipc-types'
import { ledger } from '@renderer/lib/ipc'
import { Input } from '@renderer/components/ui/input'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'

// Campaign-scoped local search over entities + their notes (P1-09). Debounced as-you-type;
// selecting a result opens it in the capture detail panel. Focusable via Ctrl+F.
export function SearchBox({ campaignId }: { campaignId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EntitySearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const searchFocusNonce = useUiStore((s) => s.searchFocusNonce)

  useEffect(() => {
    if (searchFocusNonce > 0) inputRef.current?.focus()
  }, [searchFocusNonce])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const handle = setTimeout(() => {
      ledger.search
        .text(q, campaignId)
        .then(setResults)
        .catch(() => setResults([]))
    }, 180)
    return () => clearTimeout(handle)
  }, [query, campaignId])

  function open(entityId: string) {
    setSelectedEntity(entityId)
    setActiveView('capture')
    setQuery('')
    setResults([])
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="h-8 pl-8 text-sm"
      />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {results.map((r) => (
            <li key={r.entityId}>
              <button
                onClick={() => open(r.entityId)}
                className="w-full rounded px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <span className="block truncate text-sm text-foreground">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
