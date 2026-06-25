import type { ComponentType } from 'react'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'
import { CaptureView } from '@renderer/components/views/CaptureView'
import { RecallView } from '@renderer/components/views/RecallView'
import { SuggestView } from '@renderer/components/views/SuggestView'
import { SettingsView } from '@renderer/components/views/SettingsView'

// Single-window panel switching — one feature view at a time (ARCHITECTURE §3). Not a router.
const VIEWS: Record<ViewKey, ComponentType> = {
  capture: CaptureView,
  recall: RecallView,
  suggest: SuggestView,
  settings: SettingsView
}

export function MainPanel() {
  const activeView = useUiStore((s) => s.activeView)
  const View = VIEWS[activeView]
  return <View />
}
