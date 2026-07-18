import type { Lifecycle } from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'

// An entity's optional portrait (P2-2): the base64 data-URL image, or an initials fallback on a muted
// tile (entities include places/things, so a rounded square — not a person-circle avatar). Fallen /
// presumed entities dim, matching the strike/italic treatment elsewhere.

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-8 text-[0.625rem]',
  md: 'size-16 text-lg',
  lg: 'size-24 text-2xl'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Portrait({
  image,
  name,
  lifecycle,
  size = 'md',
  className
}: {
  image: string | null
  name: string
  lifecycle?: Lifecycle
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dim = lifecycle === 'ended' || lifecycle === 'presumed_ended'
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-lg border border-border bg-muted/50',
        SIZE[size],
        dim && 'opacity-60 grayscale',
        className
      )}
    >
      {image ? (
        <img src={image} alt={name} draggable={false} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center font-display font-semibold text-muted-foreground">
          {initials(name)}
        </div>
      )}
    </div>
  )
}
