import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/jetbrains-mono'
import './styles/globals.css'
import App from './App'
import { installErrorReporting } from './lib/report-errors'
import { bootstrapAppearance } from './lib/appearance'

installErrorReporting() // renderer crashes → userData/logs/main.log (P0-3)
// Apply the mirrored appearance BEFORE first paint (ADR-065), so a scale change doesn't reflow the whole
// UI once the settings IPC resolves. settings.json stays the durable source — AppShell re-applies from it
// a beat later and refreshes the mirror.
bootstrapAppearance()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
