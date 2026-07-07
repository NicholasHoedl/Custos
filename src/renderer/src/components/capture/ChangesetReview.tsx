import { useMemo, type ReactNode } from 'react'
import type { Entity, Lifecycle, Session } from '@shared/entity-types'
import type { EntityRef, MatchCandidate } from '@shared/import-types'
import type { useImport } from '@renderer/hooks/use-import'
import { plural } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import {
  EntityRow,
  NoteRow,
  RelationshipChangeRow,
  StatusChangeRow
} from '@renderer/components/capture/import-rows'

type Imp = ReturnType<typeof useImport>

// The shared review surface for an extraction changeset — entities, status/relationship changes, and
// notes, each include-gated, with a summary + Apply/Discard footer. Driven by a `useImport()` instance
// so both callers — the Journal (Chronicle) and Import (Transcribe) — reuse one reviewer over the same
// row components.
export function ChangesetReview({
  imp,
  campaignEntities,
  sessions,
  onApply,
  onDiscard,
  applyLabel = 'Apply'
}: {
  imp: Imp
  campaignEntities: Entity[]
  /** When provided, created entities get a "first appeared" session selector (backfill roster). */
  sessions?: Session[]
  onApply: () => void
  onDiscard: () => void
  applyLabel?: string
}): ReactNode {
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

  const creating = imp.entities.filter((e) => e.action === 'create').length
  const linking = imp.entities.filter((e) => e.action === 'link').length
  const noting = imp.notes.filter((n) => n.include).length
  const changing =
    imp.statusChanges.filter((c) => c.include).length +
    imp.relationshipChanges.filter((c) => c.include).length
  const applying = imp.status === 'applying'
  const nothing = creating === 0 && linking === 0 && noting === 0 && changing === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {imp.entities.length > 0 && (
          <Section label="Entities">
            {imp.entities.map((e) => (
              <EntityRow
                key={e.index}
                entity={e}
                matches={matchesByIndex.get(e.index) ?? []}
                existingName={existingName}
                sessions={sessions}
                onPatch={(p) =>
                  imp.setEntities((es) => es.map((x) => (x.index === e.index ? { ...x, ...p } : x)))
                }
              />
            ))}
          </Section>
        )}
        {imp.statusChanges.length > 0 && (
          <Section label="Status changes">
            {imp.statusChanges.map((c, i) => (
              <StatusChangeRow
                key={i}
                change={c}
                fromLifecycle={fromLifecycle(c.entityRef)}
                refName={refName}
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
          <Section label="Relationship changes">
            {imp.relationshipChanges.map((c, i) => (
              <RelationshipChangeRow
                key={i}
                change={c}
                refName={refName}
                onToggle={() =>
                  imp.setRelationshipChanges((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                  )
                }
              />
            ))}
          </Section>
        )}
        {imp.notes.length > 0 && (
          <Section label="Annals">
            {imp.notes.map((n, i) => (
              <NoteRow
                key={i}
                note={n}
                refName={refName}
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
            Discard
          </Button>
          <Button size="sm" onClick={onApply} disabled={applying || nothing}>
            {applying ? 'Applying…' : applyLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}
