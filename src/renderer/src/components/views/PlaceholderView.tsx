interface PlaceholderViewProps {
  phase: string
  title: string
  blurb: string
}

// Phase 0 placeholder for each feature panel. Real views land in Phases 1–3.
export function PlaceholderView({ phase, title, blurb }: PlaceholderViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">{phase}</span>
      <h1 className="font-display text-5xl font-light tracking-tight text-foreground">{title}</h1>
      <p className="max-w-md font-sans text-sm leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  )
}
