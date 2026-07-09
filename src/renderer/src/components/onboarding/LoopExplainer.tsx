import { useState } from 'react'
import { ArrowRight, BookCheck, Library, NotebookPen, Wand2, X, type LucideIcon } from 'lucide-react'

// One-time "here's how Ledger remembers" card (ROADMAP P1-3). The audit's biggest coherence gap was
// that the core loop — Chronicle → Close out → Illuminate → Ask — is invisible: onboarding teaches
// SETUP (key, model, campaign) but never the USAGE flow. This names the ritual right where it starts,
// at the top of the Chronicle. Mirrors OnboardingChecklist's localStorage-gated, self-dismissing card
// (no store); shows once, then stays gone. All lucide + text — the renderer has no diagram components.

const DISMISS_KEY = 'ledger.loopExplainerDismissed'

interface LoopStep {
  icon: LucideIcon
  label: string
  gloss: string
}

// Icons match the real buttons: BookCheck = the "Close out session" button (EventFeed); the others
// read as their step.
const STEPS: LoopStep[] = [
  { icon: NotebookPen, label: 'Chronicle', gloss: 'Jot what happens at the table, in plain lines.' },
  { icon: BookCheck, label: 'Close out', gloss: 'Turn the session’s log into entities & notes.' },
  { icon: Wand2, label: 'Illuminate', gloss: 'Fill in ties & profiles from those notes.' },
  { icon: Library, label: 'Ask', gloss: 'Lore, Counsel & Converse draw on it all.' }
]

export function LoopExplainer() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  if (dismissed) return null

  function dismiss(): void {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    // Own margin (single mount site) so dismissing to null leaves no empty gap in JournalView.
    <div className="mx-4 mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-foreground">How Ledger remembers</h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
        {STEPS.map((step, i) => (
          <li key={step.label} className="contents">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
                <step.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{step.label}</div>
                <p className="text-xs leading-snug text-muted-foreground">{step.gloss}</p>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <ArrowRight className="hidden size-4 shrink-0 justify-self-center text-muted-foreground/50 lg:block" />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={dismiss}
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
