import type { ComponentType } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'
import { CharacterView } from '@renderer/components/views/CharacterView'
import { JournalView } from '@renderer/components/views/JournalView'
import { SessionsView } from '@renderer/components/views/SessionsView'
import { CaptureView } from '@renderer/components/views/CaptureView'
import { RecallView } from '@renderer/components/views/RecallView'
import { SuggestView } from '@renderer/components/views/SuggestView'
import { ConverseView } from '@renderer/components/views/ConverseView'
import { ImportView } from '@renderer/components/views/ImportView'
import { SettingsView } from '@renderer/components/views/SettingsView'

// Single-window panel switching — one feature view at a time (ARCHITECTURE §3). Not a router.
// All views stay MOUNTED and we toggle visibility, so each one keeps its state (query, streamed
// answer, scroll position, in-flight requests) when the user navigates away and comes back.
const VIEWS: { key: ViewKey; Component: ComponentType }[] = [
  { key: 'character', Component: CharacterView },
  { key: 'journal', Component: JournalView },
  { key: 'sessions', Component: SessionsView },
  { key: 'capture', Component: CaptureView },
  { key: 'recall', Component: RecallView },
  { key: 'suggest', Component: SuggestView },
  { key: 'converse', Component: ConverseView },
  { key: 'import', Component: ImportView },
  { key: 'settings', Component: SettingsView }
]

export function MainPanel() {
  const activeView = useUiStore((s) => s.activeView)
  return (
    <>
      {VIEWS.map(({ key, Component }) => (
        <div key={key} className={cn('h-full', key !== activeView && 'hidden')}>
          <Component />
        </div>
      ))}
    </>
  )
}
