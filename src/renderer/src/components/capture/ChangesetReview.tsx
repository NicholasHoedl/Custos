import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { Entity, EntityType, Lifecycle, Session } from '@shared/entity-types'
import type {
  ConfirmedEntity,
  ConfirmedFieldChange,
  ConfirmedNote,
  ConfirmedRelationshipChange,
  ConfirmedStatusChange,
  EntityRef,
  ExtractionProposal,
  MatchCandidate
} from '@shared/import-types'
import type { ImportStatus } from '@renderer/hooks/use-import'
import { plural } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import {
  BulkToggle,
  EntityRow,
  FieldChangeRow,
  NoteRow,
  RelationshipChangeRow,
  StatusChangeRow
} from '@renderer/components/capture/import-rows'

/**
 * The structural surface this reviewer needs (ADR-035): the five confirmed arrays + setters, the
 * proposal (match candidates for entity rows), and a status (only 'applying' is consulted). A
 * `useImport()` return satisfies it as-is; `use-enrich` supplies constant-empty entities/notes/status
 * so only the Relationships + Fields sections render.
 */
export interface ChangesetReviewModel {
  status: ImportStatus
  proposal: ExtractionProposal | null
  entities: ConfirmedEntity[]
  notes: ConfirmedNote[]
  statusChanges: ConfirmedStatusChange[]
  relationshipChanges: ConfirmedRelationshipChange[]
  fieldChanges: ConfirmedFieldChange[]
  setEntities: Dispatch<SetStateAction<ConfirmedEntity[]>>
  setNotes: Dispatch<SetStateAction<ConfirmedNote[]>>
  setStatusChanges: Dispatch<SetStateAction<ConfirmedStatusChange[]>>
  setRelationshipChanges: Dispatch<SetStateAction<ConfirmedRelationshipChange[]>>
  setFieldChanges: Dispatch<SetStateAction<ConfirmedFieldChange[]>>
}

// The shared review surface for an extraction changeset — entities, status/relationship changes, and
// notes, each include-gated, with a summary + Apply/Discard footer. Driven by any ChangesetReviewModel
// (a `useImport()` instance for Chronicle/Transcribe/backstory, a `useEnrich()` review for Illuminate)
// over the same row components. The close-out wizard's volume options are opt-in (ADR-035): `bulk`
// adds a tri-state select-all per section, `density="compact"` tightens rows — existing callers pass
// neither and are unchanged.
export function ChangesetReview({
  imp,
  campaignEntities,
  sessions,
  onApply,
  onDiscard,
  applyLabel = 'Apply',
  discardLabel = 'Discard',
  bulk = false,
  density = 'comfortable'
}: {
  imp: ChangesetReviewModel
  campaignEntities: Entity[]
  /** When provided, created entities get a "first appeared" session selector (backfill roster). */
  sessions?: Session[]
  onApply: () => void
  onDiscard: () => void
  applyLabel?: string
  discardLabel?: string
  /** Tri-state select-all checkbox per section (the close-out wizard's mass review). */
  bulk?: boolean
  density?: 'comfortable' | 'compact'
}): ReactNode {
  const compact = density === 'compact'
  const matchesByIndex = useMemo(() => {
    const m = new Map<number, MatchCandidate[]>()
    imp.proposal?.entities.forEach((pe) => m.set(pe.index, pe.matches))
    return m
  }, [imp.proposal])

  const existingName = (id: string): string =>
    campaignEntities.find((e) => e.id === id)?.name ?? 'an entity'
  const refName = (r: EntityRef): string =>
    r.kind === 'existing'
      ? existingName(r.entityId)
      : (imp.entities.find((e) => e.index === r.index)?.name ?? 'new entity')
  // The entity's CURRENT lifecycle (existing entities only) — lets a status change render as a
  // before→after diff. A newly-created entity has no prior state, so it shows only the new one.
  const fromLifecycle = (r: EntityRef): Lifecycle | null =>
    r.kind === 'existing'
      ? (campaignEntities.find((e) => e.id === r.entityId)?.lifecycle ?? null)
      : null
  // The referenced entity's type — so a status change renders a type-appropriate lifecycle word
  // ("Destroyed" for a location, not "Fallen"; ADR-054).
  const refType = (r: EntityRef): EntityType | null =>
    r.kind === 'existing'
      ? (campaignEntities.find((e) => e.id === r.entityId)?.type ?? null)
      : (imp.entities.find((e) => e.index === r.index)?.type ?? null)

  const creating = imp.entities.filter((e) => e.action === 'create').length
  const linking = imp.entities.filter((e) => e.action === 'link').length
  const noting = imp.notes.filter((n) => n.include).length
  const changing =
    imp.statusChanges.filter((c) => c.include).length +
    imp.relationshipChanges.filter((c) => c.include).length +
    imp.fieldChanges.filter((c) => c.include).length
  const applying = imp.status === 'applying'
  const nothing = creating === 0 && linking === 0 && noting === 0 && changing === 0

  // ---- Bulk select-all (opt-in, ADR-035): tri-state per section, wired through the same setters ----
  const triState = (on: number, total: number): 'all' | 'some' | 'none' =>
    on === 0 ? 'none' : on === total ? 'all' : 'some'
  const entityOn = imp.entities.filter((e) => e.action !== 'skip').length
  const entityBulk = {
    state: triState(entityOn, imp.entities.length),
    onToggle: () => {
      const allOn = entityOn === imp.entities.length
      // Off: patch action only (linkToEntityId survives). On: restore ONLY skipped rows via the same
      // derivation the row toggle uses — an identical round-trip to clicking each toggle.
      imp.setEntities((es) =>
        es.map((e) =>
          allOn
            ? { ...e, action: 'skip' as const }
            : e.action === 'skip'
              ? { ...e, action: e.linkToEntityId ? ('link' as const) : ('create' as const) }
              : e
        )
      )
    }
  }
  const includeBulk = <T extends { include: boolean }>(
    items: T[],
    set: (updater: (prev: T[]) => T[]) => void
  ): { state: 'all' | 'some' | 'none'; onToggle: () => void } => {
    const on = items.filter((i) => i.include).length
    return {
      state: triState(on, items.length),
      onToggle: () => {
        const next = on !== items.length
        set((prev) => prev.map((i) => ({ ...i, include: next })))
      }
    }
  }
  const counts = {
    entities: `${entityOn}/${imp.entities.length}`,
    status: `${imp.statusChanges.filter((c) => c.include).length}/${imp.statusChanges.length}`,
    rels: `${imp.relationshipChanges.filter((c) => c.include).length}/${imp.relationshipChanges.length}`,
    fields: `${imp.fieldChanges.filter((c) => c.include).length}/${imp.fieldChanges.length}`,
    notes: `${noting}/${imp.notes.length}`
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={cn('min-w-0 flex-1 overflow-y-auto pr-1', compact ? 'space-y-3' : 'space-y-4')}>
        {imp.entities.length > 0 && (
          <Section
            label="Entities"
            compact={compact}
            bulk={bulk ? entityBulk : undefined}
            count={bulk ? counts.entities : undefined}
          >
            {imp.entities.map((e) => (
              <EntityRow
                key={e.index}
                entity={e}
                matches={matchesByIndex.get(e.index) ?? []}
                existingName={existingName}
                sessions={sessions}
                compact={compact}
                onPatch={(p) =>
                  imp.setEntities((es) => es.map((x) => (x.index === e.index ? { ...x, ...p } : x)))
                }
              />
            ))}
          </Section>
        )}
        {imp.statusChanges.length > 0 && (
          <Section
            label="Status changes"
            compact={compact}
            bulk={bulk ? includeBulk(imp.statusChanges, imp.setStatusChanges) : undefined}
            count={bulk ? counts.status : undefined}
          >
            {imp.statusChanges.map((c, i) => (
              <StatusChangeRow
                key={i}
                change={c}
                fromLifecycle={fromLifecycle(c.entityRef)}
                entityType={refType(c.entityRef)}
                refName={refName}
                compact={compact}
                onToggle={() =>
                  imp.setStatusChanges((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                  )
                }
              />
            ))}
          </Section>
        )}
        {imp.relationshipChanges.length > 0 && (
          <Section
            label="Relationship changes"
            compact={compact}
            bulk={bulk ? includeBulk(imp.relationshipChanges, imp.setRelationshipChanges) : undefined}
            count={bulk ? counts.rels : undefined}
          >
            {imp.relationshipChanges.map((c, i) => (
              <RelationshipChangeRow
                key={i}
                change={c}
                refName={refName}
                compact={compact}
                onPatch={(p) =>
                  imp.setRelationshipChanges((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, ...p } : x))
                  )
                }
              />
            ))}
          </Section>
        )}
        {imp.fieldChanges.length > 0 && (
          <Section
            label="Field changes"
            compact={compact}
            bulk={bulk ? includeBulk(imp.fieldChanges, imp.setFieldChanges) : undefined}
            count={bulk ? counts.fields : undefined}
          >
            {imp.fieldChanges.map((c, i) => (
              <FieldChangeRow
                key={i}
                change={c}
                refName={refName}
                compact={compact}
                onToggle={() =>
                  imp.setFieldChanges((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                  )
                }
              />
            ))}
          </Section>
        )}
        {imp.notes.length > 0 && (
          <Section
            label="Notes"
            compact={compact}
            bulk={bulk ? includeBulk(imp.notes, imp.setNotes) : undefined}
            count={bulk ? counts.notes : undefined}
          >
            {imp.notes.map((n, i) => (
              <NoteRow
                key={i}
                note={n}
                refName={refName}
                compact={compact}
                onPatch={(p) => imp.setNotes((ns) => ns.map((x, j) => (j === i ? { ...x, ...p } : x)))}
              />
            ))}
          </Section>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {creating} new · {linking} linked · {changing} {plural(changing, 'change', 'changes')} ·{' '}
          {noting} {plural(noting, 'note', 'notes')}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={applying}>
            {discardLabel}
          </Button>
          <Button size="sm" onClick={onApply} disabled={applying || nothing}>
            {applying ? 'Applying…' : applyLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Section({
  label,
  bulk,
  count,
  compact,
  children
}: {
  label: string
  /** Opt-in tri-state select-all for the section (the close-out wizard's mass review). */
  bulk?: { state: 'all' | 'some' | 'none'; onToggle: () => void }
  count?: string
  compact?: boolean
  children: ReactNode
}) {
  return (
    <section className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center gap-2">
        {bulk && <BulkToggle state={bulk.state} onClick={bulk.onToggle} label={label} />}
        <h3 className="inscribed text-xs">{label}</h3>
        {count && <span className="text-[0.6875rem] text-muted-foreground">{count}</span>}
      </div>
      {children}
    </section>
  )
}
