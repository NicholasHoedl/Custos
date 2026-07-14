import { ArrowRight, ExternalLink } from 'lucide-react'
import { NAV_ITEMS, type NavItem } from '@renderer/lib/nav-items'
import {
  ANTHROPIC_CONSOLE_LABEL,
  ANTHROPIC_CONSOLE_URL,
  API_KEY_STEPS,
  LOOP_STEPS,
  TOOL_BLURBS,
  TOUR_GROUPS
} from '@renderer/lib/guide-content'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

// The always-available Quickstart guide (ADR-045) — a reference to Custos's core loop, every tool, and how
// to get set up. Opened from an out-of-the-way button at the bottom of the Sidebar. All copy comes from
// `lib/guide-content.tsx`, shared with the first-run tutorial's tour + the Chronicle LoopExplainer, so the
// three surfaces never drift. It backstops the loop teaching that the trimmed tutorial no longer runs.

const GROUP_ORDER = ['tour-capture', 'tour-world', 'tour-ask'] as const

export function QuickstartGuide({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Quickstart guide</DialogTitle>
          <DialogDescription>
            How Custos works, and what each tool is for. Open this any time from the button at the bottom of
            the sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* The core loop — the ritual the trimmed tutorial no longer walks through. */}
          <section className="space-y-3">
            <h3 className="font-display text-base font-semibold text-foreground">The loop</h3>
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
              {LOOP_STEPS.map((step, i) => (
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
                  {i < LOOP_STEPS.length - 1 && (
                    <ArrowRight className="hidden size-4 shrink-0 justify-self-center text-muted-foreground/50 lg:block" />
                  )}
                </li>
              ))}
            </ol>
          </section>

          {/* The tools, grouped as in the tutorial tour. */}
          {GROUP_ORDER.map((g) => {
            const { title, keys } = TOUR_GROUPS[g]
            const items = keys
              .map((k) => NAV_ITEMS.find((n) => n.key === k))
              .filter((n): n is NavItem => Boolean(n))
            return (
              <section key={g} className="space-y-3">
                <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
                <ul className="space-y-3">
                  {items.map(({ key, label, icon: Icon }) => (
                    <li key={key} className="flex gap-3">
                      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
                        <Icon className="size-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{label}</div>
                        <div className="text-sm text-muted-foreground">{TOOL_BLURBS[key]}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          {/* Getting started — including where to get an Anthropic key (mirrors the tutorial's key step). */}
          <section className="space-y-2">
            <h3 className="font-display text-base font-semibold text-foreground">Getting started</h3>
            <p className="text-sm text-muted-foreground">
              Capture works right away. The Keeper's features — <span className="text-foreground">Lore</span>
              , <span className="text-foreground">Counsel</span>, and{' '}
              <span className="text-foreground">Converse</span> — need an Anthropic API key (add it in
              Settings). Lore also needs the search model, a one-time ~30&nbsp;MB download in Settings.
            </p>
            <p className="text-sm font-medium text-foreground">To get an API key:</p>
            <ol className="list-decimal space-y-1.5 rounded-md border border-border bg-background/50 py-2 pl-7 pr-3 text-sm text-muted-foreground">
              {API_KEY_STEPS.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <a
              href={ANTHROPIC_CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              Open {ANTHROPIC_CONSOLE_LABEL} <ExternalLink className="size-3" />
            </a>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
