import type { ComponentType, ReactNode } from 'react'
import { Info, KeyRound } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

// Shared view chrome — the banner/setup-card/progress/shell/header pieces every AI pane used to copy
// locally (they had drifted apart; consolidated in the 2026-07-02 simplification pass). Pane WIDTH is
// now deliberate: two named sizes instead of five accidental ones — 'reading' (max-w-3xl; the
// top-level Recall/Suggest prose panes) and 'form' (max-w-2xl; the nested Capture panes + Settings).

/** The standard pane container: centered column, one of two deliberate widths. */
export function PaneShell({
  size = 'form',
  scroll = false,
  className,
  children
}: {
  size?: 'reading' | 'form'
  scroll?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto flex h-full flex-col gap-4 p-6',
        size === 'reading' ? 'max-w-3xl' : 'max-w-2xl',
        scroll && 'overflow-y-auto',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Pane title + description, with an optional right-aligned action (e.g. a Reset button). */
export function PaneHeader({
  title,
  description,
  size = 'md',
  action
}: {
  title: string
  description?: ReactNode
  /** 'lg' for top-level reading panes (Recall/Suggest/Settings); 'md' for nested Capture panes. */
  size?: 'lg' | 'md'
  action?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1
          className={cn(
            'font-display font-semibold text-foreground',
            size === 'lg' ? 'text-3xl' : 'text-2xl'
          )}
        >
          {title}
        </h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

/** Inline status banner (offline / no-key / error …). */
export function Banner({
  icon,
  children,
  tone = 'muted',
  className
}: {
  icon: ReactNode
  children: ReactNode
  tone?: 'muted' | 'destructive'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/10 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground',
        className
      )}
    >
      <span className={tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}

/** Setup prompt card (finish onboarding: key / model). Icon defaults to the API-key case. */
export function SetupCard({
  icon,
  title,
  body,
  action
}: {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-primary">{icon ?? <KeyRound className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** The one no-campaign/no-selection empty state (ADR-032) — the audit found three drifted shapes.
 *  Centered icon + title + one line; the line should say where to act ("Choose a campaign in the
 *  sidebar to …"). */
export function EmptyState({
  icon: IconCmp,
  title,
  children
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-2 text-center">
        <IconCmp className="mx-auto size-8 text-muted-foreground/50" />
        <p className="font-display text-lg font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

/** The "what does this tool do" affordance (ADR-032): an ⓘ that opens a rich explainer. One shared
 *  shape so every AI surface can carry guidance the way the Character page's drafting tool does. */
export function InfoPopover({
  label,
  children,
  align = 'end'
}: {
  /** Accessible name, e.g. "About Counsel". */
  label: string
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={label}>
          <Info className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 space-y-2 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** Compact model-download progress (indeterminate at 40% until a total is known). */
export function ProgressBar({
  progress
}: {
  progress: { loaded?: number; total?: number } | null
}) {
  const pct =
    progress?.total && progress.total > 0
      ? Math.round(((progress.loaded ?? 0) / progress.total) * 100)
      : null
  return (
    <div className="flex w-40 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: pct != null ? `${pct}%` : '40%' }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        {pct != null ? `${pct}%` : '…'}
      </span>
    </div>
  )
}
