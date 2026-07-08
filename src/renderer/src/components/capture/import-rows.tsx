import { ArrowRight, Check, CircleDashed, Link2, Minus, Plus, Skull, Unlink } from 'lucide-react'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  LIFECYCLE_LABELS,
  NOTE_CONFIDENCES,
  NOTE_CONFIDENCE_LABELS,
  type EntityType,
  type Lifecycle,
  type NoteConfidence,
  type Session
} from '@shared/entity-types'
import type {
  ConfirmedEntity,
  ConfirmedFieldChange,
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

// The reviewable rows of an extraction changeset, shared by the Journal (Chronicle) and Import
// (Transcribe) via ChangesetReview. Each type is styled to its meaning — a note is a testimony, a
// status change a before→after diff, a relationship a bond. Every row is include-gated: the model
// proposes, the user disposes.

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

// A new note, styled as a testimony: a quote-ruled, italic serif blockquote with the entities it
// touches and its epistemic weight (Known / Hearsay / Whispered), which the reviewer can adjust.
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
      <div className="flex items-start gap-3">
        <Toggle on={note.include} onClick={() => onPatch({ include: !note.include })} />
        <div className="min-w-0 flex-1 border-l-2 border-metal/40 pl-3">
          <Textarea
            value={note.content}
            onChange={(e) => onPatch({ content: e.target.value })}
            rows={2}
            disabled={!note.include}
            className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 font-display text-[15px] italic leading-relaxed text-foreground shadow-none focus-visible:ring-0"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
            {note.possibleDuplicate && (
              <span
                className="rounded bg-metal/15 px-1.5 py-0.5 text-[11px] text-metal"
                title="Very similar to a note already in the campaign — include only if it adds something new."
              >
                Possible duplicate
              </span>
            )}
            <div className="ml-auto flex items-center gap-1 text-metal">
              {note.confidence !== 'confirmed' && <CircleDashed className="size-3" />}
              <Select
                value={note.confidence}
                onValueChange={(v) => onPatch({ confidence: v as NoteConfidence })}
                disabled={!note.include}
              >
                <SelectTrigger
                  className="h-6 w-auto gap-1 border-0 bg-transparent px-1 text-[11px] text-metal focus:ring-0"
                  aria-label="Confidence"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_CONFIDENCES.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">
                      {NOTE_CONFIDENCE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// A dated state change, shown as a before→after diff ("Active → Fallen — Slain"), stamped at the
// batch's session on apply. Death (ended / presumed_ended) carries a blood skull.
export function StatusChangeRow({
  change,
  fromLifecycle,
  refName,
  onToggle
}: {
  change: ConfirmedStatusChange
  /** The entity's current lifecycle (existing entities only) — drives the before→after diff. */
  fromLifecycle?: Lifecycle | null
  refName: (r: EntityRef) => string
  onToggle: () => void
}) {
  const isDeath = change.lifecycle === 'ended' || change.lifecycle === 'presumed_ended'
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        change.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <Toggle on={change.include} onClick={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] text-foreground">{refName(change.entityRef)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {fromLifecycle != null && fromLifecycle !== change.lifecycle && (
              <>
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground line-through">
                  {LIFECYCLE_LABELS[fromLifecycle]}
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                isDeath ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary'
              )}
            >
              {isDeath && <Skull className="size-3.5" />}
              {LIFECYCLE_LABELS[change.lifecycle]}
            </span>
            {change.status && <span className="text-sm text-muted-foreground">{change.status}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// A relationship forming or ending, shown as a bond between two entities: form joins them with a
// solid ember rule + link; sever cuts them with a dashed blood rule + broken link.
export function RelationshipChangeRow({
  change,
  refName,
  onToggle
}: {
  change: ConfirmedRelationshipChange
  refName: (r: EntityRef) => string
  onToggle: () => void
}) {
  const isForm = change.action === 'form'
  const label = RELATIONS[change.relation]?.forward ?? change.relation
  const lineCls = isForm ? 'h-px bg-primary' : 'h-0 border-t border-dashed border-destructive/70'
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        change.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <Toggle on={change.include} onClick={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              title={refName(change.fromRef)}
              className="min-w-0 truncate rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-display text-sm text-foreground"
            >
              {refName(change.fromRef)}
            </span>
            <span className={cn('flex-1', lineCls)} />
            {isForm ? (
              <Link2 className="size-4 shrink-0 text-primary" />
            ) : (
              <Unlink className="size-4 shrink-0 text-destructive" />
            )}
            <span className={cn('flex-1', lineCls)} />
            <span
              title={refName(change.toRef)}
              className="min-w-0 truncate rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-display text-sm text-foreground"
            >
              {refName(change.toRef)}
            </span>
          </div>
          <div className="mt-1.5 text-center text-xs">
            <span className={isForm ? 'text-primary' : 'text-destructive'}>
              {isForm ? label : `no longer ${label}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// An edit to one existing entity's field (a trait/goal/flaw or a type attribute), shown as the op's
// diff: add = an ember "＋ value" chip · cut = a struck blood chip · alter = old → new (like a status
// diff). The field is labelled (Trait / Goal / Flaw / the attribute key); not chronology-versioned.
export function FieldChangeRow({
  change,
  refName,
  onToggle
}: {
  change: ConfirmedFieldChange
  refName: (r: EntityRef) => string
  onToggle: () => void
}) {
  const { op, value, oldValue } = change
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        change.include ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <Toggle on={change.include} onClick={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-[15px] text-foreground">{refName(change.entityRef)}</span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {fieldLabel(change.field)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {op === 'add' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 text-xs font-medium text-primary">
                <Plus className="size-3.5" />
                {value}
              </span>
            )}
            {op === 'cut' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-1 text-xs font-medium text-destructive">
                <Minus className="size-3.5" />
                <span className="line-through">{oldValue ?? value ?? 'cleared'}</span>
              </span>
            )}
            {op === 'alter' && (
              <>
                {oldValue && (
                  <>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground line-through">
                      {oldValue}
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </>
                )}
                <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-medium text-primary">
                  {value}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// A promoted list reads as its singular ("Trait"); an attribute key is title-cased ("Weakness").
function fieldLabel(field: string): string {
  if (field === 'traits') return 'Trait'
  if (field === 'goals') return 'Goal'
  if (field === 'flaws') return 'Flaw'
  return field.charAt(0).toUpperCase() + field.slice(1)
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
