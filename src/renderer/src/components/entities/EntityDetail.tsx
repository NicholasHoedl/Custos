import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { CircleDashed, Pencil, Skull, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPE_LABELS,
  LIFECYCLE_LABELS,
  NOTE_CONFIDENCE_LABELS,
  type Entity
} from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { profileFor, profileKeys, type ProfileField } from '@shared/entity-profiles'
import type { HierarchyView } from '@shared/graph-types'
import { ledger } from '@renderer/lib/ipc'
import { useCampaigns, useEntity, useNotes } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { formatTimestamp } from '@renderer/lib/format'
import { EntityForm } from './EntityForm'
import { RelationshipEditor } from './RelationshipEditor'
import { EntityHistory } from './EntityHistory'
import { PersonaEditor } from './PersonaEditor'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

interface EntityDetailProps {
  entityId: string
  allEntities: Entity[]
  onEntityChanged: () => void
  onDeleted: () => void
}

// The full record for a single entity: identity, hierarchy breadcrumb, traits/goals/attributes,
// relationships, and its note stream (read-only here — notes are authored on the Notes page).
export function EntityDetail({ entityId, allEntities, onEntityChanged, onDeleted }: EntityDetailProps) {
  const { entity, refresh: refreshEntity } = useEntity(entityId)
  const { notes, refresh: refreshNotes } = useNotes(entityId)
  const { campaigns } = useCampaigns()
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [hierarchy, setHierarchy] = useState<HierarchyView | null>(null)

  const isHierarchical = entity?.type === 'location' || entity?.type === 'faction'

  useEffect(() => {
    if (!entity || !isHierarchical) {
      setHierarchy(null)
      return
    }
    const kind = entity.type === 'location' ? 'location' : 'faction'
    ledger.graph
      .hierarchy(entity.id, kind)
      .then(setHierarchy)
      .catch(() => setHierarchy(null)) // intentional: the hierarchy tree is supplementary; degrade to hidden, not a toast
  }, [entity, isHierarchical])

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  async function removeNote(id: string) {
    try {
      await ledger.note.delete(id)
      refreshNotes()
    } catch (err) {
      toast.error('Could not delete note', { description: String(err) })
    }
  }

  async function handleDelete() {
    try {
      await ledger.entity.delete(entity!.id)
      useUiStore.getState().bumpEntities() // drop the deleted entity from every list immediately
      toast.success('Deleted', { description: entity!.name })
      onDeleted()
    } catch (err) {
      toast.error('Could not delete', { description: String(err) })
    }
  }

  const fallen = entity.lifecycle === 'ended'
  const presumed = entity.lifecycle === 'presumed_ended'
  // Main-character-only depth (ADR-029): backstory, persona, and voice examples belong to the MC alone.
  const isMainCharacter =
    campaigns.find((c) => c.id === entity.campaignId)?.mainCharacterId === entity.id

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
              {ENTITY_TYPE_LABELS[entity.type]}
            </span>
            {entity.status && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {entity.status}
              </span>
            )}
          </div>
          <h2
            className={cn(
              'mt-1 flex items-center gap-2 font-display text-2xl font-semibold text-foreground',
              fallen && 'text-foreground/70 line-through decoration-blood decoration-2',
              presumed && 'italic text-foreground/60'
            )}
          >
            {entity.name}
            {fallen && <Skull className="size-5 text-blood" aria-label="Fallen" />}
            {presumed && <Skull className="size-4 text-blood/60" aria-label="Presumed lost" />}
          </h2>
          {(fallen || presumed) && (
            <div className="inscribed mt-0.5 text-[11px] text-blood">
              {LIFECYCLE_LABELS[entity.lifecycle]}
            </div>
          )}
          {hierarchy && hierarchy.ancestors.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {hierarchy.ancestors.map((a) => (
                <span
                  key={a.id}
                  className="after:mx-1 after:content-['›'] last:after:content-['']"
                >
                  <button className="hover:text-primary" onClick={() => setSelectedEntity(a.id)}>
                    {a.name}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The main character's derive/persona tooling lives on the Character page (ADR-030) —
              Codex redirects the MC there, so no Suggest surface here. */}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-muted-foreground hover:border-destructive/50 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {entity.description && (
          <p className="text-sm leading-relaxed text-foreground/90">{entity.description}</p>
        )}

        {(entity.traits.length > 0 || entity.goals.length > 0) && (
          <div className="space-y-2">
            {entity.traits.length > 0 && <ChipRow label="Traits" items={entity.traits} />}
            {entity.goals.length > 0 && <ChipRow label="Goals" items={entity.goals} />}
          </div>
        )}

        <AttributesBlock entity={entity} isMainCharacter={isMainCharacter} />

        {isMainCharacter && entity.voiceExamples.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="inscribed text-xs">Voice</h3>
            <ul className="space-y-1">
              {entity.voiceExamples.map((v, i) => (
                <li
                  key={i}
                  className="border-l-2 border-metal/40 pl-3 font-display text-sm italic text-foreground/90"
                >
                  “{v}”
                </li>
              ))}
            </ul>
          </div>
        )}

        {entity.type === 'pc' && isMainCharacter && (
          <>
            <Separator />
            <PersonaEditor entityId={entity.id} />
          </>
        )}

        <Separator />

        <RelationshipEditor entity={entity} allEntities={allEntities} />

        <Separator />

        <EntityHistory entityId={entity.id} />

        <Separator />

        <div className="space-y-2">
          <h3 className="inscribed text-xs">Annals</h3>
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No annals recorded.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="group relative rounded-md border border-border bg-card/40 p-3 pr-9"
                >
                  <p className="whitespace-pre-wrap text-sm text-foreground/90">{n.content}</p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span>{formatTimestamp(n.createdAt)}</span>
                    {n.confidence !== 'confirmed' && (
                      <span className="inline-flex items-center gap-1 text-metal">
                        <CircleDashed className="size-3" />
                        {NOTE_CONFIDENCE_LABELS[n.confidence]}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeNote(n.id)}
                    className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label="Delete note"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {fallen && (
          <p className="border-t border-border/60 pt-3 font-display text-[13px] italic text-muted-foreground">
            “Another name for the Ledger of the Fallen.” — the Keeper
          </p>
        )}
      </div>

      <EntityForm
        open={editOpen}
        onOpenChange={setEditOpen}
        campaignId={entity.campaignId}
        entity={entity}
        onSaved={() => {
          refreshEntity()
          onEntityChanged()
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete {entity.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {entity.name}
              {notes.length > 0 && `, its ${notes.length} note${notes.length === 1 ? '' : 's'}`}, and
              all of its relationships. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      {items.map((it) => (
        <span key={it} className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-foreground">
          {it}
        </span>
      ))}
    </div>
  )
}

function isEmptyValue(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

function renderAttrValue(field: ProfileField | undefined, value: unknown): ReactNode {
  if (field?.kind === 'list' && Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(value as string[]).map((v) => (
          <span key={v} className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-foreground">
            {v}
          </span>
        ))}
      </div>
    )
  }
  if (field?.kind === 'textarea') {
    return <span className="whitespace-pre-wrap">{String(value)}</span>
  }
  return <>{String(value)}</>
}

// Type-specific fields shown with their profile labels (list as chips), followed by any ad-hoc /
// legacy attribute keys not owned by the profile so nothing is hidden.
function AttributesBlock({
  entity,
  isMainCharacter
}: {
  entity: Entity
  isMainCharacter: boolean
}) {
  const prof = profileFor(entity.type)
  const known = profileKeys(entity.type)
  const shown = prof.fields.filter(
    (f) => !isEmptyValue(entity.attributes[f.key]) && (!f.mainCharacterOnly || isMainCharacter)
  )
  const extra = Object.entries(entity.attributes).filter(
    ([k, v]) => !known.has(k) && !isEmptyValue(v)
  )
  if (shown.length === 0 && extra.length === 0) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1.5 text-sm">
      {shown.map((f) => (
        <Fragment key={f.key}>
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className="text-foreground">{renderAttrValue(f, entity.attributes[f.key])}</dd>
        </Fragment>
      ))}
      {extra.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="capitalize text-muted-foreground">{k}</dt>
          <dd className="text-foreground">{String(v)}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
