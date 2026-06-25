import type { LedgerApi } from '@shared/ipc-types'

declare global {
  interface Window {
    ledger: LedgerApi
  }
}
