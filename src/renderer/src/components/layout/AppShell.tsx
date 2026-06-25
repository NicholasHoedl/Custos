import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { MainPanel } from './MainPanel'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'

export function AppShell() {
  const requestQuickAddFocus = useUiStore((s) => s.requestQuickAddFocus)
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus)

  // Global hotkey: main process focuses the window then asks us to focus quick-add (ADR-010).
  useEffect(() => ledger.onQuickAddFocus(() => requestQuickAddFocus()), [requestQuickAddFocus])

  // In-app shortcuts: Ctrl/Cmd+K → quick-add, Ctrl/Cmd+F → search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        requestQuickAddFocus()
      } else if (key === 'f') {
        e.preventDefault()
        requestSearchFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestQuickAddFocus, requestSearchFocus])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <MainPanel />
        </main>
      </div>
      <Toaster theme="dark" richColors position="bottom-right" />
    </TooltipProvider>
  )
}
