import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { MainPanel } from './MainPanel'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'

export function AppShell() {
  const requestQuickAddFocus = useUiStore((s) => s.requestQuickAddFocus)
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global hotkey: main process focuses the window then asks us to focus quick-add (ADR-010).
  useEffect(() => ledger.onQuickAddFocus(() => requestQuickAddFocus()), [requestQuickAddFocus])

  // In-app shortcuts: Ctrl/Cmd+K → command palette (P2-4; quick-add is a palette command now),
  // Ctrl/Cmd+F → sidebar search. The OS-global quick-add hotkey (Ctrl+Alt+L) is unchanged.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (key === 'f') {
        e.preventDefault()
        requestSearchFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestSearchFocus])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <MainPanel />
        </main>
        {/* Grim candle-vignette — non-interactive, darkens the edges (portalled dialogs sit above it). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-50"
          style={{
            background:
              'radial-gradient(ellipse 110% 80% at 50% 42%, transparent 58%, rgba(0,0,0,0.42) 100%)'
          }}
        />
      </div>
      <Toaster theme="dark" richColors position="bottom-right" />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TooltipProvider>
  )
}
