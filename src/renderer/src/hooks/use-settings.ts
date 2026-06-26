import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'

export function useSettings(): {
  settings: AppSettings | null
  update: (patch: Partial<AppSettings>) => Promise<void>
  refresh: () => void
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const refresh = useCallback(() => {
    ledger.settings.get().then(setSettings)
  }, [])
  useEffect(() => refresh(), [refresh])
  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      await ledger.settings.set(patch)
      refresh()
    },
    [refresh]
  )
  return { settings, update, refresh }
}
