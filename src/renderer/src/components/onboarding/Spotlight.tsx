import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

// The spotlight primitive for the first-run tour (ADR-059): a click-blocking scrim with a cutout over
// one real control, plus a coach-mark popover anchored to the cutout. LAYERING (verified): this renders
// inline in AppShell at z-40 — every Radix portal (the campaign dialog, selects, this popover; all z-50
// at body end) sits ABOVE it and stays fully interactive, which is exactly what action steps need. The
// candle vignette (z-50, pointer-events-none) and Sonner toasts paint above harmlessly, and a modal
// Radix dialog additionally sets body{pointer-events:none} while open, so the scrim is moot mid-dialog.

/** A viewport-space rectangle — the (padded) union of a step's target elements. */
export interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6 // breathing room around the highlighted control

/**
 * Continuously measure the union rect of the elements matching `selectors` (null = off). A small rAF
 * loop rather than observers: targets live inside an overflow-y-auto nav and inside views that MainPanel
 * keeps mounted but `hidden` (rects are 0 until the view paints after `setActiveView`), so rects
 * legitimately change without any resize event — and a handful of querySelector + getBoundingClientRect
 * calls per frame is negligible for the duration of a tutorial. Returns null until at least one selector
 * yields a nonzero rect. Pass a STABLE array (module-const step defs) — identity changes restart the loop.
 */
export function useTargetRect(selectors: readonly string[] | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null)
  const prev = useRef<string>('')

  useEffect(() => {
    if (!selectors || selectors.length === 0) {
      prev.current = ''
      setRect(null)
      return
    }
    let raf = 0
    const measure = (): void => {
      let top = Infinity
      let left = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue // hidden view / not painted yet
          top = Math.min(top, r.top)
          left = Math.min(left, r.left)
          right = Math.max(right, r.right)
          bottom = Math.max(bottom, r.bottom)
        }
      }
      const next: TargetRect | null =
        right > left && bottom > top
          ? {
              top: Math.round(top) - PAD,
              left: Math.round(left) - PAD,
              width: Math.round(right - left) + PAD * 2,
              height: Math.round(bottom - top) + PAD * 2
            }
          : null
      const key = next ? `${next.top}:${next.left}:${next.width}:${next.height}` : 'null'
      if (key !== prev.current) {
        prev.current = key
        setRect(next)
      }
      raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [selectors])

  return rect
}

/**
 * The spotlight chrome: four scrim rects around the cutout (they swallow clicks everywhere but the
 * target), a primary ring over it, an optional transparent blocker (INFO steps: the control is visible
 * but not operable — e.g. the bug step mustn't fire the report dialog's window snap), and the anchored
 * coach mark. The popover is deliberately non-dismissable (no Esc, no outside-click) — the tour is the
 * only way forward, matching the old wizard's non-skippability.
 */
export function Spotlight({
  rect,
  interactive,
  side = 'right',
  wide = false,
  children
}: {
  rect: TargetRect | null
  /** ACTION steps: the cutout is a real hole (clicks reach the control). INFO steps: blocked. */
  interactive: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Wider coach mark for copy-heavy steps (the apikey how-to). */
  wide?: boolean
  children: ReactNode
}) {
  const scrim = 'fixed z-40 bg-background/80'
  return (
    <>
      {rect ? (
        <>
          <div className={scrim} style={{ top: 0, left: 0, right: 0, height: Math.max(rect.top, 0) }} />
          <div
            className={scrim}
            style={{ top: rect.top, left: 0, width: Math.max(rect.left, 0), height: rect.height }}
          />
          <div
            className={scrim}
            style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }}
          />
          <div className={scrim} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div
            className="pointer-events-none fixed z-40 rounded-md ring-2 ring-primary"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
          {!interactive && (
            <div
              className="fixed z-40"
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            />
          )}
        </>
      ) : (
        // Target not painted yet — keep the whole app dimmed + blocked while it appears.
        <div className={cn(scrim, 'inset-0')} />
      )}
      <Popover open modal={false}>
        <PopoverAnchor asChild>
          <div
            aria-hidden
            className="pointer-events-none fixed z-40"
            style={
              rect
                ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
                : { top: '50%', left: '50%', width: 0, height: 0 }
            }
          />
        </PopoverAnchor>
        <PopoverContent
          aria-label="Tutorial"
          side={side}
          align="center"
          sideOffset={12}
          avoidCollisions
          onOpenAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          className={cn('space-y-2 text-sm leading-relaxed', wide ? 'w-96' : 'w-80')}
        >
          {children}
        </PopoverContent>
      </Popover>
    </>
  )
}
