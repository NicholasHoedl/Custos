import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ledger } from '@renderer/lib/ipc'
import { Button } from '@renderer/components/ui/button'

// Last line of defense (T2): a renderer render-crash used to blank the window with no explanation —
// worse than useless in a live-at-the-table capture app. This catches it, shows the design-language
// fallback, and offers a reload. React still requires a class component for componentDidCatch.

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] uncaught error', error, info.componentStack)
    // Also land it in userData/logs/main.log — the packaged app has no devtools console (P0-3).
    try {
      ledger.log.rendererError({
        source: 'error-boundary',
        message: error.message,
        stack: `${error.stack ?? ''}\n--- component stack ---${info.componentStack ?? ''}`
      })
    } catch {
      // The bridge failing must never cascade out of the boundary.
    }
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="font-display text-2xl font-semibold text-foreground">Something broke</h1>
          <p className="text-sm text-muted-foreground">
            The interface hit an unexpected error. Your notes are safe on disk — reloading usually
            clears it.
          </p>
          <pre className="max-h-40 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-left font-mono text-xs text-foreground">
            {error.message}
          </pre>
          <Button onClick={() => location.reload()}>Reload Ledger</Button>
        </div>
      </div>
    )
  }
}
