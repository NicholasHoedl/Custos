import { useCallback, useState } from 'react'

// A lens's last-N answers, kept in memory (ROADMAP P1-1). Session-scoped by design: MainPanel keeps the
// views mounted, so this survives nav within a run but not an app restart (durable saving is Inscribe →
// Annals). One entry per completed ask; consecutive identical prose is de-duped so a re-render or a
// no-op re-ask doesn't stack.

export interface LensHistoryEntry {
  id: string
  /** Short human label for the picker row (the question / situation / target). */
  label: string
  /** The full inscribe-able prose (same payload as Copy/Inscribe on the live result). */
  prose: string
}

export function useLensHistory(cap = 5): {
  entries: LensHistoryEntry[]
  remember: (label: string, prose: string) => void
} {
  const [entries, setEntries] = useState<LensHistoryEntry[]>([])
  const remember = useCallback(
    (label: string, prose: string) => {
      setEntries((prev) => {
        if (prev[0]?.prose === prose) return prev // same result re-observed — don't stack
        return [{ id: crypto.randomUUID(), label, prose }, ...prev].slice(0, cap)
      })
    },
    [cap]
  )
  return { entries, remember }
}
