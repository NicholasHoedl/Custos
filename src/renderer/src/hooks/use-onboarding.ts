import { useCallback, useEffect, useState } from 'react'
import type { ModelDownloadProgress, OnboardingStatus } from '@shared/recall-types'
import { ledger } from '@renderer/lib/ipc'

export function useOnboarding(): {
  status: OnboardingStatus
  progress: ModelDownloadProgress | null
  downloading: boolean
  error: string | null
  download: () => void
  refresh: () => void
} {
  const [status, setStatus] = useState<OnboardingStatus>({ keyReady: false, modelReady: false })
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    ledger.onboarding.status().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
    return ledger.onModelDownloadProgress((p) => {
      setProgress(p)
      if (p.status === 'error') {
        setDownloading(false)
        setError(p.message ?? 'Download failed')
        refresh()
      } else if (p.status === 'ready') {
        setDownloading(false)
        setProgress(null)
        setError(null)
        refresh()
      }
    })
  }, [refresh])

  const download = useCallback(() => {
    setError(null)
    setDownloading(true)
    ledger.onboarding.downloadModel().catch((e) => {
      setDownloading(false)
      setError(String(e))
    })
  }, [])

  return { status, progress, downloading, error, download, refresh }
}
