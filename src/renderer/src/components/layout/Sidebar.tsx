import { BookOpen, ScrollText, Search, Sparkles, Settings } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'

const NAV: { key: ViewKey; label: string; icon: typeof ScrollText }[] = [
  { key: 'capture', label: 'Capture', icon: ScrollText },
  { key: 'recall', label: 'Recall', icon: Search },
  { key: 'suggest', label: 'Suggest', icon: Sparkles },
  { key: 'settings', label: 'Settings', icon: Settings }
]

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <BookOpen className="size-5 text-primary" />
        <span className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Ledger
        </span>
      </div>

      <div className="px-3 pb-2">
        <button
          disabled
          className="w-full cursor-default rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm text-muted-foreground"
        >
          No campaign yet
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 pt-2">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = key === activeView
          return (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-sidebar-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="px-5 py-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Phase 0 · scaffold
        </span>
      </div>
    </aside>
  )
}
