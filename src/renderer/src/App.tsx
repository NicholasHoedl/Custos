import { AppShell } from '@renderer/components/layout/AppShell'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}
