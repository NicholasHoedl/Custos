import { useCallback } from 'react'
import {
  useUiStore,
  type LensHistoryEntry,
  type LensHistoryKey
} from '@renderer/store/ui-store'

// A lens's last-N answers (ROADMAP P1-1) — STORE-backed since ADR-061 so the Home dashboard can read
// the same history the lens views write (it was per-component useState before, invisible to any other
// consumer). Still session-scoped by design: no persist middleware, so it survives nav and remounts
// within a run but not an app restart (durable saving is Save note → Notes). One entry per completed
// ask; consecutive identical prose is de-duped so a re-render or a no-op re-ask doesn't stack.

export type { LensHistoryEntry, LensHistoryKey }

export function useLensHistory(lens: LensHistoryKey): {
  entries: LensHistoryEntry[]
  remember: (label: string, prose: string) => void
} {
  const entries = useUiStore((s) => s.lensHistory[lens])
  const rememberLens = useUiStore((s) => s.rememberLens)
  const remember = useCallback(
    (label: string, prose: string) => rememberLens(lens, label, prose),
    [lens, rememberLens]
  )
  return { entries, remember }
}
