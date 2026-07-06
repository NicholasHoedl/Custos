import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppSettings } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'

export function useSettings(): {
  settings: AppSettings | null
  update: (patch: Partial<AppSettings>) => Promise<void>
  refresh: () => void
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const refresh = useCallback(() => {
    ledger.settings
      .get()
      .then(setSettings)
      .catch((e) =>
        toast.error("Couldn't load settings", { id: 'ipc-fetch', description: String(e) })
      )
  }, [])
  useEffect(() => refresh(), [refresh])
  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        await ledger.settings.set(patch)
        refresh()
      } catch (e) {
        toast.error('Setting not saved', { description: String(e) })
      }
    },
    [refresh]
  )
  return { settings, update, refresh }
}
