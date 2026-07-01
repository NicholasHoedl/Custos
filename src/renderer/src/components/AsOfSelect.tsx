import { Clock } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

const NOW = '__now__'

/**
 * "As of [session]" selector for Recall/Suggest — reconstruct the world at a past session (chronology,
 * ADR-017). Value is the session NUMBER (or null for "now / latest"). Hidden until sessions exist.
 */
export function AsOfSelect({
  sessions,
  value,
  onChange
}: {
  sessions: Session[]
  value: number | null
  onChange: (n: number | null) => void
}) {
  if (sessions.length === 0) return null
  const ordered = [...sessions].sort((a, b) => b.number - a.number)
  return (
    <Select
      value={value == null ? NOW : String(value)}
      onValueChange={(v) => onChange(v === NOW ? null : Number(v))}
    >
      <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="As of session">
        <Clock className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOW}>Now (latest)</SelectItem>
        {ordered.map((s) => (
          <SelectItem key={s.id} value={String(s.number)}>
            As of Session {s.number}
            {s.title ? ` — ${s.title}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
