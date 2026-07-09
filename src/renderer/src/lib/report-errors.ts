import { ledger } from '@renderer/lib/ipc'

// Global renderer-crash reporting (ROADMAP P0-3): window `error` + `unhandledrejection` forward to
// the main-process log via the one-way RENDERER_ERROR_CHANNEL — a packaged app has no devtools
// console, so these were previously invisible in the field. Dedupe repeats (a render loop can fire
// the same error hundreds of times); the main side additionally hard-caps per launch.

const seen = new Set<string>()
const MAX_DISTINCT = 25

function report(source: 'window-error' | 'unhandled-rejection', message: string, stack?: string): void {
  if (seen.size >= MAX_DISTINCT || seen.has(message)) return
  seen.add(message)
  try {
    ledger.log.rendererError({ source, message, stack })
  } catch {
    // The bridge itself failing must never cascade.
  }
}

/** Install once at renderer startup (main.tsx). */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    report('window-error', e.message || String(e.error), e.error instanceof Error ? e.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason
    const message = r instanceof Error ? r.message : String(r)
    report('unhandled-rejection', message, r instanceof Error ? r.stack : undefined)
  })
}
