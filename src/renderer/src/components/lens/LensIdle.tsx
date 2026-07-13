interface LensIdleProps {
  /** Example prompts; clicking one fills the lens input (does not submit). */
  starters: string[]
  onPick: (value: string) => void
  /** The lens's recent history (from useLensHistory) — shown as quick re-runs. */
  recent: { id: string; label: string }[]
}

// The shared idle state for the AI lenses (Lore / Counsel / Converse): example starter chips that fill the
// input on click, plus recent entries as quick re-runs — so the pane isn't mostly empty before first use.
export function LensIdle({ starters, onPick, recent }: LensIdleProps) {
  return (
    <div className="space-y-5 px-1 pt-6">
      <div className="space-y-2">
        <h3 className="inscribed text-xs">Try one</h3>
        <div className="flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-md border border-border bg-card/40 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {recent.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="inscribed text-xs">Recent</h3>
          <div className="flex flex-col gap-0.5">
            {recent.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick(r.label)}
                className="truncate rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
