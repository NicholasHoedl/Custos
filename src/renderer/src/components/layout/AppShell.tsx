import { Sidebar } from './Sidebar'
import { MainPanel } from './MainPanel'

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MainPanel />
      </main>
    </div>
  )
}
