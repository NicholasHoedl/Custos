import { Check } from 'lucide-react'
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, LIFECYCLE_LABELS, type EntityType, type Session } from '@shared/entity-types'
import type {
  ConfirmedEntity,
  ConfirmedNote,
  ConfirmedRelationshipChange,
  ConfirmedStatusChange,
  EntityRef,
  MatchCandidate
} from '@shared/import-types'
import { RELATIONS } from '@shared/relations'
import { cn } from '@renderer/lib/utils'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

// The reviewable rows of an extraction proposal, shared by the Import pane (entities + notes) and the
// Backfill pane (entities + notes + status/relationship changes, ADR-018). Every row is include-gated:
// the model proposes, the user disposes.

const BATCH_DEFAULT = '__batch__'

export function EntityRow({
  entity,
  matches,
  existingName,
  onPatch,
  sessions
}: {
  entity: ConfirmedEntity
  matches: MatchCandidate[]
  existingName: (id: string) => string
  onPatch: (patch: Partial<ConfirmedEntity>) => void
  /** Backfill: when provided, a created entity gets a "first appeared" session selector (baseline). */
  sessions?: Session[]
}) {
  const included = entity.action !== 'skip'
  const top = matches[0]
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        included ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <Toggle
          on={included}
          onClick={() =>
            onPatch({ action: included ? 'skip' : entity.linkToEntityId ? 'link' : 'create' })
          }
        />
        <Input
          value={entity.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          disabled={!included}
          className="h-8 flex-1"
        />
        <Select
          value={entity.type}
          onValueChange={(v) => onPatch({ type: v as EntityType })}
          disabled={!included}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ENTITY_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {included && matches.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">
            Similar existing: <span className="text-foreground">{top.name}</span> ({top.type},{' '}
            {Math.round(top.score * 100)}%)
          </span>
          <div className="ml-auto inline-flex overflow-hidden rounded border border-border">
            <button
              onClick={() =>
                onPatch({ action: 'link', linkToEntityId: entity.linkToEntityId ?? top.entityId })
              }
              className={cn(
                'px-2 py-0.5',
                entity.action === 'link'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Link
            </button>
            <button
              onClick={() => onPatch({ action: 'create' })}
              className={cn(
                'px-2 py-0.5',
                entity.action === 'create'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Create new
            </button>
          </div>
        </div>
      )}

      {included && entity.action === 'link' && matches.length > 1 && (
        <div className="mt-2">
          <Select
            value={entity.linkToEntityId ?? top.entityId}
            onValueChange={(v) => onPatch({ linkToEntityId: v })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {matches.map((m) => (
                <SelectItem key={m.entityId} value={m.entityId}>
                  {m.name} ({m.type}, {Math.round(m.score * 100)}%)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {included && entity.action === 'create' && (
        <>
          <Textarea
            value={entity.description ?? ''}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={2}
            placeholder="Description (optional)"
            className="mt-2 text-sm"
          />
          {entity.attributes && Object.keys(entity.attributes).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(entity.attributes).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
          {sessions && sessions.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">First appeared:</span>
              <Select
                value={entity.sessionId ?? BATCH_DEFAULT}
                onValueChange={(v) => onPatch({ sessionId: v === BATCH_DEFAULT ? undefined : v })}
              >
                <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BATCH_DEFAULT}>This batch&apos;s session</SelectItem>
                  {[...sessions]
                    .sort((a, b) => a.number - b.number)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        Session {s.number}
                        {s.title ? ` — ${s.title}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}

      {included && entity.action === 'link' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Notes from this import attach to{' '}
          <span className="text-foreground">{existingName(entity.linkToEntityId ?? '')}</span> instead
          of creating a new entity.
        </p>
      )}
    </div>
  )
}

export function NoteRow({
  note,
  refName,
  onPatch
}: {
  note: ConfirmedNote
  refName: (r: EntityRef) => string
  onPatch: (patch: Partial<ConfirmedNote>) => void
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        note.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <Toggle on={note.include} onClick={() => onPatch({ include: !note.include })} />
        <div className="min-w-0 flex-1">
          <Textarea
            value={note.content}
            onChange={(e) => onPatch({ content: e.target.value })}
            rows={2}
            disabled={!note.include}
            className="text-sm"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {note.entityRefs.map((r, i) => (
              <span key={i} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                {refName(r)}
              </span>
            ))}
            {note.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A dated state change: "<name> → Ended — Slain", stamped at the batch's session on apply. */
export function StatusChangeRow({
  change,
  refName,
  onToggle
}: {
  change: ConfirmedStatusChange
  refName: (r: EntityRef) => string
  onToggle: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 text-sm',
        change.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <Toggle on={change.include} onClick={onToggle} />
      <span className="font-medium text-foreground">{refName(change.entityRef)}</span>
      <span className="text-muted-foreground">→</span>
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-xs font-medium',
          change.lifecycle === 'ended' ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary'
        )}
      >
        {LIFECYCLE_LABELS[change.lifecycle]}
      </span>
      {change.status && <span className="truncate text-foreground/90">{change.status}</span>}
    </div>
  )
}

/** A relationship forming or ending at the batch's session (an interval opening or closing). */
export function RelationshipChangeRow({
  change,
  refName,
  onToggle
}: {
  change: ConfirmedRelationshipChange
  refName: (r: EntityRef) => string
  onToggle: () => void
}) {
  const label = RELATIONS[change.relation]?.forward ?? change.relation
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-3 text-sm',
        change.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <Toggle on={change.include} onClick={onToggle} />
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-xs font-medium',
          change.action === 'form' ? 'bg-primary/10 text-primary' : 'bg-destructive/15 text-destructive'
        )}
      >
        {change.action === 'form' ? 'Now' : 'No longer'}
      </span>
      <span className="font-medium text-foreground">{refName(change.fromRef)}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{refName(change.toRef)}</span>
    </div>
  )
}

export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? 'Exclude' : 'Include'}
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors',
        on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-transparent'
      )}
    >
      <Check className="size-3.5" />
    </button>
  )
}
