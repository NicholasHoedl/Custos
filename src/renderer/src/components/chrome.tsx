import type { ComponentType, ReactNode } from 'react'
import { Info, KeyRound, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

// Shared view chrome — the banner/setup-card/progress/header/body pieces every AI pane used to copy
// locally (they had drifted apart; consolidated in the 2026-07-02 simplification pass). The unified
// PaneHeader is a compact toolbar (icon + title + action); PaneBody is the centered scroll column
// beneath it — 'reading' (max-w-3xl), 'form' (max-w-2xl), or 'wide' (max-w-[1600px]; Counsel).

/** The unified page header: a compact toolbar — an optional leading (type) icon + the title + an
 *  optional right-side action slot. Every top-level view uses this so the app chrome is consistent; the
 *  large-Fraunces "display" moments live on CONTENT (entity / session / character names), not here. */
export function PaneHeader({
  icon: Icon,
  title,
  action
}: {
  icon?: LucideIcon
  title: string
  action?: ReactNode
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="size-4 shrink-0 text-primary" />}
        <h1 className="truncate font-display text-lg font-semibold text-foreground">{title}</h1>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  )
}

/** The scrolling body that pairs with PaneHeader: a centered column at one of three widths. Sits below
 *  the full-width header inside a `flex h-full flex-col` view. Replaces PaneShell's centering role. */
export function PaneBody({
  size = 'form',
  className,
  children
}: {
  size?: 'reading' | 'form' | 'wide'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-auto p-6',
        size === 'reading' ? 'max-w-3xl' : size === 'wide' ? 'max-w-[1600px]' : 'max-w-2xl',
        className
      )}
    >
      {children}
    </div>
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
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={label}
        >
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
